import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, type Group } from "three";

export type LabelTone = "base" | "selected" | "closed" | "mission";
const TONE: Record<LabelTone, string> = {
  base: "border:1px solid rgba(255,255,255,.12);background:rgba(10,18,34,.82);color:#EDF5FF",
  selected: "border:1px solid #39D9FF;background:#0A1222;color:#39D9FF",
  closed: "border:1px solid rgba(255,189,89,.6);background:rgba(10,18,34,.9);color:#FFBD59",
  mission: "border:1px solid rgba(255,255,255,.15);background:rgba(10,18,34,.92);color:#EDF5FF",
};

/** A text label pinned to its parent object. Plain DOM (no nested React root), repositioned every rendered frame. */
export function ProjectedLabel({ text, tone = "base", lift = 0 }: { text: string; tone?: LabelTone; lift?: number }) {
  const anchor = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);
  const el = useMemo(() => document.createElement("div"), []);

  useEffect(() => {
    el.style.cssText = `position:absolute;left:0;top:0;z-index:5;pointer-events:none;white-space:nowrap;border-radius:4px;padding:2px 6px;font:500 10px "Inter Variable",system-ui,sans-serif;${TONE[tone]}`;
    el.textContent = text;
  }, [el, text, tone]);
  useEffect(() => {
    const host = gl.domElement.parentElement;
    host?.appendChild(el);
    return () => { host?.removeChild(el); };
  }, [gl, el]);

  useFrame(() => {
    if (!anchor.current) return;
    anchor.current.getWorldPosition(v);   // the label follows its parent object (base, mission node…)
    v.y += lift;
    v.project(camera);
    const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
    el.style.display = v.z > 1 || v.z < -1 ? "none" : "block";
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  });
  return <group ref={anchor} />;
}
