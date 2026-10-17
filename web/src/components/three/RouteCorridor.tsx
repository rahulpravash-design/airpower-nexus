import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Corridor } from "../../types/api";
import { corridorPoints } from "../../lib/theatre";

export type RouteKind = "all" | "assigned" | "new" | "old";
const STYLE: Record<RouteKind, { color: string; opacity: number; width: number; dashed: boolean }> = {
  all: { color: "#2a4468", opacity: 0.4, width: 1, dashed: false },
  assigned: { color: "#4385FF", opacity: 0.9, width: 2, dashed: false },
  new: { color: "#FFBD59", opacity: 1, width: 2.5, dashed: true },
  old: { color: "#8DA1BB", opacity: 0.5, width: 1.5, dashed: true },
};

export function RouteCorridor({ corridor, kind, animate }: { corridor: Corridor; kind: RouteKind; animate: boolean }) {
  const s = STYLE[kind];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  useFrame((_, dt) => {
    if (animate && kind === "new" && ref.current?.material) ref.current.material.dashOffset -= dt * 1.2;
  });
  return (
    <Line ref={ref} points={corridorPoints(corridor, kind === "all" ? 0.12 : 0.45)} color={s.color} lineWidth={s.width}
      transparent opacity={s.opacity} dashed={s.dashed} dashSize={0.5} gapSize={0.35} />
  );
}
