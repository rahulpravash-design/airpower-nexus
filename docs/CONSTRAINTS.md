# Hard constraints

All data is synthetic and fictional. Times are slots of 15 minutes; a 12 h horizon = slots 0…48.
A sortie launches at instant `start` and recovers at `end = start + duration`.

The **same 17 rules** are enforced in the CP-SAT model (`airops/solver/plan.py`), respected by the greedy baseline
(`airops/solver/greedy.py`, which only commits a placement if the validator accepts it) and re-checked from scratch
by the independent validator (`airops/core/validation.py`, which never imports the solver).

| # | Validator rule | Meaning | CP-SAT formulation |
|---|---|---|---|
| 1 | `STRUCTURE` | known mission, assigned once; uncovered missions hold no resources | `cover[m]` ties every resource sum to 0/1 |
| 2 | `PACKAGE_SIZE` | exactly `package_size` distinct aircraft **and** crew | `Σ x[m,a] = pkg·cover[m]`, `Σ y[m,c] = pkg·cover[m]` |
| 3 | `AIRCRAFT_ROLE` | aircraft role = mission role | `x[m,a]` only created for matching roles |
| 4 | `ASSET_AVAILABLE` | record valid; status/maintenance/unavailable windows cover the whole sortie; invalid or unavailable assets are never assigned | candidate filtering + `start ≥ available_from`, `end ≤ unavailable_from` when `x=1` |
| 5 | `MISSION_WINDOW` | launch inside `[earliest_start, latest_start]` | domain of `start[m]` |
| 6 | `MISSION_HORIZON` | recovery ≤ slot 48 and (on replans) not in the past | domain of `start[m]` |
| 7 | `RUNWAY_WINDOW` | base runway open at launch **and** recovery | `start ∈ allowed(m,b)` enforced by `z[m,b]` |
| 8 | `WEATHER_MINIMA` | no weather closure at launch or recovery | same allowed-start set |
| 9 | `BASE_CORRIDOR` | aircraft and crew are based at the mission base; corridor joins that base to the mission area | `x ≤ z[m,home]`, `y ≤ z[m,home]`, `k[m,r] ≤ z[m,base(r)]`, `Σ z = cover` |
| 10 | `CORRIDOR_OPEN` | no blocking threat intersects the corridor during the mission window | blocked corridors get no `k` variable |
| 11 | `AIRCRAFT_OVERLAP` | no overlapping sorties per aircraft | optional intervals + `NoOverlap` |
| 12 | `TURNAROUND` | `turnaround_minutes` between consecutive sorties of one aircraft | interval length = duration + turnaround |
| 13 | `CREW_QUALIFICATION` | crew qualified for the role | `y[m,c]` only for qualified crew |
| 14 | `CREW_OVERLAP` | no overlap per crew (incl. `crew_turnaround_minutes`) | optional intervals + `NoOverlap` |
| 15 | `CREW_DUTY_LIMIT` | a crew duty period (consecutive sorties separated by < rest) spans ≤ `duty_limit_hours` | one duty window `D[c]`: `D ≤ start`, `end ≤ D + duty` when `y=1` |
| 16 | `CREW_REST` | first sortie not before `prior_duty_end + crew_rest_hours` | `D[c] ≥ available_from[c]` |
| 17 | `LOADOUT_STOCK` | load-out acceptable for the mission; finite per-base stock never exceeded | `Σ pkg·w[m,b,l] ≤ stock[b][l]` (minus stock consumed by frozen assignments) |

Notes and deliberate simplifications (all documented, none hidden):

* The solver is *stricter* than the validator for crew: it uses a **single duty window per crew per horizon**; the validator
  accepts any schedule that splits into duty periods separated by ≥ rest. Every solver plan therefore passes the validator.
* Corridor risk / blocking is evaluated over the mission's **whole start window** (conservative), because the start time
  is a decision variable.
* A mission is launched from exactly one base; all aircraft and crew of its package are based there.
* Coverage is **optional**: if a mission cannot be served without breaking a rule it stays uncovered.

# Freeze window and persistence

* On every replan at slot `now`, previous assignments that launch at or before `now + freeze_window` (or have already
  launched, `IN_PROGRESS`) and are still valid under the new scenario are **frozen**: they enter the model as constants.
* A frozen assignment invalidated by the event (for example its aircraft becomes unavailable) is released on its own, and the
  plan reports `FREEZE_OVERRIDE_INVALIDATED` with the violated rule. Nothing else is unfrozen.
* Everything else is re-optimised with an **assignment-change penalty** (aircraft, crew, corridor, load-out and launch-time
  deviations from the previous plan) and the previous plan as a solver hint.
