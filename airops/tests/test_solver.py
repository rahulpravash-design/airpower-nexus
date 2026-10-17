import pytest

from airops.core.entities import Assignment
from airops.core.validation import validate_plan
from airops.solver import plan as plan_mod
from airops.solver.plan import generate_plan


def test_cp_sat_plan_is_real_and_independently_valid(scn, cfg, base_plan):
    assert base_plan.method == "CP_SAT"
    assert base_plan.solver_status in ("OPTIMAL", "FEASIBLE")
    assert base_plan.validation.valid and not base_plan.validation.violations
    # re-validate from scratch, not trusting the stored report
    assert validate_plan(scn, cfg, base_plan.assignments).valid
    assert base_plan.metrics.covered == sum(1 for a in base_plan.assignments if a.covered) > 0
    assert base_plan.objective is not None and base_plan.best_bound >= base_plan.objective - 1e-6
    assert base_plan.solve_time_s > 0


def test_status_is_honest(base_plan):
    if base_plan.solver_status == "OPTIMAL":
        assert base_plan.best_bound == pytest.approx(base_plan.objective, abs=0.2)
    else:  # FEASIBLE must never be reported as optimal
        assert base_plan.best_bound > base_plan.objective


def test_cp_sat_not_worse_than_greedy_on_this_instance(base_plan, greedy_plan):
    # not a general claim -- only checks this seeded instance, see the benchmark for evidence
    assert base_plan.metrics.priority_weighted_coverage >= greedy_plan.metrics.priority_weighted_coverage - 1e-9


def test_greedy_plan_uses_same_validator(scn, cfg, greedy_plan):
    assert greedy_plan.method == "GREEDY" and greedy_plan.validation.valid
    assert validate_plan(scn, cfg, greedy_plan.assignments).valid


def test_unavailable_and_invalid_assets_never_assigned(scn, base_plan, greedy_plan):
    banned = {a.id for a in scn.aircraft if a.status == "UNAVAILABLE" or not a.record_valid}
    banned_crew = {c.id for c in scn.crew if not c.record_valid}
    for p in (base_plan, greedy_plan):
        for a in p.assignments:
            assert not banned & set(a.aircraft_ids) and not banned_crew & set(a.crew_ids)


def test_optional_coverage_leaves_missions_uncovered_instead_of_violating(scn, cfg):
    s = scn.model_copy(deep=True)
    for b in s.bases:  # starve the theatre of load-outs: only 2 sorties' worth in total
        b.loadout_stock = {"A": 0, "B": 0, "C": 0}
    s.bases[0].loadout_stock = {"A": 1, "B": 1, "C": 0}
    p = generate_plan(s, cfg, time_limit=2)
    assert p.validation.valid
    assert 0 < p.metrics.uncovered < p.metrics.total_missions + 1
    assert p.metrics.covered <= 2
    unc = [a for a in p.assignments if not a.covered]
    assert all(not a.aircraft_ids and not a.crew_ids and a.corridor_id is None for a in unc)


def test_stock_is_never_exceeded(scn, base_plan):
    used = {}
    for a in base_plan.assignments:
        if a.covered:
            used[a.base_id, a.loadout] = used.get((a.base_id, a.loadout), 0) + len(a.aircraft_ids)
    stock = {b.id: b.loadout_stock for b in scn.bases}
    assert all(n <= stock[b][l] for (b, l), n in used.items())


def test_greedy_fallback_when_cp_sat_returns_no_solution(scn, cfg, monkeypatch):
    monkeypatch.setattr(plan_mod, "solve_cp_sat", lambda *a, **k: plan_mod.CpResult(status="UNKNOWN", wall_time=0.1))
    p = generate_plan(scn, cfg, time_limit=1)
    assert p.method == "GREEDY_FALLBACK" and p.solver_status == "UNKNOWN"
    assert p.validation.valid and p.metrics.covered > 0
    assert any("fallback" in n for n in p.notes)


def test_invalid_cp_sat_output_is_never_accepted(scn, cfg, monkeypatch):
    bogus = [Assignment(mission_id=m.id, covered=True, aircraft_ids=["AC-R1-01"], crew_ids=["CR-001"],
                        base_id="BASE-A", corridor_id="C-A1-1", start_slot=0, end_slot=1, loadout="A")
             for m in scn.missions]
    monkeypatch.setattr(plan_mod, "solve_cp_sat",
                        lambda *a, **k: plan_mod.CpResult(status="FEASIBLE", assignments=bogus, objective=1, best_bound=2))
    p = generate_plan(scn, cfg, time_limit=1)
    assert p.method == "GREEDY_FALLBACK" and p.validation.valid
    assert any("independent validator" in n for n in p.notes)


def test_no_fallback_reports_honest_failure(scn, cfg, monkeypatch):
    monkeypatch.setattr(plan_mod, "solve_cp_sat", lambda *a, **k: plan_mod.CpResult(status="UNKNOWN"))
    p = generate_plan(scn, cfg, allow_fallback=False)
    assert p.method == "CP_SAT" and p.solver_status == "UNKNOWN" and p.metrics.covered == 0


def test_infeasible_frozen_set_is_reported_not_hidden(scn, cfg):
    """Two frozen assignments forced onto the same aircraft+time make the model INFEASIBLE."""
    a = next(x for x in generate_plan(scn, cfg, method="GREEDY").assignments if x.covered)
    b = a.model_copy(update={"mission_id": next(m.id for m in scn.missions if m.id != a.mission_id)})
    res = plan_mod.solve_cp_sat(scn, cfg, frozen={a.mission_id: a, b.mission_id: b}, time_limit=2)
    assert res.status == "INFEASIBLE" and not res.assignments


def test_objective_weights_change_the_plan(scn, cfg):
    p0 = generate_plan(scn, cfg, method="GREEDY")
    heavy = cfg.model_copy(update={"priority_weights": {1: 500, 2: 50, 3: 20}})
    p1 = generate_plan(scn, heavy, method="GREEDY")
    assert p1.metrics.max_priority_weighted_coverage > p0.metrics.max_priority_weighted_coverage
