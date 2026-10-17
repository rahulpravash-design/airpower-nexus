"""Transparent synthetic crew-fatigue estimator (not a validated physiological model).

    fatigue = 0.45 * duty_load + 0.35 * rest_deficit + 0.20 * time_awake_load

* duty_load       = min(1, (duty_hours_last_24h + planned_hours) / duty_limit_hours)
* rest_deficit    = max(0, 1 - hours_since_rest_completed / crew_rest_hours)  (1 = just finished duty)
* time_awake_load = min(1, hours_since_rest / 18)

All three terms are in [0, 1], so the estimate is in [0, 1]. Higher is worse.
"""
from __future__ import annotations

from ..core.config import PlanningConfig
from ..core.entities import Crew

W_DUTY, W_REST, W_AWAKE = 0.45, 0.35, 0.20


def fatigue_factors(crew: Crew, config: PlanningConfig, planned_hours: float = 0.0) -> dict[str, float]:
    duty_load = min(1.0, (crew.duty_hours_last_24h + planned_hours) / config.duty_limit_hours)
    # hours since the *end* of the last duty: derived from prior_duty_end_slot (slots <= 0)
    if crew.prior_duty_end_slot is None:
        since_duty_h = float(config.crew_rest_hours)
    else:
        since_duty_h = max(0.0, -crew.prior_duty_end_slot * 15 / 60.0)
    rest_deficit = max(0.0, 1.0 - since_duty_h / config.crew_rest_hours)
    awake = min(1.0, crew.hours_since_rest / 18.0)
    return {"duty_load": round(duty_load, 4), "rest_deficit": round(rest_deficit, 4),
            "time_awake_load": round(awake, 4)}


def fatigue_risk(crew: Crew, config: PlanningConfig, planned_hours: float = 0.0) -> float:
    f = fatigue_factors(crew, config, planned_hours)
    return round(W_DUTY * f["duty_load"] + W_REST * f["rest_deficit"] + W_AWAKE * f["time_awake_load"], 4)
