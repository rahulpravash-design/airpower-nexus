"""Reproducible benchmark: CP-SAT vs greedy on N seeded BLUELAND instances + churn study.

    python -m airops.bench.run_bench --instances 100 --time-limit 4 --churn-instances 20
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import ortools

from ..core.config import load_config
from ..generator.scenario import generate_scenario
from ..solver.plan import generate_plan
from ..solver.retask import EventError, replan_event, suggest_event
from .metrics import plan_row, summarize

RESULTS_DIR = Path(os.environ.get("AIROPS_RESULTS_DIR", Path(__file__).resolve().parent.parent / "results"))
EVENT_CYCLE = ("AIRCRAFT_UNAVAILABLE", "BASE_WEATHER", "NEW_PRIORITY1_MISSION", "NEW_THREAT")
INSTANCE_FIELDS = ["instance", "seed", "method", "solver_status", "solve_time_s", "objective",
                   "priority_weighted_coverage", "max_priority_weighted_coverage", "covered", "uncovered",
                   "risk_penalty", "hard_rules_valid", "violations", "time_limit_reached", "failure"]
CHURN_FIELDS = ["instance", "seed", "event_type", "event_target",
                "changed_missions_with_persistence", "changed_fields_with_persistence", "coverage_with_persistence",
                "valid_with_persistence", "solve_time_with_persistence",
                "changed_missions_without_persistence", "changed_fields_without_persistence",
                "coverage_without_persistence", "valid_without_persistence", "solve_time_without_persistence"]


def _write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def run_benchmark(
    instances: int = 100, seed: int = 26250, time_limit: float = 4.0, churn_instances: int = 20,
    workers: int = 4, out_dir: Optional[Path] = None,
    progress: Optional[Callable[[int, int, str], None]] = None,
) -> dict:
    out = Path(out_dir or RESULTS_DIR)
    out.mkdir(parents=True, exist_ok=True)
    cfg = load_config().model_copy(update={"solver_time_limit_s": time_limit, "solver_workers": workers})
    total = instances + churn_instances
    started = datetime.now(timezone.utc)
    rows: list[dict] = []
    churn: list[dict] = []
    baselines: dict[int, tuple] = {}

    for i in range(instances):
        s = generate_scenario(seed + i, cfg)
        g = generate_plan(s, cfg, method="GREEDY", plan_id=f"g-{i}")
        c = generate_plan(s, cfg, method="CP_SAT", plan_id=f"c-{i}", greedy_hint=False, allow_fallback=False,
                          time_limit=time_limit)
        maxp = g.metrics.max_priority_weighted_coverage
        rows.append(plan_row(i, seed + i, g, time_limit, maxp))
        rows.append(plan_row(i, seed + i, c, time_limit, maxp))
        if i < churn_instances and c.solver_status in ("OPTIMAL", "FEASIBLE") and c.validation.valid:
            baselines[i] = (s, c)
        if progress:
            progress(i + 1, total, f"instance {i + 1}/{instances}")

    for n, i in enumerate(sorted(baselines)):
        s, base = baselines[i]
        kind = EVENT_CYCLE[i % len(EVENT_CYCLE)]
        try:
            ev = suggest_event(kind, s, base, cfg)
            _, with_p = replan_event(s, base, ev, cfg, plan_id=f"cw-{i}", time_limit=time_limit,
                                     persistence=True, use_freeze=True)
            _, without_p = replan_event(s, base, ev, cfg, plan_id=f"cn-{i}", time_limit=time_limit,
                                        persistence=False, use_freeze=False, greedy_hint=False)
        except EventError:
            continue
        target = getattr(ev, "aircraft_id", None) or getattr(ev, "base_id", None) or kind
        churn.append({
            "instance": i, "seed": seed + i, "event_type": kind, "event_target": target,
            "changed_missions_with_persistence": with_p.diff.changed_mission_count,
            "changed_fields_with_persistence": with_p.diff.changed_field_count,
            "coverage_with_persistence": with_p.metrics.priority_weighted_coverage,
            "valid_with_persistence": with_p.validation.valid,
            "solve_time_with_persistence": with_p.solve_time_s,
            "changed_missions_without_persistence": without_p.diff.changed_mission_count,
            "changed_fields_without_persistence": without_p.diff.changed_field_count,
            "coverage_without_persistence": without_p.metrics.priority_weighted_coverage,
            "valid_without_persistence": without_p.validation.valid,
            "solve_time_without_persistence": without_p.solve_time_s,
        })
        if progress:
            progress(instances + n + 1, total, f"churn study {n + 1}/{len(baselines)}")

    finished = datetime.now(timezone.utc)
    meta = {
        "instances": instances, "base_seed": seed, "time_limit_s": time_limit, "workers": workers,
        "churn_instances": len(churn), "started_at": started.isoformat(), "finished_at": finished.isoformat(),
        "duration_s": round((finished - started).total_seconds(), 1), "ortools": ortools.__version__,
        "python": platform.python_version(), "cpu_count": os.cpu_count(),
        "cp_sat_setup": "no greedy hint, no fallback (pure CP-SAT within the time limit)",
        "churn_setup": "controlled event per instance (cycle of 4 types); with = persistence penalty + hints + 30-min "
                       "freeze; without = no penalty, no hints, no freeze",
    }
    summary = summarize(rows, churn, meta)
    _write_csv(out / "benchmark_instances.csv", INSTANCE_FIELDS, rows)
    _write_csv(out / "benchmark_churn.csv", CHURN_FIELDS, churn)
    with open(out / "benchmark_summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    return summary


def load_results(out_dir: Optional[Path] = None) -> Optional[dict]:
    out = Path(out_dir or RESULTS_DIR)
    sp = out / "benchmark_summary.json"
    if not sp.exists():
        return None

    def read(name: str) -> list[dict]:
        p = out / name
        if not p.exists():
            return []
        with open(p, newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))

    return {"summary": json.loads(sp.read_text(encoding="utf-8")),
            "rows": read("benchmark_instances.csv"), "churn": read("benchmark_churn.csv")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--instances", type=int, default=100)
    ap.add_argument("--seed", type=int, default=26250)
    ap.add_argument("--time-limit", type=float, default=4.0)
    ap.add_argument("--churn-instances", type=int, default=20)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", type=Path, default=RESULTS_DIR)
    a = ap.parse_args()
    t0 = time.time()
    s = run_benchmark(a.instances, a.seed, a.time_limit, a.churn_instances, a.workers, a.out,
                      progress=lambda d, t, m: print(f"[{d}/{t}] {m}", flush=True))
    print(json.dumps(s["statements"], indent=2))
    print(f"done in {time.time() - t0:.0f}s -> {a.out}")


if __name__ == "__main__":
    main()
