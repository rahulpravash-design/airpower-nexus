from airops.core.entities import Assignment, Plan
from airops.solver.diff import diff_plans


def make(pid, assignments, base_plan):
    return base_plan.model_copy(update={"id": pid, "assignments": assignments, "diff": None})


def asg(mid, **kw):
    d = dict(mission_id=mid, covered=True, aircraft_ids=["AC-1"], crew_ids=["CR-1"], base_id="BASE-A",
             corridor_id="C-1", start_slot=4, end_slot=12, loadout="A")
    d.update(kw)
    return Assignment(**d)


def test_diff_counts_missions_and_fields_separately(base_plan):
    old = make("old", [asg("M-1"), asg("M-2"), asg("M-3"), asg("M-4", covered=False, aircraft_ids=[], crew_ids=[],
                                                              base_id=None, corridor_id=None, start_slot=None,
                                                              end_slot=None, loadout=None)], base_plan)
    new = make("new", [
        asg("M-1"),                                                   # unchanged
        asg("M-2", aircraft_ids=["AC-9"], crew_ids=["CR-9"], start_slot=6, end_slot=14),   # 3 fields, 1 mission
        asg("M-3", covered=False, aircraft_ids=[], crew_ids=[], base_id=None, corridor_id=None, start_slot=None,
            end_slot=None, loadout=None),                              # newly uncovered
        asg("M-4"),                                                   # newly covered
        asg("M-5", corridor_id="C-2"),                                # added mission
    ], base_plan)
    d = diff_plans(old, new)
    assert d.unchanged_missions == ["M-1"]
    assert set(d.changed_missions) == {"M-2", "M-3", "M-4"} and d.changed_mission_count == 3
    assert d.added_missions == ["M-5"] and "M-5" in d.newly_covered and "M-4" in d.newly_covered
    assert d.newly_uncovered == ["M-3"]
    # M-2 changed in place; M-3 / M-4 lose / gain every resource field when coverage flips
    assert d.changed_aircraft == ["M-2", "M-3", "M-4"] and d.changed_crew == ["M-2", "M-3", "M-4"]
    assert d.changed_timing == ["M-2", "M-3", "M-4"]
    assert d.changed_base == ["M-3", "M-4"] and d.changed_corridor == ["M-3", "M-4"] and d.changed_loadout == ["M-3", "M-4"]
    m2_fields = {c.field for c in d.field_changes if c.mission_id == "M-2"}
    assert m2_fields == {"aircraft_ids", "crew_ids", "start_slot"}
    assert d.changed_field_count > d.changed_mission_count


def test_identical_plans_have_no_changes(base_plan):
    d = diff_plans(base_plan, base_plan)
    assert d.changed_mission_count == 0 and d.changed_field_count == 0
    assert len(d.unchanged_missions) == len(base_plan.assignments)


def test_diff_ignores_lock_flag_and_list_order(base_plan):
    a = asg("M-1", aircraft_ids=["AC-2", "AC-1"])
    b = asg("M-1", aircraft_ids=["AC-1", "AC-2"], lock="FREEZE_WINDOW")
    assert diff_plans(make("o", [a], base_plan), make("n", [b], base_plan)).changed_mission_count == 0
