import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { updateConfigSchema } from "@shared/schema";
import { useConfig, useUpdateConfig } from "@/hooks/use-bot";
import { useEffect } from "react";
import { Settings, Save, Lock, MessageSquare, FileText, Timer } from "lucide-react";

const formSchema = updateConfigSchema.extend({
  scanInterval: z.number().min(1).max(3).default(2),
});

type ConfigFormValues = z.infer<typeof formSchema>;

export function ConfigForm() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apiKey: "",
      subject: "",
      messageTemplate: "",
      scanInterval: 2,
    },
  });

  const scanInterval = form.watch("scanInterval") ?? 2;
  const sliderPct = ((scanInterval - 1) / 2) * 100;

  useEffect(() => {
    if (config) {
      form.reset({
        apiKey: config.apiKey,
        subject: config.subject,
        messageTemplate: config.messageTemplate,
        scanInterval: config.scanInterval ?? 2,
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

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 flex-1 flex flex-col">
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

        <div className="space-y-2 flex-1 flex flex-col">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Message Template
          </label>
          <textarea
            {...form.register("messageTemplate")}
            data-testid="input-message-template"
            placeholder="Enter your welcome message... HTML is supported (e.g., <b>bold text</b>)."
            className="input-field min-h-[150px] resize-none flex-1 font-mono text-sm leading-relaxed"
          />
          {form.formState.errors.messageTemplate && (
            <p className="text-xs text-red-400 mt-1">{form.formState.errors.messageTemplate.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Supports HTML formatting. Use <b>&lt;b&gt;bold text&lt;/b&gt;</b> for bolding.
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
              {scanInterval} {scanInterval === 1 ? "minute" : "minutes"}
            </span>
          </div>
          <div className="px-1">
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              data-testid="slider-scan-interval"
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${sliderPct}%, hsl(var(--muted)) ${sliderPct}%, hsl(var(--muted)) 100%)`,
              }}
              {...form.register("scanInterval", { valueAsNumber: true })}
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-muted-foreground">1 min</span>
              <span className="text-xs text-muted-foreground">2 min</span>
              <span className="text-xs text-muted-foreground">3 min</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            How often the bot scans for new nations. Takes effect after the current cycle completes.
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
