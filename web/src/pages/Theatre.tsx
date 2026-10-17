import { Eye, Focus, Pause, Play, RotateCcw, Square, Layers as LayersIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PageGate } from "../components/layout/PageGate";
import type { Layers } from "../components/three/TheatreScene";
import { SceneFallback } from "../components/three/SceneFallback";
import type { CameraFocus } from "../components/three/TheatreCamera";
import { Badge, Panel, Select, Skeleton } from "../components/ui/primitives";
import { DetailPanel } from "../features/theatre/DetailPanel";
import { SolverBadge, ValidationBadge } from "../features/plan/PlanParts";
import { useData } from "../hooks/useData";
import { fmtSlot, HORIZON } from "../lib/format";
import { hasWebGL, missionPosition, toScene } from "../lib/theatre";

const TheatreScene = lazy(() => import("../components/three/TheatreScene").then((m) => ({ default: m.TheatreScene })));

const DEFAULT_LAYERS: Layers = { corridors: true, allCorridors: false, threats: true, weather: true, aircraft: true, missions: true, changes: true };
const LAYER_LABEL: [keyof Layers, string][] = [["corridors", "Route corridors"], ["allCorridors", "All candidate corridors"], ["threats", "Threat zones"],
  ["weather", "Weather"], ["aircraft", "Aircraft"], ["missions", "Mission nodes"], ["changes", "Change highlights"]];

export default function Theatre() {
  const { viewScenario: s, viewPlan: plan, approved, proposed, viewMode, setViewMode, selection, select, configResp } = useData();
  const reduced = !!useReducedMotion();
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [time, setTime] = useState(12);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const [webgl, setWebgl] = useState(() => hasWebGL());
  const [force2d, setForce2d] = useState(false);
  const nonce = useRef(0);

  const doFocus = (target: [number, number, number], distance: number) => setFocus({ target, distance, nonce: ++nonce.current });
  const reset = () => doFocus([0, 0, 0], 55);

  useEffect(() => {
    if (!playing || reduced) return;
    let raf = 0, last = performance.now();
    const tick = (n: number) => { const dt = (n - last) / 1000; last = n; setTime((t) => (t + dt * 3 > HORIZON ? 0 : t + dt * 3)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduced]);

  // focus the camera whenever the selection changes (from the scene or from a panel)
  useEffect(() => {
    if (!s || !selection) return;
    if (selection.kind === "base") { const b = s.bases.find((x) => x.id === selection.id); if (b) doFocus(toScene(b.x, b.y), 14); }
    if (selection.kind === "mission") { const m = s.missions.find((x) => x.id === selection.id); if (m) { const p = missionPosition(s, m); doFocus(p, 13); } }
  }, [selection?.id, selection?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const diff = plan?.diff ?? null;
  const baseline = viewMode === "proposed" ? approved : null;
  const sceneProps = useMemo(() => s && ({ scenario: s, plan, baseline, diff, time, layers, selection, onSelect: select, focus, reduced, onFail: () => setWebgl(false) }), [s, plan, baseline, diff, time, layers, selection, select, focus, reduced]);
  const use3d = webgl && !force2d;

  return (
    <PageGate needPlan>
      {s && plan && sceneProps && (
        <div className="grid h-[calc(100vh-7.5rem)] min-h-[520px] gap-3 lg:grid-cols-[1fr_340px]">
          <div className="panel relative min-h-[360px] overflow-hidden">
            {use3d ? (
              <Suspense fallback={<Skeleton className="h-full w-full" />}><TheatreScene {...sceneProps} /></Suspense>
            ) : <SceneFallback {...sceneProps} />}

            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
              <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
                <Badge tone={viewMode === "proposed" ? "warn" : "ok"}>{viewMode === "proposed" ? `PROPOSED ${plan.id}` : `APPROVED ${plan.id}`}</Badge>
                <SolverBadge plan={plan} /><ValidationBadge plan={plan} />
                {diff && viewMode === "proposed" && <Badge tone="warn">{diff.changed_mission_count} changed · {diff.changed_field_count} fields</Badge>}
                {!webgl && <Badge tone="warn">WebGL unavailable · 2D fallback</Badge>}
              </div>
              <div className="pointer-events-auto flex flex-wrap gap-1.5">
                {proposed && (
                  <div className="flex overflow-hidden rounded-md border border-white/10 text-xs" role="group" aria-label="Plan shown">
                    {(["approved", "proposed"] as const).map((m) => (
                      <button key={m} className={`px-2.5 py-1 ${viewMode === m ? "bg-cyan/20 text-cyan" : "bg-bg2/80 text-muted hover:text-ink"}`} aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>{m}</button>
                    ))}
                  </div>)}
                <button className="btn px-2 py-1 text-xs" onClick={reset} title="Reset camera"><RotateCcw className="h-3.5 w-3.5" />Reset</button>
                {webgl && <button className="btn px-2 py-1 text-xs" onClick={() => setForce2d(!force2d)}><Eye className="h-3.5 w-3.5" />{force2d ? "3D" : "2D"}</button>}
              </div>
            </div>

            <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-bg2/90 px-3 py-2">
              <button className="btn px-2 py-1" aria-label={playing ? "Pause" : "Play"} disabled={reduced} title={reduced ? "Disabled by reduced-motion preference" : ""} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
              <button className="btn px-2 py-1" aria-label="Stop" onClick={() => { setPlaying(false); setTime(0); }}><Square className="h-4 w-4" /></button>
              <input type="range" min={0} max={HORIZON} step={0.25} value={time} onChange={(e) => setTime(+e.target.value)} className="min-w-[160px] flex-1 accent-cyan" aria-label="Mission time" />
              <span className="num w-24 text-right text-sm text-cyan">{fmtSlot(Math.floor(time))}</span>
            </motion.div>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <Panel title="Inspector">
              <DetailPanel scenario={s} plan={plan} config={configResp?.active ?? null} selection={selection} onSelect={select} />
            </Panel>
            <Panel title="Focus" actions={<Focus className="h-4 w-4 text-muted" />}>
              <div className="grid grid-cols-2 gap-2">
                <Select aria-label="Focus base" value="" onChange={(e) => e.target.value && select({ kind: "base", id: e.target.value })}>
                  <option value="">Base…</option>{s.bases.map((b) => <option key={b.id} value={b.id}>{b.id} {b.name}</option>)}</Select>
                <Select aria-label="Focus mission" value="" onChange={(e) => e.target.value && select({ kind: "mission", id: e.target.value })}>
                  <option value="">Mission…</option>{s.missions.map((m) => <option key={m.id} value={m.id}>{m.id} · P{m.priority}</option>)}</Select>
              </div>
            </Panel>
            <Panel title="Layers" actions={<LayersIcon className="h-4 w-4 text-muted" />}>
              <div className="grid grid-cols-1 gap-1.5">
                {LAYER_LABEL.map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="accent-cyan" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />{label}</label>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-snug text-muted">Amber pulses, dashed old routes and red/green aircraft rings are drawn only for changes present in the backend diff of the displayed proposal.</p>
            </Panel>
          </div>
        </div>
      )}
    </PageGate>
  );
}
