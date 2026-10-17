import { PageGate } from "../components/layout/PageGate";
import { Badge, Panel, ProgressBar, Stat } from "../components/ui/primitives";
import { useData } from "../hooks/useData";
import { num, pct } from "../lib/format";

export default function Fusion() {
  const { scenario: s, fusion: f, selection, select } = useData();
  return (
    <PageGate>
      {s && f && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Records" value={f.total_records} /><Stat label="Fresh" value={f.fresh} tone="ok" />
            <Stat label="Stale" value={f.stale} tone={f.stale ? "warn" : "ok"} /><Stat label="Invalid" value={f.invalid} tone={f.invalid ? "bad" : "ok"} />
            <Stat label="Conflicts" value={f.conflicts} tone={f.conflicts ? "warn" : "ok"} /><Stat label="Mean trust" value={pct(f.mean_trust)} hint={`health ${pct(f.trust_health)}`} />
          </div>
          <Panel title="Sources" subtitle={`reference time ${new Date(f.reference_time).toUTCString()} · ${f.formula}`}>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs">
              <thead className="label border-b border-white/10"><tr>{["Source", "Reliability", "Records", "Fresh", "Stale", "Invalid", "Conflicts", "Mean trust", "Age range (min)"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{f.sources.map((r) => (
                <tr key={r.source} className="border-b border-white/5">
                  <td className="num px-2 py-1.5 text-cyan">{r.source}</td><td className="num px-2">{pct(r.reliability)}</td><td className="num px-2">{r.records}</td>
                  <td className="num px-2 text-green">{r.fresh}</td><td className={`num px-2 ${r.stale ? "text-amber" : ""}`}>{r.stale}</td><td className={`num px-2 ${r.invalid ? "text-red" : ""}`}>{r.invalid}</td><td className={`num px-2 ${r.conflicts ? "text-amber" : ""}`}>{r.conflicts}</td>
                  <td className="w-40 px-2"><div className="flex items-center gap-2"><span className="num w-10">{pct(r.mean_trust)}</span><ProgressBar value={r.mean_trust} tone={r.mean_trust > 0.8 ? "ok" : "warn"} /></div></td>
                  <td className="num px-2 text-muted">{num(r.newest_age_min, 0)}–{num(r.oldest_age_min, 0)}</td></tr>))}</tbody></table></div>
            <p className="mt-3 text-xs text-muted">{f.note}</p>
          </Panel>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Flagged records" subtitle="stale, invalid, conflicting or low-trust inputs">
              {f.flagged.length === 0 ? <p className="text-sm text-green">No flagged records.</p> : (
                <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">{f.flagged.map((r) => (
                  <li key={r.record_id} className="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-bg2/60 px-2.5 py-1.5 text-xs">
                    <button className="num text-cyan hover:underline" onClick={() => r.kind === "aircraft" && select({ kind: "aircraft", id: r.record_id })}>{r.record_id}</button>
                    <span className="text-muted">{r.kind} · {r.source}</span><span className="num ml-auto">trust {pct(r.trust)}</span>
                    <span className="num text-muted">{num(r.age_min, 0)} min old</span>
                    <span className="w-full">{r.problems.map((p) => <Badge key={p} tone={p === "stale" || p === "low_trust" || p.startsWith("conflict") ? "warn" : "bad"}>{p}</Badge>)}</span></li>))}</ul>)}
            </Panel>
            <Panel title="Aircraft: trust vs serviceability" subtitle="trust = belief in the record · serviceability = model probability (synthetic)">
              <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs">
                <thead className="label sticky top-0 bg-panel"><tr><th className="px-2 py-1.5">Aircraft</th><th>Role</th><th>Status</th><th>Trust</th><th>Serviceability</th><th>Flags</th></tr></thead>
                <tbody>{s.aircraft.map((a) => (
                  <tr key={a.id} onClick={() => select({ kind: "aircraft", id: a.id })} className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${selection?.id === a.id ? "bg-cyan/10" : ""}`}>
                    <td className="num px-2 py-1 text-cyan">{a.id}</td><td>{a.role}</td><td>{a.status}</td><td className="num">{pct(a.trust)}</td>
                    <td className="num">{a.predicted_serviceability === null ? "—" : pct(a.predicted_serviceability)}</td>
                    <td>{!a.record_valid && <Badge tone="bad">invalid</Badge>}{a.stale && <Badge tone="warn">stale</Badge>}{a.conflict && <Badge tone="warn">conflict</Badge>}</td></tr>))}</tbody></table></div>
            </Panel>
          </div>
          {s.model_info && (
            <Panel title="Availability model" subtitle={`${s.model_info.name} · v${s.model_info.version}`} actions={<Badge tone={s.model_info.kind === "TRAINED_SYNTHETIC" ? "ok" : "warn"}>{s.model_info.kind}</Badge>}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {Object.entries(s.model_info.metrics).map(([k, v]) => <div key={k} className="rounded-md border border-white/5 bg-bg2/60 p-2.5"><div className="label">{k.replace(/_/g, " ")}</div><div className="num text-lg">{v}</div></div>)}
                <div className="rounded-md border border-white/5 bg-bg2/60 p-2.5"><div className="label">train / test</div><div className="num text-lg">{s.model_info.n_train} / {s.model_info.n_test}</div></div>
              </div>
              <p className="mt-3 text-xs text-muted">Held-out metrics on the synthetic test split. {s.model_info.disclaimer}</p>
            </Panel>)}
        </div>
      )}
    </PageGate>
  );
}
