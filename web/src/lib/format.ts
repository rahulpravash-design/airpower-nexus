export const SLOT_MIN = 15;
export const HORIZON = 48;

export function fmtSlot(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const m = s * SLOT_MIN;
  return `T+${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export const fmtDur = (slots: number) => `${(slots * SLOT_MIN) / 60}h`;
export const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d)}%`);
export const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "—" : x.toFixed(d));

export const PRIORITY_COLOR: Record<number, string> = { 1: "#FF5D72", 2: "#FFBD59", 3: "#4385FF" };
export const REASON_LABEL: Record<string, string> = {
  AIRCRAFT_UNAVAILABLE: "Aircraft unavailable", BASE_WEATHER_CLOSURE: "Base weather closure",
  CREW_REST_CONSTRAINT: "Crew rest constraint", HIGHER_PRIORITY_MISSION: "Higher-priority mission",
  CORRIDOR_RISK_INCREASE: "Corridor risk increase", CORRIDOR_BLOCKED: "Corridor blocked",
  LOADOUT_STOCK_LIMIT: "Load-out stock limit", LOW_TRUST_INPUT: "Low-trust input", RESOURCE_SHORTAGE: "Resource shortage",
  FREEZE_OVERRIDE_INVALIDATED: "Frozen assignment invalidated", OBJECTIVE_REOPTIMIZATION: "Objective re-optimisation",
  NEW_MISSION_ADDED: "New mission added", CONFIG_CHANGED: "Configuration changed",
  RUNWAY_WINDOW_CLOSED: "Runway window closed", CREW_DUTY_LIMIT_CONSTRAINT: "Crew duty limit",
  ASSET_UNAVAILABLE: "Asset unavailable",
};
export const FIELD_LABEL: Record<string, string> = {
  covered: "Coverage", aircraft_ids: "Aircraft", crew_ids: "Crew", base_id: "Base", corridor_id: "Corridor",
  start_slot: "Launch", loadout: "Load-out",
};
export function fmtFieldValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (field === "start_slot") return fmtSlot(v as number);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "covered" : "uncovered";
  return String(v);
}
