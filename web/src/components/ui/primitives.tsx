import { Info } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "border-green/40 bg-green/10 text-green", warn: "border-amber/40 bg-amber/10 text-amber",
  bad: "border-red/40 bg-red/10 text-red", info: "border-cyan/40 bg-cyan/10 text-cyan",
  neutral: "border-white/10 bg-white/5 text-muted",
};
export const TONE_TEXT: Record<Tone, string> = { ok: "text-green", warn: "text-amber", bad: "text-red", info: "text-cyan", neutral: "text-ink" };

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>;
}

export function Panel({ title, actions, children, className = "", subtitle }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel p-4 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div><h2 className="text-sm font-semibold tracking-wide">{title}</h2>{subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}</div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "neutral", icon, tip }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode; tip?: string;
}) {
  return (
    <div className="panel p-3.5">
      <div className="flex items-center justify-between gap-2"><span className="label flex items-center gap-1.5">{label}{tip && <Tooltip text={tip} />}</span>{icon && <span className="text-muted">{icon}</span>}</div>
      <div className={`num mt-1.5 text-2xl font-semibold ${TONE_TEXT[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Tooltip({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      {children ?? <Info className="h-3.5 w-3.5 text-muted" aria-hidden />}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md border border-white/10 bg-bg2 px-2 py-1 text-xs text-ink shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export function Skeleton({ className = "h-6 w-full" }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-md ${className}`} />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-md text-xs text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Field({ label, help, error, children }: { label: string; help?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red" role="alert">{error}</span> : help ? <span className="mt-1 block text-xs text-muted">{help}</span> : null}
    </label>
  );
}

export function ProgressBar({ value, tone = "info" }: { value: number; tone?: Tone }) {
  const color = { ok: "bg-green", warn: "bg-amber", bad: "bg-red", info: "bg-cyan", neutral: "bg-muted" }[tone];
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ""}`} />;
}
