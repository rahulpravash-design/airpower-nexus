import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils, type Group } from "three";
import type { Aircraft } from "../../types/api";
import type { Pose } from "../../lib/theatre";

const STATUS_COLOR = { AVAILABLE: "#4385FF", MAINTENANCE: "#FFBD59", UNAVAILABLE: "#FF5D72" } as const;

export function AircraftMarker({ ac, pose, selected, ring, onSelect, smooth }: {
  ac: Aircraft; pose: Pose; selected: boolean; ring: "removed" | "added" | null; onSelect: () => void; smooth: boolean;
}) {
  const g = useRef<Group>(null);
  const init = useRef(false);
  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;
    if (!init.current || !smooth) { o.position.set(...pose.pos); o.rotation.y = pose.heading; init.current = true; return; }
    o.position.x = MathUtils.damp(o.position.x, pose.pos[0], 6, dt);
    o.position.y = MathUtils.damp(o.position.y, pose.pos[1], 6, dt);
    o.position.z = MathUtils.damp(o.position.z, pose.pos[2], 6, dt);
    o.rotation.y = MathUtils.damp(o.rotation.y, pose.heading, 8, dt);
  });
  const color = !ac.record_valid ? "#5b6b82" : pose.flying ? "#39D9FF" : STATUS_COLOR[ac.status];
  return (
    <group ref={g} onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
      <mesh rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.2, 0.62, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={pose.flying || selected ? 0.8 : 0.25} />
      </mesh>
      {(selected || ring) && (
        <mesh rotation-x={-Math.PI / 2} position-y={-0.1}>
          <ringGeometry args={[0.42, 0.52, 28]} />
          <meshBasicMaterial color={ring === "removed" ? "#FF5D72" : ring === "added" ? "#45E5AE" : "#EDF5FF"} transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  );
}
