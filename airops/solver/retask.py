"""Event-driven re-planning: apply one of four events, freeze imminent launches, re-optimise."""
from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Optional

from ..core.config import PlanningConfig
from ..core.entities import (
    AppliedEvent, Assignment, Mission, Plan, Scenario, StatusReport, Threat, ROLES, LOADOUTS,
)
from ..core.events import (
    AircraftUnavailableEvent, BaseWeatherEvent, NewPriority1MissionEvent, NewThreatEvent,
)
from ..core.geometry import regular_polygon
from ..core.entities import Closure
from ..core.rules import ScenarioIndex
from ..core.validation import validate_plan
from ..predict.fatigue import fatigue_risk
from ..trust.score import assess_record, assess_scenario
from .diff import diff_plans
from .explanations import explain
from .plan import generate_plan


class EventError(ValueError):
    """The event cannot be applied to the current scenario (maps to HTTP 422)."""


def _next_id(prefix: str, existing: list[str], width: int) -> str:
    n = 0
    for e in existing:
        try:
            n = max(n, int(e.rsplit("-", 1)[1]))
        except (ValueError, IndexError):
            pass
    return f"{prefix}-{n + 1:0{width}d}"


def apply_event(scn: Scenario, ev, cfg: PlanningConfig) -> tuple[Scenario, int, dict]:
    """Return (new scenario, now_slot, summary). The input scenario is never mutated."""
    new = scn.model_copy(deep=True)
    new.version = scn.version + 1
    now = ev.now_slot if ev.now_slot is not None else cfg.default_event_slot
    H = new.horizon_slots
    ref = new.reference_time

    if isinstance(ev, AircraftUnavailableEvent):
        ac = next((a for a in new.aircraft if a.id == ev.aircraft_id), None)
        if ac is None:
            raise EventError(f"unknown aircraft {ev.aircraft_id}")
        if ac.status == "UNAVAILABLE":
            raise EventError(f"{ac.id} is already unavailable")
        ac.status = "UNAVAILABLE"
        ac.unavailable_from_slot = now
        ac.last_update = ref
        ac.reports = [StatusReport(source="BASE_OPS", status="UNAVAILABLE", last_update=ref)]
        assess_record("aircraft", ac, ref, cfg)
        summary = {"type": ev.type, "target": ac.id, "now_slot": now,
                   "description": f"{ac.id} ({ac.role}, {ac.home_base}) unavailable from slot {now}"}
    elif isinstance(ev, BaseWeatherEvent):
        base = next((b for b in new.bases if b.id == ev.base_id), None)
        if base is None:
            raise EventError(f"unknown base {ev.base_id}")
        base.weather_closures.append(Closure(start_slot=now, end_slot=now + ev.duration_slots,
                                             reason="WEATHER_BELOW_MINIMA"))
        base.last_update = ref
        assess_record("base", base, ref, cfg)
        summary = {"type": ev.type, "target": base.id, "now_slot": now,
                   "description": f"{base.id} below weather minima slots {now}-{now + ev.duration_slots}"}
    elif isinstance(ev, NewPriority1MissionEvent):
        if ev.role not in ROLES:
            raise EventError(f"unknown role {ev.role}")
        if not any(a.id == ev.area_id for a in new.areas):
            raise EventError(f"unknown area {ev.area_id}")
        if not ev.loadouts or any(l not in LOADOUTS for l in ev.loadouts):
            raise EventError("loadouts must be a non-empty subset of A, B, C")
        earliest = max(now, ev.earliest_start if ev.earliest_start is not None else now + 2)
        if earliest > H - ev.duration_slots:
            raise EventError("mission cannot fit inside the planning horizon")
        latest = min(earliest + ev.window_slots, H - ev.duration_slots)
        mid = _next_id("M", [m.id for m in new.missions], 3)
        m = Mission(id=mid, priority=1, role=ev.role, area_id=ev.area_id, package_size=ev.package_size,
                    earliest_start=earliest, latest_start=latest, duration_slots=ev.duration_slots,
                    loadouts=sorted(set(ev.loadouts)), source="MISSION_TASKING", last_update=ref,
                    created_by_event=ev.type)
        assess_record("mission", m, ref, cfg)
        new.missions.append(m)
        summary = {"type": ev.type, "target": mid, "now_slot": now,
                   "description": f"new P1 mission {mid}: {ev.role} x{ev.package_size} to {ev.area_id}, "
                                  f"launch slots {earliest}-{latest}"}
    elif isinstance(ev, NewThreatEvent):
        start = ev.start_slot if ev.start_slot is not None else now
        end = ev.end_slot if ev.end_slot is not None else H
        if end < start:
            raise EventError("end_slot must be >= start_slot")
        tid = _next_id("THR", [t.id for t in new.threats], 2)
        thr = Threat(id=tid, name=ev.label, polygon=regular_polygon(ev.center_x, ev.center_y, ev.radius_km, 8),
                     start_slot=start, end_slot=end, severity=ev.severity, blocking=ev.blocking,
                     source="THREAT_FEED", last_update=ref)
        assess_record("threat", thr, ref, cfg)
        new.threats.append(thr)
        summary = {"type": ev.type, "target": tid, "now_slot": now,
                   "description": f"fictional threat {tid} ({'blocking' if ev.blocking else 'risk'}, "
                                  f"severity {ev.severity}) slots {start}-{end}"}
    else:  # pragma: no cover
        raise EventError(f"unsupported event {type(ev).__name__}")

    new.event_log.append(AppliedEvent(type=summary["type"], now_slot=now, summary=summary["description"],
                                      payload=ev.model_dump(mode="json")))
    return new, now, summary


