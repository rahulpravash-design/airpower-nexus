import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../components/ui/Dialog";
import { Badge, Panel } from "../components/ui/primitives";
import { PageGate } from "../components/layout/PageGate";
import { useData } from "../hooks/useData";
import { api } from "../services/api";
import { streamUrl } from "../services/ws";
import type { Diagnostics as Diag } from "../types/api";

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 border-b border-white/5 py-1.5 text-xs last:border-0"><span className="text-muted">{k}</span><span className="num text-right">{children}</span></div>;
}

export default function Diagnostics() {
  const { ws, source, health, resetScenario, generateScenario, busy } = useData();
  const [d, setD] = useState<Diag | null>(null);
  const [seed, setSeed] = useState(26250);
  const [confirm, setConfirm] = useState<"reset" | "generate" | null>(null);
  const load = useCallback(async () => { try { setD(await api.diagnostics()); } catch { setD(null); } }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load, source]);
  return (
    <PageGate>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Backend" actions={<Badge tone={health ? "ok" : "bad"}>{health ? "healthy" : "unreachable"}</Badge>}>
          <KV k="Service">{health?.service ?? "—"} {health?.version}</KV><KV k="Solver">{health?.solver ?? "—"}</KV>
          <KV k="Uptime">{health ? `${Math.round(health.uptime_s)} s` : "—"}</KV><KV k="Python">{d?.python ?? "—"}</KV><KV k="Data source">{source}</KV>
        </Panel>
        <Panel title="Stream (WebSocket)" actions={<Badge tone={ws === "open" ? "ok" : ws === "connecting" ? "warn" : "bad"}>{ws}</Badge>}>
          <KV k="Endpoint">{streamUrl()}</KV><KV k="Clients connected">{d?.ws_clients ?? "—"}</KV><KV k="Reconnect">automatic, 1 s → 10 s back-off</KV>
        </Panel>
        <Panel title="Scenario">
          <KV k="Seed">{d?.seed ?? "—"}</KV><KV k="Version">{d?.scenario_version ?? "—"}</KV><KV k="Plans computed">{d?.plans_total ?? "—"}</KV>
          <KV k="Approved plan">{d?.approved_plan_id ?? "none"}</KV><KV k="Pending proposal">{d?.pending_plan_id ?? "none"}</KV>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn" disabled={!!busy} onClick={() => setConfirm("reset")}>Reset to seed 26250</button>
            <input className="input w-28" type="number" min={0} value={seed} aria-label="Seed" onChange={(e) => setSeed(+e.target.value)} />
            <button className="btn" disabled={!!busy || !Number.isInteger(seed) || seed < 0} onClick={() => setConfirm("generate")}>Generate</button></div>
        </Panel>
        <Panel title="Last plan" actions={d?.last_plan && <Badge tone={d.last_plan.valid ? "ok" : "bad"}>{d.last_plan.valid ? "valid" : "INVALID"}</Badge>}>
          {d?.last_plan ? (<><KV k="Id">{d.last_plan.id}</KV><KV k="Status">{d.last_plan.status}</KV><KV k="Method">{d.last_plan.method}</KV><KV k="Solver status">{d.last_plan.solver_status}</KV>
            <KV k="Solve time">{d.last_plan.solve_time_s.toFixed(2)} s</KV><KV k="Violations">{d.last_plan.violations}</KV><KV k="Trigger">{d.last_plan.trigger}</KV></>) : <p className="text-xs text-muted">No plan computed yet.</p>}
        </Panel>
        <Panel title="Prediction model" actions={d?.model && <Badge tone={d.model.kind === "TRAINED_SYNTHETIC" ? "ok" : "warn"}>{d.model.kind}</Badge>}>
          {d?.model ? (<><KV k="Version">{d.model.version}</KV>{Object.entries(d.model.metrics).map(([k, v]) => <KV key={k} k={k}>{v}</KV>)}<p className="mt-2 text-[11px] text-muted">{d.model.disclaimer}</p></>) : <p className="text-xs text-muted">—</p>}
        </Panel>
        <Panel title="Tests & benchmark">
          <KV k="Benchmark">{d ? (d.benchmark.available ? `results available (${d.benchmark.status})` : `not run (${d.benchmark.status})`) : "—"}</KV>
          <KV k="Backend tests">{d?.tests ? (d.tests.summary ?? `${d.tests.passed} passed, ${d.tests.failed} failed`) : "no report recorded (run scripts/run_checks.sh)"}</KV>
          <KV k="External requests">{d ? (d.offline.external_requests ? "yes" : "none") : "—"}</KV><p className="mt-2 text-[11px] text-muted">{d?.offline.note}</p>
        </Panel>
      </div>
      <Dialog open={!!confirm} title={confirm === "reset" ? "Reset scenario?" : `Generate scenario with seed ${seed}?`} onClose={() => setConfirm(null)}
        footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { const c = confirm; setConfirm(null); void (c === "reset" ? resetScenario() : generateScenario(seed)); }}>Confirm</button></>}>
        This discards all plans, proposals and applied events and regenerates the synthetic BLUELAND scenario.
      </Dialog>
    </PageGate>
  );
}
