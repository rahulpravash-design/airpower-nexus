import pytest

from airops.core.events import (
    AircraftUnavailableEvent, BaseWeatherEvent, NewPriority1MissionEvent, NewThreatEvent,
)
from airops.core.validation import validate_plan
from airops.solver.diff import diff_plans
from airops.solver.retask import EventError, apply_event, replan_config, replan_event, suggest_event

KINDS = ["AIRCRAFT_UNAVAILABLE", "BASE_WEATHER", "NEW_PRIORITY1_MISSION", "NEW_THREAT"]


@pytest.fixture(scope="module")
def proposals(scn, cfg, base_plan):
    out = {}
    for k in KINDS:
        ev = suggest_event(k, scn, base_plan, cfg)
        out[k] = (ev, *replan_event(scn, base_plan, ev, cfg, plan_id=f"t-{k}", time_limit=3))
    return out


@pytest.mark.parametrize("kind", KINDS)
def test_event_triggers_real_valid_replan(kind, proposals, scn, cfg, base_plan):
    ev, scn2, p = proposals[kind]
    assert p.trigger == kind and p.parent_plan_id == base_plan.id and p.method == "CP_SAT"
    assert p.solver_status in ("OPTIMAL", "FEASIBLE")
    assert scn2.version == scn.version + 1 and scn2.event_log[-1].type == kind
    assert validate_plan(scn2, cfg, p.assignments).valid and p.validation.valid
    assert p.diff is not None and p.diff == diff_plans(base_plan, p)
    assert p.metrics.changed_missions == p.diff.changed_mission_count
    assert any(r.mission_id is None for r in p.reasons)  # event-level reason present
    assert scn.version == 1 and not scn.event_log  # input scenario never mutated


def test_aircraft_unavailable_is_removed_and_explained(proposals, base_plan):
    ev, scn2, p = proposals["AIRCRAFT_UNAVAILABLE"]
    ac = next(a for a in scn2.aircraft if a.id == ev.aircraft_id)
    assert ac.status == "UNAVAILABLE" and ac.unavailable_from_slot == ev.now_slot
    for a in p.assignments:
        if a.covered and ac.id in a.aircraft_ids:
            assert a.end_slot <= ev.now_slot  # only sorties already finished before the failure
    hit = [a.mission_id for a in base_plan.assignments if a.covered and ac.id in a.aircraft_ids]
    ev_reason = next(r for r in p.reasons if r.code == "AIRCRAFT_UNAVAILABLE" and r.mission_id is None)
    assert ev_reason.evidence["aircraft_id"] == ac.id
    for mid in hit:
        if mid in p.diff.changed_missions:
            assert any(r.code == "AIRCRAFT_UNAVAILABLE" and r.mission_id == mid for r in p.reasons)


def test_weather_closure_blocks_launches_from_that_base(proposals):
    ev, scn2, p = proposals["BASE_WEATHER"]
    for a in p.assignments:
        if a.covered and a.base_id == ev.base_id:
            for t in (a.start_slot, a.end_slot):
                assert not (ev.now_slot <= t < ev.now_slot + ev.duration_slots)


def test_new_priority1_mission_added_and_considered(proposals, scn):
    ev, scn2, p = proposals["NEW_PRIORITY1_MISSION"]
    new = scn2.missions[-1]
    assert new.priority == 1 and new.created_by_event and len(scn2.missions) == len(scn.missions) + 1
    assert new.id in p.diff.added_missions
    assert any(r.code == "NEW_MISSION_ADDED" and r.mission_id == new.id for r in p.reasons)
    assert p.metrics.total_missions == len(scn.missions) + 1


def test_new_threat_blocks_corridors_and_changes_risk(proposals, cfg):
    ev, scn2, p = proposals["NEW_THREAT"]
    thr = scn2.threats[-1]
    assert thr.blocking and thr.id.startswith("THR-")
    reason = next(r for r in p.reasons if r.code == "CORRIDOR_RISK_INCREASE" and r.mission_id is None)
    assert reason.evidence["corridors_intersected"] and reason.evidence["threat_id"] == thr.id
    assert all(validate_plan(scn2, cfg, [a]).valid for a in p.assignments if a.covered)  # no blocked corridor used


