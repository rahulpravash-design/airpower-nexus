// TypeScript mirror of airops.core.entities / airops.api.schemas (single source of truth for the UI).
export interface RecordBase {
  id: string; source: string; last_update: string; trust: number;
  record_valid: boolean; issues: string[]; stale: boolean; conflict: boolean;
}
export interface Closure { start_slot: number; end_slot: number; reason: string }
export interface Base extends RecordBase {
  name: string; x: number; y: number; runway_windows: [number, number][];
  weather_closures: Closure[]; loadout_stock: Record<string, number>;
}
export interface Area extends RecordBase { name: string; x: number; y: number }
export type AircraftStatus = "AVAILABLE" | "MAINTENANCE" | "UNAVAILABLE";
export interface Aircraft extends RecordBase {
  role: string; home_base: string; status: AircraftStatus; available_from_slot: number;
  unavailable_from_slot: number | null; age_years: number; flight_hours_since_service: number;
  days_since_maintenance: number; fault_reports_30d: number; sensor_anomaly: number;
  predicted_serviceability: number | null;
  reports: { source: string; status: string; last_update: string }[];
}
export interface Crew extends RecordBase {
  name: string; home_base: string; qualified_roles: string[]; prior_duty_end_slot: number | null;
  duty_hours_last_24h: number; hours_since_rest: number; fatigue_risk: number | null;
}
export interface Mission extends RecordBase {
  priority: 1 | 2 | 3; role: string; area_id: string; package_size: number; earliest_start: number;
  latest_start: number; duration_slots: number; loadouts: string[]; created_by_event: string | null;
}
export interface Corridor extends RecordBase {
  name: string; base_id: string; area_id: string; waypoints: [number, number][]; base_risk: number;
}
export interface Threat extends RecordBase {
  name: string; polygon: [number, number][]; start_slot: number; end_slot: number; severity: number; blocking: boolean;
}
export interface ModelInfo {
  name: string; version: string; kind: string; trained_on: string; n_train: number; n_test: number;
  metrics: Record<string, number>; disclaimer: string;
}
export interface Scenario {
  name: string; seed: number; version: number; reference_time: string; slot_minutes: number;
  horizon_slots: number; bases: Base[]; areas: Area[]; aircraft: Aircraft[]; crew: Crew[];
  missions: Mission[]; corridors: Corridor[]; threats: Threat[]; model_info: ModelInfo | null;
  event_log: { type: string; now_slot: number; summary: string }[]; synthetic: boolean;
}

export interface Assignment {
  mission_id: string; covered: boolean; aircraft_ids: string[]; crew_ids: string[]; base_id: string | null;
  corridor_id: string | null; start_slot: number | null; end_slot: number | null; loadout: string | null;
  risk: number; lock: "IN_PROGRESS" | "FREEZE_WINDOW" | null;
}
export interface Violation { code: string; message: string; mission_id: string | null; resource_id: string | null }
export interface RuleResult { rule: string; description: string; passed: boolean; violations: number }
export interface ValidationReport { valid: boolean; violations: Violation[]; rules: RuleResult[]; validator: string }
export interface ReasonCode { code: string; message: string; mission_id: string | null; evidence: Record<string, unknown> }
export interface FieldChange { mission_id: string; field: string; old: unknown; new: unknown }
export interface PlanDiff {
  old_plan_id: string | null; new_plan_id: string; changed_missions: string[]; unchanged_missions: string[];
  added_missions: string[]; newly_covered: string[]; newly_uncovered: string[]; changed_aircraft: string[];
  changed_crew: string[]; changed_base: string[]; changed_corridor: string[]; changed_timing: string[];
  changed_loadout: string[]; field_changes: FieldChange[]; changed_mission_count: number; changed_field_count: number;
}
export interface PlanMetrics {
  total_missions: number; covered: number; uncovered: number; priority_weighted_coverage: number;
  max_priority_weighted_coverage: number; risk_penalty: number; total_risk: number; available_aircraft: number;
  assigned_aircraft: number; assigned_crew: number; changed_missions: number | null; unchanged_missions: number | null;
  low_trust_assignments: number; mean_serviceability: number | null;
}
export type PlanStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "INVALID";
export interface Plan {
  id: string; scenario_version: number; seed: number; method: "CP_SAT" | "GREEDY" | "GREEDY_FALLBACK";
  solver_status: string; solve_time_s: number; objective: number | null; best_bound: number | null;
  objective_breakdown: Record<string, number>; created_at: string; status: PlanStatus; trigger: string;
  parent_plan_id: string | null; assignments: Assignment[]; metrics: PlanMetrics; validation: ValidationReport;
  diff: PlanDiff | null; reasons: ReasonCode[]; event: Record<string, unknown> | null;
  config_snapshot: Record<string, unknown>; frozen_mission_ids: string[];
  invalidated_frozen: { mission_id: string; lock: string; violations: { code: string; message: string }[] }[];
  notes: string[]; decision_note: string | null;
}

