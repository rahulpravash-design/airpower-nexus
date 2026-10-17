"""Typed request models for the four supported retasking events."""
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field


class _EventBase(BaseModel):
    now_slot: Optional[int] = Field(None, ge=0, le=47, description="Slot at which the event happens (default: config.default_event_slot)")


class AircraftUnavailableEvent(_EventBase):
    type: Literal["AIRCRAFT_UNAVAILABLE"]
    aircraft_id: str


class BaseWeatherEvent(_EventBase):
    type: Literal["BASE_WEATHER"]
    base_id: str
    duration_slots: int = Field(24, ge=1, le=48)


class NewPriority1MissionEvent(_EventBase):
    type: Literal["NEW_PRIORITY1_MISSION"]
    role: str = "R1"
    area_id: str = "AREA-1"
    package_size: int = Field(1, ge=1, le=2)
    earliest_start: Optional[int] = Field(None, ge=0, le=47)
    window_slots: int = Field(8, ge=0, le=24)
    duration_slots: int = Field(10, ge=4, le=24)
    loadouts: list[str] = Field(default_factory=lambda: ["A"])


class NewThreatEvent(_EventBase):
    type: Literal["NEW_THREAT"]
    center_x: float
    center_y: float
    radius_km: float = Field(40.0, ge=5, le=150)
    start_slot: Optional[int] = Field(None, ge=0, le=48)
    end_slot: Optional[int] = Field(None, ge=0, le=48)
    severity: float = Field(0.8, ge=0, le=1)
    blocking: bool = True
    label: str = "Zone Nightfall"


EventRequest = Annotated[
    Union[AircraftUnavailableEvent, BaseWeatherEvent, NewPriority1MissionEvent, NewThreatEvent],
    Field(discriminator="type"),
]
EVENT_TYPES = ("AIRCRAFT_UNAVAILABLE", "BASE_WEATHER", "NEW_PRIORITY1_MISSION", "NEW_THREAT")
