import { Database, WifiOff, Radio } from "lucide-react";
import { Badge } from "./primitives";
import { useData } from "../../hooks/useData";

/** Always tells the viewer whether numbers on screen are live backend data or a stale local cache. */
export function DataBadge() {
  const { source, cachedAt } = useData();
  if (source === "live") return <Badge tone="ok" title="Data fetched from the running backend"><Radio className="h-3 w-3" />LIVE</Badge>;
  if (source === "cached")
    return <Badge tone="warn" title="Backend unreachable: showing the last data this browser received"><Database className="h-3 w-3" />CACHED{cachedAt ? ` · ${new Date(cachedAt).toLocaleTimeString()}` : ""}</Badge>;
  return <Badge tone="bad" title="No data available"><WifiOff className="h-3 w-3" />NO DATA</Badge>;
}
