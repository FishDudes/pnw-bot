import { useLogs, useTrackedNations, useAllTrackedNations } from "@/hooks/use-bot";
import { format, formatDistanceToNow } from "date-fns";
import {
  History, CheckCircle2, XCircle, Search,
  Users, Clock, Eye, WifiOff, Wifi, Send, Crown,
} from "lucide-react";
import { useState, useMemo } from "react";
import type { MessagedNation, TrackedNewNation } from "@shared/schema";

type Filter = "all" | "new" | "left" | "returned" | "alliance" | "tracking";

type Entry =
  | { kind: "log";     data: MessagedNation;   time: number }
  | { kind: "tracked"; data: TrackedNewNation; time: number };

// Status helpers for tracked nations
function TrackedStatusBadge({ status }: { status: string }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20 whitespace-nowrap">
        <Send className="w-3 h-3 shrink-0" />
        Sent
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20 whitespace-nowrap">
        <Clock className="w-3 h-3 shrink-0" />
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
      <Eye className="w-3 h-3 shrink-0" />
      Watching
    </span>
  );
}

export function LogsTable() {
  const { data: logs,       isLoading: logsLoading    } = useLogs();
  const { data: watching,   isLoading: watchLoading   } = useTrackedNations();
  const { data: allTracked, isLoading: allLoading     } = useAllTrackedNations();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const isLoading = logsLoading || watchLoading || allLoading;

  const newCount     = (logs ?? []).filter(l => l.messageType === "new_player").length;
  const leftCount    = (logs ?? []).filter(l => l.messageType === "existing_instant").length;
  const returnedCount= (logs ?? []).filter(l => l.messageType === "existing_timed").length;
  const allianceCount= (logs ?? []).filter(l => l.messageType === "alliance_leader").length;
  const trackingCount= (watching ?? []).length; // badge = currently watching

  const matches = (name: string, leader: string | null | undefined, id: number) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || (leader ?? "").toLowerCase().includes(q) || id.toString().includes(q);
  };

  // ── "All" view: merge watching tracked nations + log entries, sorted by time ─
  const allEntries = useMemo((): Entry[] => {
    if (filter === "tracking") return [];
    const result: Entry[] = [];

    for (const log of logs ?? []) {
      if (filter === "new"       && log.messageType !== "new_player") continue;
      if (filter === "left"      && log.messageType !== "existing_instant") continue;
      if (filter === "returned"  && log.messageType !== "existing_timed") continue;
      if (filter === "alliance"  && log.messageType !== "alliance_leader") continue;
      if (!matches(log.nationName, log.leaderName, log.nationId)) continue;
      result.push({ kind: "log", data: log, time: new Date(log.messagedAt).getTime() });
    }

    if (filter === "all") {
      for (const t of watching ?? []) {
        if (!matches(t.nationName, t.leaderName, t.nationId)) continue;
        result.push({ kind: "tracked", data: t, time: new Date(t.firstSeenAt).getTime() });
      }
    }

    result.sort((a, b) => b.time - a.time);
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, watching, filter, search]);

  // ── "Tracking" view: full history (all statuses), sorted by firstSeenAt DESC ─
  const trackingEntries = useMemo((): TrackedNewNation[] => {
    if (filter !== "tracking") return [];
    return (allTracked ?? []).filter(t => matches(t.nationName, t.leaderName, t.nationId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTracked, filter, search]);

  const showEmpty = filter === "tracking"
    ? trackingEntries.length === 0
    : allEntries.length === 0;

  return (
    <div className="glass-card rounded-2xl flex flex-col overflow-hidden h-full min-h-[420px]">

      {/* ── Header ── */}
      <div className="p-4 sm:p-6 border-b border-white/5 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 shrink-0">
              <History className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold">Activity Log</h2>
              <p className="text-xs sm:text-sm text-muted-foreground">History of automated messages</p>
            </div>
          </div>
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search nations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-8 py-2 text-sm w-full"
              data-testid="input-log-search"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { key: "all",       label: "All",          count: newCount + leftCount + returnedCount + allianceCount + trackingCount, color: "white"       },
              { key: "new",       label: "New Player",   count: newCount,                                                     color: "blue"        },
              { key: "left",      label: "Left Alliance", count: leftCount,                                                      color: "purple"      },
              { key: "returned",  label: "Returned",     count: returnedCount,                                                  color: "purpleLight" },
              { key: "alliance",  label: "Alliance",     count: allianceCount,                                                  color: "emerald"     },
              { key: "tracking",  label: "Tracking",     count: trackingCount,                                                  color: "amber"       },
            ] as const
          ).map(({ key, label, count, color }) => {
            const active = filter === key;
            const cls = {
              white:       active ? "bg-white/15 border-white/30 text-white"                    : "border-white/10 text-muted-foreground hover:border-white/20",
              blue:        active ? "bg-blue-500/20 border-blue-500/50 text-blue-300"          : "border-white/10 text-muted-foreground hover:border-blue-500/30",
              purple:      active ? "bg-purple-500/20 border-purple-500/50 text-purple-300"    : "border-white/10 text-muted-foreground hover:border-purple-500/30",
              purpleLight: active ? "bg-purple-300/20 border-purple-300/50 text-purple-200"    : "border-white/10 text-muted-foreground hover:border-purple-300/30",
              emerald:     active ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300": "border-white/10 text-muted-foreground hover:border-emerald-500/30",
              amber:       active ? "bg-amber-500/20 border-amber-500/50 text-amber-300"        : "border-white/10 text-muted-foreground hover:border-amber-500/30",
            }[color];
            return (
              <button key={key} type="button" data-testid={`filter-${key}`}
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${cls}`}
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

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {filter === "tracking" ? (
          /* ── Tracking tab: full history with first-seen + messaged-at ── */
          <table className="w-full text-left text-sm min-w-[480px]">
            <thead className="bg-secondary/50 sticky top-0 backdrop-blur-md z-10">
              <tr>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs">Status</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs">Nation</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs hidden md:table-cell">Leader</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs">First Seen</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs hidden sm:table-cell">Messaged At</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs text-right">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                </td></tr>
              ) : showEmpty ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  No tracking history yet. Enable Timed mode to start tracking nations.
                </td></tr>
              ) : (
                trackingEntries.map((t) => {
                  const isWatching = t.status === "watching";
                  const isOffline  = isWatching && !!t.wentOfflineAt;
                  const offlineDuration = t.wentOfflineAt
                    ? formatDistanceToNow(new Date(t.wentOfflineAt), { addSuffix: false })
                    : null;
                  return (
                    <tr key={`tracked-${t.id}`} className="hover:bg-white/5 transition-colors" data-testid={`row-tracked-${t.id}`}>
                      <td className="px-3 sm:px-5 py-3">
                        <TrackedStatusBadge status={t.status} />
                      </td>
                      <td className="px-3 sm:px-5 py-3 font-medium text-foreground">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                          <span className="truncate max-w-[120px] sm:max-w-none">{t.nationName}</span>
                          {isWatching && (
                            isOffline ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-orange-400/80 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                                <WifiOff className="w-2.5 h-2.5" />{offlineDuration}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                                <Wifi className="w-2.5 h-2.5" />Online
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-muted-foreground hidden md:table-cell text-xs">{t.leaderName || "—"}</td>
                      <td className="px-3 sm:px-5 py-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                        {format(new Date(t.firstSeenAt), "MMM d, HH:mm")}
                      </td>
                      <td className="px-3 sm:px-5 py-3 font-mono text-xs hidden sm:table-cell whitespace-nowrap">
                        {t.messagedAt ? (
                          <span className="text-green-400">{format(new Date(t.messagedAt), "MMM d, HH:mm")}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-right font-mono text-muted-foreground text-xs">#{t.nationId}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          /* ── All / New / Existing tabs ── */
          <table className="w-full text-left text-sm min-w-[360px]">
            <thead className="bg-secondary/50 sticky top-0 backdrop-blur-md z-10">
              <tr>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs">Status</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs hidden lg:table-cell">Type</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs">Nation</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs hidden md:table-cell">Leader</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs hidden sm:table-cell">Time</th>
                <th className="px-3 sm:px-5 py-3 font-semibold text-muted-foreground text-xs text-right">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                </td></tr>
              ) : showEmpty ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground text-sm">
                  No activity recorded yet.
                </td></tr>
              ) : (
                allEntries.map((entry) => {
                  if (entry.kind === "tracked") {
                    const t = entry.data;
                    const isOffline = !!t.wentOfflineAt;
                    const offlineDuration = t.wentOfflineAt
                      ? formatDistanceToNow(new Date(t.wentOfflineAt), { addSuffix: false })
                      : null;
                    return (
                      <tr key={`tracked-${t.id}`} className="hover:bg-white/5 transition-colors" data-testid={`row-tracked-${t.id}`}>
                        <td className="px-3 sm:px-5 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
                            <Eye className="w-3 h-3 shrink-0" /><span className="hidden xs:inline">Tracking</span>
                          </span>
                        </td>
                        <td className="px-3 sm:px-5 py-3 hidden lg:table-cell">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Clock className="w-3 h-3" />Timed
                          </span>
                        </td>
                        <td className="px-3 sm:px-5 py-3 font-medium text-foreground">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <span className="truncate max-w-[120px] sm:max-w-none">{t.nationName}</span>
                            {isOffline ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-orange-400/80 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                                <WifiOff className="w-2.5 h-2.5" />{offlineDuration}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                                <Wifi className="w-2.5 h-2.5" />Online
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 sm:px-5 py-3 text-muted-foreground hidden md:table-cell text-xs">{t.leaderName || "—"}</td>
                        <td className="px-3 sm:px-5 py-3 text-muted-foreground hidden sm:table-cell font-mono text-xs">
                          {format(new Date(t.firstSeenAt), "MMM d, HH:mm")}
                        </td>
                        <td className="px-3 sm:px-5 py-3 text-right font-mono text-muted-foreground text-xs">#{t.nationId}</td>
                      </tr>
                    );
                  }

                  const log = entry.data;
                  return (
                    <tr key={`log-${log.id}`} className="hover:bg-white/5 transition-colors" data-testid={`row-log-${log.id}`}>
                      <td className="px-3 sm:px-5 py-3">
                        {log.status === "success" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20 whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3 shrink-0" /><span className="hidden xs:inline">Sent</span>
                          </span>
                        ) : log.status === "pending" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 whitespace-nowrap">
                            <Clock className="w-3 h-3 shrink-0" /><span className="hidden xs:inline">Pending</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 whitespace-nowrap" title={log.error || "Unknown error"}>
                            <XCircle className="w-3 h-3 shrink-0" /><span className="hidden xs:inline">Failed</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 sm:px-5 py-3 hidden lg:table-cell">
                        {log.messageType === "existing_instant" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20" data-testid={`badge-type-${log.id}`}>
                            Left Alliance
                          </span>
                        ) : log.messageType === "existing_timed" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-300/10 text-purple-300 border border-purple-300/20" data-testid={`badge-type-${log.id}`}>
                            Returned
                          </span>
                        ) : log.messageType === "alliance_leader" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" data-testid={`badge-type-${log.id}`}>
                            Alliance Leader
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20" data-testid={`badge-type-${log.id}`}>
                            New Player
                          </span>
                        )}
                      </td>
                      <td className="px-3 sm:px-5 py-3 font-medium text-foreground">
                        <span className="truncate block max-w-[120px] sm:max-w-none">{log.nationName}</span>
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-muted-foreground hidden md:table-cell text-xs">{log.leaderName || "—"}</td>
                      <td className="px-3 sm:px-5 py-3 text-muted-foreground hidden sm:table-cell font-mono text-xs">
                        {format(new Date(log.messagedAt), "MMM d, HH:mm:ss")}
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-right font-mono text-muted-foreground text-xs">#{log.nationId}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