# ---------------------------------------------------------------------- freeze logic
def determine_frozen(
    scn_after: Scenario, cfg: PlanningConfig, plan_before: Plan, now: int, ix: ScenarioIndex,
) -> tuple[dict[str, Assignment], list[dict]]:
    """Freeze valid assignments launching within the freeze window (or already launched)."""
    frozen: dict[str, Assignment] = {}
    invalidated: list[dict] = []
    for a in plan_before.assignments:
        if not a.covered or a.start_slot is None or a.start_slot > now + cfg.freeze_slots:
            continue
        lock = "IN_PROGRESS" if a.start_slot < now else "FREEZE_WINDOW"
        cand = a.model_copy(update={"lock": lock})
        rep = validate_plan(scn_after, cfg, [cand], index=ix)
        if rep.valid:
            frozen[a.mission_id] = cand
        else:
            invalidated.append({"mission_id": a.mission_id, "lock": lock,
                                "violations": [{"code": v.code, "message": v.message, "resource_id": v.resource_id}
                                               for v in rep.violations]})
    # frozen assignments must also be consistent with each other (e.g. after a config change)
    for _ in range(len(frozen) + 1):
        rep = validate_plan(scn_after, cfg, list(frozen.values()), index=ix)
        if rep.valid:
            break
        bad = {v.mission_id for v in rep.violations if v.mission_id in frozen}
        if not bad:  # stock overrun among frozen: release the latest launch at that base
            bases = {v.resource_id for v in rep.violations}
            pool = [a for a in frozen.values() if a.base_id in bases]
            bad = {max(pool, key=lambda z: z.start_slot or 0).mission_id} if pool else set(frozen)
        for mid in bad:
            a = frozen.pop(mid)
            invalidated.append({"mission_id": mid, "lock": a.lock, "violations": [
                {"code": v.code, "message": v.message, "resource_id": v.resource_id}
                for v in rep.violations if v.mission_id == mid or v.mission_id is None]})
    return frozen, invalidated


def replan(
    scn_before: Scenario,
    scn_after: Scenario,
    plan_before: Plan,
    cfg_before: PlanningConfig,
    cfg_after: PlanningConfig,
    *,
    now: int,
    trigger: str,
    event: Optional[dict] = None,
    plan_id: Optional[str] = None,
    time_limit: Optional[float] = None,
    persistence: bool = True,
    use_freeze: bool = True,
    allow_fallback: bool = True,
    method: str = "CP_SAT",
    greedy_hint: bool = True,
) -> Plan:
    ix = ScenarioIndex(scn_after, cfg_after)
    prior_viol: dict[str, list] = {}
    for a in plan_before.assignments:
        if a.covered:
            rep = validate_plan(scn_after, cfg_after, [a], index=ix)
            if not rep.valid:
                prior_viol[a.mission_id] = rep.violations
    frozen, invalidated = determine_frozen(scn_after, cfg_after, plan_before, now, ix) if use_freeze else ({}, [])
    notes: list[str] = []
    if invalidated:
        notes.append(f"{len(invalidated)} frozen assignment(s) were invalidated by this change and released")
    plan = generate_plan(
        scn_after, cfg_after, plan_id=plan_id, trigger=trigger, parent_plan_id=plan_before.id, prior=plan_before,
        frozen=frozen, min_start=now, persistence=persistence, time_limit=time_limit, event=event,
        notes=notes, allow_fallback=allow_fallback, method=method, greedy_hint=greedy_hint)
    plan.invalidated_frozen = invalidated
    plan.diff = diff_plans(plan_before, plan)
    plan.metrics.changed_missions = plan.diff.changed_mission_count
    plan.metrics.unchanged_missions = len(plan.diff.unchanged_missions)
    plan.reasons = explain(scn_before, scn_after, cfg_before, cfg_after, plan_before, plan, event or {},
                           prior_viol, invalidated, now)
    return plan


