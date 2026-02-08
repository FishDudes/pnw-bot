import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { updateConfigSchema } from "@shared/schema";
import { useConfig, useUpdateConfig } from "@/hooks/use-bot";
import { useEffect } from "react";
import { Settings, Save, Lock, MessageSquare, FileText } from "lucide-react";

type ConfigFormValues = z.infer<typeof updateConfigSchema>;

export function ConfigForm() {
  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(updateConfigSchema),
    defaultValues: {
      apiKey: "",
      subject: "",
      messageTemplate: "",
    },
  });

  // Reset form when config loads
  useEffect(() => {
    if (config) {
      form.reset({
        apiKey: config.apiKey,
        subject: config.subject,
        messageTemplate: config.messageTemplate,
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
            placeholder="Enter your welcome message... HTML is supported."
            className="input-field min-h-[150px] resize-none flex-1 font-mono text-sm leading-relaxed"
          />
          {form.formState.errors.messageTemplate && (
            <p className="text-xs text-red-400 mt-1">{form.formState.errors.messageTemplate.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Supports basic HTML tags.
          </p>
        </div>

        <div className="pt-4 border-t border-white/5">
          <button
            type="submit"
            disabled={updateConfig.isPending}
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
