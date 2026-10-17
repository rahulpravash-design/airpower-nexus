import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const KEY = "airpower.intro.seen";

/** Optional ~2 s intro. The app underneath is already fully usable; skip with a click or any key. */
export function Intro() {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(() => {
    try { return !reduce && sessionStorage.getItem(KEY) !== "1"; } catch { return false; }
  });
  const close = () => { setShow(false); try { sessionStorage.setItem(KEY, "1"); } catch { /* optional */ } };
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(close, 2200);
    window.addEventListener("keydown", close);
    return () => { clearTimeout(t); window.removeEventListener("keydown", close); };
  }, [show]);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="fixed inset-0 z-[150] grid cursor-pointer place-items-center bg-bg" onClick={close}
          initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          <div className="text-center">
            <motion.p initial={{ opacity: 0, letterSpacing: "0.5em" }} animate={{ opacity: 1, letterSpacing: "0.22em" }} transition={{ duration: 1 }}
              className="text-3xl font-semibold text-ink">AIR POWER</motion.p>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} className="mt-3 max-w-md text-sm text-cyan">
              Every report verified. Every post stocked before the pass closes.
            </motion.p>
            <p className="mt-6 text-[11px] text-muted">SIH26250 · synthetic BLUELAND scenario · click to skip</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
