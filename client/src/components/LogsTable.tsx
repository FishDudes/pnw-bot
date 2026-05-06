import { useLogs, useTrackedNations } from "@/hooks/use-bot";
import { format, formatDistanceToNow } from "date-fns";
import { History, CheckCircle2, XCircle, Search, Users, UserCheck, Clock, Eye, WifiOff, Wifi } from "lucide-react";
import { useState } from "react";

type Filter = "all" | "new" | "existing" | "tracking";

export function LogsTable() {
  const { data: logs, isLoading: logsLoading } = useLogs();
  const { data: tracked, isLoading: trackedLoading } = useTrackedNations();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const isLoading = logsLoading || trackedLoading;

  // Counts for filter tabs
  const newCount      = logs?.filter(l => l.messageType === "new_player").length ?? 0;
  const existingCount = logs?.filter(l => l.messageType === "existing_player").length ?? 0;
  const trackingCount = tracked?.length ?? 0;

  // Search helper
  const matchesSearch = (name: string, leader: string | null | undefined, id: number) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      name.toLowerCase().includes(q) ||
      (leader ?? "").toLowerCase().includes(q) ||
      id.toString().includes(q)
    );
  };

  // Build log rows
  const logRows = (logs ?? [])
    .filter(log => {
      if (filter === "new")      return log.messageType === "new_player";
      if (filter === "existing") return log.messageType === "existing_player";
      if (filter === "tracking") return false; // tracking-only view handled separately
      return true; // "all"
    })
    .filter(log => matchesSearch(log.nationName, log.leaderName, log.nationId));

  // Build tracked rows (only shown in "all" or "tracking" filter)
  const trackedRows = (filter === "all" || filter === "tracking")
    ? (tracked ?? []).filter(t => matchesSearch(t.nationName, t.leaderName, t.nationId))
    : [];

  const showEmpty = logRows.length === 0 && trackedRows.length === 0;

  return (
    <div className="glass-card rounded-2xl flex flex-col overflow-hidden h-full min-h-[400px]">
      {/* Header */}
      <div className="p-6 border-b border-white/5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Activity Log</h2>
              <p className="text-sm text-muted-foreground">History of automated messages</p>
            </div>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search nations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9 py-2 text-sm"
              data-testid="input-log-search"
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { key: "all",      label: "All",      count: newCount + existingCount + trackingCount, color: "white" },
              { key: "new",      label: "New (Sent)", count: newCount,      color: "blue"   },
              { key: "existing", label: "Existing",  count: existingCount, color: "purple" },
              { key: "tracking", label: "Tracking",  count: trackingCount, color: "amber"  },
            ] as const
          ).map(({ key, label, count, color }) => {
            const active = filter === key;
            const colorMap = {
              white:  active ? "bg-white/15 border-white/30 text-white"         : "border-white/10 text-muted-foreground hover:border-white/20",
              blue:   active ? "bg-blue-500/20 border-blue-500/50 text-blue-300"   : "border-white/10 text-muted-foreground hover:border-blue-500/30",
              purple: active ? "bg-purple-500/20 border-purple-500/50 text-purple-300" : "border-white/10 text-muted-foreground hover:border-purple-500/30",
              amber:  active ? "bg-amber-500/20 border-amber-500/50 text-amber-300"  : "border-white/10 text-muted-foreground hover:border-amber-500/30",
            };
            return (
              <button
                key={key}
                type="button"
                data-testid={`filter-${key}`}
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${colorMap[color]}`}
              >
                {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white/10" : "bg-white/5"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/50 sticky top-0 backdrop-blur-md z-10">
            <tr>
              <th className="px-6 py-4 font-semibold text-muted-foreground">Status</th>
              <th className="px-6 py-4 font-semibold text-muted-foreground hidden lg:table-cell">Type</th>
              <th className="px-6 py-4 font-semibold text-muted-foreground">Nation</th>
              <th className="px-6 py-4 font-semibold text-muted-foreground hidden md:table-cell">Leader</th>
              <th className="px-6 py-4 font-semibold text-muted-foreground hidden sm:table-cell">Time</th>
              <th className="px-6 py-4 font-semibold text-muted-foreground text-right">Nation ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                </td>
              </tr>
            ) : showEmpty ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  {filter === "tracking"
                    ? "No nations currently being tracked. Timed mode must be active."
                    : "No activity recorded yet."}
                </td>
              </tr>
            ) : (
              <>
                {/* ── Tracked nations (watching) ── shown first so they're visible */}
                {trackedRows.map((t) => {
                  const isOffline = !!t.wentOfflineAt;
                  const offlineDuration = t.wentOfflineAt
                    ? formatDistanceToNow(new Date(t.wentOfflineAt), { addSuffix: false })
                    : null;

                  return (
                    <tr key={`tracked-${t.id}`} className="hover:bg-white/5 transition-colors bg-amber-500/3" data-testid={`row-tracked-${t.id}`}>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <Eye className="w-3 h-3" />
                          Tracking
                        </span>
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20" data-testid={`badge-type-tracked-${t.id}`}>
                          <Clock className="w-3 h-3" />
                          Timed
                        </span>
                      </td>
                      <td className="px-6 py-4 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {t.nationName}
                          {isOffline ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-orange-400/80 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded-full">
                              <WifiOff className="w-2.5 h-2.5" />
                              Offline {offlineDuration}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                              <Wifi className="w-2.5 h-2.5" />
                              Online
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground hidden md:table-cell">
                        {t.leaderName || "-"}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell font-mono text-xs" title="First seen">
                        Seen {format(new Date(t.firstSeenAt), "MMM d, HH:mm")}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                        #{t.nationId}
                      </td>
                    </tr>
                  );
                })}

                {/* ── Sent / failed log rows ── */}
                {logRows.map((log) => (
                  <tr key={`log-${log.id}`} className="hover:bg-white/5 transition-colors" data-testid={`row-log-${log.id}`}>
                    <td className="px-6 py-4">
                      {log.status === "success" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Sent
                        </span>
                      ) : log.status === "pending" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20" title={log.error || "Unknown error"}>
                          <XCircle className="w-3 h-3" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      {log.messageType === "existing_player" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20" data-testid={`badge-type-${log.id}`}>
                          <UserCheck className="w-3 h-3" />
                          Existing
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20" data-testid={`badge-type-${log.id}`}>
                          <Users className="w-3 h-3" />
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-medium text-foreground">
                      {log.nationName}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground hidden md:table-cell">
                      {log.leaderName || "-"}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell font-mono text-xs">
                      {format(new Date(log.messagedAt), "MMM d, HH:mm:ss")}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                      #{log.nationId}
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
