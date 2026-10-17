# AIR POWER · SIH26250

> *Every report verified. Every post stocked before the pass closes.*

A synthetic-data mission-planning and dynamic re-optimisation platform with a 3D web interface:

**FUSE** (validate + trust-score feeds) → **PREDICT** (serviceability model, fatigue estimate) → **OPTIMISE** (Google
OR-Tools **CP-SAT**) → **RETASK** (4 events, freeze window, persistence) → **DECIDE** (diff, reason codes, human approve/reject).

> **Everything is fictional.** The BLUELAND scenario, its bases, aircraft roles (abstract `R1–R3`), load-outs (`A/B/C`),
> threats and corridors are generated from a seed. No real military data, locations, systems or specifications are used,
> and nothing here is validated against the real world. It is a software-engineering demonstration.

## Quick start (no Docker, works offline after install)

Requirements: Python ≥ 3.11, Node ≥ 20.

```bash
# backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
uvicorn airops.api.main:app --port 8000            # API + docs at http://localhost:8000/docs

# frontend (second terminal)
cd web && npm install && npm run dev                # http://localhost:5173  (proxies /api -> :8000)
```

Single-process alternative: `cd web && npm run build`, then `uvicorn airops.api.main:app --port 8000` serves the
built app at http://localhost:8000. With Docker: `docker compose up --build` → UI http://localhost:8080
(*the compose file is syntax-checked but could not be built/run in the sandbox where this was developed*).

```bash
scripts/run_checks.sh                               # pytest + tsc + vitest + production build (writes airops/results/test_report.json)
python -m airops.bench.run_bench --instances 100 --time-limit 4 --churn-instances 20   # regenerate benchmark CSVs
```

Then follow [docs/DEMO.md](docs/DEMO.md).

## What is implemented

| Area | Where |
|---|---|
| Seeded BLUELAND generator: 3 bases, 24 aircraft (3 roles × 8), 40 crew, 30 missions, 12 h / 15-min slots, finite load-out stock, 3 corridors per base-area pair, time-windowed threat polygons, injected stale / invalid / conflicting records | `airops/generator` |
| Entities, config, rule semantics, **independent 17-rule validator**, metrics | `airops/core` |
| **CP-SAT planner** (optional coverage, intervals + `NoOverlap`, hints, persistence penalty, freeze as constants), **greedy baseline** (validator-gated), retasking, diff engine, evidence-based reason codes | `airops/solver` |
| Trust formula + fusion report; synthetic-trained availability model with held-out metrics; transparent fatigue estimator | `airops/trust`, `airops/predict` |
| FastAPI + Pydantic + WebSocket `/stream`, approve/reject lifecycle | `airops/api` |
| 100-instance benchmark, churn study, CSV export | `airops/bench` |
| React + TS + Vite + Tailwind app: Overview, 3D Theatre (React Three Fiber), Missions, Timeline, Replanning, Data Fusion, Benchmarks, Configuration, Diagnostics | `web/src` |

Design docs: [CONSTRAINTS](docs/CONSTRAINTS.md) · [OBJECTIVE](docs/OBJECTIVE.md) · [TRUST / model / fatigue](docs/TRUST.md) · [API](docs/API.md) · [DEMO](docs/DEMO.md).

## Measured results (produced by this repository's own code)

All numbers below come from `airops/results/benchmark_summary.json` (OR-Tools 9.15, 4 CPU cores, 4 workers,
100 seeded instances `26250…26349`, CP-SAT limited to **4 s**, no greedy hint and no fallback for CP-SAT in the benchmark).

| | CP-SAT | Greedy |
|---|---|---|
| Median priority-weighted coverage (max 1440 on seed 26250) | **1385** | 1320 |
| Median missions covered / 30 | 28 | 25 |
| Hard-rule validator passes | 100 / 100 | 100 / 100 |
| Median solve time | 4.02 s (hit the limit) | 18 ms |
| Solver status | **100 × FEASIBLE** (0 proven `OPTIMAL`) | n/a |

Paired comparison (CP-SAT − greedy coverage): CP-SAT better on **99**, equal on **1**, worse on **0** instances,
median difference **+70** points. Read this with care: it shows CP-SAT beats *this* simple greedy heuristic on *this*
synthetic generator when given 4 s. No instance was proven optimal within 4 s, so the gap to the optimum is unknown
(the plan page shows the solver's best bound).

**Longer time limit (15 s, `airops/results/limit_15s/`, same 100 seeds, 1824 s total):** CP-SAT median coverage **1400**
(mean 1390.6 vs 1387.9 at 4 s), better on 99 / equal on 1 / worse on 0, median difference **+80**. Only **4 of 100** runs were
proven `OPTIMAL` (96 still `FEASIBLE` at the limit), so most optimality gaps remain unknown. All 200 plans passed the validator.
Churn: median 3.5 changed missions with persistence vs 27 without (fewer in 20 / 20). The Benchmarks page has a result-set selector for both runs. Regenerate with
`python -m airops.bench.run_bench --time-limit 15 --out airops/results/limit_15s`.

Churn after one controlled event (20 events, cycling the four types): median **4** changed missions with persistence
(penalty + hints + 30-min freeze) versus **28** without; persistence changed fewer missions in 20 / 20 cases, at a
median coverage of 1360 vs 1380 (the price of stability).

Demo timings measured through the API on seed 26250: baseline plan 8.0 s (CP-SAT time limit; result `FEASIBLE`),
event re-plans 1–4 s (`OPTIMAL`) — within the < 10 s target.

## Verified checks

Actually executed on the final code in the development sandbox (Python 3.13, Node 22):

| Check | Result |
|---|---|
| `pytest` (backend: generator, validator rules, solver, greedy, fallback, freeze, 4 events, diff, API, WebSocket, config, benchmark) | **75 / 75 passed** (~70 s) |
| `vitest` (API client, formatting, plan/diff helpers, 3-D geometry, UI components) | **23 / 23 passed** |
| `tsc --noEmit` and `vite build` | exit 0 / built |
| Headless-Chromium end-to-end (`scripts/e2e_browser.cjs`): baseline → 3-D theatre (real WebGL canvas) → event → proposal → approve → config change → reject → 390 px mobile layout | passes; **0 console errors, 0 requests to non-local hosts, no horizontal overflow** |
| Backend stopped while the UI is open | stream badge `closed`, data badge switches to **CACHED** with a banner (never `LIVE`); returns to `LIVE` automatically when the API is back |

`scripts/run_checks.sh` re-runs the first three rows and records the pytest outcome for the Diagnostics page.

## Known limitations

* In-memory state, single user, no authentication (by design for the demo). Restarting the API resets plans.
* One duty window per crew per horizon in the solver (validator is more permissive) — see CONSTRAINTS.md.
* Corridor risk is evaluated over the mission's whole start window, not the exact flight time.
* Even at 15 s CP-SAT proves optimality on only 4 of 100 benchmark instances.
* Docker images were not built in the development environment (no Docker daemon available).
* Out of scope for this release: courses of action, Monte-Carlo robustness, multi-base sync, LLM briefings, real data, pathfinding.
