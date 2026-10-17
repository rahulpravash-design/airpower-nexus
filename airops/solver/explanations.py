"""Evidence-based reason codes. Every code is derived from event data, the validator's
verdict on the *previous* assignment under the *new* scenario, or measured plan facts."""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from ..core.config import PlanningConfig
from ..core.entities import Assignment, Plan, ReasonCode, Scenario
from ..core.rules import ScenarioIndex

VIOLATION_TO_REASON = {
    "RUNWAY_WINDOW": "RUNWAY_WINDOW_CLOSED",
    "WEATHER_MINIMA": "BASE_WEATHER_CLOSURE",
    "CORRIDOR_OPEN": "CORRIDOR_BLOCKED",
    "CREW_REST": "CREW_REST_CONSTRAINT",
    "CREW_DUTY_LIMIT": "CREW_DUTY_LIMIT_CONSTRAINT",
    "CREW_OVERLAP": "CREW_TURNAROUND_CONSTRAINT",
    "TURNAROUND": "TURNAROUND_CONSTRAINT",
}


def explain(
    scn_before: Scenario, scn_after: Scenario, cfg_before: PlanningConfig, cfg_after: PlanningConfig,
    plan_before: Plan, plan_after: Plan, event: dict, prior_viol: dict[str, list], invalidated: list[dict],
    now: int,
) -> list[ReasonCode]:
    ix_b = ScenarioIndex(scn_before, cfg_before)
    ix_a = ScenarioIndex(scn_after, cfg_after)
    diff = plan_after.diff
    assert diff is not None
    before = {a.mission_id: a for a in plan_before.assignments}
    after = {a.mission_id: a for a in plan_after.assignments}
    out: list[ReasonCode] = []
    seen: set[tuple[str, Optional[str]]] = set()

    def add(code: str, mid: Optional[str], msg: str, **evidence) -> None:
        if (code, mid) in seen:
            return
        seen.add((code, mid))
        out.append(ReasonCode(code=code, mission_id=mid, message=msg, evidence=evidence))

    etype = event.get("type")
    affected = sorted(prior_viol)
    # ---- event-level reasons (supported directly by the event payload)
    if etype == "AIRCRAFT_UNAVAILABLE":
        add("AIRCRAFT_UNAVAILABLE", None, event["description"], aircraft_id=event["target"], affected_missions=affected)
    elif etype == "BASE_WEATHER":
        add("BASE_WEATHER_CLOSURE", None, event["description"], base_id=event["target"], affected_missions=affected)
    elif etype == "NEW_PRIORITY1_MISSION":
        add("HIGHER_PRIORITY_MISSION", None, event["description"], mission_id=event["target"],
            covered=after[event["target"]].covered if event["target"] in after else False)
    elif etype == "NEW_THREAT":
        thr = ix_a.threats[event["target"]]
        hit = sorted({c.id for c in scn_after.corridors if ix_a.exposure(c, thr) > 0})
        add("CORRIDOR_RISK_INCREASE", None, event["description"], threat_id=thr.id, corridors_intersected=hit,
            blocking=thr.blocking, affected_missions=affected)
    elif etype == "CONFIG_CHANGE":
        add("CONFIG_CHANGED", None, event["description"], changed=event.get("changed", {}))

    # ---- invalidated frozen assignments
    for inv in invalidated:
        add("FREEZE_OVERRIDE_INVALIDATED", inv["mission_id"],
            f"{inv['mission_id']} was {inv['lock']} but an event invalidated it; only this assignment was released",
            lock=inv["lock"], violations=inv["violations"])

    def violation_reasons(mid: str) -> bool:
        vs = prior_viol.get(mid)
        if not vs:
            return False
        for v in vs:
            if v.code == "ASSET_AVAILABLE":
                ac = ix_a.aircraft.get(v.resource_id or "")
                if ac is not None and ac.unavailable_from_slot is not None:
                    add("AIRCRAFT_UNAVAILABLE", mid, v.message, aircraft_id=ac.id, unavailable_from=ac.unavailable_from_slot)
                else:
                    add("ASSET_UNAVAILABLE", mid, v.message, resource_id=v.resource_id)
            else:
                code = VIOLATION_TO_REASON.get(v.code, f"CONSTRAINT_{v.code}")
                add(code, mid, v.message, resource_id=v.resource_id, rule=v.code)
        return True

    new_priority_by_resource: dict[str, list[str]] = defaultdict(list)
    for a2 in plan_after.diff.changed_missions + plan_after.diff.added_missions:
        n = after[a2]
        if n.covered:
            for r in n.aircraft_ids + n.crew_ids:
                new_priority_by_resource[r].append(a2)

    def stock_left(bid: str, l: str) -> int:
        used = sum(len(a.aircraft_ids) for a in after.values() if a.covered and a.base_id == bid and a.loadout == l)
        return ix_a.bases[bid].loadout_stock.get(l, 0) - used

    targets = list(dict.fromkeys(diff.changed_missions + diff.added_missions))
    for mid in targets:
        o, n = before.get(mid), after[mid]
        m = ix_a.missions[mid]
        explained = False
        if mid in diff.added_missions:
            add("NEW_MISSION_ADDED", mid, f"{mid} was added by the event", priority=m.priority, covered=n.covered)
            explained = True
        if o is not None:
            explained |= violation_reasons(mid)
            # corridor risk increase (old corridor still open but riskier than before)
            if o.corridor_id and o.corridor_id in ix_a.corridors and n.corridor_id != o.corridor_id and mid not in prior_viol:
                r_old_b = ix_b.corridor_info(ix_b.missions[mid], ix_b.corridors[o.corridor_id]).risk if mid in ix_b.missions else None
                r_old_a = ix_a.corridor_info(m, ix_a.corridors[o.corridor_id]).risk
                if r_old_b is not None and r_old_a > r_old_b + 1e-6:
                    add("CORRIDOR_RISK_INCREASE", mid, f"risk of {o.corridor_id} rose {r_old_b:.2f} -> {r_old_a:.2f}",
                        old_corridor=o.corridor_id, risk_before=r_old_b, risk_after=r_old_a, new_corridor=n.corridor_id)
                    explained = True
            # displaced by a higher-priority mission that now holds the same resource
            shared = [(r, other) for r in o.aircraft_ids + o.crew_ids for other in new_priority_by_resource.get(r, [])
                      if other != mid and ix_a.missions[other].priority < m.priority]
            if shared and not (n.covered and set(o.aircraft_ids + o.crew_ids) == set(n.aircraft_ids + n.crew_ids)):
                add("HIGHER_PRIORITY_MISSION", mid,
                    f"{mid} (P{m.priority}) lost resources to higher-priority {shared[0][1]}",
                    resources=sorted({r for r, _ in shared}), displaced_by=sorted({x for _, x in shared}))
                explained = True
            # low-trust asset replaced
            low = [(r, ix_b.aircraft[r].trust) for r in o.aircraft_ids if r not in n.aircraft_ids and r in ix_b.aircraft
                   and ix_b.aircraft[r].trust < cfg_after.trust_threshold]
            low += [(r, ix_b.crew[r].trust) for r in o.crew_ids if r not in n.crew_ids and r in ix_b.crew
                    and ix_b.crew[r].trust < cfg_after.trust_threshold]
            if low and n.covered:
                add("LOW_TRUST_INPUT", mid, f"replaced low-trust asset(s) {', '.join(r for r, _ in low)}",
                    assets=[{"id": r, "trust": t} for r, t in low], threshold=cfg_after.trust_threshold)
                explained = True
            # load-out changed because stock is exhausted at the old base/load-out
            if n.covered and o.covered and o.loadout != n.loadout and o.base_id == n.base_id and o.base_id:
                add("LOADOUT_STOCK_LIMIT", mid, f"load-out {o.loadout}->{n.loadout} at {o.base_id}; "
                    f"{o.loadout} stock left {stock_left(o.base_id, o.loadout)}",
                    base=o.base_id, old=o.loadout, new=n.loadout, stock_left_old=stock_left(o.base_id, o.loadout))
                explained = True
        # newly uncovered: diagnose from plan facts
        if o is not None and o.covered and not n.covered and "CAUSE" not in seen:
            bases = sorted({a.home_base for a in ix_a.aircraft_candidates(m, *ix_a.mission_bounds(m, now))})
            left = {b: {l: stock_left(b, l) for l in m.loadouts} for b in bases}
            if bases and all(all(v < m.package_size for v in d.values()) for d in left.values()):
                add("LOADOUT_STOCK_LIMIT", mid, f"no base with eligible aircraft has load-out stock for {mid}",
                    stock_left=left, needed=m.package_size)
            elif not explained:
                add("RESOURCE_SHORTAGE", mid, f"{mid} could not be covered with remaining feasible resources",
                    eligible_aircraft=len(ix_a.aircraft_candidates(m, *ix_a.mission_bounds(m, now))),
                    eligible_crew=len(ix_a.crew_candidates(m, *ix_a.mission_bounds(m, now))),
                    stock_left=left)
            explained = True
        if not explained:
            add("OBJECTIVE_REOPTIMIZATION", mid,
                "previous assignment was still valid; re-optimisation changed it for a better overall objective",
                prior_assignment_valid=mid not in prior_viol)
    return out
