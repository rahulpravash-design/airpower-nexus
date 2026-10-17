"""Plan metrics computed from assignments (never hard-coded)."""
from __future__ import annotations

from typing import Optional, Sequence

from .config import PlanningConfig
from .entities import Assignment, PlanMetrics, Scenario
from .rules import ScenarioIndex


def compute_metrics(
    scenario: Scenario,
    config: PlanningConfig,
    assignments: Sequence[Assignment],
    changed: Optional[int] = None,
    unchanged: Optional[int] = None,
    index: Optional[ScenarioIndex] = None,
) -> PlanMetrics:
    ix = index or ScenarioIndex(scenario, config)
    covered = [a for a in assignments if a.covered]
    pw = config.priority_weights
    pwc = sum(pw[ix.missions[a.mission_id].priority] for a in covered)
    max_pwc = sum(pw[m.priority] for m in scenario.missions)
    risk = sum(a.risk for a in covered)
    air = {x for a in covered for x in a.aircraft_ids}
    crew = {x for a in covered for x in a.crew_ids}
    low = 0
    serv: list[float] = []
    for aid in air:
        ac = ix.aircraft[aid]
        if ac.trust < config.trust_threshold:
            low += 1
        if ac.predicted_serviceability is not None:
            serv.append(ac.predicted_serviceability)
    for cid in crew:
        if ix.crew[cid].trust < config.trust_threshold:
            low += 1
    available = sum(1 for a in scenario.aircraft if ix.aircraft_window(a) is not None)
    return PlanMetrics(
        total_missions=len(scenario.missions),
        covered=len(covered),
        uncovered=len(scenario.missions) - len(covered),
        priority_weighted_coverage=pwc,
        max_priority_weighted_coverage=max_pwc,
        risk_penalty=round(risk * config.risk_weight, 3),
        total_risk=round(risk, 4),
        available_aircraft=available,
        assigned_aircraft=len(air),
        assigned_crew=len(crew),
        changed_missions=changed,
        unchanged_missions=unchanged,
        low_trust_assignments=low,
        mean_serviceability=round(sum(serv) / len(serv), 4) if serv else None,
    )
