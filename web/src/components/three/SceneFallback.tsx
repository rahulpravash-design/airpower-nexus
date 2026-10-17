import { useMemo } from "react";
import { changeStatus, indexPlan } from "../../lib/plan";
import { isClosed, isThreatActive } from "../../lib/theatre";
import type { SceneProps } from "./TheatreScene";

/** Lightweight 2-D map (SVG) used when WebGL is unavailable or the user prefers it. Same data, same selection. */
export function SceneFallback({ scenario: s, plan, diff, time, layers, selection, onSelect }: SceneProps) {
  const ix = useMemo(() => indexPlan(plan), [plan]);
  const cor = useMemo(() => new Map(s.corridors.map((c) => [c.id, c])), [s.corridors]);
  const P = (x: number, y: number) => `${x},${300 - y}`;
  const used = new Set((plan?.assignments ?? []).filter((a) => a.covered && a.corridor_id).map((a) => a.corridor_id!));
  const area = new Map(s.areas.map((a) => [a.id, a]));
  return (
    <svg viewBox="-10 -10 420 320" className="h-full w-full bg-bg2" role="img" aria-label="Two-dimensional theatre map" onClick={() => onSelect(null)}>
      <rect x="0" y="0" width="400" height="300" fill="none" stroke="#39D9FF" strokeOpacity=".35" />
      {layers.corridors && s.corridors.filter((c) => layers.allCorridors || used.has(c.id)).map((c) => (
        <polyline key={c.id} points={c.waypoints.map(([x, y]) => P(x, y)).join(" ")} fill="none"
          stroke={used.has(c.id) ? "#4385FF" : "#2a4468"} strokeWidth={used.has(c.id) ? 2 : 1} opacity={used.has(c.id) ? 0.9 : 0.5} />
      ))}
      {layers.threats && s.threats.map((t) => (
        <polygon key={t.id} points={t.polygon.map(([x, y]) => P(x, y)).join(" ")} fill="#FF5D72"
          fillOpacity={isThreatActive(t, time) ? 0.28 : 0.04} stroke="#FF5D72" strokeDasharray={isThreatActive(t, time) ? "" : "4 3"} />
      ))}
      {s.bases.map((b) => {
        const closed = b.weather_closures.some((c) => isClosed(c, time));
        const sel = selection?.kind === "base" && selection.id === b.id;
        return (
          <g key={b.id} onClick={(e) => { e.stopPropagation(); onSelect({ kind: "base", id: b.id }); }} className="cursor-pointer">
            {layers.weather && closed && <circle cx={b.x} cy={300 - b.y} r="36" fill="#9fb4cc" fillOpacity=".15" stroke="#FFBD59" />}
            <rect x={b.x - 7} y={300 - b.y - 7} width="14" height="14" fill="#14304f" stroke={sel ? "#EDF5FF" : closed ? "#FFBD59" : "#39D9FF"} strokeWidth={sel ? 3 : 2} />
            <text x={b.x + 11} y={300 - b.y + 4} fontSize="9" fill="#EDF5FF">{b.id} {b.name}</text>
          </g>
        );
      })}
      {layers.missions && s.missions.map((m) => {
        const a = area.get(m.area_id)!;
        const i = s.missions.filter((x) => x.area_id === m.area_id).findIndex((x) => x.id === m.id);
        const x = a.x + Math.cos(i * 2.4) * (9 + 5 * Math.sqrt(i)), y = a.y + Math.sin(i * 2.4) * (9 + 5 * Math.sqrt(i));
        const asg = ix.byMission.get(m.id), ch = changeStatus(diff, m.id);
        const sel = selection?.kind === "mission" && selection.id === m.id;
        return (
          <g key={m.id} onClick={(e) => { e.stopPropagation(); onSelect({ kind: "mission", id: m.id }); }} className="cursor-pointer">
            <circle cx={x} cy={300 - y} r={5 - m.priority} fill={asg?.covered ? "#45E5AE" : "#FF5D72"}
              stroke={sel ? "#EDF5FF" : layers.changes && ch !== "none" && ch !== "unchanged" ? "#FFBD59" : "none"} strokeWidth="2" />
            {asg?.covered && asg.corridor_id && cor.has(asg.corridor_id) && null}
          </g>
        );
      })}
    </svg>
  );
}
