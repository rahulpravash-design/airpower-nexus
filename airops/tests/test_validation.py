"""Every hard rule is exercised by mutating a valid assignment and asserting the validator objects."""
import pytest

from airops.core.entities import Assignment, Closure, Threat
from airops.core.validation import validate_plan


@pytest.fixture(scope="module")
def good(scn, cfg, greedy_plan):
    a = next(a for a in greedy_plan.assignments if a.covered and len(a.aircraft_ids) == 1)
    assert validate_plan(scn, cfg, [a]).valid
    return a


def codes(scn, cfg, items):
    return {v.code for v in validate_plan(scn, cfg, items).violations}


def other_mission(scn, mid):
    return next(m.id for m in scn.missions if m.id != mid)


def test_valid_greedy_plan_passes_all_rules(scn, cfg, greedy_plan):
    rep = validate_plan(scn, cfg, greedy_plan.assignments)
    assert rep.valid and all(r.passed for r in rep.rules) and len(rep.rules) >= 15


def test_aircraft_role(scn, cfg, good):
    m = next(m for m in scn.missions if m.id == good.mission_id)
    ac = next(a for a in scn.aircraft if a.role != m.role and a.home_base == good.base_id)
    assert "AIRCRAFT_ROLE" in codes(scn, cfg, [good.model_copy(update={"aircraft_ids": [ac.id]})])


def test_aircraft_overlap_and_turnaround(scn, cfg, good):
    m2 = other_mission(scn, good.mission_id)
    dur = next(m for m in scn.missions if m.id == good.mission_id).duration_slots
    same = good.model_copy(update={"mission_id": m2})
    assert "AIRCRAFT_OVERLAP" in codes(scn, cfg, [good, same])
    near = good.model_copy(update={"mission_id": m2, "start_slot": good.start_slot + dur + 1})
    assert "TURNAROUND" in codes(scn, cfg, [good, near])


def test_crew_qualification(scn, cfg, good):
    m = next(m for m in scn.missions if m.id == good.mission_id)
    cr = next(c for c in scn.crew if m.role not in c.qualified_roles and c.home_base == good.base_id)
    assert "CREW_QUALIFICATION" in codes(scn, cfg, [good.model_copy(update={"crew_ids": [cr.id]})])


def test_crew_overlap(scn, cfg, good):
    m2 = other_mission(scn, good.mission_id)
    same = good.model_copy(update={"mission_id": m2, "aircraft_ids": []})
    assert "CREW_OVERLAP" in codes(scn, cfg, [good, same])


def test_crew_duty_limit(scn, cfg, good):
    m2 = other_mission(scn, good.mission_id)
    late = good.model_copy(update={"mission_id": m2, "aircraft_ids": [], "start_slot": good.start_slot + 30})
    assert "CREW_DUTY_LIMIT" in codes(scn, cfg, [good, late])


def test_crew_rest_requirement(scn, cfg, good):
    s2 = scn.model_copy(deep=True)
    for c in s2.crew:
        if c.id in good.crew_ids:
            c.prior_duty_end_slot = -2
    assert "CREW_REST" in codes(s2, cfg, [good])
    longer = cfg.model_copy(update={"crew_rest_hours": 12})
    s3 = scn.model_copy(deep=True)
    for c in s3.crew:
        if c.id in good.crew_ids:
            c.prior_duty_end_slot = -(40 - good.start_slot)  # rested exactly under 10 h, not under 12 h
    assert "CREW_REST" not in codes(s3, cfg, [good]) and "CREW_REST" in codes(s3, longer, [good])


def test_loadout_stock(scn, cfg, good):
    s2 = scn.model_copy(deep=True)
    for b in s2.bases:
        b.loadout_stock = {k: 0 for k in b.loadout_stock}
    assert "LOADOUT_STOCK" in codes(s2, cfg, [good])
    assert "LOADOUT_STOCK" in codes(scn, cfg, [good.model_copy(update={"loadout": "Z"})])


def test_runway_window_and_weather(scn, cfg, good):
    s2 = scn.model_copy(deep=True)
    next(b for b in s2.bases if b.id == good.base_id).runway_windows = []
    assert "RUNWAY_WINDOW" in codes(s2, cfg, [good])
    s3 = scn.model_copy(deep=True)
    next(b for b in s3.bases if b.id == good.base_id).weather_closures.append(Closure(start_slot=0, end_slot=48))
    assert "WEATHER_MINIMA" in codes(s3, cfg, [good])


def test_mission_window_and_horizon(scn, cfg, good):
    m = next(m for m in scn.missions if m.id == good.mission_id)
    assert "MISSION_WINDOW" in codes(scn, cfg, [good.model_copy(update={"start_slot": m.latest_start + 1})])
    assert "MISSION_HORIZON" in codes(scn, cfg, [good.model_copy(update={"start_slot": 47})])


def test_package_size(scn, cfg, good):
    assert "PACKAGE_SIZE" in codes(scn, cfg, [good.model_copy(update={"aircraft_ids": []})])
    assert "PACKAGE_SIZE" in codes(scn, cfg, [good.model_copy(update={"crew_ids": good.crew_ids * 2})])


def test_invalid_and_unavailable_assets(scn, cfg, good):
    bad = next(a for a in scn.aircraft if not a.record_valid)
    assert "ASSET_AVAILABLE" in codes(scn, cfg, [good.model_copy(update={"aircraft_ids": [bad.id]})])
    down = next(a for a in scn.aircraft if a.status == "UNAVAILABLE")
    assert "ASSET_AVAILABLE" in codes(scn, cfg, [good.model_copy(update={"aircraft_ids": [down.id]})])
    maint = next(a for a in scn.aircraft if a.status == "MAINTENANCE")
    early = good.model_copy(update={"aircraft_ids": [maint.id]})
    if good.start_slot < maint.available_from_slot:
        assert "ASSET_AVAILABLE" in codes(scn, cfg, [early])


def test_base_and_corridor_consistency(scn, cfg, good):
    wrong = next(c for c in scn.corridors if c.base_id != good.base_id)
    assert "BASE_CORRIDOR" in codes(scn, cfg, [good.model_copy(update={"corridor_id": wrong.id})])
    other_base = next(b.id for b in scn.bases if b.id != good.base_id)
    assert "BASE_CORRIDOR" in codes(scn, cfg, [good.model_copy(update={"base_id": other_base})])


def test_blocked_corridor(scn, cfg, good):
    s2 = scn.model_copy(deep=True)
    cor = next(c for c in s2.corridors if c.id == good.corridor_id)
    mx, my = cor.waypoints[1]
    poly = [(mx - 30, my - 30), (mx + 30, my - 30), (mx + 30, my + 30), (mx - 30, my + 30)]
    s2.threats.append(Threat(id="THR-T", name="t", polygon=poly, start_slot=0, end_slot=48, severity=1.0,
                             blocking=True, source="THREAT_FEED", last_update=s2.reference_time))
    assert "CORRIDOR_OPEN" in codes(s2, cfg, [good])


def test_uncovered_must_hold_nothing_and_unknown_mission(scn, cfg, good):
    assert "STRUCTURE" in codes(scn, cfg, [Assignment(mission_id=good.mission_id, covered=False, aircraft_ids=["AC-R1-01"])])
    assert "STRUCTURE" in codes(scn, cfg, [Assignment(mission_id="M-999", covered=False)])
    assert "STRUCTURE" in codes(scn, cfg, [good, good])
