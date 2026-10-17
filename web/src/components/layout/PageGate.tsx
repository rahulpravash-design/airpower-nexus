import { Plane } from "lucide-react";
import type { ReactNode } from "react";
import { useData } from "../../hooks/useData";
import { EmptyState, Skeleton } from "../ui/primitives";

/** Renders children only when a scenario exists; otherwise a consistent loading / error state. */
export function PageGate({ children, needPlan = false }: { children: ReactNode; needPlan?: boolean }) {
  const { loading, scenario, viewPlan, createBaseline, busy, source, error } = useData();
  if (loading && !scenario)
    return <div className="grid gap-3 md:grid-cols-4" aria-busy><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-72 md:col-span-4" /></div>;
  if (!scenario)
    return <EmptyState icon={<Plane className="h-8 w-8" />} title="Backend not reachable" body={error ?? "Start the API with `uvicorn airops.api.main:app` and reload."} />;
  if (needPlan && !viewPlan)
    return (
      <EmptyState icon={<Plane className="h-8 w-8" />} title="No plan yet"
        body={`The ${scenario.name} scenario is loaded (${scenario.missions.length} missions). Run CP-SAT to create the baseline plan.${source === "cached" ? " (Backend offline: cached view.)" : ""}`}
        action={<button className="btn btn-primary" disabled={!!busy || source !== "live"} onClick={() => void createBaseline()}>Generate baseline plan</button>} />
    );
  return <>{children}</>;
}
