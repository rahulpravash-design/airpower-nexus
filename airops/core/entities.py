"""Shared typed entities for AIR POWER (all data is fictional and synthetic).

Time model: the planning horizon is 12 h split into 15-minute slots (0..48).
Slot numbers are *instants*: slot 0 = T+0h00, slot 4 = T+1h00, slot 48 = T+12h00.
A mission launches at instant ``start_slot`` and recovers at ``end_slot = start + duration``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

SLOT_MINUTES = 15
HORIZON_SLOTS = 48
ROLES = ("R1", "R2", "R3")
LOADOUTS = ("A", "B", "C")


# --------------------------------------------------------------------------- records
class Record(BaseModel):
    """Every scenario record carries identity, freshness, trust and validity."""

    id: str
    source: str
    last_update: datetime
    trust: float = Field(1.0, ge=0.0, le=1.0)
    record_valid: bool = True
    issues: list[str] = Field(default_factory=list)
    stale: bool = False
    conflict: bool = False


class StatusReport(BaseModel):
    source: str
    status: str
    last_update: datetime


class Closure(BaseModel):
    start_slot: int
    end_slot: int  # exclusive
    reason: str = "WEATHER_BELOW_MINIMA"


class Base(Record):
    name: str
    x: float
    y: float
    runway_windows: list[tuple[int, int]]  # inclusive open intervals of instants
    weather_closures: list[Closure] = Field(default_factory=list)
    loadout_stock: dict[str, int]


class Area(Record):
    name: str
    x: float
    y: float


class Aircraft(Record):
    role: str
    home_base: str
    status: Literal["AVAILABLE", "MAINTENANCE", "UNAVAILABLE"] = "AVAILABLE"
    available_from_slot: int = 0
    unavailable_from_slot: Optional[int] = None
    age_years: float = 0.0
    flight_hours_since_service: float = 0.0
    days_since_maintenance: float = 0.0
    fault_reports_30d: int = 0
    sensor_anomaly: float = 0.0
    predicted_serviceability: Optional[float] = None
    reports: list[StatusReport] = Field(default_factory=list)


class Crew(Record):
    name: str
    home_base: str
    qualified_roles: list[str]
    prior_duty_end_slot: Optional[int] = None  # <= 0, relative to horizon start
    duty_hours_last_24h: float = 0.0
    hours_since_rest: float = 0.0
    fatigue_risk: Optional[float] = None


class Mission(Record):
    priority: int = Field(ge=1, le=3)
    role: str
    area_id: str
    package_size: int = Field(ge=1, le=2)
    earliest_start: int
    latest_start: int
    duration_slots: int
    loadouts: list[str]  # acceptable abstract load-outs, one is consumed per aircraft
    created_by_event: Optional[str] = None


class Corridor(Record):
    name: str
    base_id: str
    area_id: str
    waypoints: list[tuple[float, float]]
    base_risk: float


class Threat(Record):
    name: str
    polygon: list[tuple[float, float]]
    start_slot: int
    end_slot: int  # inclusive
    severity: float = Field(ge=0.0, le=1.0)
    blocking: bool = False


class ModelInfo(BaseModel):
    name: str
    version: str
    kind: str  # "TRAINED_SYNTHETIC" or "BASELINE_HEURISTIC"
    trained_on: str
    n_train: int = 0
    n_test: int = 0
    metrics: dict[str, float] = Field(default_factory=dict)
    disclaimer: str = (
        "Trained and evaluated on synthetic data only; not validated on real-world data."
    )


class AppliedEvent(BaseModel):
    type: str
    now_slot: int
    summary: str
    payload: dict[str, Any] = Field(default_factory=dict)


class Scenario(BaseModel):
    name: str = "BLUELAND"
    seed: int
    version: int = 1
    reference_time: datetime
    slot_minutes: int = SLOT_MINUTES
    horizon_slots: int = HORIZON_SLOTS
    bases: list[Base]
    areas: list[Area]
    aircraft: list[Aircraft]
    crew: list[Crew]
    missions: list[Mission]
    corridors: list[Corridor]
    threats: list[Threat]
    model_info: Optional[ModelInfo] = None
    event_log: list[AppliedEvent] = Field(default_factory=list)
    synthetic: bool = True


# --------------------------------------------------------------------------- plan
class Assignment(BaseModel):
    mission_id: str
    covered: bool
    aircraft_ids: list[str] = Field(default_factory=list)
    crew_ids: list[str] = Field(default_factory=list)
    base_id: Optional[str] = None
    corridor_id: Optional[str] = None
    start_slot: Optional[int] = None
    end_slot: Optional[int] = None
    loadout: Optional[str] = None
    risk: float = 0.0
    lock: Optional[Literal["IN_PROGRESS", "FREEZE_WINDOW"]] = None


class Violation(BaseModel):
    code: str
    message: str
    mission_id: Optional[str] = None
    resource_id: Optional[str] = None


class RuleResult(BaseModel):
    rule: str
    description: str
    passed: bool
    violations: int = 0


class ValidationReport(BaseModel):
    valid: bool
    violations: list[Violation] = Field(default_factory=list)
    rules: list[RuleResult] = Field(default_factory=list)
    validator: str = "airops.core.validation.validate_plan"


class ReasonCode(BaseModel):
    code: str
    message: str
    mission_id: Optional[str] = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class FieldChange(BaseModel):
    mission_id: str
    field: str
    old: Any = None
    new: Any = None


class PlanDiff(BaseModel):
    old_plan_id: Optional[str]
    new_plan_id: str
    changed_missions: list[str] = Field(default_factory=list)
    unchanged_missions: list[str] = Field(default_factory=list)
    added_missions: list[str] = Field(default_factory=list)
    newly_covered: list[str] = Field(default_factory=list)
    newly_uncovered: list[str] = Field(default_factory=list)
    changed_aircraft: list[str] = Field(default_factory=list)
    changed_crew: list[str] = Field(default_factory=list)
    changed_base: list[str] = Field(default_factory=list)
    changed_corridor: list[str] = Field(default_factory=list)
    changed_timing: list[str] = Field(default_factory=list)
    changed_loadout: list[str] = Field(default_factory=list)
    field_changes: list[FieldChange] = Field(default_factory=list)
    changed_mission_count: int = 0
    changed_field_count: int = 0


class PlanMetrics(BaseModel):
    total_missions: int
    covered: int
    uncovered: int
    priority_weighted_coverage: float
    max_priority_weighted_coverage: float
    risk_penalty: float
    total_risk: float
    available_aircraft: int
    assigned_aircraft: int
    assigned_crew: int
    changed_missions: Optional[int] = None
    unchanged_missions: Optional[int] = None
    low_trust_assignments: int = 0
    mean_serviceability: Optional[float] = None


class Plan(BaseModel):
    id: str
    scenario_version: int
    seed: int
    method: Literal["CP_SAT", "GREEDY", "GREEDY_FALLBACK"]
    solver_status: str
    solve_time_s: float
    objective: Optional[float] = None
    best_bound: Optional[float] = None
    objective_breakdown: dict[str, float] = Field(default_factory=dict)
    created_at: datetime
    status: Literal["PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED", "INVALID"] = "PROPOSED"
    trigger: str = "INITIAL"
    parent_plan_id: Optional[str] = None
    assignments: list[Assignment]
    metrics: PlanMetrics
    validation: ValidationReport
    diff: Optional[PlanDiff] = None
    reasons: list[ReasonCode] = Field(default_factory=list)
    event: Optional[dict[str, Any]] = None
    config_snapshot: dict[str, Any] = Field(default_factory=dict)
    frozen_mission_ids: list[str] = Field(default_factory=list)
    invalidated_frozen: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    decision_note: Optional[str] = None
