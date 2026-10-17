"""Plan diff engine: compares two plans by stable mission IDs."""
from __future__ import annotations

from typing import Optional

from ..core.entities import Assignment, FieldChange, Plan, PlanDiff

FIELDS = ("covered", "aircraft_ids", "crew_ids", "base_id", "corridor_id", "start_slot", "loadout")
CATEGORY = {
    "aircraft_ids": "changed_aircraft", "crew_ids": "changed_crew", "base_id": "changed_base",
    "corridor_id": "changed_corridor", "start_slot": "changed_timing", "loadout": "changed_loadout",
}


def _val(a: Assignment, f: str):
    v = getattr(a, f)
    return sorted(v) if isinstance(v, list) else v


def diff_plans(old: Optional[Plan], new: Plan) -> PlanDiff:
    """Changed *missions* are counted separately from changed *fields*.

    * a mission present in both plans with >= 1 differing field is "changed"
    * a mission absent from the old plan is "added" (and "newly covered" when covered)
    """
    d = PlanDiff(old_plan_id=old.id if old else None, new_plan_id=new.id)
    old_by = {a.mission_id: a for a in old.assignments} if old else {}
    cats = {c: [] for c in CATEGORY.values()}
    for na in sorted(new.assignments, key=lambda a: a.mission_id):
        oa = old_by.get(na.mission_id)
        if oa is None:
            d.added_missions.append(na.mission_id)
            if na.covered:
                d.newly_covered.append(na.mission_id)
            continue
        changes: list[FieldChange] = []
        for f in FIELDS:
            ov, nv = _val(oa, f), _val(na, f)
            if ov != nv:
                changes.append(FieldChange(mission_id=na.mission_id, field=f, old=ov, new=nv))
                if f in CATEGORY:
                    cats[CATEGORY[f]].append(na.mission_id)
        if changes:
            d.changed_missions.append(na.mission_id)
            d.field_changes += changes
            if not oa.covered and na.covered:
                d.newly_covered.append(na.mission_id)
            if oa.covered and not na.covered:
                d.newly_uncovered.append(na.mission_id)
        else:
            d.unchanged_missions.append(na.mission_id)
    for k, v in cats.items():
        setattr(d, k, v)
    d.changed_mission_count = len(d.changed_missions)
    d.changed_field_count = len(d.field_changes)
    return d
