import type { Aircraft, Assignment, Corridor, Mission, Scenario } from "../types/api";

export const KM = 0.1;          // 1 scene unit = 10 km
export const CX = 200, CY = 150; // theatre centre (km)
export type Vec3 = [number, number, number];

export const toScene = (x: number, y: number, h = 0): Vec3 => [(x - CX) * KM, h, -(y - CY) * KM];

export function corridorPoints(c: Corridor, h = 0.45): Vec3[] {
  return c.waypoints.map(([x, y]) => toScene(x, y, h));
}

/** Mission nodes sit around their area, golden-angle spiral so positions are stable and non-overlapping. */
export function missionPosition(s: Scenario, m: Mission): Vec3 {
  const area = s.areas.find((a) => a.id === m.area_id);
  if (!area) return [0, 0.4, 0];
  const same = s.missions.filter((x) => x.area_id === m.area_id);
  const i = same.findIndex((x) => x.id === m.id);
  const ang = i * 2.399963, r = 0.8 + 0.5 * Math.sqrt(i);
  const [x, , z] = toScene(area.x, area.y);
  return [x + Math.cos(ang) * r, 0.45, z + Math.sin(ang) * r];
}

function lengths(pts: Vec3[]) {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    seg.push(d); total += d;
  }
  return { seg, total };
}

/** Position + heading at fraction s (0..1) of a polyline. */
export function pointAlong(pts: Vec3[], s: number): { p: Vec3; heading: number } {
  const { seg, total } = lengths(pts);
  let d = Math.max(0, Math.min(1, s)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] === 0 ? 0 : Math.min(1, d / seg[i]);
      const a = pts[i], b = pts[i + 1];
      return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
    }
    d -= seg[i];
  }
  return { p: pts[0], heading: 0 };
}

export interface Pose { pos: Vec3; heading: number; flying: boolean; missionId: string | null }

/** Where an aircraft is at slot `t`, derived only from the plan's assignment (parked at its base otherwise). */
export function aircraftPose(
  s: Scenario, ac: Aircraft, mine: Assignment[], corridors: Map<string, Corridor>, t: number, parkIndex: number,
): Pose {
  const base = s.bases.find((b) => b.id === ac.home_base)!;
  for (const a of mine) {
    if (a.start_slot === null || a.end_slot === null || t < a.start_slot || t > a.end_slot) continue;
    const cor = a.corridor_id ? corridors.get(a.corridor_id) : undefined;
    if (!cor) continue;
    const pts = corridorPoints(cor, 0.5);
    const u = (t - a.start_slot) / Math.max(1, a.end_slot - a.start_slot);
    const out = u < 0.5;
    const { p, heading } = pointAlong(pts, out ? u * 2 : 2 - u * 2);
    const lane = a.aircraft_ids.indexOf(ac.id) * 0.35;
    return { pos: [p[0] + lane, p[1] + 0.25 * Math.sin(Math.PI * u), p[2]], heading: out ? heading : heading + Math.PI, flying: true, missionId: a.mission_id };
  }
  const [bx, , bz] = toScene(base.x, base.y);
  const ang = (parkIndex / 8) * Math.PI * 2;
  return { pos: [bx + Math.cos(ang) * 1.8, 0.2, bz + Math.sin(ang) * 1.8], heading: ang, flying: false, missionId: null };
}

export const isThreatActive = (t: { start_slot: number; end_slot: number }, slot: number) => slot >= t.start_slot && slot <= t.end_slot;
export const isClosed = (c: { start_slot: number; end_slot: number }, slot: number) => slot >= c.start_slot && slot < c.end_slot;

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
