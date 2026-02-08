import { BotConfig } from "@shared/schema";
import { useToggleBot, useRunBot } from "@/hooks/use-bot";
import { formatDistanceToNow } from "date-fns";
import { Power, RefreshCw, Clock, Activity } from "lucide-react";

interface StatusCardProps {
  config?: BotConfig | null;
}

export function StatusCard({ config }: StatusCardProps) {
  const toggleBot = useToggleBot();
  const runBot = useRunBot();
  const isActive = config?.isActive ?? false;

  return (
    <div className="glass-card rounded-2xl p-6 h-full flex flex-col relative overflow-hidden group">
      {/* Background Gradient Effect */}
      <div className={`absolute -right-20 -top-20 w-64 h-64 rounded-full blur-[100px] transition-colors duration-1000 ${isActive ? "bg-green-500/20" : "bg-red-500/10"}`} />
      
      <div className="flex items-center justify-between mb-8 relative z-10">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          System Status
        </h2>
        <div className={`px-3 py-1 rounded-full text-xs font-bold border ${
          isActive 
            ? "bg-green-500/10 text-green-400 border-green-500/20" 
            : "bg-red-500/10 text-red-400 border-red-500/20"
        }`}>
          {isActive ? "OPERATIONAL" : "OFFLINE"}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center text-center relative z-10 space-y-6">
        <div className="relative">
          <button
            onClick={() => toggleBot.mutate(!isActive)}
            disabled={toggleBot.isPending}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl ${
              isActive 
                ? "bg-green-500/10 text-green-400 ring-4 ring-green-500/20 shadow-green-500/20 hover:scale-105" 
                : "bg-red-500/10 text-red-400 ring-4 ring-red-500/20 shadow-red-500/10 hover:bg-red-500/20"
            }`}
          >
            <Power className="w-10 h-10" strokeWidth={3} />
          </button>
          {isActive && (
            <div className="absolute inset-0 rounded-full animate-ping bg-green-500/20 pointer-events-none" />
          )}
        </div>
        
        <div className="space-y-1">
          <h3 className="text-lg font-medium text-foreground">
            {isActive ? "Bot is Running" : "Bot is Stopped"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isActive 
              ? "Scanning for new nations every 2 minutes" 
              : "Toggle to start automated messaging"}
          </p>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-white/5 relative z-10">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>Last run:</span>
            <span className="text-foreground font-mono">
              {config?.lastRunAt 
                ? formatDistanceToNow(new Date(config.lastRunAt), { addSuffix: true }) 
                : "Never"}
            </span>
          </div>
          
          <button
            onClick={() => runBot.mutate()}
            disabled={runBot.isPending}
            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50"
            title="Run check immediately"
          >
            <RefreshCw className={`w-4 h-4 ${runBot.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
