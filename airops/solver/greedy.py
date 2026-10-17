"""Greedy baseline planner.

Missions are handled in priority order. For each mission the planner enumerates
(start slot, base, lowest-risk open corridor) candidates, picks the best-available
aircraft/crew, and **commits a placement only if the independent validator accepts
the tentative plan** -- so the greedy plan obeys exactly the same hard rules as CP-SAT.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from ..core.config import PlanningConfig
from ..core.entities import Assignment, Scenario
from ..core.rules import ScenarioIndex
from ..core.validation import validate_plan


@dataclass
class GreedyResult:
    assignments: list[Assignment] = field(default_factory=list)
    rejected: int = 0  # tentative placements rejected by the validator


def greedy_assign(
    scn: Scenario,
    cfg: PlanningConfig,
    *,
    index: Optional[ScenarioIndex] = None,
    frozen: Optional[dict[str, Assignment]] = None,
    prior: Optional[dict[str, Assignment]] = None,
    min_start: int = 0,
) -> GreedyResult:
    ix = index or ScenarioIndex(scn, cfg)
    frozen = frozen or {}
    placed: dict[str, Assignment] = dict(frozen)
    uncovered: list[str] = []
    res = GreedyResult()

    def busy(kind: str) -> dict[str, list[tuple[int, int]]]:
        d: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for a in placed.values():
            m = ix.missions[a.mission_id]
            pad = ix.turn if kind == "air" else ix.crew_turn
            for rid in (a.aircraft_ids if kind == "air" else a.crew_ids):
                d[rid].append((a.start_slot, a.start_slot + m.duration_slots + pad))  # type: ignore[operator]
        return d

    def try_commit(a: Assignment) -> bool:
        rep = validate_plan(scn, cfg, list(placed.values()) + [a], index=ix)
        if rep.valid:
            placed[a.mission_id] = a
            return True
        res.rejected += 1
        return False

    order = sorted(
        (m for m in scn.missions if m.id not in frozen),
        key=lambda m: (m.priority, m.latest_start - m.earliest_start, m.earliest_start, m.id))
    for m in order:
        p = prior.get(m.id) if prior else None
        if p is not None and p.covered and (p.start_slot or 0) >= min_start and try_commit(p):
            continue
        lo, hi = ix.mission_bounds(m, min_start)
        done = False
        if lo <= hi:
            air_busy, crew_busy = busy("air"), busy("crew")
            cands: list[tuple[int, float, str, str]] = []
            for bid in ix.bases:
                starts = ix.allowed_starts(m, bid, lo, hi)
                if not starts:
                    continue
                opts = [(ix.corridor_info(m, c).risk, c.id) for c in ix.corridors_for(m)
                        if c.base_id == bid and not ix.corridor_info(m, c).blocked]
                if not opts:
                    continue
                risk, cid = min(opts)
                cands += [(s, risk, bid, cid) for s in starts]
            cands.sort(key=lambda t: (t[0], t[1], t[2]))
            acs_all = ix.aircraft_candidates(m, lo, hi)
            crs_all = ix.crew_candidates(m, lo, hi)
            for s, risk, bid, cid in cands:
                e = s + m.duration_slots
                acs = [a for a in acs_all if a.home_base == bid and (ix.aircraft_window(a) or (1, 0))[0] <= s
                       and e <= (ix.aircraft_window(a) or (1, 0))[1]
                       and all(e + ix.turn <= b0 or s >= b1 for b0, b1 in air_busy[a.id])]
                if len(acs) < m.package_size:
                    continue
                acs.sort(key=lambda a: (-(a.predicted_serviceability or 0.5) * a.trust, a.id))
                crs = []
                for c in crs_all:
                    if c.home_base != bid or (ix.crew_available_from(c) or 0) > s:
                        continue
                    if any(not (e + ix.crew_turn <= b0 or s >= b1) for b0, b1 in crew_busy[c.id]):
                        continue
                    spans = [b0 for b0, _ in crew_busy[c.id]] + [s]
                    ends = [b1 - ix.crew_turn for _, b1 in crew_busy[c.id]] + [e]
                    if max(ends) - min(spans) > ix.duty:
                        continue
                    crs.append(c)
                if len(crs) < m.package_size:
                    continue
                crs.sort(key=lambda c: (c.fatigue_risk or 0.0, -c.trust, c.id))
                used = defaultdict(int)
                for a in placed.values():
                    if a.base_id == bid and a.loadout:
                        used[a.loadout] += len(a.aircraft_ids)
                lds = [l for l in m.loadouts if ix.bases[bid].loadout_stock.get(l, 0) - used[l] >= m.package_size]
                if not lds:
                    continue
                lds.sort(key=lambda l: -(ix.bases[bid].loadout_stock.get(l, 0) - used[l]))
                cand = Assignment(
                    mission_id=m.id, covered=True, aircraft_ids=sorted(a.id for a in acs[:m.package_size]),
                    crew_ids=sorted(c.id for c in crs[:m.package_size]), base_id=bid, corridor_id=cid,
                    start_slot=s, end_slot=e, loadout=lds[0], risk=risk)
                if try_commit(cand):
                    done = True
                    break
        if not done:
            uncovered.append(m.id)

    out = []
    for m in scn.missions:
        out.append(placed.get(m.id) or Assignment(mission_id=m.id, covered=False))
    res.assignments = out
    return res
