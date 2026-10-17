import csv
import json

from airops.bench.run_bench import load_results, run_benchmark


def test_benchmark_outputs_csv_and_measured_summary(tmp_path):
    summary = run_benchmark(instances=3, seed=26250, time_limit=1.0, churn_instances=2, workers=2, out_dir=tmp_path)
    inst = list(csv.DictReader(open(tmp_path / "benchmark_instances.csv")))
    assert len(inst) == 6 and {r["method"] for r in inst} == {"CP_SAT", "GREEDY"}
    assert {"seed", "solver_status", "solve_time_s", "priority_weighted_coverage", "covered", "uncovered",
            "risk_penalty", "hard_rules_valid", "time_limit_reached", "failure"} <= set(inst[0])
    assert all(r["hard_rules_valid"] == "True" for r in inst)
    assert [r["seed"] for r in inst[:2]] == ["26250", "26250"]
    p = summary["paired_comparison"]
    assert p["cp_sat_better"] + p["equal"] + p["cp_sat_worse"] == p["instances"] == 3
    for m in ("CP_SAT", "GREEDY"):
        vals = sorted(float(r["priority_weighted_coverage"]) for r in inst if r["method"] == m)
        assert summary[m]["median_priority_weighted_coverage"] == vals[1]
    churn = list(csv.DictReader(open(tmp_path / "benchmark_churn.csv")))
    assert churn and "changed_missions_with_persistence" in churn[0]
    assert json.load(open(tmp_path / "benchmark_summary.json"))["meta"]["instances"] == 3
    loaded = load_results(tmp_path)
    assert loaded and len(loaded["rows"]) == 6 and loaded["summary"]["statements"]


def test_greedy_rows_are_reproducible(tmp_path):
    a = run_benchmark(instances=2, time_limit=0.5, churn_instances=0, out_dir=tmp_path / "a")
    b = run_benchmark(instances=2, time_limit=0.5, churn_instances=0, out_dir=tmp_path / "b")
    assert a["GREEDY"]["median_priority_weighted_coverage"] == b["GREEDY"]["median_priority_weighted_coverage"]
    ra = [r for r in csv.DictReader(open(tmp_path / "a" / "benchmark_instances.csv")) if r["method"] == "GREEDY"]
    rb = [r for r in csv.DictReader(open(tmp_path / "b" / "benchmark_instances.csv")) if r["method"] == "GREEDY"]
    assert [r["priority_weighted_coverage"] for r in ra] == [r["priority_weighted_coverage"] for r in rb]
