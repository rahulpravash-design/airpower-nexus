import { describe, expect, it } from "vitest";
import { fmtFieldValue, fmtSlot, pct } from "../lib/format";
import { aircraftSwaps, changeStatus, indexPlan } from "../lib/plan";
import { aircraftPose, isClosed, isThreatActive, pointAlong, toScene, type Vec3 } from "../lib/theatre";
import type { Aircraft, Assignment, Corridor, Plan, PlanDiff, Scenario } from "../types/api";

const asg = (o: Partial<Assignment>): Assignment => ({ mission_id: "M-1", covered: true, aircraft_ids: ["AC-1"], crew_ids: ["CR-1"], base_id: "BASE-A",
  corridor_id: "C-1", start_slot: 4, end_slot: 12, loadout: "A", risk: 0.3, lock: null, ...o });
const diff = (o: Partial<PlanDiff>): PlanDiff => ({ old_plan_id: "a", new_plan_id: "b", changed_missions: [], unchanged_missions: [], added_missions: [],
  newly_covered: [], newly_uncovered: [], changed_aircraft: [], changed_crew: [], changed_base: [], changed_corridor: [], changed_timing: [],
  changed_loadout: [], field_changes: [], changed_mission_count: 0, changed_field_count: 0, ...o });

describe("format", () => {
  it("formats slots as T+HH:MM", () => { expect(fmtSlot(0)).toBe("T+00:00"); expect(fmtSlot(5)).toBe("T+01:15"); expect(fmtSlot(null)).toBe("—"); });
  it("formats values", () => { expect(pct(0.256, 1)).toBe("25.6%"); expect(fmtFieldValue("start_slot", 8)).toBe("T+02:00"); expect(fmtFieldValue("aircraft_ids", ["A", "B"])).toBe("A, B"); });
});

describe("plan helpers (change status comes only from the backend diff)", () => {
  it("indexes a plan", () => {
    const ix = indexPlan({ assignments: [asg({}), asg({ mission_id: "M-2", aircraft_ids: ["AC-1", "AC-2"], start_slot: 20, end_slot: 28 })] } as Plan);
    expect(ix.byAircraft.get("AC-1")?.map((a) => a.mission_id)).toEqual(["M-1", "M-2"]);
    expect(ix.baseCount.get("BASE-A")).toBe(2);
    expect(ix.stockUsed.get("BASE-A|A")).toBe(3);
  });
  it("derives change status from the diff", () => {
    const d = diff({ changed_missions: ["M-1"], unchanged_missions: ["M-2"], added_missions: ["M-9"], newly_covered: ["M-9"], newly_uncovered: ["M-3"] });
    expect(changeStatus(d, "M-1")).toBe("changed"); expect(changeStatus(d, "M-2")).toBe("unchanged");
    expect(changeStatus(d, "M-9")).toBe("added"); expect(changeStatus(d, "M-3")).toBe("newly_uncovered");
    expect(changeStatus(null, "M-1")).toBe("none");
  });
  it("finds swapped aircraft only from field changes", () => {
    const sw = aircraftSwaps(diff({ field_changes: [{ mission_id: "M-1", field: "aircraft_ids", old: ["AC-1"], new: ["AC-2"] }, { mission_id: "M-1", field: "start_slot", old: 1, new: 2 }] }));
    expect([...sw.removed]).toEqual(["AC-1"]); expect([...sw.added]).toEqual(["AC-2"]);
  });
});

describe("theatre geometry", () => {
  const pts: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
  it("interpolates along a polyline", () => {
    expect(pointAlong(pts, 0).p).toEqual([0, 0, 0]);
    expect(pointAlong(pts, 0.5).p).toEqual([10, 0, 0]);
    expect(pointAlong(pts, 1).p).toEqual([10, 0, 10]);
  });
  it("maps km to scene units with north on -z", () => { expect(toScene(200, 150)).toEqual([0, 0, -0]); expect(toScene(300, 250)[2]).toBeLessThan(0); });
  it("time windows", () => { expect(isThreatActive({ start_slot: 8, end_slot: 30 }, 8)).toBe(true); expect(isClosed({ start_slot: 30, end_slot: 34 }, 34)).toBe(false); });
  it("parks idle aircraft at their base and flies assigned ones along the corridor", () => {
    const s = { bases: [{ id: "BASE-A", x: 60, y: 70 }] } as unknown as Scenario;
    const ac = { id: "AC-1", home_base: "BASE-A" } as Aircraft;
    const cor = { id: "C-1", waypoints: [[60, 70], [100, 100], [150, 150]] } as unknown as Corridor;
    const parked = aircraftPose(s, ac, [asg({})], new Map([["C-1", cor]]), 0, 0);
    expect(parked.flying).toBe(false);
    const flying = aircraftPose(s, ac, [asg({})], new Map([["C-1", cor]]), 8, 0);
    expect(flying.flying).toBe(true); expect(flying.missionId).toBe("M-1");
    const back = aircraftPose(s, ac, [asg({})], new Map([["C-1", cor]]), 12, 0);
    expect(back.pos[0]).toBeCloseTo(toScene(60, 70)[0], 1); // returned to the base end of the corridor
  });
});
