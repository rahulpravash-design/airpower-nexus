"""Planning configuration (constraints.yaml) with validation."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .entities import SLOT_MINUTES

DEFAULT_CONFIG_PATH = Path(__file__).with_name("constraints.yaml")


class PlanningConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # --- hard-rule parameters
    crew_rest_hours: float = Field(10.0, ge=1.0, le=24.0)
    duty_limit_hours: float = Field(8.0, ge=2.0, le=16.0)
    turnaround_minutes: int = Field(60, ge=0, le=240)
    crew_turnaround_minutes: int = Field(15, ge=0, le=120)
    freeze_window_minutes: int = Field(30, ge=0, le=240)
    default_event_slot: int = Field(4, ge=0, le=47)

    # --- solver
    solver_time_limit_s: float = Field(8.0, ge=0.5, le=120.0)
    solver_workers: int = Field(4, ge=1, le=16)
    solver_seed: int = 26250

    # --- objective weights (points; one P1 mission = priority_weights[1])
    priority_weights: dict[int, float] = Field(default_factory=lambda: {1: 100.0, 2: 50.0, 3: 20.0})
    risk_weight: float = Field(8.0, ge=0.0, le=1000.0)
    change_penalty: float = Field(10.0, ge=0.0, le=1000.0)
    low_trust_weight: float = Field(20.0, ge=0.0, le=1000.0)
    serviceability_weight: float = Field(10.0, ge=0.0, le=1000.0)
    fatigue_weight: float = Field(5.0, ge=0.0, le=1000.0)
    trust_threshold: float = Field(0.6, ge=0.0, le=1.0)

    # --- data freshness
    fresh_minutes: int = Field(30, ge=1, le=1440)
    stale_minutes: int = Field(180, ge=2, le=4320)

    @field_validator("priority_weights")
    @classmethod
    def _weights(cls, v: dict[int, float]) -> dict[int, float]:
        for p in (1, 2, 3):
            if p not in v:
                raise ValueError(f"priority_weights must define priority {p}")
            if v[p] < 0:
                raise ValueError("priority weights must be >= 0")
        if not (v[1] >= v[2] >= v[3]):
            raise ValueError("priority weights must be non-increasing (P1 >= P2 >= P3)")
        return {p: float(v[p]) for p in (1, 2, 3)}

    @field_validator("turnaround_minutes", "crew_turnaround_minutes", "freeze_window_minutes")
    @classmethod
    def _slot_multiple(cls, v: int) -> int:
        if v % SLOT_MINUTES:
            raise ValueError(f"must be a multiple of {SLOT_MINUTES} minutes")
        return v

    def model_post_init(self, __context) -> None:  # noqa: D401
        if self.stale_minutes <= self.fresh_minutes:
            raise ValueError("stale_minutes must be greater than fresh_minutes")

    # --- derived slot values
    @property
    def rest_slots(self) -> int:
        return math.ceil(self.crew_rest_hours * 60 / SLOT_MINUTES)

    @property
    def duty_slots(self) -> int:
        return math.floor(self.duty_limit_hours * 60 / SLOT_MINUTES)

    @property
    def turnaround_slots(self) -> int:
        return self.turnaround_minutes // SLOT_MINUTES

    @property
    def crew_turnaround_slots(self) -> int:
        return self.crew_turnaround_minutes // SLOT_MINUTES

    @property
    def freeze_slots(self) -> int:
        return self.freeze_window_minutes // SLOT_MINUTES


def load_config(path: Optional[Path] = None) -> PlanningConfig:
    p = Path(path) if path else DEFAULT_CONFIG_PATH
    with open(p, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    return PlanningConfig(**raw)
