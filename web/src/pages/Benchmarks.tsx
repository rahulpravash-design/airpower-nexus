import { Download, FlaskConical } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import { EmptyState, Field, Panel, ProgressBar, Skeleton, Stat } from "../components/ui/primitives";
import { useData } from "../hooks/useData";
import { api, describeError } from "../services/api";
import type { BenchmarkPayload } from "../types/api";

export default function Benchmarks() {
  const { source, benchProgress } = useData();
  const toast = useToast();
  const [b, setB] = useState<BenchmarkPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ instances: 100, time_limit_s: 4, churn_instances: 20 });
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => { try { setB(await api.benchmarks()); setErr(null); } catch (e) { setErr(describeError(e)); } }, []);
  useEffect(() => { void load(); }, [load, source]);
  useEffect(() => { if (b?.status !== "running") return; const t = setInterval(() => void load(), 2500); return () => clearInterval(t); }, [b?.status, load]);

  const run = async () => {
    try { setB(await api.runBenchmarks(form)); toast.push({ tone: "info", title: "Benchmark started on the backend" }); }
    catch (e) { toast.push({ tone: "bad", title: "Could not start benchmark", body: describeError(e) }); }
  };

  if (err && !b) return <EmptyState title="Benchmark data unavailable" body={err} />;
  if (!b) return <Skeleton className="h-64" />;
  const sm = b.summary;
  const running = b.status === "running";
  const pr = benchProgress ?? b.progress;
  const paired = (() => {
    const g = new Map(b.rows.filter((r) => r.method === "GREEDY").map((r) => [r.instance, r]));
    return b.rows.filter((r) => r.method === "CP_SAT").map((c) => ({ i: +c.instance, seed: c.seed, cp: +c.priority_weighted_coverage, gr: +(g.get(c.instance)?.priority_weighted_coverage ?? 0), status: c.solver_status, t: +c.solve_time_s }))
      .map((x) => ({ ...x, diff: x.cp - x.gr }));
  })();

  return (
    <div className="space-y-4">
      <Panel title="Benchmark laboratory" subtitle="CP-SAT vs greedy on seeded BLUELAND instances; every number below is read from the backend's own run."
        actions={<><button className="btn btn-primary" disabled={running || source !== "live"} onClick={() => setConfirm(true)}><FlaskConical className="h-4 w-4" />Run benchmark</button>
          {b.available && <><a className="btn" href={api.benchmarkCsvUrl("instances")} download><Download className="h-4 w-4" />Instances CSV</a><a className="btn" href={api.benchmarkCsvUrl("churn")} download><Download className="h-4 w-4" />Churn CSV</a></>}</>}>
        {running && <div className="mb-2"><div className="mb-1 flex justify-between text-xs"><span>{pr.message || "starting…"}</span><span className="num">{pr.done}/{pr.total}</span></div><ProgressBar value={pr.total ? pr.done / pr.total : 0} /></div>}
        {b.status === "error" && <p className="text-sm text-red" role="alert">Benchmark failed: {b.error}</p>}
        {!b.available && !running && <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Not yet run" body="No benchmark results exist. Run the 100-instance benchmark (takes several minutes at the default 4 s CP-SAT limit) or execute `python -m airops.bench.run_bench`." />}
        {b.available && sm && (<>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label="Median coverage · CP-SAT" value={sm.CP_SAT.median_priority_weighted_coverage ?? "—"} hint="priority-weighted points" tone="info" />
            <Stat label="Median coverage · Greedy" value={sm.GREEDY.median_priority_weighted_coverage ?? "—"} hint="priority-weighted points" />
            <Stat label="Median difference" value={sm.paired_comparison.median_difference ?? "—"} hint="CP-SAT − greedy" tone={(sm.paired_comparison.median_difference ?? 0) > 0 ? "ok" : "warn"} />
            <Stat label="CP-SAT better" value={sm.paired_comparison.cp_sat_better} tone="ok" hint={`of ${sm.paired_comparison.instances}`} />
            <Stat label="Equal" value={sm.paired_comparison.equal} /><Stat label="CP-SAT worse" value={sm.paired_comparison.cp_sat_worse} tone={sm.paired_comparison.cp_sat_worse ? "warn" : "ok"} />
            <Stat label="CP-SAT median solve" value={`${sm.CP_SAT.median_solve_time_s?.toFixed(2)} s`} hint={`max ${sm.CP_SAT.max_solve_time_s?.toFixed(2)} s`} />
            <Stat label="Greedy median solve" value={`${((sm.GREEDY.median_solve_time_s ?? 0) * 1000).toFixed(0)} ms`} />
            <Stat label="CP-SAT status" value={Object.entries(sm.CP_SAT.status_counts).map(([k, v]) => `${v} ${k}`).join(" · ")} hint={`${sm.CP_SAT.time_limit_reached} hit time limit · ${sm.CP_SAT.failures} failures`} />
            <Stat label="Hard rules valid" value={`${sm.CP_SAT.all_hard_rules_valid + sm.GREEDY.all_hard_rules_valid}/${sm.CP_SAT.instances + sm.GREEDY.instances}`} tone="ok" hint="independent validator" />
            {sm.churn && <Stat label="Median churn · with persistence" value={sm.churn.median_changed_missions_with_persistence ?? "—"} tone="ok" hint="changed missions after an event" />}
            {sm.churn && <Stat label="Median churn · without" value={sm.churn.median_changed_missions_without_persistence ?? "—"} tone="warn" hint={`${sm.churn.instances} controlled events`} />}
          </div>
          <ul className="mt-4 space-y-1 rounded-md border border-white/5 bg-bg2/60 p-3 text-sm">{sm.statements.map((t) => <li key={t}>• {t}</li>)}
            <li className="text-xs text-muted">Run: {String(sm.meta.instances)} instances · base seed {String(sm.meta.base_seed)} · {String(sm.meta.time_limit_s)} s CP-SAT limit · {String(sm.meta.workers)} workers · OR-Tools {String(sm.meta.ortools)} · {String(sm.meta.duration_s)} s total. {String(sm.meta.cp_sat_setup)}.</li></ul>
        </>)}
      </Panel>

      {b.available && paired.length > 0 && (<>
        <Panel title="Coverage difference per instance" subtitle="CP-SAT minus greedy priority-weighted coverage (positive = CP-SAT better)">
          <div className="h-60"><ResponsiveContainer><BarChart data={paired} margin={{ left: -12, right: 8 }}>
            <CartesianGrid stroke="#ffffff10" vertical={false} /><XAxis dataKey="i" stroke="#8DA1BB" fontSize={11} /><YAxis stroke="#8DA1BB" fontSize={11} />
            <RTooltip contentStyle={{ background: "#0A1222", border: "1px solid #ffffff20", fontSize: 12 }} cursor={{ fill: "#ffffff08" }} formatter={(v) => [String(v), "difference"]} labelFormatter={(l) => `instance ${l}`} />
            <Bar dataKey="diff" isAnimationActive={false}>{paired.map((d) => <Cell key={d.i} fill={d.diff > 0 ? "#45E5AE" : d.diff < 0 ? "#FF5D72" : "#8DA1BB"} />)}</Bar></BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel title="Instances" subtitle={`${paired.length} paired instances`}>
          <div className="max-h-96 overflow-auto"><table className="w-full min-w-[640px] text-left text-xs">
            <thead className="label sticky top-0 bg-panel"><tr>{["#", "Seed", "Greedy", "CP-SAT", "Diff", "CP-SAT status", "CP-SAT time"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
            <tbody>{paired.map((r) => <tr key={r.i} className="border-b border-white/5"><td className="num px-2 py-1">{r.i}</td><td className="num">{r.seed}</td><td className="num">{r.gr}</td><td className="num">{r.cp}</td>
              <td className={`num ${r.diff > 0 ? "text-green" : r.diff < 0 ? "text-red" : ""}`}>{r.diff > 0 ? "+" : ""}{r.diff}</td><td>{r.status}</td><td className="num">{r.t.toFixed(2)} s</td></tr>)}</tbody></table></div>
        </Panel>
        {b.churn.length > 0 && (
          <Panel title="Churn study" subtitle="changed missions after one controlled event; with = persistence penalty + hints + freeze, without = none of these">
            <div className="max-h-72 overflow-auto"><table className="w-full min-w-[640px] text-left text-xs">
              <thead className="label sticky top-0 bg-panel"><tr>{["#", "Event", "Target", "Changed (with)", "Changed (without)", "Coverage (with)", "Coverage (without)"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
              <tbody>{b.churn.map((c) => <tr key={c.instance} className="border-b border-white/5"><td className="num px-2 py-1">{c.instance}</td><td>{c.event_type}</td><td className="num">{c.event_target}</td>
                <td className="num text-green">{c.changed_missions_with_persistence}</td><td className="num text-amber">{c.changed_missions_without_persistence}</td><td className="num">{c.coverage_with_persistence}</td><td className="num">{c.coverage_without_persistence}</td></tr>)}</tbody></table></div>
          </Panel>)}
      </>)}

      <Dialog open={confirm} title="Run benchmark" onClose={() => setConfirm(false)} footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-primary" onClick={() => { setConfirm(false); void run(); }}>Start</button></>}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Instances"><input type="number" className="input" min={1} max={100} value={form.instances} onChange={(e) => setForm({ ...form, instances: +e.target.value })} /></Field>
          <Field label="CP-SAT limit (s)"><input type="number" className="input" min={0.5} max={30} step={0.5} value={form.time_limit_s} onChange={(e) => setForm({ ...form, time_limit_s: +e.target.value })} /></Field>
          <Field label="Churn instances"><input type="number" className="input" min={0} max={100} value={form.churn_instances} onChange={(e) => setForm({ ...form, churn_instances: +e.target.value })} /></Field>
        </div>
        <p className="mt-3">Worst case ≈ {Math.round(form.instances * (form.time_limit_s + 0.2) + form.churn_instances * 2 * form.time_limit_s)} s. Existing results are overwritten when it completes. The solver competes for CPU with the rest of the app while running.</p>
      </Dialog>
    </div>
  );
}
