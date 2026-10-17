import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import type { Mission } from "../../types/api";
import type { ChangeKind } from "../../lib/plan";
import type { Vec3 } from "../../lib/theatre";
import { ProjectedLabel } from "./ProjectedLabel";

export function MissionNode({ mission, position, covered, change, locked, selected, pulse, onSelect }: {
  mission: Mission; position: Vec3; covered: boolean; change: ChangeKind; locked: boolean; selected: boolean; pulse: boolean; onSelect: () => void;
}) {
  const halo = useRef<Mesh>(null);
  const changed = change === "changed" || change === "added" || change === "newly_covered" || change === "newly_uncovered";
  useFrame(({ clock }) => {
    if (!halo.current) return;
    const k = changed && pulse ? 1 + 0.35 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4)) : 1;
    halo.current.scale.set(k, k, k);
  });
  const color = covered ? "#45E5AE" : "#FF5D72";
  const size = mission.priority === 1 ? 0.3 : mission.priority === 2 ? 0.23 : 0.18;
  return (
    <group position={position} onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
      <mesh><octahedronGeometry args={[size, 0]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.9 : 0.35} /></mesh>
      {(changed || locked || selected) && (
        <mesh ref={halo} rotation-x={-Math.PI / 2} position-y={-0.2}>
          <ringGeometry args={[size * 1.7, size * 1.95, 28]} />
          <meshBasicMaterial color={changed ? "#FFBD59" : selected ? "#EDF5FF" : "#39D9FF"} transparent opacity={0.9} />
        </mesh>
      )}
      {selected && (
        <ProjectedLabel lift={0.7} tone="mission" text={`${mission.id} · P${mission.priority}`} />
      )}
    </group>
  );
}
