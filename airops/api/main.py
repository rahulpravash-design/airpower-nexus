"""AIR POWER FastAPI application (synthetic BLUELAND scenario only).

Every endpoint is mounted twice: at the root (as specified) and under ``/api`` (used by the web UI
so that SPA routes such as /fusion and /benchmarks never collide with API paths).
"""
from __future__ import annotations

import asyncio
import json
import os
import platform
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import ortools
from fastapi import APIRouter, Body, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..bench import run_bench
from ..core.config import PlanningConfig
from ..core.entities import Plan, PlanDiff, Scenario
from ..core.events import EVENT_TYPES, EventRequest
from ..generator.scenario import generate_scenario
from ..solver.diff import diff_plans
from ..solver.retask import EventError, suggest_event
from ..trust.score import FusionReport, build_fusion_report
from . import events as ev
from .schemas import (
    BenchmarkRunRequest, ConfigResponse, DecisionRequest, HealthResponse, PlanRequest, PlanState,
    ProposalResponse, SeedRequest,
)
from .state import state

VERSION = "1.0.0"
WEB_DIST = Path(os.environ.get("AIROPS_WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist"))


def fail(status: int, code: str, message: str, details: Any = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, "details": details})


router = APIRouter()


# ------------------------------------------------------------------ health / scenario
@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=VERSION, solver=f"OR-Tools CP-SAT {ortools.__version__}",
                          time=datetime.now(timezone.utc).isoformat(), uptime_s=round(time.time() - state.started, 1))


@router.get("/scenario", response_model=Scenario)
def get_scenario() -> Scenario:
    return state.scenario


def _bus_reset(kind: str) -> None:
    state.bus.publish({"type": "scenario_reset", "kind": kind, "seed": state.scenario.seed})


@router.post("/scenario/reset", response_model=Scenario)
def reset_scenario() -> Scenario:
    with state.lock:
        state.reset(26250)
    _bus_reset("reset")
    return state.scenario


@router.post("/scenario/generate", response_model=Scenario)
def generate(req: SeedRequest) -> Scenario:
    with state.lock:
        state.reset(req.seed)
    _bus_reset("generate")
    return state.scenario


@router.get("/fusion", response_model=FusionReport)
def get_fusion() -> FusionReport:
    return build_fusion_report(state.scenario, state.config)


# ------------------------------------------------------------------ plans
@router.get("/plan/current", response_model=PlanState)
def plan_current() -> PlanState:
    return PlanState(approved=state.approved, proposed=state.proposed, proposed_scenario=state.proposed_scenario,
                     pending_config=state.proposed_config if state.proposed_config != state.config else None,
                     scenario_version=state.scenario.version, history=state.history[-20:])


@router.post("/plan", response_model=Plan)
def post_plan(req: PlanRequest = Body(default_factory=PlanRequest)) -> Plan:
    with state.lock:
        try:
            return ev.create_plan(state, req.method, req.time_limit_s, req.auto_approve)
        except ev.Conflict as e:
            raise fail(409, e.code, e.message, e.details)


@router.get("/plan/{plan_id}", response_model=Plan)
def get_plan(plan_id: str) -> Plan:
    plan = state.plans.get(plan_id)
    if plan is None:
        raise fail(404, "PLAN_NOT_FOUND", f"unknown plan {plan_id}")
    return plan


@router.get("/plan/{plan_id}/scenario", response_model=Scenario)
def get_plan_scenario(plan_id: str) -> Scenario:
    scn = state.plan_scenarios.get(plan_id)
    if scn is None:
        raise fail(404, "PLAN_NOT_FOUND", f"unknown plan {plan_id}")
    return scn


@router.get("/plan/{plan_id}/diff", response_model=PlanDiff)
def get_plan_diff(plan_id: str, against: Optional[str] = Query(None)) -> PlanDiff:
    plan = state.plans.get(plan_id)
    if plan is None:
        raise fail(404, "PLAN_NOT_FOUND", f"unknown plan {plan_id}")
    base_id = against or plan.parent_plan_id
    base = state.plans.get(base_id) if base_id else None
    if base_id and base is None:
        raise fail(404, "PLAN_NOT_FOUND", f"unknown comparison plan {base_id}")
    return diff_plans(base, plan)


@router.post("/plan/{plan_id}/approve", response_model=Plan)
def approve_plan(plan_id: str, req: DecisionRequest = Body(default_factory=DecisionRequest)) -> Plan:
    with state.lock:
        try:
            return ev.approve(state, plan_id, req.note)
        except KeyError:
            raise fail(404, "PLAN_NOT_FOUND", f"unknown plan {plan_id}")
        except ev.Conflict as e:
            raise fail(409, e.code, e.message, e.details)


