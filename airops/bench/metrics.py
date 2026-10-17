"""Benchmark row construction and summary statistics (all numbers come from measured plans)."""
from __future__ import annotations

import statistics
from collections import Counter
from typing import Any, Optional

from ..core.entities import Plan

EPS = 1e-9


def plan_row(instance: int, seed: int, plan: Plan, time_limit: float, max_pwc: float) -> dict[str, Any]:
    usable = plan.solver_status in ("OPTIMAL", "FEASIBLE") or plan.method == "GREEDY"
    method = "GREEDY" if plan.method == "GREEDY" else "CP_SAT"
    return {
        "instance": instance, "seed": seed, "method": method, "solver_status": plan.solver_status,
        "solve_time_s": round(plan.solve_time_s, 4),
        "objective": None if plan.objective is None else round(plan.objective, 3),
        "priority_weighted_coverage": plan.metrics.priority_weighted_coverage,
        "max_priority_weighted_coverage": max_pwc,
        "covered": plan.metrics.covered, "uncovered": plan.metrics.uncovered,
        "risk_penalty": plan.metrics.risk_penalty,
        "hard_rules_valid": plan.validation.valid, "violations": len(plan.validation.violations),
        "time_limit_reached": bool(method == "CP_SAT" and plan.solver_status != "OPTIMAL"
                                   and plan.solve_time_s >= 0.95 * time_limit),
        "failure": bool(not usable or not plan.validation.valid),
    }


def _med(xs: list[float]) -> Optional[float]:
    return round(statistics.median(xs), 4) if xs else None


def _mean(xs: list[float]) -> Optional[float]:
    return round(statistics.fmean(xs), 4) if xs else None


def summarize(rows: list[dict], churn: list[dict], meta: dict) -> dict[str, Any]:
    out: dict[str, Any] = {"meta": meta}
    by = {m: {r["instance"]: r for r in rows if r["method"] == m} for m in ("CP_SAT", "GREEDY")}
    for m, d in by.items():
        rs = list(d.values())
        out[m] = {
            "instances": len(rs),
            "median_priority_weighted_coverage": _med([r["priority_weighted_coverage"] for r in rs]),
            "mean_priority_weighted_coverage": _mean([r["priority_weighted_coverage"] for r in rs]),
            "median_missions_covered": _med([r["covered"] for r in rs]),
            "median_missions_uncovered": _med([r["uncovered"] for r in rs]),
            "median_risk_penalty": _med([r["risk_penalty"] for r in rs]),
            "median_solve_time_s": _med([r["solve_time_s"] for r in rs]),
            "max_solve_time_s": max((r["solve_time_s"] for r in rs), default=None),
            "status_counts": dict(Counter(r["solver_status"] for r in rs)),
            "all_hard_rules_valid": sum(1 for r in rs if r["hard_rules_valid"]),
            "time_limit_reached": sum(1 for r in rs if r["time_limit_reached"]),
            "failures": sum(1 for r in rs if r["failure"]),
        }
    paired = sorted(set(by["CP_SAT"]) & set(by["GREEDY"]))
    diffs = [by["CP_SAT"][i]["priority_weighted_coverage"] - by["GREEDY"][i]["priority_weighted_coverage"] for i in paired]
    out["paired_comparison"] = {
        "instances": len(paired),
        "metric": "priority_weighted_coverage (CP_SAT minus GREEDY)",
        "median_difference": _med(diffs), "mean_difference": _mean(diffs),
        "cp_sat_better": sum(1 for d in diffs if d > EPS),
        "equal": sum(1 for d in diffs if abs(d) <= EPS),
        "cp_sat_worse": sum(1 for d in diffs if d < -EPS),
    }
    if churn:
        w = [c["changed_missions_with_persistence"] for c in churn]
        wo = [c["changed_missions_without_persistence"] for c in churn]
        out["churn"] = {
            "instances": len(churn),
            "median_changed_missions_with_persistence": _med(w),
            "median_changed_missions_without_persistence": _med(wo),
            "mean_changed_missions_with_persistence": _mean(w),
            "mean_changed_missions_without_persistence": _mean(wo),
            "persistence_fewer_changes": sum(1 for a, b in zip(w, wo) if a < b),
            "equal": sum(1 for a, b in zip(w, wo) if a == b),
            "persistence_more_changes": sum(1 for a, b in zip(w, wo) if a > b),
            "median_coverage_with_persistence": _med([c["coverage_with_persistence"] for c in churn]),
            "median_coverage_without_persistence": _med([c["coverage_without_persistence"] for c in churn]),
            "all_valid": all(c["valid_with_persistence"] and c["valid_without_persistence"] for c in churn),
        }
    # Conclusions are generated strictly from the measured numbers above.
    p, cp, gr = out["paired_comparison"], out["CP_SAT"], out["GREEDY"]
    stmts = [
        f"Median priority-weighted coverage: CP-SAT {cp['median_priority_weighted_coverage']} vs greedy "
        f"{gr['median_priority_weighted_coverage']} over {p['instances']} paired instances.",
        f"CP-SAT better on {p['cp_sat_better']}, equal on {p['equal']}, worse on {p['cp_sat_worse']} instances "
        f"(median difference {p['median_difference']}).",
    ]
    if "churn" in out:
        c = out["churn"]
        stmts.append(
            f"Median changed missions after an event: {c['median_changed_missions_with_persistence']} with persistence "
            f"vs {c['median_changed_missions_without_persistence']} without ({c['instances']} controlled events).")
    out["statements"] = stmts
    return out
