import { Line } from "@react-three/drei";

export function GroundGrid() {
  const w = 20, h = 15; // theatre half-extent in scene units (400 x 300 km)
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}><planeGeometry args={[70, 56]} /><meshStandardMaterial color="#070e1c" roughness={1} /></mesh>
      <gridHelper args={[60, 60, "#1c3354", "#0f2038"]} position-y={0} />
      <Line points={[[-w, 0.02, -h], [w, 0.02, -h], [w, 0.02, h], [-w, 0.02, h], [-w, 0.02, -h]]} color="#39D9FF" lineWidth={1} transparent opacity={0.35} />
    </group>
  );
}
