"""Record validation, trust scoring and the data-fusion report.

Trust formula (documented in docs/TRUST.md)::

    trust = source_reliability * validity_factor * freshness_factor * conflict_factor

* ``source_reliability``  fixed per feed (SOURCE_RELIABILITY)
* ``validity_factor``     1.0 when the record passes all checks, 0.0 when it is rejected
* ``freshness_factor``    1.0 while age <= fresh_minutes, then linear decay to 0.1 at stale_minutes
* ``conflict_factor``     0.6 when two feeds disagree about the same record, else 1.0

Trust measures *how much we believe the input record*. It is deliberately distinct
from ``predicted_serviceability`` (probability that an aircraft stays serviceable).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping

from pydantic import BaseModel, Field

from ..core.config import PlanningConfig
from ..core.entities import Record, Scenario

SOURCE_RELIABILITY: dict[str, float] = {
    "MAINT_LOG": 0.97,
    "BASE_OPS": 0.93,
    "TELEMETRY": 0.88,
    "CREW_ROSTER": 0.95,
    "WX_STATION": 0.92,
    "MISSION_TASKING": 0.96,
    "THREAT_FEED": 0.85,
    "GEO_DB": 0.99,
}
FRESHNESS_FLOOR = 0.1
CONFLICT_FACTOR = 0.6


def age_minutes(rec_time: datetime, reference: datetime) -> float:
    return (reference - rec_time).total_seconds() / 60.0


def freshness_factor(age_min: float, config: PlanningConfig) -> float:
    if age_min <= config.fresh_minutes:
        return 1.0
    if age_min >= config.stale_minutes:
        return FRESHNESS_FLOOR
    span = config.stale_minutes - config.fresh_minutes
    return round(1.0 - (1.0 - FRESHNESS_FLOOR) * (age_min - config.fresh_minutes) / span, 4)


def trust_score(source: str, age_min: float, valid: bool, conflict: bool, config: PlanningConfig) -> float:
    rel = SOURCE_RELIABILITY.get(source, 0.5)
    t = rel * (1.0 if valid else 0.0) * freshness_factor(age_min, config) * (CONFLICT_FACTOR if conflict else 1.0)
    return round(min(1.0, max(0.0, t)), 4)


# ------------------------------------------------------------------ raw record checks
def check_aircraft_raw(raw: Mapping[str, Any]) -> list[str]:
    """Return a list of validation issues for a raw (untrusted) aircraft record."""
    issues: list[str] = []
    for key in ("id", "role", "home_base", "last_update"):
        if raw.get(key) in (None, ""):
            issues.append(f"missing_{key}")
    if raw.get("role") not in ("R1", "R2", "R3"):
        issues.append("unknown_role")
    for key in ("flight_hours_since_service", "days_since_maintenance", "fault_reports_30d", "age_years"):
        val = raw.get(key)
        if val is None or not isinstance(val, (int, float)) or val < 0:
            issues.append(f"invalid_{key}")
    s = raw.get("sensor_anomaly")
    if s is None or not isinstance(s, (int, float)) or not 0 <= s <= 1:
        issues.append("invalid_sensor_anomaly")
    t = raw.get("trust", 1.0)
    if not isinstance(t, (int, float)) or not 0 <= t <= 1:
        issues.append("trust_out_of_range")
    return issues


def check_crew_raw(raw: Mapping[str, Any]) -> list[str]:
    issues: list[str] = []
    for key in ("id", "home_base", "last_update"):
        if raw.get(key) in (None, ""):
            issues.append(f"missing_{key}")
    roles = raw.get("qualified_roles")
    if not roles or any(r not in ("R1", "R2", "R3") for r in roles):
        issues.append("invalid_qualified_roles")
    pde = raw.get("prior_duty_end_slot")
    if pde is not None and (not isinstance(pde, int) or pde > 0):
        issues.append("prior_duty_end_in_future")
    t = raw.get("trust", 1.0)
    if not isinstance(t, (int, float)) or not 0 <= t <= 1:
        issues.append("trust_out_of_range")
    return issues


# ------------------------------------------------------------------ fusion report
class SourceSummary(BaseModel):
    source: str
    reliability: float
    records: int
    fresh: int
    stale: int
    invalid: int
    conflicts: int
    mean_trust: float
    newest_age_min: float
    oldest_age_min: float


class RecordIssue(BaseModel):
    record_id: str
    kind: str  # "aircraft", "crew", ...
    source: str
    trust: float
    age_min: float
    problems: list[str]


class FusionReport(BaseModel):
    reference_time: datetime
    total_records: int
    fresh: int
    stale: int
    invalid: int
    conflicts: int
    mean_trust: float
    trust_health: float  # share of records that are fresh, valid and conflict-free
    sources: list[SourceSummary]
    flagged: list[RecordIssue] = Field(default_factory=list)
    formula: str = "trust = reliability x validity x freshness x conflict"
    note: str = "Trust is confidence in the input record; it is not a serviceability probability."


def _records(s: Scenario) -> list[tuple[str, Record]]:
    out: list[tuple[str, Record]] = []
    for kind, items in (("base", s.bases), ("area", s.areas), ("aircraft", s.aircraft), ("crew", s.crew),
                        ("mission", s.missions), ("corridor", s.corridors), ("threat", s.threats)):
        out.extend((kind, r) for r in items)
    return out


def build_fusion_report(s: Scenario, config: PlanningConfig) -> FusionReport:
    ref = s.reference_time
    recs = _records(s)
    by_src: dict[str, list[Record]] = {}
    flagged: list[RecordIssue] = []
    for kind, r in recs:
        by_src.setdefault(r.source, []).append(r)
        problems: list[str] = list(r.issues)
        if r.stale:
            problems.append("stale")
        if r.conflict:
            problems.append("conflicting_reports")
        if r.trust < config.trust_threshold and not problems:
            problems.append("low_trust")
        if problems:
            flagged.append(RecordIssue(record_id=r.id, kind=kind, source=r.source, trust=r.trust,
                                       age_min=round(age_minutes(r.last_update, ref), 1), problems=problems))
    sources: list[SourceSummary] = []
    for src, lst in sorted(by_src.items()):
        ages = [age_minutes(r.last_update, ref) for r in lst]
        sources.append(SourceSummary(
            source=src, reliability=SOURCE_RELIABILITY.get(src, 0.5), records=len(lst),
            fresh=sum(1 for r in lst if not r.stale), stale=sum(1 for r in lst if r.stale),
            invalid=sum(1 for r in lst if not r.record_valid), conflicts=sum(1 for r in lst if r.conflict),
            mean_trust=round(sum(r.trust for r in lst) / len(lst), 4),
            newest_age_min=round(min(ages), 1), oldest_age_min=round(max(ages), 1),
        ))
    n = len(recs)
    clean = sum(1 for _, r in recs if not r.stale and r.record_valid and not r.conflict)
    return FusionReport(
        reference_time=ref, total_records=n,
        fresh=sum(1 for _, r in recs if not r.stale), stale=sum(1 for _, r in recs if r.stale),
        invalid=sum(1 for _, r in recs if not r.record_valid), conflicts=sum(1 for _, r in recs if r.conflict),
        mean_trust=round(sum(r.trust for _, r in recs) / n, 4) if n else 0.0,
        trust_health=round(clean / n, 4) if n else 0.0,
        sources=sources, flagged=sorted(flagged, key=lambda f: (f.trust, f.record_id)),
    )


# ------------------------------------------------------------------ record assessment
def _reports_conflict(reports) -> bool:
    return len({r.status for r in reports}) > 1


def assess_record(kind: str, rec: Record, reference: datetime, config: PlanningConfig) -> None:
    """Fill ``issues``, ``record_valid``, ``stale``, ``conflict`` and ``trust`` in place."""
    issues: list[str] = []
    if kind == "aircraft":
        issues = check_aircraft_raw(rec.model_dump())
        rec.conflict = _reports_conflict(getattr(rec, "reports", []))
    elif kind == "crew":
        issues = check_crew_raw(rec.model_dump())
    rec.issues = issues
    rec.record_valid = not issues
    age = age_minutes(rec.last_update, reference)
    rec.stale = age >= config.stale_minutes
    rec.trust = trust_score(rec.source, age, rec.record_valid, rec.conflict, config)


def assess_scenario(s: Scenario, config: PlanningConfig) -> None:
    for kind, rec in _records(s):
        assess_record(kind, rec, s.reference_time, config)
