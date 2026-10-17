"""CP-SAT mission planner (Google OR-Tools) + plan orchestration.

Decision variables (per mission m, aircraft a, crew c, corridor r, load-out l, base b):

* ``cover[m]``  mission is covered (optional coverage -- the solver may leave missions uncovered)
* ``start[m]``  launch slot (integer, inside the mission window and the runway/weather-allowed set)
* ``x[m,a]``    aircraft a flies m           * ``y[m,c]``  crew c flies m
* ``z[m,b]``    mission launched from base b * ``k[m,r]``  corridor r is used
* ``ld[m,l]``  load-out l is used            * ``D[c]``    start of crew c's single duty window

Hard constraints are listed in docs/CONSTRAINTS.md; the objective in docs/OBJECTIVE.md.
Frozen assignments enter the model as constants (fixed intervals / consumed stock).
"""
from __future__ import annotations

import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from ortools.sat.python import cp_model

from ..core.config import PlanningConfig
from ..core.entities import Assignment, Plan, Scenario
from ..core.metrics import compute_metrics
from ..core.rules import ScenarioIndex
from ..core.validation import validate_plan
from .greedy import greedy_assign

SCALE = 10  # objective points are multiplied by SCALE and rounded to integers for CP-SAT
USABLE = ("OPTIMAL", "FEASIBLE")


def _c(points: float) -> int:
    return int(round(points * SCALE))


@dataclass
class CpResult:
    status: str
    assignments: list[Assignment] = field(default_factory=list)
    objective: Optional[float] = None
    best_bound: Optional[float] = None
    wall_time: float = 0.0
    breakdown: dict[str, float] = field(default_factory=dict)
    stats: dict = field(default_factory=dict)

    @property
    def usable(self) -> bool:
        return self.status in USABLE


def _aircraft_cost(ix: ScenarioIndex, cfg: PlanningConfig, aid: str) -> tuple[int, int]:
    a = ix.aircraft[aid]
    low = _c(cfg.low_trust_weight * max(0.0, cfg.trust_threshold - a.trust))
    p = a.predicted_serviceability if a.predicted_serviceability is not None else 0.5
    return low, _c(cfg.serviceability_weight * (1.0 - p))


def _crew_cost(ix: ScenarioIndex, cfg: PlanningConfig, cid: str) -> tuple[int, int]:
    c = ix.crew[cid]
    low = _c(cfg.low_trust_weight * max(0.0, cfg.trust_threshold - c.trust))
    return low, _c(cfg.fatigue_weight * (c.fatigue_risk or 0.0))


