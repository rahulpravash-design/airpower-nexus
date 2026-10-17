"""Aircraft serviceability model, trained on SYNTHETIC data only.

``get_availability_model()`` trains (once per process) a gradient-boosted classifier
on a seeded synthetic maintenance dataset and reports held-out metrics. If
scikit-learn is unavailable it falls back to an explicitly labelled deterministic
baseline. Nothing here is validated on real-world data.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Sequence

import numpy as np

from ..core.entities import Aircraft, ModelInfo

FEATURES = ["flight_hours_since_service", "days_since_maintenance", "fault_reports_30d",
            "sensor_anomaly", "age_years"]
TRAIN_SEED = 7013
N_SAMPLES = 4000
MODEL_VERSION = "avail-gbc-1.0"


def _latent(X: np.ndarray) -> np.ndarray:
    """Hidden synthetic ground truth: P(aircraft serviceable over the next 12 h)."""
    fh, days, faults, anomaly, age = X.T
    z = 5.4 - 0.012 * fh - 0.045 * days - 0.35 * faults - 3.2 * anomaly - 0.06 * age
    return 1.0 / (1.0 + np.exp(-z))


def make_synthetic_dataset(n: int = N_SAMPLES, seed: int = TRAIN_SEED) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    X = np.column_stack([
        rng.uniform(0, 160, n), rng.uniform(0, 45, n), rng.poisson(1.2, n).astype(float),
        np.clip(rng.beta(1.5, 6.0, n), 0, 1), rng.uniform(1, 25, n),
    ])
    y = (rng.random(n) < _latent(X)).astype(int)
    return X, y


def features_of(a: Aircraft) -> list[float]:
    return [a.flight_hours_since_service, a.days_since_maintenance, float(a.fault_reports_30d),
            a.sensor_anomaly, a.age_years]


@dataclass
class AvailabilityModel:
    info: ModelInfo
    _clf: object | None

    def predict(self, aircraft: Sequence[Aircraft]) -> list[float]:
        if not aircraft:
            return []
        X = np.array([features_of(a) for a in aircraft], dtype=float)
        if self._clf is not None:
            p = self._clf.predict_proba(X)[:, 1]  # type: ignore[attr-defined]
        else:
            p = _baseline(X)
        return [round(float(v), 4) for v in p]


def _baseline(X: np.ndarray) -> np.ndarray:
    """Deterministic hand-written heuristic (used only if scikit-learn is unavailable)."""
    fh, days, faults, anomaly, age = X.T
    z = 2.0 - 0.01 * fh - 0.03 * days - 0.25 * faults - 2.0 * anomaly - 0.03 * age
    return 1.0 / (1.0 + np.exp(-z))


@lru_cache(maxsize=1)
def get_availability_model() -> AvailabilityModel:
    X, y = make_synthetic_dataset()
    try:
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
        from sklearn.model_selection import train_test_split

        Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=TRAIN_SEED, stratify=y)
        clf = GradientBoostingClassifier(n_estimators=120, max_depth=3, learning_rate=0.08,
                                         random_state=TRAIN_SEED)
        clf.fit(Xtr, ytr)
        proba = clf.predict_proba(Xte)[:, 1]
        metrics = {
            "roc_auc": round(float(roc_auc_score(yte, proba)), 4),
            "accuracy": round(float(accuracy_score(yte, proba >= 0.5)), 4),
            "brier": round(float(brier_score_loss(yte, proba)), 4),
            "positive_rate_test": round(float(np.mean(yte)), 4),
        }
        info = ModelInfo(name="Aircraft serviceability (gradient boosting)", version=MODEL_VERSION,
                         kind="TRAINED_SYNTHETIC",
                         trained_on=f"{N_SAMPLES} synthetic maintenance records, seed {TRAIN_SEED}, 75/25 split",
                         n_train=len(ytr), n_test=len(yte), metrics=metrics)
        return AvailabilityModel(info, clf)
    except Exception as exc:  # pragma: no cover - only without scikit-learn
        p = _baseline(X)
        brier = float(np.mean((p - y) ** 2))
        info = ModelInfo(name="Aircraft serviceability (deterministic baseline)", version="baseline-1.0",
                         kind="BASELINE_HEURISTIC", trained_on=f"not trained ({type(exc).__name__}); heuristic only",
                         n_test=len(y), metrics={"brier": round(brier, 4)})
        return AvailabilityModel(info, None)


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))
