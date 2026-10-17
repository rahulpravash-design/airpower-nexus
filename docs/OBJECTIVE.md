# Objective

CP-SAT maximises (all terms in "points"; each coefficient is multiplied by 10 and rounded to an integer):

```
  Σ_m   priority_weight[p(m)] · cover[m]                     coverage            (P1/P2/P3 = 100/50/20)
− Σ_m,r risk_weight · risk(m,r) · k[m,r]                      corridor risk       (default 8 pts per risk unit)
− Σ_m   change_penalty · (changed aircraft/crew/corridor/…)    persistence         (default 10 pts per change, ½ for corridor/load-out)
− Σ     low_trust_weight · max(0, trust_threshold − trust)     low-trust assets    (aircraft x and crew y)
− Σ     serviceability_weight · (1 − predicted_serviceability) aircraft model risk
− Σ     fatigue_weight · crew fatigue estimate                 crew fatigue
```

`risk(m,r) = base_risk(r) + Σ_active threats severity · (0.5 + 3·exposure)` where `exposure` is the fraction of the
corridor polyline inside the threat polygon (0 → threat ignored).

All weights live in `airops/core/constraints.yaml`, are validated by `PlanningConfig`, are editable on the
*Configuration* page, and are reported back per term in `plan.objective_breakdown`.

**Solver status honesty.** `OPTIMAL` is reported only when CP-SAT proves it; a solution found at the time limit is
`FEASIBLE` together with the best bound. If CP-SAT returns no usable solution (or a solution that fails the independent
validator) a greedy fallback is used and the plan is labelled `GREEDY_FALLBACK` with the original CP-SAT status.
