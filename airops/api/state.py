"""In-memory application state (single-process demo server)."""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Any, Optional

from fastapi import WebSocket

from ..core.config import PlanningConfig, load_config
from ..core.entities import Plan, Scenario
from ..generator.scenario import DEFAULT_SEED, generate_scenario


class Broadcaster:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    async def _send_all(self, msg: dict[str, Any]) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def publish(self, msg: dict[str, Any]) -> None:
        """Thread-safe: called from sync endpoints running in the worker thread pool."""
        if self.loop is None or not self.clients:
            return
        asyncio.run_coroutine_threadsafe(self._send_all(msg), self.loop)


class AppState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.started = time.time()
        self.bus = Broadcaster()
        self.reset(DEFAULT_SEED)

    def reset(self, seed: int) -> None:
        with self.lock:
            self.defaults: PlanningConfig = load_config()
            self.config: PlanningConfig = self.defaults.model_copy(deep=True)
            self.scenario: Scenario = generate_scenario(seed, self.config)
            self.plans: dict[str, Plan] = {}
            self.plan_scenarios: dict[str, Scenario] = {}
            self.approved: Optional[Plan] = None
            self.proposed: Optional[Plan] = None
            self.proposed_scenario: Optional[Scenario] = None
            self.proposed_config: Optional[PlanningConfig] = None
            self.history: list[dict[str, Any]] = []
            self._counter = 0

    def next_plan_id(self) -> str:
        with self.lock:
            self._counter += 1
            return f"plan-{self._counter:04d}"

    def log(self, kind: str, plan: Optional[Plan] = None, **extra: Any) -> None:
        entry = {"kind": kind, "at": time.time(), "plan_id": plan.id if plan else None, **extra}
        self.history.append(entry)
        del self.history[:-50]


state = AppState()