@router.post("/plan/{plan_id}/reject", response_model=Plan)
def reject_plan(plan_id: str, req: DecisionRequest = Body(default_factory=DecisionRequest)) -> Plan:
    with state.lock:
        try:
            return ev.reject(state, plan_id, req.note)
        except KeyError:
            raise fail(404, "PLAN_NOT_FOUND", f"unknown plan {plan_id}")
        except ev.Conflict as e:
            raise fail(409, e.code, e.message, e.details)


# ------------------------------------------------------------------ events
@router.post("/event", response_model=ProposalResponse)
def post_event(event: EventRequest) -> ProposalResponse:
    with state.lock:
        try:
            plan = ev.handle_event(state, event)
        except ev.Conflict as e:
            raise fail(409, e.code, e.message, e.details)
        except EventError as e:
            raise fail(422, "EVENT_REJECTED", str(e))
        return ProposalResponse(plan=plan, proposed_scenario=state.proposed_scenario)  # type: ignore[arg-type]


@router.get("/event/suggest/{kind}")
def suggest(kind: str) -> dict[str, Any]:
    if kind not in EVENT_TYPES:
        raise fail(404, "UNKNOWN_EVENT", f"event type must be one of {EVENT_TYPES}")
    if state.approved is None:
        raise fail(409, "NO_BASELINE_PLAN", "approve a baseline plan first")
    try:
        return suggest_event(kind, state.scenario, state.approved, state.config).model_dump(exclude_none=True)
    except EventError as e:
        raise fail(422, "EVENT_REJECTED", str(e))


# ------------------------------------------------------------------ config
def _config_response(proposal: Optional[Plan] = None) -> ConfigResponse:
    pend = state.proposed_config if state.proposed_config != state.config else None
    return ConfigResponse(active=state.config, pending=pend, defaults=state.defaults,
                          proposal=ProposalResponse(plan=proposal, proposed_scenario=state.proposed_scenario)
                          if proposal and state.proposed_scenario else None)


@router.get("/config", response_model=ConfigResponse)
def get_config() -> ConfigResponse:
    return _config_response()