def solve_cp_sat(
    scn: Scenario,
    cfg: PlanningConfig,
    *,
    index: Optional[ScenarioIndex] = None,
    frozen: Optional[dict[str, Assignment]] = None,
    prior: Optional[dict[str, Assignment]] = None,
    hints: Optional[dict[str, Assignment]] = None,
    min_start: int = 0,
    persistence: bool = True,
    time_limit: Optional[float] = None,
    workers: Optional[int] = None,
) -> CpResult:
    ix = index or ScenarioIndex(scn, cfg)
    frozen = frozen or {}
    prior = prior or {}
    H = ix.H
    model = cp_model.CpModel()
    terms: dict[str, list] = defaultdict(list)  # objective category -> scaled expressions
    cw = _c(cfg.change_penalty) if persistence else 0

    stock = {bid: dict(b.loadout_stock) for bid, b in ix.bases.items()}
    ac_iv: dict[str, list] = defaultdict(list)
    cr_iv: dict[str, list] = defaultdict(list)

    D: dict[str, cp_model.IntVar] = {}
    for c in scn.crew:
        avail = ix.crew_available_from(c)
        if avail is not None and avail <= H:
            D[c.id] = model.new_int_var(avail, H, f"D_{c.id}")

    # ------------------------------------------------------------ frozen (constants)
    for mid, a in frozen.items():
        m = ix.missions[mid]
        s, e = a.start_slot, a.start_slot + m.duration_slots  # type: ignore[operator]
        terms["coverage"].append(_c(cfg.priority_weights[m.priority]))
        cor = ix.corridors[a.corridor_id]  # type: ignore[index]
        terms["corridor_risk"].append(-_c(cfg.risk_weight * ix.corridor_info(m, cor).risk))
        for aid in a.aircraft_ids:
            ac_iv[aid].append(model.new_fixed_size_interval_var(s, m.duration_slots + ix.turn, f"fa_{mid}_{aid}"))
            lo_, sv_ = _aircraft_cost(ix, cfg, aid)
            terms["low_trust"].append(-lo_)
            terms["serviceability"].append(-sv_)
        for cid in a.crew_ids:
            cr_iv[cid].append(model.new_fixed_size_interval_var(s, m.duration_slots + ix.crew_turn, f"fc_{mid}_{cid}"))
            if cid in D:
                model.add(D[cid] <= s)
                model.add(D[cid] + ix.duty >= e)
            lo_, fa_ = _crew_cost(ix, cfg, cid)
            terms["low_trust"].append(-lo_)
            terms["fatigue"].append(-fa_)
        stock[a.base_id][a.loadout] -= len(a.aircraft_ids)  # type: ignore[index]

    # ------------------------------------------------------------ free missions
    cover: dict[str, cp_model.IntVar] = {}
    start: dict[str, cp_model.IntVar] = {}
    X: dict[tuple[str, str], cp_model.IntVar] = {}
    Y: dict[tuple[str, str], cp_model.IntVar] = {}
    Z: dict[tuple[str, str], cp_model.IntVar] = {}
    K: dict[tuple[str, str], cp_model.IntVar] = {}
    LD: dict[tuple[str, str], cp_model.IntVar] = {}
    stock_terms: dict[tuple[str, str], list] = defaultdict(list)

    for m in scn.missions:
        if m.id in frozen:
            continue
        cv = model.new_bool_var(f"cover_{m.id}")
        cover[m.id] = cv
        lo, hi = ix.mission_bounds(m, min_start)
        if lo > hi:
            model.add(cv == 0)
            continue
        st = model.new_int_var(lo, hi, f"start_{m.id}")
        start[m.id] = st
        dur = m.duration_slots

        # bases: one base per covered mission, start restricted to runway/weather-open slots
        zb: dict[str, cp_model.IntVar] = {}
        for bid in ix.bases:
            z = model.new_bool_var(f"z_{m.id}_{bid}")
            zb[bid] = z
            Z[m.id, bid] = z
            allowed = ix.allowed_starts(m, bid, lo, hi)
            if not allowed:
                model.add(z == 0)
            elif len(allowed) < hi - lo + 1:
                model.add_linear_expression_in_domain(st, cp_model.Domain.from_values(allowed)).only_enforce_if(z)
        model.add(sum(zb.values()) == cv)

        # aircraft
        xs = []
        for a in ix.aircraft_candidates(m, lo, hi):
            x = model.new_bool_var(f"x_{m.id}_{a.id}")
            X[m.id, a.id] = x
            xs.append(x)
            model.add(x <= zb[a.home_base])
            w0, w1 = ix.aircraft_window(a)  # type: ignore[misc]
            if w0 > lo:
                model.add(st >= w0).only_enforce_if(x)
            if w1 < hi + dur:
                model.add(st + dur <= w1).only_enforce_if(x)
            ac_iv[a.id].append(model.new_optional_fixed_size_interval_var(st, dur + ix.turn, x, f"ia_{m.id}_{a.id}"))
            lo_, sv_ = _aircraft_cost(ix, cfg, a.id)
            terms["low_trust"].append(-lo_ * x)
            terms["serviceability"].append(-sv_ * x)
        model.add(sum(xs) == m.package_size * cv)

        # crew
        ys = []
        for c in ix.crew_candidates(m, lo, hi):
            if c.id not in D:
                continue
            y = model.new_bool_var(f"y_{m.id}_{c.id}")
            Y[m.id, c.id] = y
            ys.append(y)
            model.add(y <= zb[c.home_base])
            model.add(st >= D[c.id]).only_enforce_if(y)
            model.add(st + dur <= D[c.id] + ix.duty).only_enforce_if(y)
            cr_iv[c.id].append(model.new_optional_fixed_size_interval_var(st, dur + ix.crew_turn, y, f"ic_{m.id}_{c.id}"))
            lo_, fa_ = _crew_cost(ix, cfg, c.id)
            terms["low_trust"].append(-lo_ * y)
            terms["fatigue"].append(-fa_ * y)
        model.add(sum(ys) == m.package_size * cv)

        # corridors (precomputed only)
        ks = []
        for r in ix.corridors_for(m):
            info = ix.corridor_info(m, r)
            if info.blocked:
                continue
            k = model.new_bool_var(f"k_{m.id}_{r.id}")
            K[m.id, r.id] = k
            ks.append(k)
            model.add(k <= zb[r.base_id])
            terms["corridor_risk"].append(-_c(cfg.risk_weight * info.risk) * k)
        model.add(sum(ks) == cv)

        # load-out + per-base stock
        lds = []
        for l in m.loadouts:
            ld = model.new_bool_var(f"ld_{m.id}_{l}")
            LD[m.id, l] = ld
            lds.append(ld)
        model.add(sum(lds) == cv)
        for bid in ix.bases:
            for l in m.loadouts:
                w = model.new_bool_var(f"w_{m.id}_{bid}_{l}")
                model.add_bool_or([LD[m.id, l].negated(), zb[bid].negated(), w])
                stock_terms[bid, l].append(m.package_size * w)

        terms["coverage"].append(_c(cfg.priority_weights[m.priority]) * cv)

        # ---- assignment persistence: penalise deviation from the previous plan
        p = prior.get(m.id)
        if cw and p is not None and p.covered:
            for aid in p.aircraft_ids:
                terms["change"].append(-cw * (1 - X[m.id, aid]) if (m.id, aid) in X else -cw)
            for cid in p.crew_ids:
                terms["change"].append(-cw * (1 - Y[m.id, cid]) if (m.id, cid) in Y else -cw)
            if p.corridor_id:
                terms["change"].append(-(cw // 2) * (1 - K[m.id, p.corridor_id]) if (m.id, p.corridor_id) in K else -(cw // 2))
            if p.loadout:
                terms["change"].append(-(cw // 2) * (1 - LD[m.id, p.loadout]) if (m.id, p.loadout) in LD else -(cw // 2))
            if p.start_slot is not None:
                if lo <= p.start_slot <= hi:
                    same = model.new_bool_var(f"same_{m.id}")
                    model.add(st == p.start_slot).only_enforce_if(same)
                    model.add(st != p.start_slot).only_enforce_if(same.negated())
                    terms["change"].append(-cw * (1 - same))
                else:
                    terms["change"].append(-cw)

    for (bid, l), lst in stock_terms.items():
        model.add(sum(lst) <= max(0, stock[bid].get(l, 0)))
    for lst in ac_iv.values():
        if len(lst) > 1:
            model.add_no_overlap(lst)
    for lst in cr_iv.values():
        if len(lst) > 1:
            model.add_no_overlap(lst)

    # ------------------------------------------------------------ hints (valid previous / greedy assignments)
    for mid, h in (hints or {}).items():
        if mid not in cover or mid not in start:
            continue
        model.add_hint(cover[mid], 1 if h.covered else 0)
        for (m2, aid), var in X.items():
            if m2 == mid:
                model.add_hint(var, 1 if h.covered and aid in h.aircraft_ids else 0)
        for (m2, cid), var in Y.items():
            if m2 == mid:
                model.add_hint(var, 1 if h.covered and cid in h.crew_ids else 0)
        for (m2, rid), var in K.items():
            if m2 == mid:
                model.add_hint(var, 1 if h.covered and rid == h.corridor_id else 0)
        for (m2, l), var in LD.items():
            if m2 == mid:
                model.add_hint(var, 1 if h.covered and l == h.loadout else 0)
        for (m2, bid), var in Z.items():
            if m2 == mid:
                model.add_hint(var, 1 if h.covered and bid == h.base_id else 0)
        if h.covered and h.start_slot is not None:
            model.add_hint(start[mid], h.start_slot)

    all_terms = [t for lst in terms.values() for t in lst]
    model.maximize(sum(all_terms) if all_terms else 0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit if time_limit is not None else cfg.solver_time_limit_s)
    solver.parameters.num_workers = int(workers or cfg.solver_workers)
    solver.parameters.random_seed = cfg.solver_seed
    solver.parameters.repair_hint = True
    t0 = time.perf_counter()
    status = solver.solve(model)
    wall = time.perf_counter() - t0
    name = solver.status_name(status)
    stats = {"variables": len(model.proto.variables), "constraints": len(model.proto.constraints),
             "conflicts": solver.num_conflicts, "branches": solver.num_branches}
    if name not in USABLE:
        return CpResult(status=name, wall_time=wall, stats=stats)

    out: list[Assignment] = []
    for m in scn.missions:
        if m.id in frozen:
            out.append(frozen[m.id])
            continue
        if m.id not in cover or not solver.value(cover[m.id]):
            out.append(Assignment(mission_id=m.id, covered=False))
            continue
        aircraft_ids = sorted(aid for (m2, aid), v in X.items() if m2 == m.id and solver.value(v))
        crew_ids = sorted(cid for (m2, cid), v in Y.items() if m2 == m.id and solver.value(v))
        base_id = next(bid for (m2, bid), v in Z.items() if m2 == m.id and solver.value(v))
        corridor_id = next(rid for (m2, rid), v in K.items() if m2 == m.id and solver.value(v))
        loadout = next(l for (m2, l), v in LD.items() if m2 == m.id and solver.value(v))
        s0 = int(solver.value(start[m.id]))
        out.append(Assignment(
            mission_id=m.id, covered=True, aircraft_ids=aircraft_ids, crew_ids=crew_ids, base_id=base_id,
            corridor_id=corridor_id, start_slot=s0, end_slot=s0 + m.duration_slots, loadout=loadout,
            risk=ix.corridor_info(m, ix.corridors[corridor_id]).risk))

    breakdown = {k: round(solver.value(sum(v)) / SCALE, 3) if v else 0.0 for k, v in terms.items()}
    return CpResult(
        status=name, assignments=out, objective=solver.objective_value / SCALE,
        best_bound=solver.best_objective_bound / SCALE, wall_time=wall, breakdown=breakdown, stats=stats)


# ====================================================================== orchestration
def individually_valid(scn: Scenario, cfg: PlanningConfig, ix: ScenarioIndex, a: Assignment) -> bool:
    return validate_plan(scn, cfg, [a], index=ix).valid


def generate_plan(
    scn: Scenario,
    cfg: PlanningConfig,
    *,
    plan_id: Optional[str] = None,
    method: str = "CP_SAT",
    trigger: str = "INITIAL",
    parent_plan_id: Optional[str] = None,
    prior: Optional[Plan] = None,
    frozen: Optional[dict[str, Assignment]] = None,
    min_start: int = 0,
    persistence: bool = True,
    greedy_hint: bool = True,
    allow_fallback: bool = True,
    time_limit: Optional[float] = None,
    event: Optional[dict] = None,
    notes: Optional[list[str]] = None,
) -> Plan:
    """Solve and validate a plan. Every returned plan carries an independent validation report."""
    ix = ScenarioIndex(scn, cfg)
    frozen = dict(frozen or {})
    notes = list(notes or [])
    prior_all = {a.mission_id: a for a in (prior.assignments if prior else []) if a.covered}
    prior_free = {k: v for k, v in prior_all.items() if k not in frozen}
    valid_prior = {k: v for k, v in prior_free.items() if individually_valid(scn, cfg, ix, v)} if persistence else {}

    assignments: list[Assignment] = []
    status, solve_time, objective, bound, breakdown = "NOT_APPLICABLE", 0.0, None, None, {}
    used_method = method

    if method == "GREEDY":
        t0 = time.perf_counter()
        g = greedy_assign(scn, cfg, index=ix, frozen=frozen, prior=prior_free if persistence else None, min_start=min_start)
        solve_time = time.perf_counter() - t0
        assignments = g.assignments
        if g.rejected:
            notes.append(f"greedy: validator rejected {g.rejected} tentative placements")
    else:
        hints = dict(valid_prior)
        if greedy_hint and not hints:
            g0 = greedy_assign(scn, cfg, index=ix, frozen=frozen, prior=None, min_start=min_start)
            hints = {a.mission_id: a for a in g0.assignments if a.mission_id not in frozen}
        res = solve_cp_sat(scn, cfg, index=ix, frozen=frozen, prior=prior_free if persistence else None,
                           hints=hints if persistence or greedy_hint else None, min_start=min_start,
                           persistence=persistence, time_limit=time_limit)
        status, solve_time, objective, bound, breakdown = res.status, res.wall_time, res.objective, res.best_bound, res.breakdown
        assignments = res.assignments
        if res.usable:
            rep = validate_plan(scn, cfg, assignments, index=ix)
            if not rep.valid:
                notes.append(f"CP-SAT returned {status} but the independent validator found {len(rep.violations)} violation(s)")
                assignments = []
        if not assignments:
            if not allow_fallback:
                notes.append(f"CP-SAT status {status}: no usable solution; fallback disabled")
            else:
                t0 = time.perf_counter()
                g = greedy_assign(scn, cfg, index=ix, frozen=frozen, prior=prior_free if persistence else None,
                                  min_start=min_start)
                solve_time += time.perf_counter() - t0
                assignments = g.assignments
                used_method = "GREEDY_FALLBACK"
                notes.append(f"CP-SAT status {status}: greedy fallback used")

    if not assignments:
        assignments = [Assignment(mission_id=m.id, covered=False) for m in scn.missions]
    for a in assignments:
        if a.mission_id in frozen:
            a.lock = frozen[a.mission_id].lock
    report = validate_plan(scn, cfg, assignments, index=ix)
    metrics = compute_metrics(scn, cfg, assignments, index=ix)
    return Plan(
        id=plan_id or f"plan-{uuid.uuid4().hex[:8]}", scenario_version=scn.version, seed=scn.seed,
        method=used_method, solver_status=status, solve_time_s=round(solve_time, 4),  # type: ignore[arg-type]
        objective=objective, best_bound=bound, objective_breakdown=breakdown,
        created_at=datetime.now(timezone.utc), status="PROPOSED" if report.valid else "INVALID",
        trigger=trigger, parent_plan_id=parent_plan_id, assignments=assignments, metrics=metrics,
        validation=report, event=event, config_snapshot=cfg.model_dump(mode="json"),
        frozen_mission_ids=sorted(frozen), notes=notes)
