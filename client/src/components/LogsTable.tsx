import { useLogs } from "@/hooks/use-bot";
import { format } from "date-fns";
import { History, CheckCircle2, XCircle, Search, Users, UserCheck } from "lucide-react";
import { useState } from "react";

export function LogsTable() {
  const { data: logs, isLoading } = useLogs();
  const [search, setSearch] = useState("");

  const filteredLogs = logs?.filter(log =>
    log.nationName.toLowerCase().includes(search.toLowerCase()) ||
    log.leaderName?.toLowerCase().includes(search.toLowerCase()) ||
    log.nationId.toString().includes(search)
  ) || [];

  return (
    <div className="glass-card rounded-2xl flex flex-col overflow-hidden h-full min-h-[400px]">
      <div className="p-6 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                    Loading logs...
                  </div>
                </td>
              </tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  No activity recorded yet.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-white/5 transition-colors" data-testid={`row-log-${log.id}`}>
                  <td className="px-6 py-4">
                    {log.status === 'success' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Sent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20" title={log.error || "Unknown error"}>
                        <XCircle className="w-3 h-3" />
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    {log.messageType === 'existing_player' ? (
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
