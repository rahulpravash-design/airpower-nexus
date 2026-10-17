import pytest
from fastapi.testclient import TestClient

from airops.api.main import app
from airops.api.state import state
from airops.bench import run_bench


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(run_bench, "RESULTS_DIR", tmp_path)
    state.reset(26250)
    with TestClient(app) as c:
        yield c


def baseline(client):
    r = client.post("/plan", json={"time_limit_s": 2, "auto_approve": True})
    assert r.status_code == 200, r.text
    return r.json()


def test_health_and_scenario_schema(client):
    h = client.get("/health").json()
    assert h["status"] == "ok" and "CP-SAT" in h["solver"]
    s = client.get("/scenario").json()
    assert len(s["aircraft"]) == 24 and len(s["crew"]) == 40 and len(s["missions"]) == 30 and len(s["bases"]) == 3
    assert client.get("/api/scenario").json()["seed"] == 26250  # /api mirror used by the web UI


def test_scenario_generate_and_reset(client):
    s = client.post("/scenario/generate", json={"seed": 7}).json()
    assert s["seed"] == 7 and client.get("/scenario").json()["seed"] == 7
    assert client.post("/scenario/reset").json()["seed"] == 26250
    assert client.post("/scenario/generate", json={"seed": -1}).status_code == 422


def test_plan_current_empty_then_baseline(client):
    cur = client.get("/plan/current").json()
    assert cur["approved"] is None and cur["proposed"] is None
    plan = baseline(client)
    assert plan["status"] == "APPROVED" and plan["validation"]["valid"] and plan["method"] == "CP_SAT"
    cur = client.get("/plan/current").json()
    assert cur["approved"]["id"] == plan["id"] and cur["proposed"] is None


