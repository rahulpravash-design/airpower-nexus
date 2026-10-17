import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Tone = "ok" | "info" | "warn" | "bad";
interface ToastItem { id: number; tone: Tone; title: string; body?: string }
interface ToastApi { push: (t: Omit<ToastItem, "id">) => void }

const Ctx = createContext<ToastApi>({ push: () => undefined });
export const useToast = () => useContext(Ctx);

const ICON = { ok: CheckCircle2, info: Info, warn: AlertTriangle, bad: XCircle } as const;
const COLOR = { ok: "text-green", info: "text-cyan", warn: "text-amber", bad: "text-red" } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === "bad" ? 9000 : 5000);
  }, []);
  const api = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = ICON[t.tone];
            return (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }}
                className="panel pointer-events-auto flex gap-3 border-white/10 bg-panel p-3 shadow-xl">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${COLOR[t.tone]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.body && <p className="mt-0.5 break-words text-xs text-muted">{t.body}</p>}
                </div>
                <button aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
