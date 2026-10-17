from collections import Counter

import pytest

from airops.core.config import load_config
from airops.generator.scenario import generate_scenario
from airops.trust.score import check_aircraft_raw, check_crew_raw


def test_seed_reproducibility(cfg):
    a, b = generate_scenario(26250, cfg), generate_scenario(26250, cfg)
    assert a.model_dump() == b.model_dump()
    c = generate_scenario(26251, cfg)
    assert a.model_dump() != c.model_dump()


def test_resource_counts(scn):
    assert scn.name == "BLUELAND"
    assert len(scn.bases) == 3
    assert len(scn.aircraft) == 24
    assert Counter(a.role for a in scn.aircraft) == {"R1": 8, "R2": 8, "R3": 8}
    assert len(scn.crew) == 40
    assert len(scn.missions) == 30
    assert scn.horizon_slots * scn.slot_minutes == 12 * 60 and scn.slot_minutes == 15
    pairs = Counter((c.base_id, c.area_id) for c in scn.corridors)
    assert len(pairs) == 3 * len(scn.areas) and set(pairs.values()) == {3}
    for b in scn.bases:
        assert set(b.loadout_stock) == {"A", "B", "C"} and all(v >= 2 for v in b.loadout_stock.values())
    assert all(set(m.loadouts) <= {"A", "B", "C"} for m in scn.missions)
    assert all(m.earliest_start <= m.latest_start and m.latest_start + m.duration_slots <= 48 for m in scn.missions)


def test_every_record_has_id_update_and_trust(scn):
    for coll in (scn.bases, scn.areas, scn.aircraft, scn.crew, scn.missions, scn.corridors, scn.threats):
        for r in coll:
            assert r.id and r.last_update and 0.0 <= r.trust <= 1.0


def test_unique_ids(scn):
    ids = [r.id for coll in (scn.bases, scn.aircraft, scn.crew, scn.missions, scn.corridors) for r in coll]
    assert len(ids) == len(set(ids))


def test_invalid_aircraft_record_rejected():
    raw = dict(id="AC-X", role="R1", home_base="BASE-A", last_update="2026-03-01T06:00:00Z",
               flight_hours_since_service=-3, days_since_maintenance=1, fault_reports_30d=0,
               age_years=3, sensor_anomaly=0.1, trust=0.9)
    assert "invalid_flight_hours_since_service" in check_aircraft_raw(raw)
    assert "unknown_role" in check_aircraft_raw({**raw, "role": "ZZ", "flight_hours_since_service": 3})
    assert "trust_out_of_range" in check_aircraft_raw({**raw, "trust": 1.4, "flight_hours_since_service": 3})
    assert check_aircraft_raw({**raw, "flight_hours_since_service": 3}) == []


def test_invalid_crew_record_rejected():
    raw = dict(id="CR-X", home_base="BASE-A", last_update="x", qualified_roles=["R1"], prior_duty_end_slot=5)
    assert "prior_duty_end_in_future" in check_crew_raw(raw)
    assert "invalid_qualified_roles" in check_crew_raw({**raw, "qualified_roles": [], "prior_duty_end_slot": -3})


def test_generated_scenario_contains_flagged_records(scn):
    assert any(not a.record_valid for a in scn.aircraft)
    assert any(a.stale for a in scn.aircraft)
    assert any(a.conflict for a in scn.aircraft)
    assert any(not c.record_valid for c in scn.crew)
    bad = next(a for a in scn.aircraft if not a.record_valid)
    assert bad.trust == 0.0 and bad.predicted_serviceability is None


def test_config_validation():
    with pytest.raises(Exception):
        load_config().model_copy(update={}).__class__(crew_rest_hours=0)
    with pytest.raises(Exception):
        load_config().__class__(turnaround_minutes=50)