def test_freeze_keeps_valid_assignments_in_window_unchanged(scn, cfg, base_plan):
    ev = suggest_event("AIRCRAFT_UNAVAILABLE", scn, base_plan, cfg)
    scn2, p = replan_event(scn, base_plan, ev, cfg, plan_id="t-fz", time_limit=3)
    now = ev.now_slot
    old = {a.mission_id: a for a in base_plan.assignments}
    imminent = [a for a in base_plan.assignments if a.covered and a.start_slot <= now + cfg.freeze_slots]
    assert imminent, "baseline plan has no launches inside the freeze window"
    invalid_ids = {i["mission_id"] for i in p.invalidated_frozen}
    for a in imminent:
        if a.mission_id in invalid_ids:
            continue
        new = next(x for x in p.assignments if x.mission_id == a.mission_id)
        assert a.mission_id in p.frozen_mission_ids and new.lock in ("FREEZE_WINDOW", "IN_PROGRESS")
        assert new.model_dump(exclude={"lock"}) == a.model_dump(exclude={"lock"})


def test_event_that_invalidates_a_frozen_assignment_releases_only_that_one(scn, cfg, base_plan):
    first = min((a for a in base_plan.assignments if a.covered), key=lambda a: a.start_slot)
    victim = first.aircraft_ids[0]
    now = max(0, first.start_slot - 1)           # first is inside the freeze window, not yet launched
    ev = AircraftUnavailableEvent(type="AIRCRAFT_UNAVAILABLE", aircraft_id=victim, now_slot=now)
    scn2, p = replan_event(scn, base_plan, ev, cfg, plan_id="t-inv", time_limit=3)
    released = {i["mission_id"] for i in p.invalidated_frozen}
    assert first.mission_id in released and first.mission_id not in p.frozen_mission_ids
    assert any(r.code == "FREEZE_OVERRIDE_INVALIDATED" and r.mission_id == first.mission_id for r in p.reasons)
    # every other frozen assignment is untouched
    for a in base_plan.assignments:
        if a.covered and a.mission_id in p.frozen_mission_ids:
            new = next(x for x in p.assignments if x.mission_id == a.mission_id)
            assert new.model_dump(exclude={"lock"}) == a.model_dump(exclude={"lock"})
    assert p.validation.valid


def test_persistence_reduces_churn(scn, cfg, base_plan):
    ev = suggest_event("BASE_WEATHER", scn, base_plan, cfg)
    _, with_p = replan_event(scn, base_plan, ev, cfg, time_limit=3, persistence=True, use_freeze=True)
    _, without = replan_event(scn, base_plan, ev, cfg, time_limit=3, persistence=False, use_freeze=False,
                              greedy_hint=False)
    assert with_p.validation.valid and without.validation.valid
    assert with_p.diff.changed_mission_count <= without.diff.changed_mission_count


def test_config_change_crew_rest_triggers_new_calculation(scn, cfg, base_plan):
    cfg12 = cfg.model_copy(update={"crew_rest_hours": 12})
    scn2, p = replan_config(scn, base_plan, cfg, cfg12, plan_id="t-cfg", time_limit=3)
    assert p.trigger == "CONFIG_CHANGE" and p.config_snapshot["crew_rest_hours"] == 12
    assert p.solver_status in ("OPTIMAL", "FEASIBLE") and p.parent_plan_id == base_plan.id
    assert validate_plan(scn2, cfg12, p.assignments).valid  # valid under the NEW rest rule
    ev_reason = next(r for r in p.reasons if r.code == "CONFIG_CHANGED")
    assert ev_reason.evidence["changed"]["crew_rest_hours"] == [10.0, 12.0]


def test_invalid_events_are_rejected(scn, cfg):
    with pytest.raises(EventError):
        apply_event(scn, AircraftUnavailableEvent(type="AIRCRAFT_UNAVAILABLE", aircraft_id="NOPE"), cfg)
    with pytest.raises(EventError):
        apply_event(scn, BaseWeatherEvent(type="BASE_WEATHER", base_id="NOPE"), cfg)
    with pytest.raises(EventError):
        apply_event(scn, NewPriority1MissionEvent(type="NEW_PRIORITY1_MISSION", area_id="NOPE"), cfg)
    with pytest.raises(EventError):
        apply_event(scn, NewPriority1MissionEvent(type="NEW_PRIORITY1_MISSION", earliest_start=47), cfg)
    with pytest.raises(EventError):
        apply_event(scn, NewThreatEvent(type="NEW_THREAT", center_x=1, center_y=1, start_slot=20, end_slot=10), cfg)
    down = next(a for a in scn.aircraft if a.status == "UNAVAILABLE")
    with pytest.raises(EventError):
        apply_event(scn, AircraftUnavailableEvent(type="AIRCRAFT_UNAVAILABLE", aircraft_id=down.id), cfg)