def replan_event(scn_before: Scenario, plan_before: Plan, ev, cfg: PlanningConfig, **kw) -> tuple[Scenario, Plan]:
    scn_after, now, summary = apply_event(scn_before, ev, cfg)
    plan = replan(scn_before, scn_after, plan_before, cfg, cfg, now=now, trigger=summary["type"],
                  event=summary, **kw)
    return scn_after, plan


def replan_config(scn_before: Scenario, plan_before: Plan, cfg_before: PlanningConfig,
                  cfg_after: PlanningConfig, **kw) -> tuple[Scenario, Plan]:
    """Configuration change (e.g. crew rest 10 h -> 12 h) triggers a new calculation."""
    scn_after = scn_before.model_copy(deep=True)
    scn_after.version += 1
    assess_scenario(scn_after, cfg_after)
    for c in scn_after.crew:
        if c.record_valid:
            c.fatigue_risk = fatigue_risk(c, cfg_after)
    changed = {k: [getattr(cfg_before, k), getattr(cfg_after, k)] for k in cfg_after.model_fields
               if getattr(cfg_before, k) != getattr(cfg_after, k)}
    summary = {"type": "CONFIG_CHANGE", "target": ",".join(sorted(changed)) or "none",
               "now_slot": cfg_after.default_event_slot, "changed": changed,
               "description": "configuration changed: " + ", ".join(f"{k} {v[0]}->{v[1]}" for k, v in changed.items())}
    scn_after.event_log.append(AppliedEvent(type="CONFIG_CHANGE", now_slot=summary["now_slot"],
                                            summary=summary["description"], payload={"changed": changed}))
    plan = replan(scn_before, scn_after, plan_before, cfg_before, cfg_after, now=summary["now_slot"],
                  trigger="CONFIG_CHANGE", event=summary, **kw)
    return scn_after, plan


# ---------------------------------------------------------------------- deterministic event suggestions
def suggest_event(kind: str, scn: Scenario, plan: Plan, cfg: PlanningConfig):
    now = cfg.default_event_slot
    ix = ScenarioIndex(scn, cfg)
    later = [a for a in plan.assignments if a.covered and (a.start_slot or 0) > now + cfg.freeze_slots]
    if kind == "AIRCRAFT_UNAVAILABLE":
        cnt = Counter(aid for a in later for aid in a.aircraft_ids if ix.aircraft[aid].status != "UNAVAILABLE")
        if not cnt:
            cand = [a.id for a in scn.aircraft if a.status == "AVAILABLE"]
            if not cand:
                raise EventError("no available aircraft to suggest")
            return AircraftUnavailableEvent(type=kind, aircraft_id=sorted(cand)[0], now_slot=now)
        best = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        return AircraftUnavailableEvent(type=kind, aircraft_id=best, now_slot=now)
    if kind == "BASE_WEATHER":
        cnt = Counter(a.base_id for a in later if a.base_id)
        base = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if cnt else scn.bases[0].id
        return BaseWeatherEvent(type=kind, base_id=base, duration_slots=16, now_slot=now)
    if kind == "NEW_PRIORITY1_MISSION":
        load = Counter(ix.missions[a.mission_id].role for a in plan.assignments if a.covered)
        role = sorted(load.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if load else "R1"
        return NewPriority1MissionEvent(type=kind, role=role, area_id=scn.areas[0].id, package_size=2,
                                        earliest_start=now + 3, window_slots=6, duration_slots=10,
                                        loadouts=["A", "B"], now_slot=now)
    if kind == "NEW_THREAT":
        cnt = Counter(a.corridor_id for a in later if a.corridor_id)
        cid = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if cnt else scn.corridors[0].id
        wp = ix.corridors[cid].waypoints
        mx, my = wp[1]
        return NewThreatEvent(type=kind, center_x=mx, center_y=my, radius_km=45, severity=0.9, blocking=True,
                              start_slot=now, end_slot=scn.horizon_slots, now_slot=now,
                              label="Zone Nightfall")
    raise EventError(f"unknown event type {kind}")
