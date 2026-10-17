"""Schema of blueland.yaml (the static, fictional theatre layout)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class BaseLayout(BaseModel):
    id: str
    name: str
    x: float
    y: float
    runway_windows: list[tuple[int, int]]
    stock: dict[str, int]


class AreaLayout(BaseModel):
    id: str
    name: str
    x: float
    y: float


class ThreatLayout(BaseModel):
    id: str
    name: str
    cx: float
    cy: float
    radius: float
    start: int
    end: int
    severity: float = Field(ge=0, le=1)
    blocking: bool = False


class WeatherLayout(BaseModel):
    base: str
    start: int
    end: int
    reason: str = "WEATHER_BELOW_MINIMA"


class Layout(BaseModel):
    name: str
    default_seed: int
    reference_time: str
    horizon_slots: int
    slot_minutes: int
    roles: list[str]
    aircraft_per_role: int
    crew_count: int
    mission_count: int
    loadouts: list[str]
    bases: list[BaseLayout]
    areas: list[AreaLayout]
    threats: list[ThreatLayout]
    weather: list[WeatherLayout] = Field(default_factory=list)
