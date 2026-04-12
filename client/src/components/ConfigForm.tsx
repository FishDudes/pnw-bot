import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { updateConfigSchema } from "@shared/schema";
import { useConfig, useUpdateConfig } from "@/hooks/use-bot";
import { useEffect } from "react";
import { Settings, Save, Lock, MessageSquare, FileText, Timer, Users, UserCheck } from "lucide-react";

const formSchema = updateConfigSchema.extend({
  scanInterval: z.number().min(60).max(180).default(120),
});

type ConfigFormValues = z.infer<typeof formSchema>;

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${m}m`;
  return `${m}m ${sec}s`;
}

export function ConfigForm() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey: "",
      subject: "",
      messageTemplate: "",
      existingPlayerSubject: "",
      existingPlayerMessageTemplate: "",
      scanInterval: 120,
    },
  });

  const scanInterval = form.watch("scanInterval") ?? 120;
  const sliderPct = ((scanInterval - 60) / 120) * 100;

  useEffect(() => {
    if (config) {
      form.reset({
        apiKey: config.apiKey,
        subject: config.subject,
        messageTemplate: config.messageTemplate,
        existingPlayerSubject: config.existingPlayerSubject ?? "",
        existingPlayerMessageTemplate: config.existingPlayerMessageTemplate ?? "",
        scanInterval: config.scanInterval ?? 120,
      });
    }
  }, [config, form]);

  const onSubmit = (data: ConfigFormValues) => {
    updateConfig.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6 h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Bot Configuration</h2>
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

        {/* ── New Player Template ─────────────────────────────────────────── */}
        <div className="space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">New Player Template</span>
            <span className="ml-auto text-xs text-muted-foreground bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
              Brand-new nations
            </span>
          </div>

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

        {/* ── Existing Player Template ────────────────────────────────────── */}
        <div className="space-y-4 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-purple-300">Existing Player Template</span>
            <span className="ml-auto text-xs text-muted-foreground bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
              Unaligned · 15+ cities · active 7d
            </span>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Sent to established, unaligned nations with more than 15 cities who have logged in within the last 7 days and are not in vacation mode.
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

        {/* Scan Interval Slider */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" /> Scan Interval
            </label>
            <span
              data-testid="text-scan-interval"
              className="text-sm font-semibold text-primary tabular-nums"
            >
              {formatSeconds(scanInterval)}
            </span>
          </div>
          <div className="px-1">
            <input
              type="range"
              min={60}
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
              <span className="text-xs text-muted-foreground">1m</span>
              <span className="text-xs text-muted-foreground">1m 30s</span>
              <span className="text-xs text-muted-foreground">2m</span>
              <span className="text-xs text-muted-foreground">2m 30s</span>
              <span className="text-xs text-muted-foreground">3m</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Applies to both scanners. Takes effect after the current cycle completes.
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
