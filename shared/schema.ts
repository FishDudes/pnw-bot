import { pgTable, text, serial, boolean, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

// Store configuration for the bot
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
  // 'instant' = message as soon as nation appears in band scan (original behaviour)
  // 'timed'   = track new nations and message the moment they return online after
  //             going offline for at least 5 minutes, so the message is first in feed
  newNationRecruitMode: text("new_nation_recruit_mode").notNull().default("instant"),
});

// Store history of messaged nations to avoid duplicates.
// nationId is unique: each nation can only have one record (upserted on retry).
// messageType distinguishes which campaign sent the message: 'new_player' | 'existing_player'
export const messagedNations = pgTable("messaged_nations", {
  id: serial("id").primaryKey(),
  nationId: integer("nation_id").notNull(),
  nationName: text("nation_name").notNull(),
  leaderName: text("leader_name"),
  messagedAt: timestamp("messaged_at").defaultNow().notNull(),
  status: text("status").notNull(), // 'success', 'failed', 'pending'
  error: text("error"),
  messageType: text("message_type").notNull().default("new_player"), // 'new_player' | 'existing_player'
}, (table) => [
  index("idx_messaged_nations_nation_status").on(table.nationId, table.status),
  unique("uq_messaged_nations_nation_id").on(table.nationId),
]);

// Timed-mode tracking table.
// New nations are added here when detected in the band scan.
// Each cycle their last_active is checked via P&W API.
// When they go offline (last_active > 10 min ago) and then come back online,
// the bot sends the message immediately so it is first in their inbox.
// status: 'watching' | 'sent' | 'expired'
export const trackedNewNations = pgTable("tracked_new_nations", {
  id: serial("id").primaryKey(),
  nationId: integer("nation_id").notNull(),
  nationName: text("nation_name").notNull(),
  leaderName: text("leader_name"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at"),    // most recent last_active from P&W
  wentOfflineAt: timestamp("went_offline_at"),   // first time we detected them offline
  status: text("status").notNull().default("watching"),
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
