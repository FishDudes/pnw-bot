import { z } from "zod";
import { insertBotConfigSchema, botConfig, messagedNations, updateConfigSchema } from "./schema";

export const api = {
  config: {
    get: {
      method: "GET" as const,
      path: "/api/config" as const,
      responses: {
        200: z.custom<typeof botConfig.$inferSelect>(),
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: "POST" as const,
      path: "/api/config" as const,
      input: updateConfigSchema,
      responses: {
        200: z.custom<typeof botConfig.$inferSelect>(),
      },
    },
  },
  logs: {
    list: {
      method: "GET" as const,
      path: "/api/logs" as const,
      responses: {
        200: z.array(z.custom<typeof messagedNations.$inferSelect>()),
      },
    },
  },
  bot: {
    toggle: {
      method: "POST" as const,
      path: "/api/bot/toggle" as const,
      input: z.object({ isActive: z.boolean() }),
      responses: {
        200: z.custom<typeof botConfig.$inferSelect>(),
      },
    },
    run: {
      method: "POST" as const,
      path: "/api/bot/run" as const, // Manual trigger
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
  },
};
