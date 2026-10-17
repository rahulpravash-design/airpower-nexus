"""Independent hard-rule plan validator.

This module never imports the solver. It re-derives every rule from the raw
scenario + configuration and reports every violation it finds. A plan is only
``valid`` when *all* rules pass.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Optional

from .config import PlanningConfig
from .entities import (
    Assignment, RuleResult, Scenario, ValidationReport, Violation,
)
from .rules import ScenarioIndex

RULES: list[tuple[str, str]] = [
    ("STRUCTURE", "Every assignment refers to a known mission, once; uncovered missions hold no resources"),
    ("PACKAGE_SIZE", "Covered mission has exactly package_size aircraft and crew"),
    ("AIRCRAFT_ROLE", "Aircraft role matches the mission role"),
    ("ASSET_AVAILABLE", "Aircraft/crew are valid records and available for the whole sortie"),
    ("MISSION_WINDOW", "Launch lies inside the mission start window"),
    ("MISSION_HORIZON", "Recovery lies inside the 12 h planning horizon"),
    ("RUNWAY_WINDOW", "Base runway is open at launch and recovery"),
    ("WEATHER_MINIMA", "Base weather is above minima at launch and recovery"),
    ("BASE_CORRIDOR", "Aircraft/crew are based at the mission base; corridor joins that base to the area"),
    ("CORRIDOR_OPEN", "Corridor is not blocked by an active threat zone"),
    ("AIRCRAFT_OVERLAP", "No overlapping sorties per aircraft"),
    ("TURNAROUND", "Aircraft turnaround respected between sorties"),
    ("CREW_QUALIFICATION", "Crew is qualified for the mission role"),
    ("CREW_OVERLAP", "No overlapping sorties per crew member (incl. crew turnaround)"),
    ("CREW_DUTY_LIMIT", "Crew duty period does not exceed the duty limit"),
    ("CREW_REST", "Crew rest requirement is respected before the first sortie"),
    ("LOADOUT_STOCK", "Per-base load-out stock is not exceeded; load-out is acceptable for the mission"),
]


def validate_plan(
    scenario: Scenario,
    config: PlanningConfig,
    assignments: Iterable[Assignment],
    index: Optional[ScenarioIndex] = None,
) -> ValidationReport:
    ix = index or ScenarioIndex(scenario, config)
    items = list(assignments)
    out: list[Violation] = []

    def v(code: str, msg: str, mid: Optional[str] = None, rid: Optional[str] = None) -> None:
        out.append(Violation(code=code, message=msg, mission_id=mid, resource_id=rid))

    seen: set[str] = set()
    by_aircraft: dict[str, list[Assignment]] = defaultdict(list)
    by_crew: dict[str, list[Assignment]] = defaultdict(list)
    stock_used: dict[tuple[str, str], int] = defaultdict(int)

    for a in items:
        m = ix.missions.get(a.mission_id)
        if m is None:
            v("STRUCTURE", f"unknown mission {a.mission_id}", a.mission_id)
            continue
        if a.mission_id in seen:
            v("STRUCTURE", "mission assigned more than once", a.mission_id)
            continue
        seen.add(a.mission_id)
        if not a.covered:
            if a.aircraft_ids or a.crew_ids or a.corridor_id or a.start_slot is not None:
                v("STRUCTURE", "uncovered mission holds resources", m.id)
            continue

        # ---- structure & package
        if a.start_slot is None or a.base_id is None or a.corridor_id is None or a.loadout is None:
            v("STRUCTURE", "covered mission missing start/base/corridor/loadout", m.id)
            continue
        if len(a.aircraft_ids) != m.package_size or len(set(a.aircraft_ids)) != len(a.aircraft_ids):
            v("PACKAGE_SIZE", f"needs {m.package_size} distinct aircraft, has {len(a.aircraft_ids)}", m.id)
        if len(a.crew_ids) != m.package_size or len(set(a.crew_ids)) != len(a.crew_ids):
            v("PACKAGE_SIZE", f"needs {m.package_size} distinct crew, has {len(a.crew_ids)}", m.id)

        start, end = a.start_slot, a.start_slot + m.duration_slots
        if a.end_slot is not None and a.end_slot != end:
            v("STRUCTURE", f"end_slot {a.end_slot} != start+duration {end}", m.id)

        # ---- timing
        if not (m.earliest_start <= start <= m.latest_start):
            v("MISSION_WINDOW", f"start {start} outside [{m.earliest_start},{m.latest_start}]", m.id)
        if start < 0 or end > ix.H:
            v("MISSION_HORIZON", f"sortie [{start},{end}] leaves horizon [0,{ix.H}]", m.id)

        # ---- base
        base = ix.bases.get(a.base_id)
        if base is None:
            v("BASE_CORRIDOR", f"unknown base {a.base_id}", m.id)
        else:
            for label, t in (("launch", start), ("recovery", end)):
                if not ix.runway_open(base.id, t):
                    v("RUNWAY_WINDOW", f"{base.id} runway closed at {label} slot {t}", m.id, base.id)
                if not ix.weather_ok(base.id, t):
                    v("WEATHER_MINIMA", f"{base.id} below weather minima at {label} slot {t}", m.id, base.id)

        # ---- corridor
        cor = ix.corridors.get(a.corridor_id)
        if cor is None:
            v("BASE_CORRIDOR", f"unknown corridor {a.corridor_id}", m.id)
        else:
            if cor.base_id != a.base_id or cor.area_id != m.area_id:
                v("BASE_CORRIDOR", f"corridor {cor.id} joins {cor.base_id}->{cor.area_id}, "
                                   f"mission needs {a.base_id}->{m.area_id}", m.id, cor.id)
            info = ix.corridor_info(m, cor)
            if info.blocked:
                v("CORRIDOR_OPEN", f"corridor {cor.id} blocked by {','.join(info.threat_ids)}", m.id, cor.id)

        # ---- load-out
        if a.loadout not in m.loadouts:
            v("LOADOUT_STOCK", f"load-out {a.loadout} not acceptable for {m.id} {m.loadouts}", m.id)
        stock_used[(a.base_id, a.loadout)] += len(a.aircraft_ids)

        # ---- aircraft
        for aid in a.aircraft_ids:
            ac = ix.aircraft.get(aid)
            if ac is None:
                v("STRUCTURE", f"unknown aircraft {aid}", m.id, aid)
                continue
            if ac.role != m.role:
                v("AIRCRAFT_ROLE", f"{aid} role {ac.role} != mission role {m.role}", m.id, aid)
            if ac.home_base != a.base_id:
                v("BASE_CORRIDOR", f"{aid} based at {ac.home_base}, mission base {a.base_id}", m.id, aid)
            w = ix.aircraft_window(ac)
            if w is None:
                v("ASSET_AVAILABLE", f"{aid} unavailable/invalid ({ac.status}, valid={ac.record_valid})", m.id, aid)
            elif start < w[0] or end > w[1]:
                v("ASSET_AVAILABLE", f"{aid} available only in [{w[0]},{w[1]}], sortie [{start},{end}]", m.id, aid)
            by_aircraft[aid].append(a)

        # ---- crew
        for cid in a.crew_ids:
            cr = ix.crew.get(cid)
            if cr is None:
                v("STRUCTURE", f"unknown crew {cid}", m.id, cid)
                continue
            if m.role not in cr.qualified_roles:
                v("CREW_QUALIFICATION", f"{cid} not qualified for {m.role} (has {cr.qualified_roles})", m.id, cid)
            if cr.home_base != a.base_id:
                v("BASE_CORRIDOR", f"{cid} based at {cr.home_base}, mission base {a.base_id}", m.id, cid)
            if ix.crew_available_from(cr) is None:
                v("ASSET_AVAILABLE", f"{cid} record invalid", m.id, cid)
            by_crew[cid].append(a)

    # ---- aircraft overlap / turnaround
    for aid, lst in by_aircraft.items():
        lst.sort(key=lambda z: z.start_slot)  # type: ignore[arg-type,return-value]
        for p, n in zip(lst[:-1], lst[1:]):
            p_end = p.start_slot + ix.missions[p.mission_id].duration_slots  # type: ignore[operator]
            if n.start_slot < p_end:  # type: ignore[operator]
                v("AIRCRAFT_OVERLAP", f"{aid}: {p.mission_id} and {n.mission_id} overlap", n.mission_id, aid)
            elif n.start_slot < p_end + ix.turn:  # type: ignore[operator]
                v("TURNAROUND", f"{aid}: gap {n.start_slot - p_end} < turnaround {ix.turn}", n.mission_id, aid)

    # ---- crew overlap / duty / rest
    for cid, lst in by_crew.items():
        cr = ix.crew[cid]
        lst.sort(key=lambda z: z.start_slot)  # type: ignore[arg-type,return-value]
        for p, n in zip(lst[:-1], lst[1:]):
            p_end = p.start_slot + ix.missions[p.mission_id].duration_slots  # type: ignore[operator]
            if n.start_slot < p_end + ix.crew_turn:  # type: ignore[operator]
                v("CREW_OVERLAP", f"{cid}: {p.mission_id} and {n.mission_id} overlap/too close "
                                  f"(gap {n.start_slot - p_end}, crew turnaround {ix.crew_turn})", n.mission_id, cid)
        # duty periods: a gap >= rest starts a new period
        periods: list[list[Assignment]] = []
        for asg in lst:
            if periods:
                last = periods[-1][-1]
                last_end = last.start_slot + ix.missions[last.mission_id].duration_slots  # type: ignore[operator]
                if asg.start_slot - last_end < ix.rest:  # type: ignore[operator]
                    periods[-1].append(asg)
                    continue
            periods.append([asg])
        for per in periods:
            first, last = per[0], per[-1]
            span = last.start_slot + ix.missions[last.mission_id].duration_slots - first.start_slot  # type: ignore[operator]
            if span > ix.duty:
                v("CREW_DUTY_LIMIT", f"{cid}: duty span {span} slots > limit {ix.duty}", first.mission_id, cid)
        avail = ix.crew_available_from(cr)
        if avail is not None and lst and lst[0].start_slot < avail:  # type: ignore[operator]
            v("CREW_REST", f"{cid}: first launch {lst[0].start_slot} before rested at slot {avail} "
                           f"(prior duty end {cr.prior_duty_end_slot}, rest {ix.rest} slots)", lst[0].mission_id, cid)

    # ---- stock
    for (bid, ld), used in stock_used.items():
        have = ix.bases[bid].loadout_stock.get(ld, 0) if bid in ix.bases else 0
        if used > have:
            v("LOADOUT_STOCK", f"{bid} load-out {ld}: used {used} > stock {have}", None, bid)

    counts: dict[str, int] = defaultdict(int)
    for x in out:
        counts[x.code] += 1
    rules = [
        RuleResult(rule=name, description=desc, passed=counts.get(name, 0) == 0, violations=counts.get(name, 0))
        for name, desc in RULES
    ]
    return ValidationReport(valid=not out, violations=out, rules=rules)
