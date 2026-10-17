"""Pure rule semantics shared by the solver, the greedy baseline and the validator.

``ScenarioIndex`` only answers factual questions about the scenario (is the runway
open at slot t? what is the risk of corridor r for mission m?). It never decides
whether a *plan* is valid -- that is ``core.validation``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from typing import Optional

from .config import PlanningConfig
from .entities import Aircraft, Base, Corridor, Crew, Mission, Scenario, Threat
from .geometry import path_exposure

INF_SLOT = 10_000
THREAT_RISK_BASE = 0.5       # risk added once a corridor touches an active threat (x severity)
THREAT_RISK_EXPOSURE = 3.0   # extra risk per unit of corridor exposure (x severity)


@dataclass(frozen=True)
class CorridorInfo:
    risk: float
    blocked: bool
    threat_ids: tuple[str, ...]


class ScenarioIndex:
    def __init__(self, scenario: Scenario, config: PlanningConfig):
        self.s = scenario
        self.c = config
        self.H = scenario.horizon_slots
        self.bases: dict[str, Base] = {b.id: b for b in scenario.bases}
        self.aircraft: dict[str, Aircraft] = {a.id: a for a in scenario.aircraft}
        self.crew: dict[str, Crew] = {c.id: c for c in scenario.crew}
        self.missions: dict[str, Mission] = {m.id: m for m in scenario.missions}
        self.corridors: dict[str, Corridor] = {c.id: c for c in scenario.corridors}
        self.threats: dict[str, Threat] = {t.id: t for t in scenario.threats}
        self.turn = config.turnaround_slots
        self.crew_turn = config.crew_turnaround_slots
        self.rest = config.rest_slots
        self.duty = config.duty_slots
        self._exposure: dict[tuple[str, str], float] = {}
        self._cinfo: dict[tuple[str, str], CorridorInfo] = {}
        self._site_ok: dict[str, list[bool]] = {}
        self._runway_ok: dict[str, list[bool]] = {}
        self._weather_ok: dict[str, list[bool]] = {}
        for b in scenario.bases:
            rw = [any(lo <= t <= hi for lo, hi in b.runway_windows) for t in range(self.H + 1)]
            wx = [not any(cl.start_slot <= t < cl.end_slot for cl in b.weather_closures)
                  for t in range(self.H + 1)]
            self._runway_ok[b.id] = rw
            self._weather_ok[b.id] = wx
            self._site_ok[b.id] = [r and w for r, w in zip(rw, wx)]

    # ------------------------------------------------------------------ bases
    def runway_open(self, base_id: str, t: int) -> bool:
        return 0 <= t <= self.H and self._runway_ok[base_id][t]

    def weather_ok(self, base_id: str, t: int) -> bool:
        return 0 <= t <= self.H and self._weather_ok[base_id][t]

    def site_ok(self, base_id: str, t: int) -> bool:
        return 0 <= t <= self.H and self._site_ok[base_id][t]

    # ------------------------------------------------------------------ assets
    def aircraft_window(self, a: Aircraft) -> Optional[tuple[int, int]]:
        """(earliest launch, latest recovery) or None when the asset can never be used."""
        if not a.record_valid:
            return None
        if a.status == "UNAVAILABLE" and a.unavailable_from_slot is None:
            return None
        until = a.unavailable_from_slot if a.unavailable_from_slot is not None else INF_SLOT
        return (a.available_from_slot, until)

    def crew_available_from(self, c: Crew) -> Optional[int]:
        if not c.record_valid:
            return None
        if c.prior_duty_end_slot is None:
            return 0
        return max(0, c.prior_duty_end_slot + self.rest)

    # ------------------------------------------------------------------ missions
    def mission_bounds(self, m: Mission, min_start: int = 0) -> tuple[int, int]:
        lo = max(m.earliest_start, min_start)
        hi = min(m.latest_start, self.H - m.duration_slots)
        return lo, hi

    def allowed_starts(self, m: Mission, base_id: str, lo: int, hi: int) -> list[int]:
        d = m.duration_slots
        return [t for t in range(lo, hi + 1) if self.site_ok(base_id, t) and self.site_ok(base_id, t + d)]

    def aircraft_candidates(self, m: Mission, lo: int, hi: int) -> list[Aircraft]:
        out = []
        for a in self.s.aircraft:
            if a.role != m.role:
                continue
            w = self.aircraft_window(a)
            if w is None:
                continue
            if w[0] > hi or w[1] < lo + m.duration_slots:
                continue
            out.append(a)
        return out

    def crew_candidates(self, m: Mission, lo: int, hi: int) -> list[Crew]:
        out = []
        for c in self.s.crew:
            if m.role not in c.qualified_roles:
                continue
            avail = self.crew_available_from(c)
            if avail is None or avail > hi:
                continue
            out.append(c)
        return out

    # ------------------------------------------------------------------ corridors
    def exposure(self, cor: Corridor, thr: Threat) -> float:
        key = (cor.id, thr.id)
        if key not in self._exposure:
            self._exposure[key] = path_exposure(cor.waypoints, thr.polygon)
        return self._exposure[key]

    def corridor_info(self, m: Mission, cor: Corridor) -> CorridorInfo:
        """Risk/blocked status of a corridor over the mission's whole window (conservative)."""
        key = (m.id, cor.id)
        hit = self._cinfo.get(key)
        if hit is not None:
            return hit
        w0, w1 = m.earliest_start, m.latest_start + m.duration_slots
        risk = cor.base_risk
        blocked = False
        ids: list[str] = []
        for thr in self.s.threats:
            if thr.start_slot > w1 or thr.end_slot < w0:
                continue
            e = self.exposure(cor, thr)
            if e <= 0:
                continue
            risk += thr.severity * (THREAT_RISK_BASE + THREAT_RISK_EXPOSURE * e)
            ids.append(thr.id)
            if thr.blocking:
                blocked = True
        info = CorridorInfo(round(risk, 4), blocked, tuple(ids))
        self._cinfo[key] = info
        return info

    def corridors_for(self, m: Mission) -> list[Corridor]:
        return [c for c in self.s.corridors if c.area_id == m.area_id]

    # ------------------------------------------------------------------ misc
    @cached_property
    def stock(self) -> dict[str, dict[str, int]]:
        return {b.id: dict(b.loadout_stock) for b in self.s.bases}
