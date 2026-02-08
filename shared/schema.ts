import { pgTable, text, serial, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

// Store configuration for the bot
export const botConfig = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  apiKey: text("api_key").notNull(),
  subject: text("subject").notNull().default("Welcome!"),
  messageTemplate: text("message_template").notNull().default("Welcome to Politics and War!"),
  isActive: boolean("is_active").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
});

// Store history of messaged nations to avoid duplicates
export const messagedNations = pgTable("messaged_nations", {
  id: serial("id").primaryKey(),
  nationId: integer("nation_id").notNull().unique(),
  nationName: text("nation_name").notNull(),
  leaderName: text("leader_name"),
  messagedAt: timestamp("messaged_at").defaultNow().notNull(),
  status: text("status").notNull(), // 'success', 'failed'
  error: text("error"),
});

// === SCHEMAS ===

export const insertBotConfigSchema = createInsertSchema(botConfig);
export const insertMessagedNationSchema = createInsertSchema(messagedNations);

// === TYPES ===

export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;

export type MessagedNation = typeof messagedNations.$inferSelect;
export type InsertMessagedNation = z.infer<typeof insertMessagedNationSchema>;

// === API TYPES ===

export const updateConfigSchema = insertBotConfigSchema.omit({ id: true, lastRunAt: true });
export type UpdateConfigRequest = z.infer<typeof updateConfigSchema>;
