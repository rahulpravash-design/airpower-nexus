// Last successfully fetched backend state, shown (and clearly labelled "CACHED") only when the API is unreachable.
const KEY = "airpower.cache.v1";
export interface CacheShape { at: number; scenario: unknown; planState: unknown; config: unknown; fusion: unknown }

export function saveCache(c: CacheShape) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* quota or private mode: caching is optional */ }
}
export function loadCache(): CacheShape | null {
  try { const r = localStorage.getItem(KEY); return r ? (JSON.parse(r) as CacheShape) : null; } catch { return null; }
}
