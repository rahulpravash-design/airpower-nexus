import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, ProgressBar } from "../../components/ui/primitives";
import { fmtDur, fmtSlot, num, pct } from "../../lib/format";
import { changeStatus, indexPlan } from "../../lib/plan";
import type { Selection } from "../../hooks/useData";
import type { Plan, PlanningConfig, Scenario } from "../../types/api";
import { ChangeBadge, LockBadge, ReasonList } from "../plan/PlanParts";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 border-b border-white/5 py-1.5 text-xs last:border-0"><span className="text-muted">{k}</span><span className="num text-right">{children}</span></div>;
}

export function DetailPanel({ scenario: s, plan, config, selection, onSelect }: {
  scenario: Scenario; plan: Plan | null; config: PlanningConfig | null; selection: Selection; onSelect: (s: Selection) => void;
}) {
  const ix = useMemo(() => indexPlan(plan), [plan]);
  if (!selection) return <p className="text-sm text-muted">Select a base, aircraft or mission in the scene (or a table) to inspect it.</p>;

  if (selection.kind === "base") {
    const b = s.bases.find((x) => x.id === selection.id);
    if (!b) return null;
    const closures = b.weather_closures;
    return (
      <div>
        <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-semibold">{b.id} · {b.name}</h3><Badge tone={closures.length ? "warn" : "ok"}>{closures.length ? "weather closures" : "nominal"}</Badge></div>
        <Row k="Assigned missions">{ix.baseCount.get(b.id) ?? 0}</Row>
        <Row k="Aircraft based">{s.aircraft.filter((a) => a.home_base === b.id).length}</Row>
        <Row k="Crew based">{s.crew.filter((a) => a.home_base === b.id).length}</Row>
        <Row k="Runway open">{b.runway_windows.map(([a, c]) => `${fmtSlot(a)}–${fmtSlot(c)}`).join(", ")}</Row>
        <Row k="Weather closures">{closures.length ? closures.map((c) => `${fmtSlot(c.start_slot)}–${fmtSlot(c.end_slot)}`).join(", ") : "none"}</Row>
        <Row k="Trust">{pct(b.trust)}</Row>
        <p className="label mb-1 mt-3">Load-out stock (used / total)</p>
        {Object.entries(b.loadout_stock).map(([l, total]) => {
          const used = ix.stockUsed.get(`${b.id}|${l}`) ?? 0;
          return <div key={l} className="mb-1.5"><div className="flex justify-between text-xs"><span>Load-out {l}</span><span className="num">{used} / {total}</span></div><ProgressBar value={total ? used / total : 0} tone={used >= total ? "warn" : "info"} /></div>;
        })}
      </div>
    );
  }

  if (selection.kind === "aircraft") {
    const a = s.aircraft.find((x) => x.id === selection.id);
    if (!a) return null;
    const mine = ix.byAircraft.get(a.id) ?? [];
    return (
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{a.id}</h3>
          <Badge tone={a.status === "AVAILABLE" ? "ok" : a.status === "MAINTENANCE" ? "warn" : "bad"}>{a.status}</Badge>
          {!a.record_valid && <Badge tone="bad">INVALID RECORD</Badge>}{a.stale && <Badge tone="warn">STALE</Badge>}{a.conflict && <Badge tone="warn">CONFLICT</Badge>}</div>
        <Row k="Abstract role">{a.role}</Row><Row k="Home base">{a.home_base}</Row>
        <Row k="Reported status">{a.status}{a.available_from_slot > 0 ? ` (returns ${fmtSlot(a.available_from_slot)})` : ""}{a.unavailable_from_slot !== null ? ` (from ${fmtSlot(a.unavailable_from_slot)})` : ""}</Row>
        <Row k="Input trust">{pct(a.trust)}</Row>
        <Row k="Predicted serviceability">{a.predicted_serviceability === null ? "n/a (record rejected)" : pct(a.predicted_serviceability)}</Row>
        <Row k="Source">{a.source}</Row>
        {a.reports.map((r) => <Row key={r.source} k={`Report · ${r.source}`}>{r.status}</Row>)}
        {a.issues.length > 0 && <Row k="Issues">{a.issues.join(", ")}</Row>}
        <p className="label mb-1 mt-3">Assignments</p>
        {mine.length === 0 ? <p className="text-xs text-muted">Not assigned in this plan.</p> : mine.map((m) => (
          <button key={m.mission_id} className="mb-1 flex w-full items-center justify-between rounded border border-white/5 bg-bg2/60 px-2 py-1 text-xs hover:border-cyan/40" onClick={() => onSelect({ kind: "mission", id: m.mission_id })}>
            <span className="num text-cyan">{m.mission_id}</span><span className="num">{fmtSlot(m.start_slot)} → {fmtSlot(m.end_slot)}</span></button>
        ))}
      </div>
    );
  }

  if (selection.kind === "crew") {
    const c = s.crew.find((x) => x.id === selection.id);
    if (!c) return null;
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold">{c.id}</h3>
        <Row k="Home base">{c.home_base}</Row><Row k="Qualified roles">{c.qualified_roles.join(", ")}</Row>
        <Row k="Input trust">{pct(c.trust)}</Row><Row k="Fatigue estimate (synthetic)">{c.fatigue_risk === null ? "n/a" : num(c.fatigue_risk, 2)}</Row>
        <Row k="Prior duty ended">{c.prior_duty_end_slot === null ? "rested" : fmtSlot(c.prior_duty_end_slot)}</Row>
        <Row k="Missions">{(ix.byCrew.get(c.id) ?? []).map((m) => m.mission_id).join(", ") || "none"}</Row>
      </div>
    );
  }

  const m = s.missions.find((x) => x.id === selection.id);
  if (!m) return null;
  const a = ix.byMission.get(m.id);
  const ch = changeStatus(plan?.diff, m.id);
  const fc = (plan?.diff?.field_changes ?? []).filter((c) => c.mission_id === m.id);
  const cor = s.corridors.find((c) => c.id === a?.corridor_id);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{m.id}</h3>
        <Badge tone={m.priority === 1 ? "bad" : m.priority === 2 ? "warn" : "info"}>P{m.priority}</Badge>
        <Badge tone={a?.covered ? "ok" : "bad"}>{a?.covered ? "COVERED" : "UNCOVERED"}</Badge><ChangeBadge kind={ch} /><LockBadge lock={a?.lock ?? null} /></div>
      <Row k="Required role">{m.role} × {m.package_size}</Row><Row k="Area">{m.area_id}</Row>
      <Row k="Start window">{fmtSlot(m.earliest_start)} – {fmtSlot(m.latest_start)}</Row><Row k="Duration">{fmtDur(m.duration_slots)}</Row>
      <Row k="Acceptable load-outs">{m.loadouts.join(", ")}</Row><Row k="Source trust">{pct(m.trust)}</Row>
      {a?.covered ? (<>
        <p className="label mb-1 mt-3">Assignment</p>
        <Row k="Launch → recovery">{fmtSlot(a.start_slot)} → {fmtSlot(a.end_slot)}</Row><Row k="Base">{a.base_id}</Row>
        <Row k="Aircraft">{a.aircraft_ids.map((id) => <button key={id} className="ml-1 text-cyan hover:underline" onClick={() => onSelect({ kind: "aircraft", id })}>{id}</button>)}</Row>
        <Row k="Crew">{a.crew_ids.join(", ")}</Row><Row k="Load-out">{a.loadout}</Row>
        <Row k="Corridor">{cor?.name ?? a.corridor_id}</Row><Row k="Corridor risk">{num(a.risk, 2)} (base {num(cor?.base_risk, 2)})</Row>
      </>) : <p className="mt-3 text-xs text-muted">No feasible assignment in this plan.</p>}
      {fc.length > 0 && (<><p className="label mb-1 mt-3">Changes vs previous plan</p>
        {fc.map((c) => <Row key={c.field} k={c.field}>{JSON.stringify(c.old)} → {JSON.stringify(c.new)}</Row>)}</>)}
      {plan && plan.reasons.some((r) => r.mission_id === m.id) && (<><p className="label mb-1 mt-3">Why</p><ReasonList reasons={plan.reasons} mission={m.id} /></>)}
      <Link to="/timeline" className="mt-3 inline-block text-xs text-cyan hover:underline" onClick={() => undefined}>Open in timeline →</Link>
      {config && <p className="mt-2 text-[10px] text-muted">Turnaround {config.turnaround_minutes} min · freeze {config.freeze_window_minutes} min</p>}
    </div>
  );
}
