import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type BotConfig, type UpdateConfigRequest, type MessagedNation } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// Fetch Bot Configuration
export function useConfig() {
  return useQuery({
    queryKey: [api.config.get.path],
    queryFn: async () => {
      const res = await fetch(api.config.get.path);
      if (res.status === 404) return null; // Handle case where config doesn't exist yet
      if (!res.ok) throw new Error("Failed to fetch configuration");
      return api.config.get.responses[200].parse(await res.json());
    },
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

// Fetch Logs
export function useLogs() {
  return useQuery({
    queryKey: [api.logs.list.path],
    queryFn: async () => {
      const res = await fetch(api.logs.list.path);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return api.logs.list.responses[200].parse(await res.json());
    },
    refetchInterval: 5000, // Poll every 5 seconds for new logs
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
          ? "The bot is now scanning for new nations every 2 minutes." 
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
      const res = await fetch(api.bot.run.path, {
        method: api.bot.run.method,
      });
      
      if (!res.ok) throw new Error("Failed to run bot manually");
      return api.bot.run.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      toast({
        title: "Manual Run Initiated",
        description: data.message,
      });
      // Invalidate logs to show new messages
      queryClient.invalidateQueries({ queryKey: [api.logs.list.path] });
    },
  });
}
