import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import type { Base } from "../../types/api";
import { toScene } from "../../lib/theatre";
import { ProjectedLabel } from "./ProjectedLabel";

export function BaseMarker({ base, selected, closed, onSelect, pulse }: {
  base: Base; selected: boolean; closed: boolean; onSelect: () => void; pulse: boolean;
}) {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const k = selected && pulse ? 1 + 0.12 * Math.sin(clock.elapsedTime * 3) : 1;
    ring.current.scale.set(k, k, k);
  });
  const col = closed ? "#FFBD59" : "#39D9FF";
  return (
    <group position={toScene(base.x, base.y)} onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
      <mesh position-y={0.07}><cylinderGeometry args={[1, 1.15, 0.14, 40]} /><meshStandardMaterial color="#14304f" emissive={col} emissiveIntensity={selected ? 0.55 : 0.18} /></mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.17}><ringGeometry args={[1.35, 1.5, 56]} /><meshBasicMaterial color={col} transparent opacity={selected ? 0.95 : 0.4} /></mesh>
      <mesh position-y={0.3}><boxGeometry args={[0.5, 0.3, 0.5]} /><meshStandardMaterial color="#1d4670" emissive={col} emissiveIntensity={0.3} /></mesh>
      <ProjectedLabel lift={1.5} tone={closed ? "closed" : selected ? "selected" : "base"} text={`${base.id} · ${base.name}${closed ? " · WX CLOSED" : ""}`} />
    </group>
  );
}
