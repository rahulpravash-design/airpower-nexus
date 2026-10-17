import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageGate } from "../components/layout/PageGate";
import { Badge, Field, Panel } from "../components/ui/primitives";
import { useData } from "../hooks/useData";
import type { PlanningConfig } from "../types/api";

interface Spec { key: keyof PlanningConfig; label: string; min: number; max: number; step: number; unit: string; help: string; multiple?: number }
const SPECS: Spec[] = [
  { key: "crew_rest_hours", label: "Crew rest", min: 1, max: 24, step: 0.5, unit: "h", help: "Rest required after duty (changing it triggers a re-plan)" },
  { key: "duty_limit_hours", label: "Duty limit", min: 2, max: 16, step: 0.5, unit: "h", help: "Max span of a crew duty window" },
  { key: "turnaround_minutes", label: "Aircraft turnaround", min: 0, max: 240, step: 15, unit: "min", help: "Multiple of 15", multiple: 15 },
  { key: "crew_turnaround_minutes", label: "Crew turnaround", min: 0, max: 120, step: 15, unit: "min", help: "Multiple of 15", multiple: 15 },
  { key: "freeze_window_minutes", label: "Freeze window", min: 0, max: 240, step: 15, unit: "min", help: "Launches inside this window are frozen", multiple: 15 },
  { key: "solver_time_limit_s", label: "Solver time limit", min: 0.5, max: 120, step: 0.5, unit: "s", help: "CP-SAT wall-clock limit" },
  { key: "risk_weight", label: "Corridor-risk weight", min: 0, max: 1000, step: 0.5, unit: "pts/risk", help: "Penalty per unit of corridor risk" },
  { key: "change_penalty", label: "Assignment-change penalty", min: 0, max: 1000, step: 1, unit: "pts", help: "Persistence: penalty per changed aircraft/crew/timing" },
  { key: "low_trust_weight", label: "Low-trust weight", min: 0, max: 1000, step: 1, unit: "pts", help: "Penalty for assets below the trust threshold" },
  { key: "serviceability_weight", label: "Serviceability weight", min: 0, max: 1000, step: 1, unit: "pts", help: "Penalty × (1 − predicted serviceability)" },
  { key: "fatigue_weight", label: "Fatigue weight", min: 0, max: 1000, step: 1, unit: "pts", help: "Penalty × crew fatigue estimate" },
  { key: "trust_threshold", label: "Trust threshold", min: 0, max: 1, step: 0.05, unit: "", help: "Below this an asset is 'low trust'" },
  { key: "fresh_minutes", label: "Fresh threshold", min: 1, max: 1440, step: 1, unit: "min", help: "Records younger than this are fully fresh" },
  { key: "stale_minutes", label: "Stale threshold", min: 2, max: 4320, step: 1, unit: "min", help: "Records older than this are stale" },
];

export default function Settings() {
  const { configResp, updateConfig, busy, proposed, source } = useData();
  const active = configResp?.active;
  const [draft, setDraft] = useState<PlanningConfig | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // Reset the form only when the *content* of the active config changes, never on a background refresh,
  // otherwise in-progress edits would be wiped whenever the WebSocket reconnects.
  const activeKey = JSON.stringify(active ?? null);
  useEffect(() => { if (active) setDraft(active); }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!draft) return e;
    for (const s of SPECS) {
      const v = draft[s.key] as number;
      if (!Number.isFinite(v)) e[s.key] = "required";
      else if (v < s.min || v > s.max) e[s.key] = `must be ${s.min}–${s.max}`;
      else if (s.multiple && v % s.multiple) e[s.key] = `multiple of ${s.multiple}`;
    }
    if (draft.stale_minutes <= draft.fresh_minutes) e.stale_minutes = "must exceed fresh threshold";
    const w = draft.priority_weights;
    if (!(w["1"] >= w["2"] && w["2"] >= w["3"])) e.priority_weights = "P1 ≥ P2 ≥ P3 required";
    return e;
  }, [draft]);

  const changed = useMemo(() => draft && active ? (Object.keys(draft) as (keyof PlanningConfig)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(active[k])) : [], [draft, active]);
  return (
    <PageGate>
      {draft && active && (
        <div className="space-y-4">
          {configResp?.pending && <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-amber">A configuration proposal is pending (rest {configResp.pending.crew_rest_hours} h). <Link className="underline" to="/retasking">Approve or reject it on the Replanning page.</Link></div>}
          <Panel title="Planning configuration" subtitle="Validated here and again by the backend. Changes recalculate the plan and become a proposal you approve."
            actions={<><button className="btn" onClick={() => setDraft(configResp!.defaults)}>Load defaults</button><button className="btn" disabled={!changed.length} onClick={() => setDraft(active)}>Revert</button></>}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {SPECS.map((s) => (
                <Field key={s.key} label={`${s.label}${s.unit ? ` (${s.unit})` : ""}`} help={s.help} error={errors[s.key]}>
                  <input type="number" className={`input ${errors[s.key] ? "!border-red" : ""}`} min={s.min} max={s.max} step={s.step} value={draft[s.key] as number}
                    onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value === "" ? NaN : +e.target.value })} />
                </Field>))}
              {(["1", "2", "3"] as const).map((p) => (
                <Field key={p} label={`Priority-${p} coverage weight (pts)`} help="Objective points for covering a mission" error={p === "1" ? errors.priority_weights : undefined}>
                  <input type="number" className="input" min={0} value={draft.priority_weights[p]} onChange={(e) => setDraft({ ...draft, priority_weights: { ...draft.priority_weights, [p]: +e.target.value } })} />
                </Field>))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
              <button className="btn btn-primary" disabled={!changed.length || Object.keys(errors).length > 0 || !!busy || !!proposed || source !== "live"}
                onClick={async () => { const patch = Object.fromEntries(changed.map((k) => [k, draft[k]])); const r = await updateConfig(patch); setResult(r?.proposal ? `Proposal ${r.proposal.plan.id}: ${r.proposal.plan.solver_status}, ${r.proposal.plan.diff?.changed_mission_count ?? 0} mission(s) changed.` : r ? "Applied (no baseline plan yet)." : null); }}>
                Apply & recalculate plan</button>
              {changed.length > 0 ? <Badge tone="warn">{changed.length} unsaved: {changed.join(", ")}</Badge> : <Badge>no changes</Badge>}
              {proposed && <Badge tone="warn">decide the pending proposal first</Badge>}
              {result && <span className="text-xs text-green">{result} <Link to="/retasking" className="underline">Review →</Link></span>}
            </div>
          </Panel>
        </div>)}
    </PageGate>
  );
}
