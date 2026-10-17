import type { Base } from "../../types/api";
import { toScene } from "../../lib/theatre";

export function WeatherOverlay({ base }: { base: Base }) {
  const [x, , z] = toScene(base.x, base.y);
  return (
    <group position={[x, 0, z]}>
      <mesh position-y={1.1}><cylinderGeometry args={[3.6, 3.6, 2.2, 36, 1, true]} /><meshStandardMaterial color="#7e93ad" transparent opacity={0.16} side={2} depthWrite={false} /></mesh>
      <mesh position-y={2.2}><circleGeometry args={[3.6, 36]} /><meshBasicMaterial color="#9fb4cc" transparent opacity={0.1} side={2} depthWrite={false} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}><ringGeometry args={[3.5, 3.65, 48]} /><meshBasicMaterial color="#FFBD59" transparent opacity={0.7} /></mesh>
    </group>
  );
}
