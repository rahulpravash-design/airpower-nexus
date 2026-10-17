import type { Aircraft, Assignment, Plan, PlanDiff, Scenario } from "../types/api";

export interface PlanIndex {
  byMission: Map<string, Assignment>;
  byAircraft: Map<string, Assignment[]>;
  byCrew: Map<string, Assignment[]>;
  baseCount: Map<string, number>;
  stockUsed: Map<string, number>; // `${base}|${loadout}`
}

export function indexPlan(plan: Plan | null | undefined): PlanIndex {
  const ix: PlanIndex = { byMission: new Map(), byAircraft: new Map(), byCrew: new Map(), baseCount: new Map(), stockUsed: new Map() };
  if (!plan) return ix;
  for (const a of plan.assignments) {
    ix.byMission.set(a.mission_id, a);
    if (!a.covered) continue;
    for (const id of a.aircraft_ids) ix.byAircraft.set(id, [...(ix.byAircraft.get(id) ?? []), a]);
    for (const id of a.crew_ids) ix.byCrew.set(id, [...(ix.byCrew.get(id) ?? []), a]);
    if (a.base_id) {
      ix.baseCount.set(a.base_id, (ix.baseCount.get(a.base_id) ?? 0) + 1);
      const k = `${a.base_id}|${a.loadout}`;
      ix.stockUsed.set(k, (ix.stockUsed.get(k) ?? 0) + a.aircraft_ids.length);
    }
  }
  for (const list of ix.byAircraft.values()) list.sort((x, y) => (x.start_slot ?? 0) - (y.start_slot ?? 0));
  for (const list of ix.byCrew.values()) list.sort((x, y) => (x.start_slot ?? 0) - (y.start_slot ?? 0));
  return ix;
}

export type ChangeKind = "changed" | "added" | "newly_covered" | "newly_uncovered" | "unchanged" | "none";

/** Change status of a mission, derived ONLY from the backend diff (never recomputed in the UI). */
export function changeStatus(diff: PlanDiff | null | undefined, id: string): ChangeKind {
  if (!diff) return "none";
  if (diff.newly_uncovered.includes(id)) return "newly_uncovered";
  if (diff.added_missions.includes(id)) return "added";
  if (diff.newly_covered.includes(id)) return "newly_covered";
  if (diff.changed_missions.includes(id)) return "changed";
  if (diff.unchanged_missions.includes(id)) return "unchanged";
  return "none";
}

/** Aircraft IDs removed from / added to missions according to the diff's field changes. */
export function aircraftSwaps(diff: PlanDiff | null | undefined) {
  const removed = new Set<string>(), added = new Set<string>();
  for (const c of diff?.field_changes ?? []) {
    if (c.field !== "aircraft_ids") continue;
    const o = (c.old as string[]) ?? [], n = (c.new as string[]) ?? [];
    o.filter((x) => !n.includes(x)).forEach((x) => removed.add(x));
    n.filter((x) => !o.includes(x)).forEach((x) => added.add(x));
  }
  return { removed, added };
}

export const baseName = (s: Scenario, id: string | null) => s.bases.find((b) => b.id === id)?.name ?? id ?? "—";
export function aircraftAvailable(a: Aircraft) { return a.record_valid && a.status !== "UNAVAILABLE"; }
