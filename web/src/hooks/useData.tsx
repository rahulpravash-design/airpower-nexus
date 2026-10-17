import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "../components/ui/Toast";
import { api, ApiError, describeError } from "../services/api";
import { loadCache, saveCache } from "../services/cache";
import { connectStream, type StreamMessage, type WsState } from "../services/ws";
import type {
  ConfigResponse, EventRequest, FusionReport, Health, Plan, PlanState, PlanningConfig, ProposalResponse, Scenario,
} from "../types/api";

export type Selection = { kind: "base" | "aircraft" | "mission" | "crew"; id: string } | null;
export type Source = "live" | "cached" | "none";
export type ViewMode = "approved" | "proposed";

interface DataCtx {
  loading: boolean; error: string | null; source: Source; cachedAt: number | null;
  scenario: Scenario | null; planState: PlanState | null; configResp: ConfigResponse | null;
  fusion: FusionReport | null; health: Health | null; ws: WsState; busy: string | null;
  benchProgress: { done: number; total: number; message: string } | null;
  selection: Selection; select: (s: Selection) => void;
  viewMode: ViewMode; setViewMode: (m: ViewMode) => void;
  /** scenario/plan shown to the user (the proposal while one is pending and selected, else the approved plan) */
  viewScenario: Scenario | null; viewPlan: Plan | null; approved: Plan | null; proposed: Plan | null;
  refresh: (silent?: boolean) => Promise<void>;
  createBaseline: () => Promise<Plan | null>;
  replan: (method?: "CP_SAT" | "GREEDY") => Promise<Plan | null>;
  submitEvent: (ev: EventRequest) => Promise<ProposalResponse | null>;
  approve: (id: string) => Promise<boolean>; reject: (id: string) => Promise<boolean>;
  updateConfig: (patch: Partial<PlanningConfig>) => Promise<ConfigResponse | null>;
  resetScenario: () => Promise<void>; generateScenario: (seed: number) => Promise<void>;
}

