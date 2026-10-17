import { OrbitControls } from "@react-three/drei";
import { invalidate, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ElementRef } from "react";
import { Vector3 } from "three";

export interface CameraFocus { target: [number, number, number]; distance: number; nonce: number }
export const HOME_DIR = new Vector3(0, 0.68, 0.73).normalize();

export function TheatreCamera({ focus, reduced }: { focus: CameraFocus | null; reduced: boolean }) {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const anim = useRef<{ fp: Vector3; ft: Vector3; tp: Vector3; tt: Vector3; t: number } | null>(null);

  useEffect(() => {
    const c = controls.current;
    if (!focus || !c) return;
    const tgt = new Vector3(...focus.target);
    const dir = focus.distance > 34 ? HOME_DIR.clone() : camera.position.clone().sub(c.target).normalize();
    const to = tgt.clone().add(dir.multiplyScalar(focus.distance));
    anim.current = { fp: camera.position.clone(), ft: c.target.clone(), tp: to, tt: tgt, t: reduced ? 1 : 0 };
    invalidate();
  }, [focus, camera, reduced]);

  useFrame((_, dt) => {
    const a = anim.current, c = controls.current;
    if (!a || !c) return;
    a.t = Math.min(1, a.t + dt / 0.9);
    const k = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.fp, a.tp, k);
    c.target.lerpVectors(a.ft, a.tt, k);
    c.update();
    if (a.t >= 1) anim.current = null;
    else if (reduced) invalidate();
  });

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.05} minDistance={6} maxDistance={90} />;
}
