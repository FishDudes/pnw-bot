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

// Fetch nations currently being tracked in timed mode
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
