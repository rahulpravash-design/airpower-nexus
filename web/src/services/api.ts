// The ONLY place that talks to the network. Components call these typed functions (never fetch directly).
import type {
  BenchmarkPayload, ConfigResponse, Diagnostics, EventRequest, EventType, FusionReport, Health, Plan, PlanDiff,
  PlanState, PlanningConfig, ProposalResponse, Scenario,
} from "../types/api";

export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() { return this.status === 0; }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new ApiError(0, "NETWORK", "Backend unreachable. Is the AIR POWER API running?", String(e));
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<Health>("/health"),
  scenario: () => request<Scenario>("/scenario"),
  resetScenario: () => post<Scenario>("/scenario/reset"),
  generateScenario: (seed: number) => post<Scenario>("/scenario/generate", { seed }),
  planState: () => request<PlanState>("/plan/current"),
  createPlan: (opts: { method?: "CP_SAT" | "GREEDY"; time_limit_s?: number; auto_approve?: boolean } = {}) =>
    post<Plan>("/plan", opts),
  plan: (id: string) => request<Plan>(`/plan/${id}`),
  planDiff: (id: string, against?: string) =>
    request<PlanDiff>(`/plan/${id}/diff${against ? `?against=${encodeURIComponent(against)}` : ""}`),
  approve: (id: string, note?: string) => post<Plan>(`/plan/${id}/approve`, { note }),
  reject: (id: string, note?: string) => post<Plan>(`/plan/${id}/reject`, { note }),
  submitEvent: (ev: EventRequest) => post<ProposalResponse>("/event", ev),
  suggestEvent: (kind: EventType) => request<EventRequest>(`/event/suggest/${kind}`),
  config: () => request<ConfigResponse>("/config"),
  updateConfig: (patch: Partial<PlanningConfig>) =>
    request<ConfigResponse>("/config", { method: "PUT", body: JSON.stringify(patch) }),
  fusion: () => request<FusionReport>("/fusion"),
  benchmarks: () => request<BenchmarkPayload>("/benchmarks", { headers: { Accept: "application/json" } }),
  runBenchmarks: (p: { instances: number; time_limit_s: number; churn_instances: number }) =>
    post<BenchmarkPayload>("/benchmarks/run", p),
  benchmarkCsvUrl: (kind: "instances" | "churn") => `${API_BASE}/benchmarks/csv?kind=${kind}`,
  diagnostics: () => request<Diagnostics>("/diagnostics"),
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const d = Array.isArray(e.details)
      ? " — " + (e.details as { field?: string; message?: string }[]).slice(0, 3).map((x) => `${x.field ?? ""} ${x.message ?? ""}`.trim()).join("; ")
      : "";
    return `${e.message}${d}`;
  }
  return e instanceof Error ? e.message : String(e);
}
