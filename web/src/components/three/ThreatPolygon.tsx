import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Shape, type MeshStandardMaterial } from "three";
import type { Threat } from "../../types/api";
import { CX, CY, KM, toScene } from "../../lib/theatre";

export function ThreatPolygon({ threat, active, animate }: { threat: Threat; active: boolean; animate: boolean }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const shape = useMemo(() => {
    const s = new Shape();
    threat.polygon.forEach(([x, y], i) => { const px = (x - CX) * KM, py = (y - CY) * KM; i ? s.lineTo(px, py) : s.moveTo(px, py); });
    s.closePath();
    return s;
  }, [threat.polygon]);
  const outline = useMemo(() => [...threat.polygon, threat.polygon[0]].map(([x, y]) => toScene(x, y, 0.06)), [threat.polygon]);
  const base = threat.blocking ? 0.34 : 0.2;
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = active ? base * (animate ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 2.2) : 1) : 0.05;
  });
  const color = threat.blocking ? "#FF5D72" : "#FF8F5D";
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2}>
        <extrudeGeometry args={[shape, { depth: active ? 0.9 : 0.05, bevelEnabled: false }]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.35} transparent opacity={base} depthWrite={false} />
      </mesh>
      <Line points={outline} color={color} lineWidth={active ? 2 : 1} transparent opacity={active ? 0.95 : 0.35} dashed={!active} dashSize={0.4} gapSize={0.3} />
    </group>
  );
}
