import { useMemo, useState } from "react";
import { PageGate } from "../components/layout/PageGate";
import { Badge, Panel, Select } from "../components/ui/primitives";
import { DetailPanel } from "../features/theatre/DetailPanel";
import { useData } from "../hooks/useData";
import { fmtSlot, HORIZON, PRIORITY_COLOR } from "../lib/format";
import { changeStatus } from "../lib/plan";
import type { Assignment, Plan, Scenario } from "../types/api";

type Group = "aircraft" | "crew" | "base" | "mission";
const W = 26; // px per 15-minute slot

function rowKeys(a: Assignment, g: Group): string[] {
  return g === "aircraft" ? a.aircraft_ids : g === "crew" ? a.crew_ids : g === "base" ? (a.base_id ? [a.base_id] : []) : [a.mission_id];
}

export default function Timeline() {
  const { viewScenario: s, viewPlan: plan, approved, proposed, viewMode, selection, select, configResp } = useData();
  const [group, setGroup] = useState<Group>("aircraft");
  const [idle, setIdle] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [ghost, setGhost] = useState(true);
  const turnSlots = (configResp?.active.turnaround_minutes ?? 60) / 15;

  const rows = useMemo(() => {
    if (!s || !plan) return [] as string[];
    const all = group === "aircraft" ? s.aircraft.map((a) => a.id) : group === "crew" ? s.crew.map((c) => c.id) : group === "base" ? s.bases.map((b) => b.id) : s.missions.map((m) => m.id);
    const used = new Set<string>();
    const add = (p: Plan | null) => p?.assignments.forEach((a) => a.covered && rowKeys(a, group).forEach((k) => used.add(k)));
    add(plan); if (ghost && viewMode === "proposed") add(approved);
    return all.filter((k) => idle || used.has(k));
  }, [s, plan, approved, viewMode, group, idle, ghost]);

  const compare = viewMode === "proposed" && !!proposed && ghost ? approved : null;
  const ticks = Array.from({ length: HORIZON / 4 + 1 }, (_, i) => i * 4);

  function bars(p: Plan, key: string, old: boolean) {
    return p.assignments.filter((a) => a.covered && rowKeys(a, group).includes(key) && a.start_slot !== null).map((a) => {
      const m = s!.missions.find((x) => x.id === a.mission_id)!;
      const ch = changeStatus(plan!.diff, a.mission_id);
      if (onlyChanged && !old && ch !== "changed" && ch !== "added" && ch !== "newly_covered") return null;
      const sel = selection?.kind === "mission" && selection.id === a.mission_id;
      const left = a.start_slot! * W, width = m.duration_slots * W;
      return (
        <div key={`${old ? "o" : "n"}-${a.mission_id}`} className="absolute top-1" style={{ left, width: width + (group === "aircraft" && !old ? turnSlots * W : 0), height: 26 }}>
          <button onClick={() => select({ kind: "mission", id: a.mission_id })}
            title={`${a.mission_id} P${m.priority} ${fmtSlot(a.start_slot)}–${fmtSlot(a.end_slot)} ${a.aircraft_ids.join(",")} / ${a.corridor_id}${a.lock ? ` · ${a.lock}` : ""}`}
            className={`absolute left-0 top-0 h-full truncate rounded px-1.5 text-left text-[10px] font-medium text-bg2 ${old ? "border border-dashed border-muted bg-transparent !text-muted" : ""} ${sel ? "ring-2 ring-white" : ""} ${!old && ch === "changed" ? "outline outline-2 outline-amber" : ""} ${!old && a.lock ? "border-b-4 border-cyan" : ""}`}
            style={{ width, background: old ? undefined : PRIORITY_COLOR[m.priority] }}>{a.mission_id}{a.lock ? " 🔒" : ""}</button>
          {group === "aircraft" && !old && turnSlots > 0 && (
            <div className="absolute top-0 h-full rounded-r bg-[repeating-linear-gradient(45deg,#ffffff22,#ffffff22_3px,transparent_3px,transparent_6px)]" style={{ left: width, width: turnSlots * W }} title="turnaround" />
          )}
        </div>
      );
    });
  }

  return (
    <PageGate needPlan>
      {s && plan && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <Panel title="12-hour timeline" subtitle={`15-minute divisions · plan ${plan.id} (${plan.status})`}
            actions={<div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Group rows by" value={group} onChange={(e) => setGroup(e.target.value as Group)}><option value="aircraft">Rows: aircraft</option><option value="crew">Rows: crew</option><option value="base">Rows: base</option><option value="mission">Rows: mission</option></Select>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-cyan" checked={idle} onChange={(e) => setIdle(e.target.checked)} />idle rows</label>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-cyan" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />changed only</label>
              {proposed && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-cyan" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />old plan overlay</label>}</div>}>
            <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted">
              {[1, 2, 3].map((p) => <span key={p} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PRIORITY_COLOR[p] }} />P{p}</span>)}
              <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm outline outline-2 outline-amber" />changed</span>
              <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 border-b-4 border-cyan bg-white/20" />frozen/in-progress</span>
              <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 bg-[repeating-linear-gradient(45deg,#ffffff44,#ffffff44_2px,transparent_2px,transparent_4px)]" />turnaround</span>
              <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 border border-dashed border-muted" />previous plan</span>
              <Badge tone={viewMode === "proposed" ? "warn" : "ok"}>{viewMode}</Badge></div>
            {rows.length === 0 ? <p className="text-sm text-muted">No assignments to show.</p> : (
              <div className="max-h-[68vh] overflow-auto rounded-lg border border-white/5">
                <div style={{ width: 112 + HORIZON * W }} className="relative">
                  <div className="sticky top-0 z-20 flex border-b border-white/10 bg-bg2">
                    <div className="sticky left-0 z-30 w-28 shrink-0 bg-bg2 px-2 py-1.5 label">{group}</div>
                    <div className="relative h-7" style={{ width: HORIZON * W }}>{ticks.map((t) => <span key={t} className="num absolute top-1.5 -translate-x-1/2 text-[10px] text-muted" style={{ left: t * W }}>{fmtSlot(t).slice(2)}</span>)}</div>
                  </div>
                  {rows.map((key) => (
                    <div key={key} className="flex border-b border-white/5">
                      <button className="num sticky left-0 z-10 w-28 shrink-0 truncate bg-bg2 px-2 py-2 text-left text-[11px] text-muted hover:text-cyan"
                        onClick={() => select(group === "aircraft" ? { kind: "aircraft", id: key } : group === "crew" ? { kind: "crew", id: key } : group === "base" ? { kind: "base", id: key } : { kind: "mission", id: key })}>{key}</button>
                      <div className="relative h-9" style={{ width: HORIZON * W, backgroundImage: `repeating-linear-gradient(90deg, #ffffff0a 0, #ffffff0a 1px, transparent 1px, transparent ${W}px), repeating-linear-gradient(90deg, #ffffff18 0, #ffffff18 1px, transparent 1px, transparent ${W * 4}px)` }}>
                        {compare && bars(compare, key, true)}
                        {bars(plan, key, false)}
                      </div>
                    </div>))}
                </div>
              </div>)}
          </Panel>
          <Panel title="Inspector" className="h-fit"><DetailPanel scenario={s as Scenario} plan={plan} config={configResp?.active ?? null} selection={selection} onSelect={select} /></Panel>
        </div>
      )}
    </PageGate>
  );
}
