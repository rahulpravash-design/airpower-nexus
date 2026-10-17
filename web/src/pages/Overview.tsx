import { CheckCircle2, Clock, Plane, ShieldCheck, Users, XCircle, Layers, Gauge, GitCompareArrows } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { PageGate } from "../components/layout/PageGate";
import { Panel, Stat } from "../components/ui/primitives";
import { SolverBadge, ValidationBadge } from "../features/plan/PlanParts";
import { useData } from "../hooks/useData";
import { PRIORITY_COLOR, pct } from "../lib/format";

const LABEL: Record<string, string> = { coverage: "Priority coverage", corridor_risk: "Corridor risk", change: "Assignment change", low_trust: "Low trust", serviceability: "Serviceability", fatigue: "Crew fatigue" };

export default function Overview() {
  const { viewScenario: s, viewPlan: plan, fusion, busy, source, replan, proposed, planState } = useData();
  return (
    <PageGate needPlan>
      {s && plan && (() => {
        const m = plan.metrics;
        const byPrio = [1, 2, 3].map((p) => {
          const ids = s.missions.filter((x) => x.priority === p).map((x) => x.id);
          const cov = plan.assignments.filter((a) => a.covered && ids.includes(a.mission_id)).length;
          return { name: `P${p}`, covered: cov, uncovered: ids.length - cov, p };
        });
        const bd = Object.entries(plan.objective_breakdown).map(([k, v]) => ({ name: LABEL[k] ?? k, value: v }));
        const gap = plan.objective !== null && plan.best_bound !== null ? plan.best_bound - plan.objective : null;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Stat label="Total missions" value={m.total_missions} icon={<Layers className="h-4 w-4" />} hint={`${s.name} · seed ${s.seed}`} />
              <Stat label="Covered" tip="Missions with a feasible, validated assignment. Priority-weighted coverage counts P1/P2/P3 as 100/50/20 points by default." value={m.covered} tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} hint={`priority-weighted ${m.priority_weighted_coverage} / ${m.max_priority_weighted_coverage}`} />
              <Stat label="Uncovered" tip="Coverage is optional: the solver leaves a mission uncovered rather than break a hard rule." value={m.uncovered} tone={m.uncovered ? "bad" : "ok"} icon={<XCircle className="h-4 w-4" />} hint="left uncovered rather than violating a hard rule" />
              <Stat label="Available aircraft" value={`${m.available_aircraft}/${s.aircraft.length}`} icon={<Plane className="h-4 w-4" />} hint={`${m.assigned_aircraft} assigned in this plan`} />
              <Stat label="Assigned crew" value={`${m.assigned_crew}/${s.crew.length}`} icon={<Users className="h-4 w-4" />} hint="distinct crew members flying" />
              <Stat label="Input trust health" tip="Share of input records that are fresh, valid and conflict-free. Trust is confidence in a record, not a serviceability probability." value={fusion ? pct(fusion.trust_health) : "—"} tone={fusion && fusion.trust_health > 0.9 ? "ok" : "warn"} icon={<ShieldCheck className="h-4 w-4" />}
                hint={fusion ? `${fusion.stale} stale · ${fusion.invalid} invalid · ${fusion.conflicts} conflict` : undefined} />
              <Stat label="Solver time" tip="Wall-clock time of the CP-SAT call (it stops at the configured time limit and reports FEASIBLE with a bound if optimality is not proven)." value={`${plan.solve_time_s.toFixed(2)} s`} tone={plan.solve_time_s <= 10 ? "ok" : "warn"} icon={<Clock className="h-4 w-4" />} hint={`${plan.method} · ${plan.solver_status} (target < 10 s)`} />
              <Stat label="Changed missions" value={m.changed_missions ?? "—"} tone={m.changed_missions ? "warn" : "neutral"} icon={<GitCompareArrows className="h-4 w-4" />} hint={m.changed_missions === null ? "baseline plan: nothing to compare" : "vs previous plan"} />
              <Stat label="Unchanged missions" tip="Existing missions whose assignment did not change versus the previous plan (assignment persistence + freeze window)." value={m.unchanged_missions ?? "—"} icon={<Gauge className="h-4 w-4" />} hint="assignments preserved by persistence" />
              <Stat label="Hard-rule validation" tip="Verdict of the independent validator that re-checks all 17 hard rules from scratch; a failing plan can never be approved." value={plan.validation.valid ? "PASS" : "FAIL"} tone={plan.validation.valid ? "ok" : "bad"} icon={<ShieldCheck className="h-4 w-4" />}
                hint={`${plan.validation.rules.filter((r) => r.passed).length}/${plan.validation.rules.length} rules · independent validator`} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="Plan" className="lg:col-span-1" subtitle={`${plan.id} · ${plan.status} · trigger ${plan.trigger}`}
                actions={<div className="flex gap-1.5"><SolverBadge plan={plan} /><ValidationBadge plan={plan} /></div>}>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-muted">Objective</dt><dd className="num text-right">{plan.objective?.toFixed(1) ?? "—"}</dd>
                  <dt className="text-muted">Best bound</dt><dd className="num text-right">{plan.best_bound?.toFixed(1) ?? "—"}</dd>
                  <dt className="text-muted">Optimality gap</dt><dd className="num text-right">{gap === null ? "—" : gap.toFixed(1)} pts</dd>
                  <dt className="text-muted">Risk penalty</dt><dd className="num text-right">{m.risk_penalty}</dd>
                  <dt className="text-muted">Frozen missions</dt><dd className="num text-right">{plan.frozen_mission_ids.length}</dd>
                  <dt className="text-muted">Mean serviceability</dt><dd className="num text-right">{pct(m.mean_serviceability)}</dd>
                </dl>
                {plan.notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber">{plan.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn btn-primary" disabled={!!busy || source !== "live" || !!proposed} onClick={() => void replan("CP_SAT")}>Re-optimise now (CP-SAT)</button>
                  <button className="btn" disabled={!!busy || source !== "live" || !!proposed} onClick={() => void replan("GREEDY")}>Greedy baseline</button>
                </div>
                {proposed && <p className="mt-2 text-xs text-amber">A proposal is pending: decide it on the Replanning page first.</p>}
              </Panel>
              <Panel title="Coverage by priority" subtitle="actual covered vs uncovered missions in the displayed plan">
                <div className="h-56"><ResponsiveContainer>
                  <BarChart data={byPrio} margin={{ left: -18, right: 6 }}>
                    <CartesianGrid stroke="#ffffff10" vertical={false} /><XAxis dataKey="name" stroke="#8DA1BB" fontSize={12} /><YAxis stroke="#8DA1BB" fontSize={12} allowDecimals={false} />
                    <RTooltip contentStyle={{ background: "#0A1222", border: "1px solid #ffffff20", fontSize: 12 }} cursor={{ fill: "#ffffff08" }} />
                    <Bar dataKey="covered" stackId="a" name="Covered" fill="#45E5AE" isAnimationActive={false} />
                    <Bar dataKey="uncovered" stackId="a" name="Uncovered" fill="#FF5D72" isAnimationActive={false}>{byPrio.map((d) => <Cell key={d.name} fill="#FF5D72" stroke={PRIORITY_COLOR[d.p]} />)}</Bar>
                  </BarChart></ResponsiveContainer></div>
              </Panel>
              <Panel title="Objective breakdown" subtitle="points contributed by each term (solver-reported)">
                {bd.length === 0 ? <p className="text-xs text-muted">The greedy baseline does not report an objective.</p> : (
                  <div className="h-56"><ResponsiveContainer>
                    <BarChart data={bd} layout="vertical" margin={{ left: 40, right: 12 }}>
                      <CartesianGrid stroke="#ffffff10" horizontal={false} /><XAxis type="number" stroke="#8DA1BB" fontSize={11} /><YAxis type="category" dataKey="name" stroke="#8DA1BB" fontSize={11} width={110} />
                      <RTooltip contentStyle={{ background: "#0A1222", border: "1px solid #ffffff20", fontSize: 12 }} cursor={{ fill: "#ffffff08" }} />
                      <Bar dataKey="value" name="points" isAnimationActive={false}>{bd.map((d) => <Cell key={d.name} fill={d.value >= 0 ? "#39D9FF" : "#FFBD59"} />)}</Bar>
                    </BarChart></ResponsiveContainer></div>)}
              </Panel>
            </div>
            {planState && planState.history.length > 0 && (
              <Panel title="Recent activity" subtitle="decisions recorded by the backend">
                <ul className="space-y-1 text-xs">{[...planState.history].reverse().slice(0, 6).map((h, i) => (
                  <li key={i} className="flex gap-3"><span className="num w-16 text-muted">{new Date((h.at as number) * 1000).toLocaleTimeString()}</span><span className="w-20 uppercase text-cyan">{String(h.kind)}</span><span className="num">{String(h.plan_id ?? "")}</span><span className="text-muted">{String(h.trigger ?? "")}</span></li>
                ))}</ul>
              </Panel>)}
          </div>
        );
      })()}
    </PageGate>
  );
}
