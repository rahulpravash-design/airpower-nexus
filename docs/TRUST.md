# Trust, freshness, prediction and fatigue (all synthetic)

## Trust (confidence in an *input record*)

```
trust = source_reliability × validity × freshness × conflict
validity  = 1 if the record passes its checks else 0 (rejected)
freshness = 1 for age ≤ fresh_minutes, linear decay to 0.1 at stale_minutes (default 30 / 180 min)
conflict  = 0.6 if two feeds disagree about the same record else 1
```

Records are rejected (never planned with) when malformed (negative counters, unknown role, duty "ending in the future"…).
Stale records (≥ `stale_minutes`) are flagged and trusted less. Trust is **not** a probability of serviceability.

## Aircraft availability model

`airops/predict/availability.py` trains a gradient-boosting classifier on 4 000 seeded **synthetic** maintenance records
(75/25 split) and reports held-out ROC-AUC, accuracy and Brier score on the Data Fusion page and `/diagnostics`.
The labels come from a hand-written synthetic ground truth, so the metrics measure how well the model recovers *that*
function. They say nothing about real aircraft. If scikit-learn were missing a deterministic heuristic labelled
`BASELINE_HEURISTIC` would be used instead.

## Crew fatigue estimator

```
fatigue = 0.45·duty_load + 0.35·rest_deficit + 0.20·time_awake_load      (each term in [0,1])
```

Transparent weights, no physiological claims. It enters the objective with a small weight (`fatigue_weight`).
