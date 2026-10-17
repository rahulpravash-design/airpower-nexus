import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageGate } from "../components/layout/PageGate";
import { Badge, EmptyState, Panel, Select } from "../components/ui/primitives";
import { DetailPanel } from "../features/theatre/DetailPanel";
import { ChangeBadge, LockBadge } from "../features/plan/PlanParts";
import { useData } from "../hooks/useData";
import { fmtSlot } from "../lib/format";
import { changeStatus, indexPlan } from "../lib/plan";

type SortKey = "id" | "priority" | "start";

export default function Missions() {
  const { viewScenario: s, viewPlan: plan, selection, select, configResp } = useData();
  const [q, setQ] = useState(""); const [prio, setPrio] = useState(""); const [cov, setCov] = useState(""); const [chg, setChg] = useState("");
  const [base, setBase] = useState(""); const [sort, setSort] = useState<SortKey>("id");
  const ix = useMemo(() => indexPlan(plan), [plan]);

  const rows = useMemo(() => {
    if (!s) return [];
    const r = s.missions.map((m) => ({ m, a: ix.byMission.get(m.id), ch: changeStatus(plan?.diff, m.id) })).filter(({ m, a, ch }) => {
      const hay = [m.id, m.role, m.area_id, ...(a?.aircraft_ids ?? []), ...(a?.crew_ids ?? []), a?.corridor_id ?? ""].join(" ").toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (prio && String(m.priority) !== prio) return false;
      if (cov === "covered" && !a?.covered) return false;
      if (cov === "uncovered" && a?.covered) return false;
      if (chg && ch !== chg) return false;
      if (base && a?.base_id !== base) return false;
      return true;
    });
    r.sort((x, y) => sort === "priority" ? x.m.priority - y.m.priority || x.m.id.localeCompare(y.m.id)
      : sort === "start" ? (x.a?.start_slot ?? 99) - (y.a?.start_slot ?? 99) : x.m.id.localeCompare(y.m.id));
    return r;
  }, [s, ix, plan, q, prio, cov, chg, base, sort]);

  return (
    <PageGate needPlan>
      {s && plan && (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <Panel title="Missions" subtitle={`${rows.length} of ${s.missions.length} shown · plan ${plan.id} (${plan.status})`}>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
              <div className="relative col-span-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" /><input className="input pl-8" placeholder="Search id, aircraft, crew, area…" aria-label="Search missions" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Select aria-label="Priority" value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Priority: all</option><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option></Select>
              <Select aria-label="Coverage" value={cov} onChange={(e) => setCov(e.target.value)}><option value="">Coverage: all</option><option value="covered">Covered</option><option value="uncovered">Uncovered</option></Select>
              <Select aria-label="Change" value={chg} onChange={(e) => setChg(e.target.value)}><option value="">Change: all</option><option value="changed">Changed</option><option value="unchanged">Unchanged</option><option value="added">New</option><option value="newly_covered">Newly covered</option><option value="newly_uncovered">Newly uncovered</option></Select>
              <Select aria-label="Base" value={base} onChange={(e) => setBase(e.target.value)}><option value="">Base: all</option>{s.bases.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</Select>
            </div>
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">Sort by
              {(["id", "priority", "start"] as SortKey[]).map((k) => <button key={k} className={`rounded px-2 py-0.5 ${sort === k ? "bg-cyan/15 text-cyan" : "hover:text-ink"}`} onClick={() => setSort(k)}>{k}</button>)}</div>
            {rows.length === 0 ? <EmptyState title="No missions match the filters" body="Clear a filter or the search box." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-xs">
                  <thead className="label border-b border-white/10"><tr>{["Mission", "Pri", "Role", "Coverage", "Aircraft", "Crew", "Base", "Departure", "Corridor", "Change"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{rows.map(({ m, a, ch }) => {
                    const sel = selection?.kind === "mission" && selection.id === m.id;
                    return (
                      <tr key={m.id} tabIndex={0} aria-selected={sel} onClick={() => select({ kind: "mission", id: m.id })} onKeyDown={(e) => e.key === "Enter" && select({ kind: "mission", id: m.id })}
                        className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${sel ? "bg-cyan/10" : ""}`}>
                        <td className="num px-2 py-1.5 text-cyan">{m.id}{m.created_by_event && <Badge tone="info">NEW</Badge>}</td>
                        <td className="px-2"><Badge tone={m.priority === 1 ? "bad" : m.priority === 2 ? "warn" : "info"}>P{m.priority}</Badge></td>
                        <td className="num px-2">{m.role}×{m.package_size}</td>
                        <td className="px-2"><Badge tone={a?.covered ? "ok" : "bad"}>{a?.covered ? "COVERED" : "UNCOVERED"}</Badge> <LockBadge lock={a?.lock ?? null} /></td>
                        <td className="num px-2">{a?.aircraft_ids.join(", ") || "—"}</td><td className="num px-2">{a?.crew_ids.join(", ") || "—"}</td>
                        <td className="num px-2">{a?.base_id ?? "—"}</td><td className="num px-2">{fmtSlot(a?.start_slot)}</td>
                        <td className="num px-2">{a?.corridor_id ?? "—"}</td><td className="px-2"><ChangeBadge kind={ch} /></td>
                      </tr>);
                  })}</tbody>
                </table>
              </div>)}
          </Panel>
          <Panel title="Mission detail" className="h-fit xl:sticky xl:top-0">
            <DetailPanel scenario={s} plan={plan} config={configResp?.active ?? null} selection={selection} onSelect={select} />
          </Panel>
        </div>
      )}
    </PageGate>
  );
}
