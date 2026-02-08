import { ConfigForm } from "@/components/ConfigForm";
import { StatusCard } from "@/components/StatusCard";
import { LogsTable } from "@/components/LogsTable";
import { useConfig } from "@/hooks/use-bot";
import { ShieldCheck } from "lucide-react";

export default function Dashboard() {
  const { data: config } = useConfig();

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0a0f1c] to-[#050505]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary rounded-xl shadow-lg shadow-primary/20">
                <ShieldCheck className="w-6 h-6 text-primary-foreground" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white">
                Diplomacy<span className="text-primary">Bot</span>
              </h1>
            </div>
            <p className="text-muted-foreground pl-[3.25rem]">
              Automated recruitment and messaging system for Politics & War.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="px-4 py-2 rounded-lg bg-secondary/50 border border-white/5 text-sm text-muted-foreground">
               Version 1.0.0
             </div>
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Config */}
          <div className="lg:col-span-7 xl:col-span-8">
            <ConfigForm />
          </div>

          {/* Right Column: Status */}
          <div className="lg:col-span-5 xl:col-span-4">
            <StatusCard config={config} />
          </div>
        </div>

        {/* Bottom Section: Logs */}
        <div className="h-[500px]">
          <LogsTable />
        </div>

        {/* Footer */}
        <footer className="pt-8 text-center text-sm text-muted-foreground opacity-50">
          <p>
            System scans for new nations every 2 minutes when active.
            <br />
            Configured to avoid duplicate messages.
          </p>
        </footer>
      </div>
    </div>
  );
}
