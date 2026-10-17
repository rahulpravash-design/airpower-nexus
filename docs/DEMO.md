# Demo script (≈ 5 minutes, fully offline)

1. Start backend and frontend (see README). Open http://localhost:5173.
2. **Overview** → *Generate baseline plan*. CP-SAT runs (8 s limit). Every tile is computed from the returned plan;
   *Hard-rule validation: PASS 17/17* comes from the independent validator.
3. **3D Theatre** → orbit/zoom, click a base (stock + assigned missions), an aircraft (trust vs serviceability) and a
   mission. Drag the time slider or press play: aircraft fly their assigned corridors out and back.
4. **Replanning** → *Aircraft unavailable* → *Suggest target* → *Review & submit…* → confirm. The backend re-plans
   (≈ 1–4 s). Inspect solver status/time, changed vs unchanged missions, **reason codes with evidence**, frozen
   assignments, and the diff.
5. **3D Theatre** (proposal toggle) → amber pulses mark exactly the missions in the returned diff; dashed grey/amber
   routes are old/new corridors; red/green aircraft rings are removed/added aircraft. **Timeline** shows the old plan as
   dashed ghosts. Back on **Replanning** press *Approve* (or *Reject*): the success toast appears only after the backend
   confirms.
6. Repeat with *Base weather*, *New priority-1 mission*, *New threat zone*.
7. **Configuration** → crew rest 10 → 12 h → *Apply & recalculate*: a new CONFIG_CHANGE proposal is solved under the new rule.
8. **Benchmarks** → results of the 100-instance run (or *Run benchmark*), CSV download. **Data Fusion** → stale/invalid/
   conflicting records and model metrics. **Diagnostics** → backend, WebSocket, seed, last plan, tests.

Offline check: stop the network; nothing changes — fonts, icons, scenario data and the solver are all local.
Stop only the backend and the UI shows a banner, a *CACHED* badge on stale numbers, and reconnects automatically.