const Ctx = createContext<DataCtx | null>(null);
export function useData(): DataCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData must be used inside <DataProvider>");
  return c;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [planState, setPlanState] = useState<PlanState | null>(null);
  const [configResp, setConfigResp] = useState<ConfigResponse | null>(null);
  const [fusion, setFusion] = useState<FusionReport | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("none");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [ws, setWs] = useState<WsState>("connecting");
  const [busy, setBusy] = useState<string | null>(null);
  const [benchProgress, setBenchProgress] = useState<DataCtx["benchProgress"]>(null);
  const [selection, select] = useState<Selection>(null);
  const [viewModeRaw, setViewMode] = useState<ViewMode>("proposed");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [h, s, p, c, f] = await Promise.all([api.health(), api.scenario(), api.planState(), api.config(), api.fusion()]);
      setHealth(h); setScenario(s); setPlanState(p); setConfigResp(c); setFusion(f);
      setSource("live"); setError(null); setCachedAt(null);
      saveCache({ at: Date.now(), scenario: s, planState: p, config: c, fusion: f });
    } catch (e) {
      setHealth(null);
      if (e instanceof ApiError && e.isNetwork) {
        const cache = loadCache();
        if (cache) {
          setScenario(cache.scenario as Scenario); setPlanState(cache.planState as PlanState);
          setConfigResp(cache.config as ConfigResponse); setFusion(cache.fusion as FusionReport);
          setSource("cached"); setCachedAt(cache.at);
        } else setSource("none");
      }
      setError(describeError(e));
    } finally { setLoading(false); }
  }, []);

  const debounced = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(true), 200);
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onMsg = (m: StreamMessage) => {
      switch (m.type) {
        case "plan_proposed": case "plan_approved": case "plan_rejected": case "scenario_reset": case "config_updated":
          setBusy(null); debounced(); break;
        case "solver_started": setBusy(`Solving ${(m.event as string) ?? "plan"} with CP-SAT…`); break;
        case "benchmark_progress":
          setBenchProgress({ done: m.done as number, total: m.total as number, message: m.message as string }); break;
        case "benchmark_finished": setBenchProgress(null); break;
        default: break;
      }
    };
    return connectStream(onMsg, (s) => { setWs(s); if (s === "open") debounced(); });
  }, [debounced]);

  // Never keep presenting data as LIVE after the backend has gone away:
  //  * while live, probe /health every 8 s and fall back to the cached view (labelled CACHED) on failure
  //  * while not live, retry a full refresh every 5 s so the UI recovers by itself
  useEffect(() => {
    const t = setInterval(() => {
      if (source === "live") void api.health().catch(() => void refresh(true));
      else void refresh(true);
    }, source === "live" ? 8000 : 5000);
    return () => clearInterval(t);
  }, [source, refresh]);
  // A dropped WebSocket is an early warning: verify immediately instead of waiting for the next probe.
  useEffect(() => {
    if (ws !== "closed") return;
    const t = setTimeout(() => void api.health().catch(() => void refresh(true)), 500);
    return () => clearTimeout(t);
  }, [ws, refresh]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, okTitle?: (r: T) => string): Promise<T | null> => {
    setBusy(label);
    try {
      const r = await fn();
      await refresh(true);
      if (okTitle) toast.push({ tone: "ok", title: okTitle(r) });
      return r;
    } catch (e) {
      toast.push({ tone: "bad", title: "Request failed", body: describeError(e) });
      return null;
    } finally { setBusy(null); }
  }, [refresh, toast]);

  const approved = planState?.approved ?? null;
  const proposed = planState?.proposed ?? null;
  const viewMode: ViewMode = proposed ? viewModeRaw : "approved";
  const viewPlan = viewMode === "proposed" && proposed ? proposed : approved;
  const viewScenario = viewMode === "proposed" && proposed && planState?.proposed_scenario ? planState.proposed_scenario : scenario;

  const value: DataCtx = useMemo(() => ({
    loading, error, source, cachedAt, scenario, planState, configResp, fusion, health, ws, busy, benchProgress,
    selection, select, viewMode, setViewMode, viewScenario, viewPlan, approved, proposed, refresh,
    createBaseline: () => run("Solving baseline plan with CP-SAT…", () => api.createPlan({ auto_approve: true }),
      (p) => `Baseline plan ${p.id} approved (${p.solver_status}, ${p.solve_time_s.toFixed(1)} s)`),
    replan: (method = "CP_SAT") => run(`Re-optimising (${method})…`, () => api.createPlan({ method }),
      (p) => `Proposal ${p.id} ready: ${p.diff?.changed_mission_count ?? 0} mission(s) changed`),
    submitEvent: (ev) => run("Solving event with CP-SAT…", () => api.submitEvent(ev),
      (r) => `Proposal ${r.plan.id}: ${r.plan.solver_status} in ${r.plan.solve_time_s.toFixed(1)} s`),
    approve: async (id) => (await run("Approving…", () => api.approve(id), (p) => `Plan ${p.id} approved by the backend`)) !== null,
    reject: async (id) => (await run("Rejecting…", () => api.reject(id), (p) => `Plan ${p.id} rejected; previous plan stays active`)) !== null,
    updateConfig: (patch) => run("Applying configuration and re-planning…", () => api.updateConfig(patch),
      (r) => (r.proposal ? `Configuration proposal ${r.proposal.plan.id} calculated` : "Configuration applied")),
    resetScenario: async () => { await run("Resetting scenario…", () => api.resetScenario(), () => "Scenario reset to seed 26250"); select(null); },
    generateScenario: async (seed) => { await run("Generating scenario…", () => api.generateScenario(seed), () => `Scenario generated with seed ${seed}`); select(null); },
  }), [loading, error, source, cachedAt, scenario, planState, configResp, fusion, health, ws, busy, benchProgress, selection,
       viewMode, viewScenario, viewPlan, approved, proposed, refresh, run]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
