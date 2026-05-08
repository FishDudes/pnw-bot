import { ConfigForm } from "@/components/ConfigForm";
import { StatusCard } from "@/components/StatusCard";
import { LogsTable } from "@/components/LogsTable";
import { useConfig } from "@/hooks/use-bot";
import { ShieldCheck } from "lucide-react";

export default function Dashboard() {
  const { data: config } = useConfig();

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0a0f1c] to-[#050505]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6 sm:space-y-8">

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-2.5 bg-primary rounded-xl shadow-lg shadow-primary/20 shrink-0">
                <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white leading-tight">
                Atlantis <span className="text-primary">Recruitment System</span>
              </h1>
            </div>
            <p className="text-sm text-muted-foreground pl-[2.75rem] sm:pl-[3.25rem]">
              Automated recruitment and messaging system for Atlantis
            </p>
          </div>

          <div className="flex items-center gap-3 pl-[2.75rem] sm:pl-0">
            <div className="px-3 py-1.5 rounded-lg bg-secondary/50 border border-white/5 text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
              Version 1.0.0
            </div>
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
          <div className="lg:col-span-7 xl:col-span-8">
            <ConfigForm />
          </div>
          <div className="lg:col-span-5 xl:col-span-4">
            <StatusCard config={config} />
          </div>
        </div>

        {/* Activity Log */}
        <div className="min-h-[420px] sm:h-[520px]">
          <LogsTable />
        </div>

        <footer className="pt-4 text-center text-xs sm:text-sm text-muted-foreground opacity-50">
          <p>
            System scans on the configured interval when active.
            <br />
            Each nation is only ever messaged once across all campaigns.
          </p>
        </footer>
      </div>
    </div>
  );
}
