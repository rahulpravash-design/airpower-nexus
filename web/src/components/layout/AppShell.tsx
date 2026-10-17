import {
  Activity, Boxes, Database, FlaskConical, GanttChart, Globe2, LayoutDashboard, ListChecks, Menu, Settings, Shuffle, X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { useData } from "../../hooks/useData";
import { DataBadge } from "../ui/DataBadge";
import { Badge } from "../ui/primitives";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/theatre", label: "3D Theatre", icon: Globe2 },
  { to: "/missions", label: "Mission Planner", icon: ListChecks },
  { to: "/timeline", label: "Timeline", icon: GanttChart },
  { to: "/retasking", label: "Replanning", icon: Shuffle },
  { to: "/fusion", label: "Data Fusion", icon: Database },
  { to: "/benchmarks", label: "Benchmarks", icon: FlaskConical },
  { to: "/settings", label: "Configuration", icon: Settings },
  { to: "/diagnostics", label: "Diagnostics", icon: Activity },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { ws, busy, proposed, scenario, error, source } = useData();
  const loc = useLocation();
  const title = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)))?.label ?? "AIR POWER";
  const wsTone = ws === "open" ? "ok" : ws === "connecting" ? "warn" : "bad";
  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-[200] rounded bg-cyan px-3 py-1 text-bg">Skip to content</a>
      <aside className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r border-white/5 bg-bg2/95 p-3 transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-4 flex items-center justify-between px-1.5 pt-1">
          <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-cyan/15 text-cyan"><Boxes className="h-4 w-4" /></span>
            <span className="leading-tight"><span className="block text-sm font-semibold tracking-wide">AIR POWER</span><span className="block text-[10px] text-muted">SIH26250 · BLUELAND</span></span>
          </Link>
          <button className="md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${isActive ? "bg-cyan/10 text-cyan shadow-glow" : "text-muted hover:bg-white/5 hover:text-ink"}`}>
              <Icon className="h-4 w-4" aria-hidden />{label}
              {to === "/retasking" && proposed && <span className="ml-auto h-2 w-2 rounded-full bg-amber" aria-label="Proposal pending" />}
            </NavLink>
          ))}
        </nav>
        <p className="absolute inset-x-4 bottom-3 text-[10px] leading-snug text-muted">Every report verified. Every post stocked before the pass closes.<br />Synthetic, fictional data only.</p>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-bg/80 px-4 py-2.5 backdrop-blur-sm">
          <button className="btn px-2 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></button>
          <h1 className="text-base font-semibold">{title}</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {busy && <Badge tone="info"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />{busy}</Badge>}
            {proposed && <Link to="/retasking"><Badge tone="warn">Proposal {proposed.id} awaiting decision</Badge></Link>}
            {scenario && <Badge title="Scenario seed / version">seed {scenario.seed} · v{scenario.version}</Badge>}
            <Badge tone={wsTone} title="WebSocket stream state"><span className={`h-1.5 w-1.5 rounded-full ${ws === "open" ? "bg-green" : ws === "connecting" ? "bg-amber" : "bg-red"}`} />stream {ws}</Badge>
            <DataBadge />
          </div>
        </header>
        {error && source !== "live" && (
          <div role="alert" className="border-b border-amber/30 bg-amber/10 px-4 py-2 text-xs text-amber">
            {error} {source === "cached" ? "Showing cached data from this browser; nothing here is live. Retrying every 5 s." : "Retrying every 5 s."}
          </div>
        )}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto p-4"><Outlet /></main>
      </div>
    </div>
  );
}