@router.put("/config", response_model=ConfigResponse)
def put_config(patch: dict[str, Any] = Body(...)) -> ConfigResponse:
    with state.lock:
        merged = {**state.config.model_dump(), **patch}
        try:
            new_cfg = PlanningConfig(**merged)
        except ValidationError as e:
            raise fail(422, "INVALID_CONFIG", "configuration failed validation",
                       [{"field": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in e.errors()])
        try:
            plan = ev.handle_config(state, new_cfg)
        except ev.Conflict as e:
            raise fail(409, e.code, e.message, e.details)
        return _config_response(plan)


# ------------------------------------------------------------------ benchmarks
class BenchJob:
    def __init__(self) -> None:
        self.status = "idle"
        self.done = 0
        self.total = 0
        self.message = ""
        self.error: Optional[str] = None
        self.params: dict[str, Any] = {}
        self.thread: Optional[threading.Thread] = None


bench_job = BenchJob()


def _bench_payload() -> dict[str, Any]:
    res = run_bench.load_results()
    return {"status": bench_job.status, "progress": {"done": bench_job.done, "total": bench_job.total,
                                                      "message": bench_job.message},
            "error": bench_job.error, "params": bench_job.params,
            "available": res is not None, "summary": res["summary"] if res else None,
            "rows": res["rows"] if res else [], "churn": res["churn"] if res else []}


@router.get("/benchmarks")
def get_benchmarks() -> dict[str, Any]:
    return _bench_payload()


@router.post("/benchmarks/run")
def run_benchmarks(req: BenchmarkRunRequest = Body(default_factory=BenchmarkRunRequest)) -> dict[str, Any]:
    if bench_job.status == "running":
        raise fail(409, "BENCHMARK_RUNNING", "a benchmark is already running")
    bench_job.status, bench_job.done, bench_job.error = "running", 0, None
    bench_job.total = req.instances + req.churn_instances
    bench_job.params = req.model_dump()

    def work() -> None:
        def prog(d: int, t: int, m: str) -> None:
            bench_job.done, bench_job.total, bench_job.message = d, t, m
            state.bus.publish({"type": "benchmark_progress", "done": d, "total": t, "message": m})
        try:
            run_bench.run_benchmark(req.instances, req.seed, req.time_limit_s, req.churn_instances,
                                    state.config.solver_workers, progress=prog)
            bench_job.status = "done"
        except Exception as exc:  # surfaced to the UI, never swallowed
            bench_job.status, bench_job.error = "error", f"{type(exc).__name__}: {exc}"
        state.bus.publish({"type": "benchmark_finished", "status": bench_job.status})

    bench_job.thread = threading.Thread(target=work, daemon=True, name="benchmark")
    bench_job.thread.start()
    return _bench_payload()


@router.get("/benchmarks/csv")
def benchmark_csv(kind: str = Query("instances", pattern="^(instances|churn)$")):
    path = run_bench.RESULTS_DIR / f"benchmark_{kind}.csv"
    if not path.exists():
        raise fail(404, "BENCHMARK_NOT_RUN", "no benchmark results exist yet; run the benchmark first")
    return FileResponse(path, media_type="text/csv", filename=path.name)


# ------------------------------------------------------------------ diagnostics
@router.get("/diagnostics")
def diagnostics() -> dict[str, Any]:
    last = max(state.plans.values(), key=lambda p: p.created_at, default=None)
    report = run_bench.RESULTS_DIR / "test_report.json"
    return {
        "health": health().model_dump(), "python": platform.python_version(), "ortools": ortools.__version__,
        "seed": state.scenario.seed, "scenario_version": state.scenario.version,
        "ws_clients": len(state.bus.clients), "config": state.config.model_dump(),
        "approved_plan_id": state.approved.id if state.approved else None,
        "pending_plan_id": state.proposed.id if state.proposed else None,
        "last_plan": None if last is None else {
            "id": last.id, "status": last.status, "method": last.method, "solver_status": last.solver_status,
            "solve_time_s": last.solve_time_s, "valid": last.validation.valid,
            "violations": len(last.validation.violations), "trigger": last.trigger},
        "plans_total": len(state.plans),
        "model": state.scenario.model_info.model_dump() if state.scenario.model_info else None,
        "benchmark": {"status": bench_job.status, "available": (run_bench.RESULTS_DIR / "benchmark_summary.json").exists()},
        "tests": json.loads(report.read_text()) if report.exists() else None,
        "offline": {"external_requests": False, "note": "no CDN, remote fonts, map tiles or cloud APIs are used"},
    }


# ------------------------------------------------------------------ websocket
@router.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    state.bus.loop = asyncio.get_running_loop()
    state.bus.clients.add(ws)
    try:
        await ws.send_json({"type": "hello", "seed": state.scenario.seed, "scenario_version": state.scenario.version,
                            "approved_plan_id": state.approved.id if state.approved else None,
                            "pending_plan_id": state.proposed.id if state.proposed else None})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_json({"type": "pong", "t": time.time()})
    except WebSocketDisconnect:
        pass
    finally:
        state.bus.clients.discard(ws)


# ------------------------------------------------------------------ app factory
@asynccontextmanager
async def lifespan(app: FastAPI):
    state.bus.loop = asyncio.get_running_loop()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="AIR POWER (SIH26250)", version=VERSION, lifespan=lifespan,
                  description="Synthetic-data mission planning & dynamic re-optimisation (OR-Tools CP-SAT).")
    origins = [o.strip() for o in os.environ.get("AIROPS_CORS_ORIGINS", "*").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: Request, exc: StarletteHTTPException):
        d = exc.detail
        body = d if isinstance(d, dict) and "code" in d else {"code": f"HTTP_{exc.status_code}", "message": str(d), "details": None}
        return JSONResponse(status_code=exc.status_code, content={"error": body})

    @app.exception_handler(RequestValidationError)
    async def val_exc(_: Request, exc: RequestValidationError):
        det = [{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR",
                                                                 "message": "request validation failed", "details": det}})

    @app.exception_handler(Exception)
    async def any_exc(_: Request, exc: Exception):
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR",
                                                                 "message": f"{type(exc).__name__}: {exc}", "details": None}})

    # SPA pages /fusion, /benchmarks and /diagnostics share their names with root-level API paths: when a browser navigates
    # to them (Accept: text/html) serve the web app instead of JSON. The UI itself always uses /api/*.
    @app.middleware("http")
    async def spa_for_browsers(request: Request, call_next):
        if (request.method == "GET" and request.url.path in ("/fusion", "/benchmarks", "/diagnostics")
                and "text/html" in request.headers.get("accept", "") and (WEB_DIST / "index.html").exists()):
            return FileResponse(WEB_DIST / "index.html")
        return await call_next(request)

    app.include_router(router)
    app.include_router(router, prefix="/api")

    if (WEB_DIST / "index.html").exists():  # single-process mode: serve the built web app too
        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            f = WEB_DIST / full_path
            return FileResponse(f if f.is_file() else WEB_DIST / "index.html")
    return app


app = create_app()
