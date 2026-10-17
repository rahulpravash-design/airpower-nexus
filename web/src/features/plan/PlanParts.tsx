import { CheckCircle2, ChevronDown, ChevronRight, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { FIELD_LABEL, REASON_LABEL, fmtFieldValue } from "../../lib/format";
import type { ChangeKind } from "../../lib/plan";
import type { Plan, PlanDiff, ReasonCode } from "../../types/api";
import { Badge, type Tone } from "../../components/ui/primitives";

export function ValidationBadge({ plan }: { plan: Plan }) {
  const v = plan.validation, passed = v.rules.filter((r) => r.passed).length;
  return v.valid
    ? <Badge tone="ok" title={`Independent validator: ${v.validator}`}><ShieldCheck className="h-3 w-3" />HARD RULES PASS · {passed}/{v.rules.length}</Badge>
    : <Badge tone="bad" title={v.violations.slice(0, 5).map((x) => x.message).join("\n")}><ShieldAlert className="h-3 w-3" />INVALID · {v.violations.length} violation(s)</Badge>;
}

export function SolverBadge({ plan }: { plan: Plan }) {
  const tone: Tone = plan.solver_status === "OPTIMAL" ? "ok" : plan.solver_status === "FEASIBLE" ? "info" : plan.solver_status === "NOT_APPLICABLE" ? "neutral" : "warn";
  const method = plan.method === "CP_SAT" ? "CP-SAT" : plan.method === "GREEDY" ? "Greedy" : "Greedy fallback";
  return <Badge tone={tone} title="Solver status exactly as returned by the solver">{method} · {plan.solver_status}</Badge>;
}

export function ChangeBadge({ kind }: { kind: ChangeKind }) {
  const m: Record<ChangeKind, [Tone, string]> = {
    changed: ["warn", "CHANGED"], added: ["info", "NEW"], newly_covered: ["ok", "NEWLY COVERED"],
    newly_uncovered: ["bad", "NEWLY UNCOVERED"], unchanged: ["neutral", "UNCHANGED"], none: ["neutral", "—"],
  };
  return <Badge tone={m[kind][0]}>{m[kind][1]}</Badge>;
}

export function LockBadge({ lock }: { lock: string | null }) {
  if (!lock) return null;
  return <Badge tone="info" title={lock === "IN_PROGRESS" ? "Already launched: locked" : "Launches within the freeze window: locked"}><Lock className="h-3 w-3" />{lock === "IN_PROGRESS" ? "IN PROGRESS" : "FROZEN"}</Badge>;
}

export function ReasonList({ reasons, mission }: { reasons: ReasonCode[]; mission?: string }) {
  const list = mission ? reasons.filter((r) => r.mission_id === mission) : reasons;
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!list.length) return <p className="text-xs text-muted">No reason codes for this selection.</p>;
  return (
    <ul className="space-y-1.5">
      {list.map((r, i) => (
        <li key={`${r.code}-${r.mission_id}-${i}`} className="rounded-md border border-white/5 bg-bg2/60 p-2">
          <button className="flex w-full items-start gap-1.5 text-left" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} aria-expanded={!!open[i]}>
            {open[i] ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone="warn">{r.code}</Badge>
                {r.mission_id ? <span className="num text-xs text-cyan">{r.mission_id}</span> : <span className="text-[11px] text-muted">event-level</span>}
                <span className="text-xs text-muted">{REASON_LABEL[r.code] ?? ""}</span>
              </span>
              <span className="mt-1 block text-xs text-ink/90">{r.message}</span>
            </span>
          </button>
          {open[i] && <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-muted">{JSON.stringify(r.evidence, null, 2)}</pre>}
        </li>
      ))}
    </ul>
  );
}

export function DiffView({ diff, limit = 12 }: { diff: PlanDiff; limit?: number }) {
  const [all, setAll] = useState(false);
  const byMission = new Map<string, typeof diff.field_changes>();
  for (const c of diff.field_changes) byMission.set(c.mission_id, [...(byMission.get(c.mission_id) ?? []), c]);
  const ids = [...byMission.keys()];
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["Changed missions", diff.changed_mission_count], ["Unchanged missions", diff.unchanged_missions.length],
           ["Changed fields", diff.changed_field_count], ["New missions", diff.added_missions.length],
           ["Newly covered", diff.newly_covered.length], ["Newly uncovered", diff.newly_uncovered.length],
           ["Aircraft changes", diff.changed_aircraft.length], ["Crew changes", diff.changed_crew.length],
           ["Base changes", diff.changed_base.length], ["Corridor changes", diff.changed_corridor.length],
           ["Timing changes", diff.changed_timing.length], ["Load-out changes", diff.changed_loadout.length]] as [string, number][]).map(([l, v]) => (
          <div key={l} className="rounded-md border border-white/5 bg-bg2/60 px-2.5 py-1.5"><div className="label">{l}</div><div className="num text-lg">{v}</div></div>
        ))}
      </div>
      {ids.length === 0 ? <p className="flex items-center gap-1.5 text-sm text-green"><CheckCircle2 className="h-4 w-4" />No existing assignment changed.</p> : (
        <ul className="space-y-1.5">
          {(all ? ids : ids.slice(0, limit)).map((id) => (
            <li key={id} className="rounded-md border border-white/5 bg-bg2/60 p-2 text-xs">
              <span className="num mr-2 text-cyan">{id}</span>
              {byMission.get(id)!.map((c) => (
                <span key={c.field} className="mr-3 inline-block">
                  <span className="text-muted">{FIELD_LABEL[c.field] ?? c.field}: </span>
                  <span className="text-red/90 line-through">{fmtFieldValue(c.field, c.old)}</span>
                  <span className="text-muted"> → </span><span className="text-green">{fmtFieldValue(c.field, c.new)}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {ids.length > limit && <button className="btn mt-2" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${ids.length} changed missions`}</button>}
    </div>
  );
}