def test_event_requires_baseline_then_proposal_approve_flow(client):
    body = {"type": "AIRCRAFT_UNAVAILABLE", "aircraft_id": "AC-R1-02"}
    r = client.post("/event", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_BASELINE_PLAN"
    base = baseline(client)
    sug = client.get("/event/suggest/AIRCRAFT_UNAVAILABLE").json()
    r = client.post("/event", json=sug)
    assert r.status_code == 200, r.text
    prop = r.json()["plan"]
    assert prop["status"] == "PROPOSED" and prop["parent_plan_id"] == base["id"] and prop["diff"]
    cur = client.get("/plan/current").json()
    assert cur["proposed"]["id"] == prop["id"] and cur["approved"]["id"] == base["id"]
    # a second event while a proposal is pending is refused
    assert client.post("/event", json=sug).status_code == 409
    d = client.get(f"/plan/{prop['id']}/diff").json()
    assert d["changed_mission_count"] == prop["diff"]["changed_mission_count"]
    ok = client.post(f"/plan/{prop['id']}/approve", json={"note": "ok"})
    assert ok.status_code == 200 and ok.json()["status"] == "APPROVED" and ok.json()["decision_note"] == "ok"
    cur = client.get("/plan/current").json()
    assert cur["approved"]["id"] == prop["id"] and cur["proposed"] is None
    assert client.get("/plan/" + base["id"]).json()["status"] == "SUPERSEDED"
    ac = next(a for a in client.get("/scenario").json()["aircraft"] if a["id"] == sug["aircraft_id"])
    assert ac["status"] == "UNAVAILABLE"  # scenario only changes after approval
    assert client.post(f"/plan/{prop['id']}/approve").status_code == 409  # no longer pending


def test_reject_discards_the_proposal_and_scenario_change(client):
    base = baseline(client)
    sug = client.get("/event/suggest/BASE_WEATHER").json()
    prop = client.post("/event", json=sug).json()["plan"]
    r = client.post(f"/plan/{prop['id']}/reject", json={"note": "no"})
    assert r.status_code == 200 and r.json()["status"] == "REJECTED"
    cur = client.get("/plan/current").json()
    assert cur["approved"]["id"] == base["id"] and cur["proposed"] is None
    s = client.get("/scenario").json()
    assert all(not b["weather_closures"] or b["id"] == "BASE-C" for b in s["bases"]) and s["version"] == 1


def test_invalid_plan_cannot_be_approved(client):
    baseline(client)
    sug = client.get("/event/suggest/NEW_THREAT").json()
    prop = client.post("/event", json=sug).json()["plan"]
    state.plans[prop["id"]].validation.valid = False  # simulate a plan that fails validation
    r = client.post(f"/plan/{prop['id']}/approve")
    assert r.status_code == 409 and r.json()["error"]["code"] == "PLAN_INVALID"


@pytest.mark.parametrize("kind", ["BASE_WEATHER", "NEW_PRIORITY1_MISSION", "NEW_THREAT"])
def test_all_event_types_via_api(client, kind):
    baseline(client)
    sug = client.get(f"/event/suggest/{kind}").json()
    r = client.post("/event", json=sug)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["plan"]["validation"]["valid"] and p["plan"]["trigger"] == kind
    assert p["proposed_scenario"]["version"] == 2


def test_errors_use_a_consistent_envelope(client):
    r = client.get("/plan/nope")
    assert r.status_code == 404 and set(r.json()["error"]) == {"code", "message", "details"}
    r = client.post("/event", json={"type": "BOGUS"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    baseline(client)
    r = client.post("/event", json={"type": "AIRCRAFT_UNAVAILABLE", "aircraft_id": "ZZZ"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "EVENT_REJECTED"
    assert client.get("/event/suggest/NOPE").status_code == 404


def test_config_validation_and_defaults(client):
    cfg = client.get("/config").json()
    assert cfg["active"]["crew_rest_hours"] == 10 and cfg["pending"] is None
    r = client.put("/config", json={"crew_rest_hours": 0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_CONFIG"
    assert client.put("/config", json={"turnaround_minutes": 50}).status_code == 422
    assert client.put("/config", json={"not_a_key": 1}).status_code == 422
    r = client.put("/config", json={"freeze_window_minutes": 45})  # no baseline yet -> applied immediately
    assert r.status_code == 200 and r.json()["active"]["freeze_window_minutes"] == 45 and r.json()["proposal"] is None


def test_crew_rest_change_triggers_new_plan_calculation(client):
    base = baseline(client)
    r = client.put("/config", json={"crew_rest_hours": 12, "solver_time_limit_s": 2})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["active"]["crew_rest_hours"] == 10 and j["pending"]["crew_rest_hours"] == 12
    plan = j["proposal"]["plan"]
    assert plan["trigger"] == "CONFIG_CHANGE" and plan["config_snapshot"]["crew_rest_hours"] == 12
    assert plan["id"] != base["id"] and plan["validation"]["valid"]
    assert client.put("/config", json={"crew_rest_hours": 11}).status_code == 409  # pending proposal
    client.post(f"/plan/{plan['id']}/approve")
    assert client.get("/config").json()["active"]["crew_rest_hours"] == 12
    # rejecting a config proposal keeps the old rule
    r = client.put("/config", json={"crew_rest_hours": 8}).json()
    client.post(f"/plan/{r['proposal']['plan']['id']}/reject")
    assert client.get("/config").json()["active"]["crew_rest_hours"] == 12


def test_greedy_plan_via_api(client):
    r = client.post("/plan", json={"method": "GREEDY"})
    assert r.status_code == 200 and r.json()["method"] == "GREEDY" and r.json()["validation"]["valid"]


def test_fusion_and_diagnostics(client):
    f = client.get("/fusion").json()
    assert f["total_records"] > 100 and f["stale"] >= 1 and f["invalid"] >= 1
    d = client.get("/diagnostics").json()
    assert d["seed"] == 26250 and d["benchmark"]["available"] is False and d["model"]["kind"] == "TRAINED_SYNTHETIC"


def test_benchmarks_not_run_state_and_csv_404(client):
    b = client.get("/benchmarks").json()
    assert b["available"] is False and b["summary"] is None and b["rows"] == []
    assert client.get("/benchmarks/csv").status_code == 404


def test_websocket_stream_publishes_real_events(client):
    baseline(client)
    with client.websocket_connect("/stream") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["approved_plan_id"]
        ws.send_text("ping")
        assert ws.receive_json()["type"] == "pong"
        sug = client.get("/event/suggest/NEW_PRIORITY1_MISSION").json()
        client.post("/event", json=sug)
        seen = []
        for _ in range(4):
            m = ws.receive_json()
            seen.append(m["type"])
            if m["type"] == "plan_proposed":
                assert m["valid"] is True
                break
        assert "plan_proposed" in seen


def test_spa_pages_that_share_api_names_serve_the_web_app_to_browsers(client, tmp_path, monkeypatch):
    from airops.api import main
    (tmp_path / "index.html").write_text("<!doctype html><title>spa</title>")
    monkeypatch.setattr(main, "WEB_DIST", tmp_path)
    for path in ("/fusion", "/benchmarks", "/diagnostics"):
        html = client.get(path, headers={"accept": "text/html"})
        assert html.status_code == 200 and "<title>spa</title>" in html.text
        js = client.get(path, headers={"accept": "application/json"})
        assert js.status_code == 200 and js.headers["content-type"].startswith("application/json")


def test_benchmark_variants_are_discovered_and_selectable(client, tmp_path, monkeypatch):
    from airops.bench.run_bench import run_benchmark
    run_benchmark(instances=1, time_limit=0.5, churn_instances=0, out_dir=tmp_path)
    run_benchmark(instances=1, time_limit=1.0, churn_instances=0, out_dir=tmp_path / "limit_1s")
    b = client.get("/benchmarks").json()
    assert {v["id"] for v in b["variants"]} == {"default", "limit_1s"} and b["summary"]["meta"]["time_limit_s"] == 0.5
    b2 = client.get("/benchmarks?variant=limit_1s").json()
    assert b2["variant"] == "limit_1s" and b2["summary"]["meta"]["time_limit_s"] == 1.0
    assert client.get("/benchmarks/csv?variant=limit_1s").status_code == 200
    assert client.get("/benchmarks?variant=..").status_code == 404
    assert client.get("/benchmarks/csv?variant=../x").status_code == 404
