import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { updateConfigSchema } from "@shared/schema";
import { useConfig, useUpdateConfig, useImportConfig } from "@/hooks/use-bot";
import { useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  Settings, Save, Lock, MessageSquare, FileText, Timer,
  Users, UserCheck, Zap, Clock, Download, Upload,
} from "lucide-react";

const formSchema = updateConfigSchema.extend({
  scanInterval:            z.number().min(30).max(180).default(120),
  timedModeOfflineMinutes: z.number().min(15).max(180).default(15),
});

type ConfigFormValues = z.infer<typeof formSchema>;

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${m}m`;
  return `${m}m ${sec}s`;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

export function ConfigForm() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();
  const importConfig = useImportConfig();
  const importInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey:                          "",
      subject:                         "",
      messageTemplate:                 "",
      existingPlayerSubject:           "",
      existingPlayerMessageTemplate:   "",
      scanInterval:                    120,
      newNationRecruitMode:            "instant",
      timedModeOfflineMinutes:         15,
    },
  });

  const scanInterval   = form.watch("scanInterval")            ?? 120;
  const recruitMode    = form.watch("newNationRecruitMode")    ?? "instant";
  const offlineMinutes = form.watch("timedModeOfflineMinutes") ?? 15;

  // Scan interval slider: 30–180s
  const sliderPct  = ((scanInterval   - 30) / (180 - 30))  * 100;
  // Offline minutes slider: 15–180 min
  const offlinePct = ((offlineMinutes - 15) / (180 - 15)) * 100;

  useEffect(() => {
    if (config) {
      form.reset({
        apiKey:                          config.apiKey,
        subject:                         config.subject,
        messageTemplate:                 config.messageTemplate,
        existingPlayerSubject:           config.existingPlayerSubject   ?? "",
        existingPlayerMessageTemplate:   config.existingPlayerMessageTemplate ?? "",
        scanInterval:                    config.scanInterval            ?? 120,
        newNationRecruitMode:            config.newNationRecruitMode    ?? "instant",
        // Clamp stored value to new min of 15 so form stays valid
        timedModeOfflineMinutes:         Math.max(15, config.timedModeOfflineMinutes ?? 15),
      });
    }
  }, [config, form]);

  const onSubmit = (data: ConfigFormValues) => {
    updateConfig.mutate(data);
  };

  // ── Export ───────────────────────────────────────────────────────────────
  function handleExport() {
    if (!config) return;
    const dateStr = format(new Date(), "yyyy-MM-dd");
    const exportData = {
      _version:  "1.0",
      _exported: new Date().toISOString(),
      apiKey:                          config.apiKey,
      subject:                         config.subject,
      messageTemplate:                 config.messageTemplate,
      existingPlayerSubject:           config.existingPlayerSubject   ?? "",
      existingPlayerMessageTemplate:   config.existingPlayerMessageTemplate ?? "",
      scanInterval:                    config.scanInterval            ?? 120,
      newNationRecruitMode:            config.newNationRecruitMode    ?? "instant",
      timedModeOfflineMinutes:         config.timedModeOfflineMinutes ?? 15,
      // System fields excluded: id, isActive, lastRunAt, lastNationId
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `Atlantis Recruitment Bot Save - ${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import ───────────────────────────────────────────────────────────────
  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        importConfig.mutate(data);
      } catch {
        alert("Could not read the file. Make sure it is a valid Atlantis Recruitment Bot save.");
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = "";
  }

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6 h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 h-full flex flex-col">
      {/* Header + Export/Import */}
      <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Bot Configuration</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Import */}
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
            data-testid="input-import-file"
          />
          <button
            type="button"
            disabled={importConfig.isPending}
            onClick={() => importInputRef.current?.click()}
            data-testid="button-import-config"
            title="Import settings from a save file"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-secondary/50 hover:bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            {importConfig.isPending
              ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <Upload className="w-3.5 h-3.5" />}
            Import
          </button>

          {/* Export */}
          <button
            type="button"
            disabled={!config}
            onClick={handleExport}
            data-testid="button-export-config"
            title="Export settings to a save file"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-secondary/50 hover:bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 flex-1 flex flex-col">

        {/* API Key */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" /> API Key
          </label>
          <input
            {...form.register("apiKey")}
            data-testid="input-api-key"
            type="password"
            placeholder="Paste your Politics & War API Key"
            className="input-field font-mono text-sm"
          />
          {form.formState.errors.apiKey && (
            <p className="text-xs text-red-400 mt-1">{form.formState.errors.apiKey.message}</p>
          )}
        </div>

        {/* ── New Player Template ──────────────────────────────────────────── */}
        <div className="space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">New Player Template</span>
            <span className="ml-auto text-xs text-muted-foreground bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
              Brand-new nations
            </span>
          </div>

          {/* Recruit Mode Toggle */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Recruitment Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="button-mode-instant"
                onClick={() => form.setValue("newNationRecruitMode", "instant")}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  recruitMode === "instant"
                    ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                    : "bg-transparent border-white/10 text-muted-foreground hover:border-white/20"
                }`}
              >
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span className="text-left leading-tight">
                  <span className="block">Instant</span>
                  <span className="text-xs opacity-70">Message on first sight</span>
                </span>
              </button>
              <button
                type="button"
                data-testid="button-mode-timed"
                onClick={() => form.setValue("newNationRecruitMode", "timed")}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  recruitMode === "timed"
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                    : "bg-transparent border-white/10 text-muted-foreground hover:border-white/20"
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="text-left leading-tight">
                  <span className="block">Timed</span>
                  <span className="text-xs opacity-70">Send on return login</span>
                </span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {recruitMode === "timed"
                ? "Tracks new nations and sends the moment they return online after going offline — message appears first in their inbox."
                : "Messages new nations immediately when they appear in the scan band."}
            </p>
            <input type="hidden" {...form.register("newNationRecruitMode")} />
          </div>

          {/* Offline wait time slider — 15 min to 3 hours */}
          {recruitMode === "timed" && (
            <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-amber-300/80 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Min. Offline Time Before Send
                </label>
                <span
                  data-testid="text-offline-minutes"
                  className="text-xs font-semibold text-amber-300 tabular-nums"
                >
                  {formatMinutes(offlineMinutes)}
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={180}
                step={1}
                data-testid="slider-offline-minutes"
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, hsl(38 92% 50%) 0%, hsl(38 92% 50%) ${offlinePct}%, hsl(var(--muted)) ${offlinePct}%, hsl(var(--muted)) 100%)`,
                }}
                {...form.register("timedModeOfflineMinutes", { valueAsNumber: true })}
              />
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">15m</span>
                <span className="text-xs text-muted-foreground">1h</span>
                <span className="text-xs text-muted-foreground">1h 30m</span>
                <span className="text-xs text-muted-foreground">2h</span>
                <span className="text-xs text-muted-foreground">3h</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Nation must be offline this long before returning online triggers the message. Nations tracked longer than 2 days receive the message automatically.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5" /> Subject
            </label>
            <input
              {...form.register("subject")}
              data-testid="input-subject"
              placeholder="Welcome message subject"
              className="input-field"
            />
            {form.formState.errors.subject && (
              <p className="text-xs text-red-400 mt-1">{form.formState.errors.subject.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" /> Message Template
            </label>
            <textarea
              {...form.register("messageTemplate")}
              data-testid="input-message-template"
              placeholder="Enter your new-player welcome message... HTML supported."
              className="input-field min-h-[120px] resize-none font-mono text-sm leading-relaxed"
            />
            {form.formState.errors.messageTemplate && (
              <p className="text-xs text-red-400 mt-1">{form.formState.errors.messageTemplate.message}</p>
            )}
          </div>
        </div>

        {/* ── Existing Player Template ─────────────────────────────────────── */}
        <div className="space-y-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <UserCheck className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-purple-300">Existing Player Template</span>
            <span className="ml-auto text-xs text-muted-foreground bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
              Recently unaligned
            </span>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Sent to any unaligned nation active within the last 24 hours — catches players the moment they leave an alliance. Not in vacation mode. One message per nation.
          </p>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5" /> Subject
            </label>
            <input
              {...form.register("existingPlayerSubject")}
              data-testid="input-existing-player-subject"
              placeholder="Recruitment message subject"
              className="input-field"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" /> Message Template
            </label>
            <textarea
              {...form.register("existingPlayerMessageTemplate")}
              data-testid="input-existing-player-message-template"
              placeholder="Enter your existing-player recruitment message... HTML supported."
              className="input-field min-h-[120px] resize-none font-mono text-sm leading-relaxed"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Leave both fields empty to disable this scanner. Supports HTML formatting.
          </p>
        </div>

        {/* Scan Interval Slider — 30s to 3m */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" /> Scan Interval
            </label>
            <span data-testid="text-scan-interval" className="text-sm font-semibold text-primary tabular-nums">
              {formatSeconds(scanInterval)}
            </span>
          </div>
          <div className="px-1">
            <input
              type="range"
              min={30}
              max={180}
              step={1}
              data-testid="slider-scan-interval"
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${sliderPct}%, hsl(var(--muted)) ${sliderPct}%, hsl(var(--muted)) 100%)`,
              }}
              {...form.register("scanInterval", { valueAsNumber: true })}
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-muted-foreground">30s</span>
              <span className="text-xs text-muted-foreground">1m</span>
              <span className="text-xs text-muted-foreground">1m 30s</span>
              <span className="text-xs text-muted-foreground">2m</span>
              <span className="text-xs text-muted-foreground">3m</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Applies to all scanners. Takes effect after the current cycle completes.
          </p>
        </div>

        <div className="pt-4 border-t border-white/5">
          <button
            type="submit"
            disabled={updateConfig.isPending}
            data-testid="button-save-config"
            className="btn-primary w-full gap-2"
          >
            {updateConfig.isPending ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}
