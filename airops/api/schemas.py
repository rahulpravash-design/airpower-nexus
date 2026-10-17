"""HTTP request/response models (domain models live in airops.core.entities)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from ..core.config import PlanningConfig
from ..core.entities import Plan, Scenario


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str = "airops"
    version: str
    solver: str
    time: str
    uptime_s: float


class SeedRequest(BaseModel):
    seed: int = Field(26250, ge=0, le=2**31 - 1)


class PlanRequest(BaseModel):
    method: Literal["CP_SAT", "GREEDY"] = "CP_SAT"
    time_limit_s: Optional[float] = Field(None, ge=0.5, le=120)
    auto_approve: bool = False


class DecisionRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class PlanState(BaseModel):
    """What the UI needs to render the theatre: the approved plan and an optional pending proposal."""
    approved: Optional[Plan] = None
    proposed: Optional[Plan] = None
    proposed_scenario: Optional[Scenario] = None
    pending_config: Optional[PlanningConfig] = None
    scenario_version: int
    history: list[dict[str, Any]] = Field(default_factory=list)


class ProposalResponse(BaseModel):
    plan: Plan
    proposed_scenario: Scenario


class ConfigResponse(BaseModel):
    active: PlanningConfig
    pending: Optional[PlanningConfig] = None
    defaults: PlanningConfig
    proposal: Optional[ProposalResponse] = None


class BenchmarkRunRequest(BaseModel):
    instances: int = Field(100, ge=1, le=100)
    seed: int = 26250
    time_limit_s: float = Field(4.0, ge=0.5, le=30)
    churn_instances: int = Field(20, ge=0, le=100)
