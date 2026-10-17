import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { aircraftSwaps, changeStatus, indexPlan } from "../../lib/plan";
import { aircraftPose, isClosed, isThreatActive, missionPosition } from "../../lib/theatre";
import type { Plan, PlanDiff, Scenario } from "../../types/api";
import type { Selection } from "../../hooks/useData";
import { AircraftMarker } from "./AircraftMarker";
import { BaseMarker } from "./BaseMarker";
import { GroundGrid } from "./GroundGrid";
import { MissionNode } from "./MissionNode";
import { RouteCorridor } from "./RouteCorridor";
import { ThreatPolygon } from "./ThreatPolygon";
import { TheatreCamera, type CameraFocus } from "./TheatreCamera";
import { WeatherOverlay } from "./WeatherOverlay";

export interface Layers { corridors: boolean; allCorridors: boolean; threats: boolean; weather: boolean; aircraft: boolean; missions: boolean; changes: boolean }

export interface SceneProps {
  scenario: Scenario; plan: Plan | null; baseline: Plan | null; diff: PlanDiff | null; time: number; layers: Layers;
  selection: Selection; onSelect: (s: Selection) => void; focus: CameraFocus | null; reduced: boolean; onFail: () => void;
}

export function TheatreScene(p: SceneProps) {
  const { scenario: s, plan, baseline, diff, time, layers, selection, onSelect, reduced } = p;
  const ix = useMemo(() => indexPlan(plan), [plan]);
  const corridors = useMemo(() => new Map(s.corridors.map((c) => [c.id, c])), [s.corridors]);
  const swaps = useMemo(() => aircraftSwaps(diff), [diff]);
  const used = useMemo(() => new Set((plan?.assignments ?? []).filter((a) => a.covered && a.corridor_id).map((a) => a.corridor_id!)), [plan]);
  // Ghost of the previous route is drawn ONLY for missions whose corridor really changed in the returned diff.
  const oldRoutes = useMemo(() => {
    if (!baseline || !diff) return [] as string[];
    const base = indexPlan(baseline);
    return diff.changed_corridor.map((m) => base.byMission.get(m)?.corridor_id).filter((x): x is string => !!x);
  }, [baseline, diff]);
  const newRoutes = useMemo(() => (diff ? diff.changed_corridor.map((m) => ix.byMission.get(m)?.corridor_id).filter((x): x is string => !!x) : []), [diff, ix]);
  const parkIdx = useMemo(() => {
    const m = new Map<string, number>(); const n: Record<string, number> = {};
    s.aircraft.forEach((a) => { n[a.home_base] = (n[a.home_base] ?? 0); m.set(a.id, n[a.home_base]++); });
    return m;
  }, [s.aircraft]);

  return (
    <Canvas dpr={[1, 1.5]} frameloop={reduced ? "demand" : "always"} camera={{ position: [0, 38, 40], fov: 45, near: 0.1, far: 300 }}
      gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => onSelect(null)}
      onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); p.onFail(); })}>
      <color attach="background" args={["#050914"]} />
      <fog attach="fog" args={["#050914", 70, 150]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[12, 22, 8]} intensity={1} />
      <GroundGrid />
      <TheatreCamera focus={p.focus} reduced={reduced} />

      {layers.corridors && layers.allCorridors && s.corridors.filter((c) => !used.has(c.id)).map((c) => <RouteCorridor key={c.id} corridor={c} kind="all" animate={false} />)}
      {layers.corridors && [...used].map((id) => corridors.get(id)).filter(Boolean).map((c) => <RouteCorridor key={`a-${c!.id}`} corridor={c!} kind="assigned" animate={false} />)}
      {layers.corridors && layers.changes && [...new Set(oldRoutes)].map((id) => corridors.get(id)).filter(Boolean).map((c) => <RouteCorridor key={`o-${c!.id}`} corridor={c!} kind="old" animate={false} />)}
      {layers.corridors && layers.changes && [...new Set(newRoutes)].map((id) => corridors.get(id)).filter(Boolean).map((c) => <RouteCorridor key={`n-${c!.id}`} corridor={c!} kind="new" animate={!reduced} />)}

      {layers.threats && s.threats.map((t) => <ThreatPolygon key={t.id} threat={t} active={isThreatActive(t, time)} animate={!reduced} />)}
      {layers.weather && s.bases.flatMap((b) => b.weather_closures.some((c) => isClosed(c, time)) ? [<WeatherOverlay key={`w-${b.id}`} base={b} />] : [])}

      {s.bases.map((b) => (
        <BaseMarker key={b.id} base={b} pulse={!reduced} selected={selection?.kind === "base" && selection.id === b.id}
          closed={b.weather_closures.some((c) => isClosed(c, time))} onSelect={() => onSelect({ kind: "base", id: b.id })} />
      ))}

      {layers.missions && s.missions.map((m) => {
        const a = ix.byMission.get(m.id);
        return (
          <MissionNode key={m.id} mission={m} position={missionPosition(s, m)} covered={!!a?.covered}
            change={layers.changes ? changeStatus(diff, m.id) : "none"} locked={!!a?.lock} pulse={!reduced}
            selected={selection?.kind === "mission" && selection.id === m.id} onSelect={() => onSelect({ kind: "mission", id: m.id })} />
        );
      })}

      {layers.aircraft && s.aircraft.map((ac) => (
        <AircraftMarker key={ac.id} ac={ac} smooth={!reduced} pose={aircraftPose(s, ac, ix.byAircraft.get(ac.id) ?? [], corridors, time, parkIdx.get(ac.id) ?? 0)}
          selected={selection?.kind === "aircraft" && selection.id === ac.id}
          ring={layers.changes ? (swaps.removed.has(ac.id) ? "removed" : swaps.added.has(ac.id) ? "added" : null) : null}
          onSelect={() => onSelect({ kind: "aircraft", id: ac.id })} />
      ))}
    </Canvas>
  );
}
