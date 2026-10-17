"""Deterministic, seeded BLUELAND scenario generator (fictional data only)."""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import yaml

from ..core.config import PlanningConfig, load_config
from ..core.entities import (
    Aircraft, Area, Base, Closure, Corridor, Crew, Mission, Scenario, StatusReport, Threat,
)
from ..core.geometry import regular_polygon
from ..predict.availability import get_availability_model
from ..predict.fatigue import fatigue_risk
from ..trust.score import assess_scenario
from .schemas import Layout

LAYOUT_PATH = Path(__file__).with_name("blueland.yaml")
DEFAULT_SEED = 26250


def load_layout(path: Optional[Path] = None) -> Layout:
    with open(path or LAYOUT_PATH, "r", encoding="utf-8") as fh:
        return Layout(**yaml.safe_load(fh))


def _ts(ref: datetime, age_min: float) -> datetime:
    return ref - timedelta(minutes=float(age_min))


def generate_scenario(
    seed: int = DEFAULT_SEED,
    config: Optional[PlanningConfig] = None,
    layout: Optional[Layout] = None,
    inject_data_quality_issues: bool = True,
) -> Scenario:
    cfg = config or load_config()
    lay = layout or load_layout()
    rng = np.random.default_rng(seed)
    ref = datetime.fromisoformat(lay.reference_time)
    H = lay.horizon_slots

    # ---------------------------------------------------------------- bases / areas
    bases: list[Base] = []
    for b in lay.bases:
        stock = {l: max(2, int(b.stock.get(l, 0) + rng.integers(-1, 2))) for l in lay.loadouts}
        bases.append(Base(id=b.id, name=b.name, x=b.x, y=b.y, source="BASE_OPS",
                          last_update=_ts(ref, rng.integers(1, 20)), runway_windows=b.runway_windows,
                          loadout_stock=stock))
    base_by_id = {b.id: b for b in bases}
    for w in lay.weather:
        base_by_id[w.base].weather_closures.append(Closure(start_slot=w.start, end_slot=w.end, reason=w.reason))
    areas = [Area(id=a.id, name=a.name, x=a.x, y=a.y, source="GEO_DB", last_update=_ts(ref, 5)) for a in lay.areas]

    # ---------------------------------------------------------------- corridors (3 per base-area pair)
    corridors: list[Corridor] = []
    for b in bases:
        for a in areas:
            dx, dy = a.x - b.x, a.y - b.y
            length = math.hypot(dx, dy)
            nx, ny = -dy / length, dx / length
            mx, my = (b.x + a.x) / 2, (b.y + a.y) / 2
            for k, (label, off) in enumerate((("direct", 0.0), ("north-arc", 0.22), ("south-arc", -0.22)), start=1):
                wp = [(b.x, b.y), (round(mx + nx * off * length, 2), round(my + ny * off * length, 2)), (a.x, a.y)]
                corridors.append(Corridor(
                    id=f"C-{b.id[-1]}{a.id[-1]}-{k}", name=f"{b.name}->{a.name} {label}", base_id=b.id,
                    area_id=a.id, waypoints=wp, base_risk=round(0.15 + 0.5 * float(rng.random()), 3),
                    source="GEO_DB", last_update=_ts(ref, 5)))

    # ---------------------------------------------------------------- threats
    threats = [
        Threat(id=t.id, name=t.name, source="THREAT_FEED", last_update=_ts(ref, rng.integers(2, 25)),
               polygon=regular_polygon(t.cx + float(rng.uniform(-8, 8)), t.cy + float(rng.uniform(-8, 8)),
                                       t.radius, 8, float(rng.uniform(0, math.pi / 4))),
               start_slot=t.start, end_slot=t.end, severity=t.severity, blocking=t.blocking)
        for t in lay.threats
    ]

    # ---------------------------------------------------------------- aircraft (3 roles x 8)
    aircraft: list[Aircraft] = []
    for ri, role in enumerate(lay.roles):
        for i in range(lay.aircraft_per_role):
            home = bases[(i + ri) % len(bases)].id
            aircraft.append(Aircraft(
                id=f"AC-{role}-{i + 1:02d}", role=role, home_base=home, source="BASE_OPS",
                last_update=_ts(ref, rng.integers(1, 25)),
                age_years=round(float(rng.uniform(2, 22)), 1),
                flight_hours_since_service=round(float(rng.uniform(5, 140)), 1),
                days_since_maintenance=round(float(rng.uniform(0, 40)), 1),
                fault_reports_30d=int(rng.poisson(1.0)),
                sensor_anomaly=round(float(np.clip(rng.beta(1.3, 7.0), 0, 1)), 3),
            ))
    special = rng.permutation(len(aircraft))
    for idx in special[:2]:  # in maintenance, returning to service later in the horizon
        aircraft[idx].status = "MAINTENANCE"
        aircraft[idx].available_from_slot = int(rng.integers(10, 22))
        aircraft[idx].source = "MAINT_LOG"
    aircraft[special[2]].status = "UNAVAILABLE"
    for ac in aircraft:
        st = ac.status
        ac.reports = [StatusReport(source="BASE_OPS", status=st, last_update=ac.last_update),
                      StatusReport(source="TELEMETRY", status=st, last_update=_ts(ref, rng.integers(1, 30)))]

    # ---------------------------------------------------------------- crew (40)
    crew: list[Crew] = []
    for i in range(lay.crew_count):
        roles = [lay.roles[(i // len(bases)) % len(lay.roles)]]
        if rng.random() < 0.4:
            other = [r for r in lay.roles if r not in roles]
            roles.append(other[int(rng.integers(0, len(other)))])
        prior = -int(rng.integers(2, 30)) if rng.random() < 0.3 else None
        crew.append(Crew(
            id=f"CR-{i + 1:03d}", name=f"Crew {i + 1:03d}", home_base=bases[i % len(bases)].id,
            qualified_roles=sorted(roles), source="CREW_ROSTER", last_update=_ts(ref, rng.integers(1, 25)),
            prior_duty_end_slot=prior,
            duty_hours_last_24h=round(float(rng.uniform(3, 8) if prior is not None else rng.uniform(0, 3)), 1),
            hours_since_rest=round(float(rng.uniform(1, 16)), 1)))

    # ---------------------------------------------------------------- missions (30)
    prios = [1] * 6 + [2] * 12 + [3] * (lay.mission_count - 18)
    rng.shuffle(prios)
    role_cycle = [lay.roles[i % len(lay.roles)] for i in range(lay.mission_count)]
    rng.shuffle(role_cycle)
    raw: list[dict] = []
    for i in range(lay.mission_count):
        pr = prios[i]
        dur = int(rng.integers(8, 15))
        earliest = int(min(rng.integers(0, 30), H - dur))
        latest = int(min(earliest + rng.integers(4, 11), H - dur))
        pkg = 2 if rng.random() < (0.5 if pr == 1 else 0.12) else 1
        lds = [lay.loadouts[int(rng.integers(0, len(lay.loadouts)))]]
        if rng.random() < 0.5:
            lds.append(next(l for l in lay.loadouts if l != lds[0]) if rng.random() < 0.5 else
                       [l for l in lay.loadouts if l != lds[0]][-1])
        raw.append(dict(priority=pr, role=role_cycle[i], area=areas[int(rng.integers(0, len(areas)))].id,
                        package=pkg, earliest=earliest, latest=latest, dur=dur, loadouts=sorted(set(lds)),
                        age=int(rng.integers(1, 20))))
    raw.sort(key=lambda r: (r["earliest"], r["priority"]))
    missions = [
        Mission(id=f"M-{i + 1:03d}", priority=r["priority"], role=r["role"], area_id=r["area"],
                package_size=r["package"], earliest_start=r["earliest"], latest_start=r["latest"],
                duration_slots=r["dur"], loadouts=r["loadouts"], source="MISSION_TASKING",
                last_update=_ts(ref, r["age"]))
        for i, r in enumerate(raw)
    ]

    # ---------------------------------------------------------------- injected data-quality problems
    if inject_data_quality_issues:
        free = [a for a in aircraft if a.status == "AVAILABLE"]
        pick = rng.permutation(len(free))
        for j in pick[:2]:  # stale aircraft feeds
            free[j].last_update = _ts(ref, rng.integers(200, 400))
            free[j].reports[0].last_update = free[j].last_update
        free[pick[2]].flight_hours_since_service = -5.0  # malformed record -> rejected
        free[pick[3]].reports[1].status = "UNAVAILABLE"  # telemetry disagrees with base ops -> conflict
        cpick = rng.permutation(len(crew))
        crew[cpick[0]].last_update = _ts(ref, rng.integers(200, 400))  # stale crew record
        crew[cpick[1]].prior_duty_end_slot = 6  # malformed (duty "ends in the future") -> rejected

    scenario = Scenario(
        name=lay.name, seed=seed, reference_time=ref, slot_minutes=lay.slot_minutes, horizon_slots=H,
        bases=bases, areas=areas, aircraft=aircraft, crew=crew, missions=missions, corridors=corridors,
        threats=threats)

    # ---------------------------------------------------------------- trust, prediction, fatigue
    assess_scenario(scenario, cfg)
    model = get_availability_model()
    scenario.model_info = model.info
    ok = [a for a in aircraft if a.record_valid]
    for a, p in zip(ok, model.predict(ok)):
        a.predicted_serviceability = p
    for c in crew:
        if c.record_valid:
            c.fatigue_risk = fatigue_risk(c, cfg)
    return scenario
