"""HTTP-layer helpers around the four retasking events and proposal lifecycle."""
from __future__ import annotations

from typing import Optional

from ..core.config import PlanningConfig
from ..core.entities import Plan, Scenario
from ..core.events import EventRequest
from ..solver.plan import generate_plan
from ..solver.retask import replan, replan_config, replan_event
from .state import AppState


class Conflict(Exception):
    def __init__(self, code: str, message: str, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details


def _store_proposal(st: AppState, plan: Plan, scn: Scenario, cfg: PlanningConfig) -> Plan:
    st.plans[plan.id] = plan
    st.plan_scenarios[plan.id] = scn
    st.proposed, st.proposed_scenario, st.proposed_config = plan, scn, cfg
    st.log("proposed", plan, trigger=plan.trigger, valid=plan.validation.valid)
    st.bus.publish({"type": "plan_proposed", "plan_id": plan.id, "trigger": plan.trigger,
                    "valid": plan.validation.valid, "changed_missions": plan.diff.changed_mission_count if plan.diff else 0})
    return plan


def require_no_pending(st: AppState) -> None:
    if st.proposed is not None:
        raise Conflict("PENDING_PROPOSAL", f"{st.proposed.id} is awaiting approval or rejection", {"plan_id": st.proposed.id})


def create_plan(st: AppState, method: str, time_limit: Optional[float], auto_approve: bool) -> Plan:
    require_no_pending(st)
    pid = st.next_plan_id()
    st.bus.publish({"type": "solver_started", "plan_id": pid, "method": method})
    if st.approved is None:
        plan = generate_plan(st.scenario, st.config, plan_id=pid, method=method, trigger="INITIAL", time_limit=time_limit)
        _store_proposal(st, plan, st.scenario, st.config)
    else:
        scn_after = st.scenario.model_copy(deep=True)
        scn_after.version += 1
        plan = replan(st.scenario, scn_after, st.approved, st.config, st.config, now=st.config.default_event_slot,
                      trigger="MANUAL_REPLAN", event={"type": "MANUAL_REPLAN", "target": "-", "now_slot": st.config.default_event_slot,
                                                      "description": "manual re-optimisation from the current moment"},
                      plan_id=pid, time_limit=time_limit, method=method)
        _store_proposal(st, plan, scn_after, st.config)
    if auto_approve and plan.validation.valid:
        approve(st, plan.id, note="auto-approved baseline")
    return plan


def handle_event(st: AppState, ev: EventRequest, time_limit: Optional[float] = None) -> Plan:
    require_no_pending(st)
    if st.approved is None:
        raise Conflict("NO_BASELINE_PLAN", "approve a baseline plan before applying events")
    pid = st.next_plan_id()
    st.bus.publish({"type": "solver_started", "plan_id": pid, "method": "CP_SAT", "event": ev.type})
    scn_after, plan = replan_event(st.scenario, st.approved, ev, st.config, plan_id=pid, time_limit=time_limit)
    return _store_proposal(st, plan, scn_after, st.config)


def handle_config(st: AppState, new_cfg: PlanningConfig) -> Optional[Plan]:
    """Returns the proposed plan, or None when the config was applied immediately (no baseline yet)."""
    require_no_pending(st)
    if new_cfg == st.config:
        return None
    if st.approved is None:
        st.config = new_cfg
        st.log("config", None)
        st.bus.publish({"type": "config_updated", "applied": True})
        return None
    pid = st.next_plan_id()
    st.bus.publish({"type": "solver_started", "plan_id": pid, "method": "CP_SAT", "event": "CONFIG_CHANGE"})
    scn_after, plan = replan_config(st.scenario, st.approved, st.config, new_cfg, plan_id=pid)
    return _store_proposal(st, plan, scn_after, new_cfg)


def approve(st: AppState, plan_id: str, note: Optional[str] = None) -> Plan:
    plan = st.plans.get(plan_id)
    if plan is None:
        raise KeyError(plan_id)
    if st.proposed is None or st.proposed.id != plan_id:
        raise Conflict("NOT_PENDING", f"{plan_id} is not the pending proposal (status {plan.status})")
    if not plan.validation.valid:
        raise Conflict("PLAN_INVALID", "a plan that fails hard-rule validation cannot be approved",
                       [v.model_dump() for v in plan.validation.violations[:20]])
    if st.approved is not None:
        st.approved.status = "SUPERSEDED"
    plan.status, plan.decision_note = "APPROVED", note
    st.approved = plan
    st.scenario = st.proposed_scenario or st.plan_scenarios[plan_id]
    if st.proposed_config is not None:
        st.config = st.proposed_config
    st.proposed = st.proposed_scenario = st.proposed_config = None
    st.log("approved", plan)
    st.bus.publish({"type": "plan_approved", "plan_id": plan.id})
    return plan


def reject(st: AppState, plan_id: str, note: Optional[str] = None) -> Plan:
    plan = st.plans.get(plan_id)
    if plan is None:
        raise KeyError(plan_id)
    if st.proposed is None or st.proposed.id != plan_id:
        raise Conflict("NOT_PENDING", f"{plan_id} is not the pending proposal (status {plan.status})")
    plan.status, plan.decision_note = "REJECTED", note
    st.proposed = st.proposed_scenario = st.proposed_config = None
    st.log("rejected", plan)
    st.bus.publish({"type": "plan_rejected", "plan_id": plan.id})
    return plan
