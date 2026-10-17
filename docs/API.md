# API (FastAPI, also served under `/api` for the web UI)

Interactive docs: `http://localhost:8000/docs`. Errors always use `{"error": {"code", "message", "details"}}`.

| Method & path | Purpose |
|---|---|
| `GET /health` | status, version, OR-Tools version, uptime |
| `GET /scenario` | active BLUELAND scenario (3 bases, 24 aircraft, 40 crew, 30 missions, 45 corridors, threats) |
| `POST /scenario/reset` · `POST /scenario/generate {seed}` | regenerate (deterministic per seed; clears plans) |
| `GET /plan/current` | `{approved, proposed, proposed_scenario, pending_config, history}` |
| `POST /plan {method, time_limit_s, auto_approve}` | baseline plan (no plan yet) or manual re-optimisation |
| `POST /event` | one of the four events (`AIRCRAFT_UNAVAILABLE`, `BASE_WEATHER`, `NEW_PRIORITY1_MISSION`, `NEW_THREAT`) → proposal |
| `GET /event/suggest/{type}` | deterministic suggested target for an event (from the approved plan) |
| `GET /plan/{id}` · `/plan/{id}/scenario` · `/plan/{id}/diff?against=` | stored plans, their scenario, diffs |
| `POST /plan/{id}/approve` · `/reject` | human decision; **409** if not pending or if validation failed |
| `GET /config` · `PUT /config` | active/pending/default config; a change triggers a new calculation (proposal) |
| `GET /fusion` | source freshness / trust / stale / invalid / conflicts |
| `GET /benchmarks` · `POST /benchmarks/run` · `GET /benchmarks/csv?kind=instances\|churn` | benchmark results, run, export |
| `GET /diagnostics` | health, ws clients, seed, last plan, model, benchmark/test info |
| `WS /stream` | `hello`, `solver_started`, `plan_proposed`, `plan_approved`, `plan_rejected`, `scenario_reset`, `config_updated`, `benchmark_progress` |

Proposal lifecycle: an event or config change never mutates the live scenario. It creates a `PROPOSED` plan plus the
modified scenario; **approve** promotes both (and supersedes the old plan), **reject** discards both. Only one proposal
can be pending at a time.