export interface PlanningConfig {
  crew_rest_hours: number; duty_limit_hours: number; turnaround_minutes: number; crew_turnaround_minutes: number;
  freeze_window_minutes: number; default_event_slot: number; solver_time_limit_s: number; solver_workers: number;
  solver_seed: number; priority_weights: Record<string, number>; risk_weight: number; change_penalty: number;
  low_trust_weight: number; serviceability_weight: number; fatigue_weight: number; trust_threshold: number;
  fresh_minutes: number; stale_minutes: number;
}
export interface ProposalResponse { plan: Plan; proposed_scenario: Scenario }
export interface ConfigResponse {
  active: PlanningConfig; pending: PlanningConfig | null; defaults: PlanningConfig; proposal: ProposalResponse | null;
}
export interface PlanState {
  approved: Plan | null; proposed: Plan | null; proposed_scenario: Scenario | null;
  pending_config: PlanningConfig | null; scenario_version: number; history: Record<string, unknown>[];
}
export interface Health { status: "ok"; service: string; version: string; solver: string; time: string; uptime_s: number }

export interface SourceSummary {
  source: string; reliability: number; records: number; fresh: number; stale: number; invalid: number;
  conflicts: number; mean_trust: number; newest_age_min: number; oldest_age_min: number;
}
export interface FlaggedRecord { record_id: string; kind: string; source: string; trust: number; age_min: number; problems: string[] }
export interface FusionReport {
  reference_time: string; total_records: number; fresh: number; stale: number; invalid: number; conflicts: number;
  mean_trust: number; trust_health: number; sources: SourceSummary[]; flagged: FlaggedRecord[]; formula: string; note: string;
}

export type EventRequest =
  | { type: "AIRCRAFT_UNAVAILABLE"; aircraft_id: string; now_slot?: number }
  | { type: "BASE_WEATHER"; base_id: string; duration_slots: number; now_slot?: number }
  | { type: "NEW_PRIORITY1_MISSION"; role: string; area_id: string; package_size: number; earliest_start?: number;
      window_slots: number; duration_slots: number; loadouts: string[]; now_slot?: number }
  | { type: "NEW_THREAT"; center_x: number; center_y: number; radius_km: number; severity: number; blocking: boolean;
      start_slot?: number; end_slot?: number; label?: string; now_slot?: number };
export type EventType = EventRequest["type"];

export interface BenchmarkPayload {
  status: "idle" | "running" | "done" | "error"; progress: { done: number; total: number; message: string };
  error: string | null; params: Record<string, unknown>; available: boolean;
  variant: string; variants: { id: string; label: string; time_limit_s: number | null; instances: number | null }[];
  summary: BenchmarkSummary | null; rows: Record<string, string>[]; churn: Record<string, string>[];
}
export interface MethodStats {
  instances: number; median_priority_weighted_coverage: number | null; mean_priority_weighted_coverage: number | null;
  median_missions_covered: number | null; median_missions_uncovered: number | null; median_risk_penalty: number | null;
  median_solve_time_s: number | null; max_solve_time_s: number | null; status_counts: Record<string, number>;
  all_hard_rules_valid: number; time_limit_reached: number; failures: number;
}
export interface BenchmarkSummary {
  meta: Record<string, unknown>; CP_SAT: MethodStats; GREEDY: MethodStats;
  paired_comparison: { instances: number; metric: string; median_difference: number | null; mean_difference: number | null;
    cp_sat_better: number; equal: number; cp_sat_worse: number };
  churn?: { instances: number; median_changed_missions_with_persistence: number | null;
    median_changed_missions_without_persistence: number | null; mean_changed_missions_with_persistence: number | null;
    mean_changed_missions_without_persistence: number | null; persistence_fewer_changes: number; equal: number;
    persistence_more_changes: number; all_valid: boolean };
  statements: string[];
}
export interface Diagnostics {
  health: Health; python: string; ortools: string; seed: number; scenario_version: number; ws_clients: number;
  approved_plan_id: string | null; pending_plan_id: string | null; plans_total: number;
  last_plan: { id: string; status: string; method: string; solver_status: string; solve_time_s: number; valid: boolean;
    violations: number; trigger: string } | null;
  model: ModelInfo | null; benchmark: { status: string; available: boolean };
  tests: { summary?: string; passed?: number; failed?: number; total?: number; at?: string } | null;
  offline: { external_requests: boolean; note: string };
}
