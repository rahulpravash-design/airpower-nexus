import { CloudLightning, Crosshair, Plane, PlusCircle, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageGate } from "../components/layout/PageGate";
import { Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import { Badge, EmptyState, Field, Panel, Select, Stat } from "../components/ui/primitives";
import { DiffView, ReasonList, SolverBadge, ValidationBadge } from "../features/plan/PlanParts";
import { useData } from "../hooks/useData";
import { api, describeError } from "../services/api";
import { fmtSlot } from "../lib/format";
import type { EventRequest, EventType, Plan } from "../types/api";

const TABS: { type: EventType; label: string; icon: typeof Plane; blurb: string }[] = [
  { type: "AIRCRAFT_UNAVAILABLE", label: "Aircraft unavailable", icon: Plane, blurb: "Mark an aircraft unavailable from the event slot and re-plan." },
  { type: "BASE_WEATHER", label: "Base weather", icon: CloudLightning, blurb: "A base drops below weather minima for a period." },
  { type: "NEW_PRIORITY1_MISSION", label: "New priority-1 mission", icon: PlusCircle, blurb: "Insert a new P1 mission and re-plan around it." },
  { type: "NEW_THREAT", label: "New threat zone", icon: Crosshair, blurb: "A fictional time-windowed polygon changes corridor risk or closes corridors." },
];

export default function Retasking() {
  const { viewScenario: s, scenario, approved, proposed, configResp, submitEvent, approve, reject, busy, source, replan } = useData();
  const toast = useToast();
  const cfg = configResp?.active;
  const [tab, setTab] = useState<EventType>("AIRCRAFT_UNAVAILABLE");
  const [nowSlot, setNowSlot] = useState<number>(4);
  const [acId, setAcId] = useState(""); const [baseId, setBaseId] = useState(""); const [dur, setDur] = useState(16);
  const [p1, setP1] = useState({ role: "R1", area: "AREA-1", pkg: 2, earliest: 7, window: 6, duration: 10, loadouts: ["A", "B"] });
  const [thr, setThr] = useState({ x: 200, y: 150, r: 45, sev: 0.9, blocking: true, label: "Zone Nightfall" });
  const [confirm, setConfirm] = useState<EventRequest | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  useEffect(() => { if (cfg) setNowSlot(cfg.default_event_slot); }, [cfg?.default_event_slot]); // eslint-disable-line react-hooks/exhaustive-deps
  const sc = scenario;
  const available = useMemo(() => sc?.aircraft.filter((a) => a.status !== "UNAVAILABLE" && a.record_valid) ?? [], [sc]);
  useEffect(() => { if (available.length && !acId) setAcId(available[0].id); }, [available, acId]);
  useEffect(() => { if (sc && !baseId) setBaseId(sc.bases[0].id); }, [sc, baseId]);

  const build = (): EventRequest | null => {
    switch (tab) {
      case "AIRCRAFT_UNAVAILABLE": return acId ? { type: tab, aircraft_id: acId, now_slot: nowSlot } : null;
      case "BASE_WEATHER": return baseId ? { type: tab, base_id: baseId, duration_slots: dur, now_slot: nowSlot } : null;
      case "NEW_PRIORITY1_MISSION": return { type: tab, role: p1.role, area_id: p1.area, package_size: p1.pkg, earliest_start: p1.earliest, window_slots: p1.window, duration_slots: p1.duration, loadouts: p1.loadouts, now_slot: nowSlot };
      case "NEW_THREAT": return { type: tab, center_x: thr.x, center_y: thr.y, radius_km: thr.r, severity: thr.sev, blocking: thr.blocking, label: thr.label, start_slot: nowSlot, end_slot: 48, now_slot: nowSlot };
    }
  };
  const describe = (e: EventRequest): string => {
    switch (e.type) {
      case "AIRCRAFT_UNAVAILABLE": { const a = sc?.aircraft.find((x) => x.id === e.aircraft_id); return `Aircraft ${e.aircraft_id} (${a?.role}, ${a?.home_base}) becomes unavailable from ${fmtSlot(e.now_slot)}.`; }
      case "BASE_WEATHER": return `${e.base_id} falls below weather minima from ${fmtSlot(e.now_slot)} for ${e.duration_slots * 15} minutes.`;
      case "NEW_PRIORITY1_MISSION": return `New priority-1 mission: ${e.role} ×${e.package_size} to ${e.area_id}, launch ${fmtSlot(e.earliest_start)}–${fmtSlot((e.earliest_start ?? 0) + e.window_slots)}, ${e.duration_slots * 15} min.`;
      case "NEW_THREAT": return `Fictional ${e.blocking ? "blocking " : ""}threat (severity ${e.severity}) centred at (${e.center_x}, ${e.center_y}) km, radius ${e.radius_km} km, from ${fmtSlot(e.now_slot)}.`;
    }
  };
  const suggest = async () => {
    try {
      const e = await api.suggestEvent(tab);
      if (e.type === "AIRCRAFT_UNAVAILABLE") setAcId(e.aircraft_id);
      if (e.type === "BASE_WEATHER") { setBaseId(e.base_id); setDur(e.duration_slots); }
      if (e.type === "NEW_PRIORITY1_MISSION") setP1({ role: e.role, area: e.area_id, pkg: e.package_size, earliest: e.earliest_start ?? 7, window: e.window_slots, duration: e.duration_slots, loadouts: e.loadouts });
      if (e.type === "NEW_THREAT") setThr({ x: e.center_x, y: e.center_y, r: e.radius_km, sev: e.severity, blocking: e.blocking, label: e.label ?? "Zone Nightfall" });
      if (e.now_slot !== undefined) setNowSlot(e.now_slot);
      toast.push({ tone: "info", title: "Suggested a target from the current plan" });
    } catch (err) { toast.push({ tone: "bad", title: "Could not suggest", body: describeError(err) }); }
  };
  const disabled = !!busy || source !== "live" || !approved || !!proposed;
  const ev = build();

  return (
    <PageGate needPlan>
      {s && (
        <div className="space-y-4">
          {!approved && <EmptyState title="Approve a baseline plan first" body="Events are applied relative to an approved plan." />}
          <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
            <Panel title="Inject event" subtitle="Each event triggers a real CP-SAT re-plan on the backend; nothing changes until you approve.">
              <div className="mb-3 grid grid-cols-2 gap-1.5" role="tablist">
                {TABS.map((t) => (
                  <button key={t.type} role="tab" aria-selected={tab === t.type} onClick={() => setTab(t.type)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-2 text-left text-xs ${tab === t.type ? "border-cyan/60 bg-cyan/10 text-cyan" : "border-white/10 text-muted hover:text-ink"}`}><t.icon className="h-4 w-4 shrink-0" />{t.label}</button>))}
              </div>
              <p className="mb-3 text-xs text-muted">{TABS.find((t) => t.type === tab)!.blurb}</p>
              <div className="space-y-3">
                {tab === "AIRCRAFT_UNAVAILABLE" && (
                  <Field label="Target aircraft"><Select value={acId} onChange={(e) => setAcId(e.target.value)}>{available.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.role} · {a.home_base}</option>)}</Select></Field>)}
                {tab === "BASE_WEATHER" && (<>
                  <Field label="Target base"><Select value={baseId} onChange={(e) => setBaseId(e.target.value)}>{s.bases.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}</Select></Field>
                  <Field label="Closure length"><Select value={dur} onChange={(e) => setDur(+e.target.value)}>{[8, 16, 24].map((d) => <option key={d} value={d}>{d * 15} minutes</option>)}</Select></Field></>)}
                {tab === "NEW_PRIORITY1_MISSION" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Role"><Select value={p1.role} onChange={(e) => setP1({ ...p1, role: e.target.value })}>{["R1", "R2", "R3"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
                    <Field label="Area"><Select value={p1.area} onChange={(e) => setP1({ ...p1, area: e.target.value })}>{s.areas.map((a) => <option key={a.id} value={a.id}>{a.id} {a.name}</option>)}</Select></Field>
                    <Field label="Package size"><Select value={p1.pkg} onChange={(e) => setP1({ ...p1, pkg: +e.target.value })}><option value={1}>1 aircraft</option><option value={2}>2 aircraft</option></Select></Field>
                    <Field label="Earliest launch (slot)"><input type="number" className="input" min={0} max={47} value={p1.earliest} onChange={(e) => setP1({ ...p1, earliest: +e.target.value })} /></Field>
                    <Field label="Window (slots)"><input type="number" className="input" min={0} max={24} value={p1.window} onChange={(e) => setP1({ ...p1, window: +e.target.value })} /></Field>
                    <Field label="Duration (slots)"><input type="number" className="input" min={4} max={24} value={p1.duration} onChange={(e) => setP1({ ...p1, duration: +e.target.value })} /></Field>
                    <div className="col-span-2 flex gap-4 text-sm">{["A", "B", "C"].map((l) => <label key={l} className="flex items-center gap-1.5"><input type="checkbox" className="accent-cyan" checked={p1.loadouts.includes(l)} onChange={(e) => setP1({ ...p1, loadouts: e.target.checked ? [...p1.loadouts, l] : p1.loadouts.filter((x) => x !== l) })} />Load-out {l}</label>)}</div>
                  </div>)}
                {tab === "NEW_THREAT" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Centre on corridor midpoint" help="or type coordinates below"><Select value="" onChange={(e) => { const c = s.corridors.find((x) => x.id === e.target.value); if (c) setThr({ ...thr, x: c.waypoints[1][0], y: c.waypoints[1][1] }); }}><option value="">Pick corridor…</option>{s.corridors.map((c) => <option key={c.id} value={c.id}>{c.id} {c.name}</option>)}</Select></Field>
                    <Field label="Label"><input className="input" value={thr.label} onChange={(e) => setThr({ ...thr, label: e.target.value })} /></Field>
                    <Field label="Centre x (km)"><input type="number" className="input" value={thr.x} onChange={(e) => setThr({ ...thr, x: +e.target.value })} /></Field>
                    <Field label="Centre y (km)"><input type="number" className="input" value={thr.y} onChange={(e) => setThr({ ...thr, y: +e.target.value })} /></Field>
                    <Field label="Radius (km)"><input type="number" className="input" min={5} max={150} value={thr.r} onChange={(e) => setThr({ ...thr, r: +e.target.value })} /></Field>
                    <Field label="Severity (0–1)"><input type="number" step={0.05} className="input" min={0} max={1} value={thr.sev} onChange={(e) => setThr({ ...thr, sev: +e.target.value })} /></Field>
                    <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-cyan" checked={thr.blocking} onChange={(e) => setThr({ ...thr, blocking: e.target.checked })} />Blocking (intersecting corridors are closed while active)</label>
                  </div>)}
                <Field label="Event time (slot)" help={`= ${fmtSlot(nowSlot)}; launches within ${cfg?.freeze_window_minutes ?? 30} min of this are frozen`}><input type="number" className="input" min={0} max={47} value={nowSlot} onChange={(e) => setNowSlot(+e.target.value)} /></Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn" disabled={disabled} onClick={() => void suggest()}>Suggest target</button>
                <button className="btn btn-primary" disabled={disabled || !ev} onClick={() => ev && setConfirm(ev)}>Review & submit…</button>
                <button className="btn" disabled={disabled} onClick={() => void replan("CP_SAT")}>Re-plan without event</button>
              </div>
              {proposed && <p className="mt-3 text-xs text-amber">A proposal is waiting for your decision (right). Approve or reject it before sending another event.</p>}
            </Panel>

            <div className="space-y-4">
              {proposed ? <Proposal plan={proposed} baseline={approved} busy={!!busy} onApprove={() => setDecision("approve")} onReject={() => setDecision("reject")} />
                : <Panel title="No pending proposal"><EmptyState title="Submit an event to see the proposal" body="You will get the solver status and time, changed and unchanged missions, reason codes with evidence, freeze/invalidation details and the hard-rule validation result — then approve or reject." /></Panel>}
              {!proposed && approved?.diff && approved.trigger !== "INITIAL" && (
                <Panel title={`Last approved change · ${approved.id}`} subtitle={`${approved.trigger} · ${(approved.event?.description as string) ?? ""}`}
                  actions={<><SolverBadge plan={approved} /><ValidationBadge plan={approved} /></>}>
                  <DiffView diff={approved.diff} limit={5} /></Panel>)}
            </div>
          </div>

          <Dialog open={!!confirm} title="Confirm event" onClose={() => setConfirm(null)}
            footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { const e = confirm!; setConfirm(null); void submitEvent(e); }}>Run CP-SAT re-plan</button></>}>
            {confirm && <><p className="text-ink">{describe(confirm)}</p><p className="mt-2">The backend will re-plan with persistence and a {cfg?.freeze_window_minutes ?? 30}-minute freeze window and return a <b>proposal</b>. The live scenario only changes if you approve it.</p></>}
          </Dialog>
          <Dialog open={!!decision && !!proposed} title={decision === "approve" ? "Approve proposed plan?" : "Reject proposed plan?"} onClose={() => setDecision(null)}
            footer={<><button className="btn" onClick={() => setDecision(null)}>Cancel</button>
              <button className={`btn ${decision === "approve" ? "btn-ok" : "btn-danger"}`} onClick={() => { const d = decision; setDecision(null); if (proposed) void (d === "approve" ? approve(proposed.id) : reject(proposed.id)); }}>{decision === "approve" ? "Approve" : "Reject"}</button></>}>
            {proposed && (decision === "approve"
              ? <p>{proposed.id} replaces {approved?.id}. {proposed.diff?.changed_mission_count ?? 0} mission(s) change; the success message appears only after the backend confirms.</p>
              : <p>{proposed.id} is discarded; {approved?.id} and the current scenario stay in force.</p>)}
          </Dialog>
        </div>
      )}
    </PageGate>
  );
}

function Proposal({ plan, baseline, busy, onApprove, onReject }: { plan: Plan; baseline: Plan | null; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const d = plan.diff;
  return (
    <Panel title={`Proposal ${plan.id}`} subtitle={`${plan.trigger} · ${(plan.event?.description as string) ?? "manual re-plan"}`}
      actions={<><SolverBadge plan={plan} /><ValidationBadge plan={plan} /></>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Solver time" value={`${plan.solve_time_s.toFixed(2)} s`} hint={plan.solver_status} tone={plan.solve_time_s <= 10 ? "ok" : "warn"} />
        <Stat label="Covered" value={`${baseline?.metrics.covered ?? "—"} → ${plan.metrics.covered}`} hint={`of ${plan.metrics.total_missions}`} tone={baseline && plan.metrics.covered < baseline.metrics.covered ? "warn" : "ok"} />
        <Stat label="Changed missions" value={d?.changed_mission_count ?? "—"} hint={`${d?.changed_field_count ?? 0} fields`} tone={d?.changed_mission_count ? "warn" : "ok"} />
        <Stat label="Unchanged" value={d?.unchanged_missions.length ?? "—"} hint="preserved by persistence" />
      </div>
      {plan.frozen_mission_ids.length > 0 && <p className="mt-3 text-xs text-muted">Frozen/in-progress, kept untouched: <span className="num text-cyan">{plan.frozen_mission_ids.join(", ")}</span></p>}
      {plan.invalidated_frozen.length > 0 && (
        <div className="mt-3 rounded-md border border-amber/40 bg-amber/10 p-2.5 text-xs text-amber"><p className="mb-1 flex items-center gap-1.5 font-medium"><ShieldAlert className="h-4 w-4" />Frozen assignment(s) invalidated by this event and released:</p>
          {plan.invalidated_frozen.map((i) => <p key={i.mission_id} className="num">{i.mission_id}: {i.violations.map((v) => v.code).join(", ")}</p>)}</div>)}
      {plan.notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber">{plan.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
      {!plan.validation.valid && (
        <div className="mt-3 rounded-md border border-red/40 bg-red/10 p-2.5 text-xs text-red">This plan fails hard-rule validation and cannot be approved.
          <ul className="mt-1">{plan.validation.violations.slice(0, 5).map((v, i) => <li key={i} className="num">{v.code}: {v.message}</li>)}</ul></div>)}
      <h3 className="label mb-2 mt-4">Reason codes (evidence-backed)</h3>
      <ReasonList reasons={plan.reasons} />
      {d && (<><h3 className="label mb-2 mt-4">Plan diff</h3><DiffView diff={d} /></>)}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
        <button className="btn btn-ok" disabled={busy || !plan.validation.valid} onClick={onApprove}>Approve plan</button>
        <button className="btn btn-danger" disabled={busy} onClick={onReject}>Reject plan</button>
        <Link to="/theatre" className="btn">View in 3D theatre</Link><Link to="/timeline" className="btn">Compare in timeline</Link>
        <Badge>{plan.status}</Badge>
      </div>
    </Panel>
  );
}
