import { BotConfig } from "@shared/schema";
import { useToggleBot, useRunBot } from "@/hooks/use-bot";
import { formatDistanceToNow } from "date-fns";
import { Power, RefreshCw, Clock, Activity } from "lucide-react";

interface StatusCardProps {
  config?: BotConfig | null;
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === 0) return `${m} minute${m !== 1 ? "s" : ""}`;
  return `${m}m ${s}s`;
}

export function StatusCard({ config }: StatusCardProps) {
  const toggleBot = useToggleBot();
  const runBot    = useRunBot();
  const isActive  = config?.isActive ?? false;
  const interval  = config?.scanInterval ?? 120;

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 h-full flex flex-col relative overflow-hidden group">
      {/* Background Gradient Effect */}
      <div className={`absolute -right-20 -top-20 w-64 h-64 rounded-full blur-[100px] transition-colors duration-1000 ${isActive ? "bg-green-500/20" : "bg-red-500/10"}`} />

      <div className="flex items-center justify-between mb-6 sm:mb-8 relative z-10">
        <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          System Status
        </h2>
        <div className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
          isActive
            ? "bg-green-500/10 text-green-400 border-green-500/20"
            : "bg-red-500/10 text-red-400 border-red-500/20"
        }`}>
          {isActive ? "OPERATIONAL" : "OFFLINE"}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center text-center relative z-10 space-y-5 sm:space-y-6">
        <div className="relative">
          <button
            onClick={() => toggleBot.mutate(!isActive)}
            disabled={toggleBot.isPending}
            data-testid="button-toggle-bot"
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl ${
              isActive
                ? "bg-green-500/10 text-green-400 ring-4 ring-green-500/20 shadow-green-500/20 hover:scale-105"
                : "bg-red-500/10 text-red-400 ring-4 ring-red-500/20 shadow-red-500/10 hover:bg-red-500/20"
            }`}
          >
            <Power className="w-9 h-9 sm:w-10 sm:h-10" strokeWidth={3} />
          </button>
          {isActive && (
            <div className="absolute inset-0 rounded-full animate-ping bg-green-500/20 pointer-events-none" />
          )}
        </div>

        <div className="space-y-1 px-2">
          <h3 className="text-base sm:text-lg font-medium text-foreground">
            {isActive ? "Bot is Running" : "Bot is Stopped"}
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
            {isActive
              ? `Scanning for new nations every ${formatInterval(interval)}`
              : "Toggle to start automated messaging"}
          </p>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-white/5 relative z-10">
        <div className="flex items-center justify-between text-sm gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs sm:text-sm min-w-0">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span className="shrink-0">Last run:</span>
            <span className="text-foreground font-mono truncate">
              {config?.lastRunAt
                ? formatDistanceToNow(new Date(config.lastRunAt), { addSuffix: true })
                : "Never"}
            </span>
          </div>

          <button
            onClick={() => runBot.mutate()}
            disabled={runBot.isPending}
            data-testid="button-run-now"
            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50 shrink-0"
            title="Run check immediately"
          >
            <RefreshCw className={`w-4 h-4 ${runBot.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
