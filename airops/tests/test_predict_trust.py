from datetime import timedelta

from airops.core.config import load_config
from airops.predict.availability import get_availability_model
from airops.predict.fatigue import fatigue_risk
from airops.trust.score import build_fusion_report, freshness_factor, trust_score


def test_availability_model_is_trained_on_synthetic_data_with_heldout_metrics(scn):
    info = get_availability_model().info
    assert info.kind == "TRAINED_SYNTHETIC" and info.n_test > 500 and info.version
    assert info.metrics["roc_auc"] > 0.65 and 0 < info.metrics["brier"] < 0.25
    assert "synthetic" in info.disclaimer.lower()
    probs = [a.predicted_serviceability for a in scn.aircraft if a.record_valid]
    assert probs and all(0.0 <= p <= 1.0 for p in probs)


def test_trust_formula_components(cfg):
    assert freshness_factor(0, cfg) == 1.0 and freshness_factor(cfg.fresh_minutes, cfg) == 1.0
    assert freshness_factor(cfg.stale_minutes, cfg) == 0.1
    mid = freshness_factor((cfg.fresh_minutes + cfg.stale_minutes) / 2, cfg)
    assert 0.1 < mid < 1.0
    fresh = trust_score("MAINT_LOG", 5, True, False, cfg)
    assert trust_score("MAINT_LOG", 500, True, False, cfg) < fresh
    assert trust_score("MAINT_LOG", 5, False, False, cfg) == 0.0
    assert trust_score("MAINT_LOG", 5, True, True, cfg) < fresh


def test_fusion_report_counts_flagged_records(scn, cfg):
    rep = build_fusion_report(scn, cfg)
    assert rep.stale >= 1 and rep.invalid >= 1 and rep.conflicts >= 1
    assert 0 < rep.trust_health < 1
    assert {f.record_id for f in rep.flagged} >= {a.id for a in scn.aircraft if not a.record_valid}
    assert sum(s.records for s in rep.sources) == rep.total_records


def test_fatigue_estimator_is_monotonic(scn, cfg):
    c = next(c for c in scn.crew if c.record_valid and c.prior_duty_end_slot is None)
    base = fatigue_risk(c, cfg)
    assert fatigue_risk(c, cfg, planned_hours=4) > base
    tired = c.model_copy(update={"hours_since_rest": 18, "duty_hours_last_24h": 8, "prior_duty_end_slot": -1})
    assert fatigue_risk(tired, cfg) > base
    assert 0 <= fatigue_risk(tired, cfg, 10) <= 1
    longer_rest = cfg.model_copy(update={"crew_rest_hours": 14})
    assert fatigue_risk(tired, longer_rest) >= fatigue_risk(tired, cfg)
