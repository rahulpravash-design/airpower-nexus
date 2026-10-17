import { API_BASE } from "./api";

export type WsState = "connecting" | "open" | "closed";
export interface StreamMessage { type: string; [k: string]: unknown }

export function streamUrl(): string {
  if (/^https?:/.test(API_BASE)) return API_BASE.replace(/^http/, "ws") + "/stream";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${API_BASE}/stream`;
}

/** WebSocket with automatic reconnection (exponential back-off, 1 s -> 10 s). */
export function connectStream(onMessage: (m: StreamMessage) => void, onState: (s: WsState) => void) {
  let ws: WebSocket | null = null;
  let stopped = false;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const open = () => {
    onState("connecting");
    try { ws = new WebSocket(streamUrl()); } catch { schedule(); return; }
    ws.onopen = () => {
      delay = 1000;
      onState("open");
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 15000);
    };
    ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data as string) as StreamMessage); } catch { /* ignore malformed */ } };
    ws.onclose = () => { clearInterval(ping); onState("closed"); if (!stopped) schedule(); };
    ws.onerror = () => ws?.close();
  };
  const schedule = () => { timer = setTimeout(open, delay); delay = Math.min(delay * 2, 10000); };
  open();
  return () => { stopped = true; clearTimeout(timer); clearInterval(ping); ws?.close(); };
}
