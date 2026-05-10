import { pgTable, text, serial, boolean, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const botConfig = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  apiKey: text("api_key").notNull(),
  subject: text("subject").notNull().default("Welcome!"),
  messageTemplate: text("message_template").notNull().default("Welcome to Politics and War!"),
  existingPlayerSubject: text("existing_player_subject").notNull().default(""),
  existingPlayerMessageTemplate: text("existing_player_message_template").notNull().default(""),
  isActive: boolean("is_active").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  lastNationId: integer("last_nation_id"),
  scanInterval: integer("scan_interval").notNull().default(120),
  // 'instant' = message immediately on band scan
  // 'timed'   = track and message on offline→online return
  newNationRecruitMode: text("new_nation_recruit_mode").notNull().default("instant"),
  // Timed mode: minimum minutes a nation must be offline before we send on return
  timedModeOfflineMinutes: integer("timed_mode_offline_minutes").notNull().default(5),
});

// History of sent messages — UNIQUE on nation_id prevents any nation being messaged twice
export const messagedNations = pgTable("messaged_nations", {
  id: serial("id").primaryKey(),
  nationId: integer("nation_id").notNull(),
  nationName: text("nation_name").notNull(),
  leaderName: text("leader_name"),
  messagedAt: timestamp("messaged_at").defaultNow().notNull(),
  status: text("status").notNull(), // 'success' | 'failed' | 'pending'
  error: text("error"),
  messageType: text("message_type").notNull().default("new_player"), // 'new_player' | 'existing_player'
}, (table) => [
  index("idx_messaged_nations_nation_status").on(table.nationId, table.status),
  unique("uq_messaged_nations_nation_id").on(table.nationId),
]);

// Timed-mode tracking: new nations being watched before message is sent
// status: 'watching' | 'sent' | 'expired'
export const trackedNewNations = pgTable("tracked_new_nations", {
  id: serial("id").primaryKey(),
  nationId: integer("nation_id").notNull(),
  nationName: text("nation_name").notNull(),
  leaderName: text("leader_name"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at"),
  wentOfflineAt: timestamp("went_offline_at"),
  status: text("status").notNull().default("watching"),
  // Set when the recruitment message is actually sent
  messagedAt: timestamp("messaged_at"),
}, (table) => [
  unique("uq_tracked_new_nations_nation_id").on(table.nationId),
]);

// === SCHEMAS ===

export const insertBotConfigSchema = createInsertSchema(botConfig);
export const insertMessagedNationSchema = createInsertSchema(messagedNations);
export const insertTrackedNewNationSchema = createInsertSchema(trackedNewNations);

// === TYPES ===

export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;

export type MessagedNation = typeof messagedNations.$inferSelect;
export type InsertMessagedNation = z.infer<typeof insertMessagedNationSchema>;

export type TrackedNewNation = typeof trackedNewNations.$inferSelect;
export type InsertTrackedNewNation = z.infer<typeof insertTrackedNewNationSchema>;

// === API TYPES ===

export const updateConfigSchema = insertBotConfigSchema.omit({ id: true, lastRunAt: true });
export type UpdateConfigRequest = z.infer<typeof updateConfigSchema>;
