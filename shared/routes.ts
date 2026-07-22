import { z } from "zod";
import { insertBotConfigSchema, botConfig, messagedNations, trackedNewNations, updateConfigSchema } from "./schema";

export type { BotConfig, UpdateConfigRequest, MessagedNation, TrackedNewNation } from "./schema";

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
    import: {
      method: "POST" as const,
      path: "/api/config/import" as const,
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
    allianceLeaders: {
      method: "GET" as const,
      path: "/api/logs/alliance-leaders" as const,
      responses: {
        200: z.array(z.custom<typeof messagedNations.$inferSelect>()),
      },
    },
    allianceLeadersImport: {
      method: "POST" as const,
      path: "/api/logs/alliance-leaders/import" as const,
      responses: {
        200: z.object({ imported: z.number(), skipped: z.number() }),
      },
    },
  },
  trackedNations: {
    list: {
      method: "GET" as const,
      path: "/api/tracked-nations" as const,
      responses: {
        200: z.array(z.custom<typeof trackedNewNations.$inferSelect>()),
      },
    },
    all: {
      method: "GET" as const,
      path: "/api/tracked-nations/all" as const,
      responses: {
        200: z.array(z.custom<typeof trackedNewNations.$inferSelect>()),
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
      path: "/api/bot/run" as const,
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
  },
};
