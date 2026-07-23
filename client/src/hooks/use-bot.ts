import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BotConfig, type UpdateConfigRequest, type MessagedNation, type TrackedNewNation } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// Fetch Bot Configuration
export function useConfig() {
  return useQuery({
    queryKey: [api.config.get.path],
    queryFn: async () => {
      const res = await fetch(api.config.get.path);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch configuration");
      return api.config.get.responses[200].parse(await res.json());
    },
    refetchInterval: 15000,
  });
}

// Update Bot Configuration
export function useUpdateConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: UpdateConfigRequest) => {
      const validated = api.config.update.input.parse(data);
      const res = await fetch(api.config.update.path, {
        method: api.config.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      if (!res.ok) throw new Error("Failed to update configuration");
      return api.config.update.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([api.config.get.path], data);
      toast({
        title: "Configuration Saved",
        description: "Your bot settings have been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Import configuration from a saved file
export function useImportConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(api.config.import.path, {
        method: api.config.import.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Failed to import configuration");
      }
      return api.config.import.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([api.config.get.path], data);
      toast({
        title: "Configuration Imported",
        description: "All settings have been restored from the save file.",
      });
    },
    onError: (error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Fetch sent/failed message logs
export function useLogs() {
  return useQuery({
    queryKey: [api.logs.list.path],
    queryFn: async () => {
      const res = await fetch(api.logs.list.path);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return api.logs.list.responses[200].parse(await res.json()) as MessagedNation[];
    },
    refetchInterval: 5000,
  });
}

// Fetch nations currently being watched in timed mode (status = watching)
export function useTrackedNations() {
  return useQuery({
    queryKey: [api.trackedNations.list.path],
    queryFn: async () => {
      const res = await fetch(api.trackedNations.list.path);
      if (!res.ok) throw new Error("Failed to fetch tracked nations");
      return api.trackedNations.list.responses[200].parse(await res.json()) as TrackedNewNation[];
    },
    refetchInterval: 10000,
  });
}

// Fetch ALL tracked nations including sent/expired — for the Tracking history tab
export function useAllTrackedNations() {
  return useQuery({
    queryKey: [api.trackedNations.all.path],
    queryFn: async () => {
      const res = await fetch(api.trackedNations.all.path);
      if (!res.ok) throw new Error("Failed to fetch tracked nations history");
      return api.trackedNations.all.responses[200].parse(await res.json()) as TrackedNewNation[];
    },
    refetchInterval: 10000,
  });
}

// Toggle Bot Status
export function useToggleBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await fetch(api.bot.toggle.path, {
        method: api.bot.toggle.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to toggle bot status");
      return api.bot.toggle.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([api.config.get.path], data);
      toast({
        title: data.isActive ? "Bot Activated" : "Bot Deactivated",
        description: data.isActive
          ? "The bot is now scanning for new nations."
          : "The bot has stopped scanning.",
        variant: data.isActive ? "default" : "destructive",
      });
    },
  });
}

// Fetch ALL alliance leader logs (no row cap) — used for the Alliance tab and export
export function useAllianceLeaderLogs() {
  return useQuery({
    queryKey: [api.logs.allianceLeaders.path],
    queryFn: async () => {
      const res = await fetch(api.logs.allianceLeaders.path);
      if (!res.ok) throw new Error("Failed to fetch alliance leader logs");
      return res.json() as Promise<MessagedNation[]>;
    },
    refetchInterval: 10000,
  });
}

// Import alliance leader logs from a saved export file (post-wipe restore)
export function useImportAllianceLeaderLogs() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(api.logs.allianceLeadersImport.path, {
        method: api.logs.allianceLeadersImport.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Import failed");
      }
      return api.logs.allianceLeadersImport.responses[200].parse(await res.json());
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [api.logs.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.logs.allianceLeaders.path] });
      toast({
        title: "Alliance Leader Logs Imported",
        description: `${result.imported} leader(s) restored, ${result.skipped} already on record.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Manual Run Trigger
export function useRunBot() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.bot.run.path, { method: api.bot.run.method });
      if (!res.ok) throw new Error("Failed to run bot manually");
      return api.bot.run.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      toast({ title: "Manual Run Initiated", description: data.message });
      queryClient.invalidateQueries({ queryKey: [api.logs.list.path] });
    },
  });
}
