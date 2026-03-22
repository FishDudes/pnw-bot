import { db } from "./db";
import { botConfig, messagedNations, type BotConfig, type InsertBotConfig, type UpdateConfigRequest, type MessagedNation, type InsertMessagedNation } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getConfig(): Promise<BotConfig | undefined>;
  updateConfig(config: UpdateConfigRequest): Promise<BotConfig>;
  toggleBot(isActive: boolean): Promise<BotConfig>;
  updateLastRun(): Promise<void>;
  updateLastNationId(nationId: number): Promise<void>;
  
  getLogs(): Promise<MessagedNation[]>;
  // Upsert: insert if new, update status/error/messagedAt if already exists
  upsertLog(log: InsertMessagedNation): Promise<MessagedNation>;
  hasMessagedNation(nationId: number): Promise<boolean>;
  getFailedNations(): Promise<MessagedNation[]>;
}

export class DatabaseStorage implements IStorage {
  async getConfig(): Promise<BotConfig | undefined> {
    const configs = await db.select().from(botConfig).limit(1);
    return configs[0];
  }

  async updateConfig(update: UpdateConfigRequest): Promise<BotConfig> {
    const existing = await this.getConfig();
    if (existing) {
      const [updated] = await db.update(botConfig)
        .set(update)
        .where(eq(botConfig.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(botConfig)
        .values({ ...update, isActive: false })
        .returning();
      return created;
    }
  }

  async toggleBot(isActive: boolean): Promise<BotConfig> {
    const existing = await this.getConfig();
    if (existing) {
      const [updated] = await db.update(botConfig)
        .set({ isActive })
        .where(eq(botConfig.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(botConfig)
        .values({ 
            apiKey: "", 
            subject: "Welcome", 
            messageTemplate: "Welcome!", 
            isActive 
        })
        .returning();
      return created;
    }
  }

  async updateLastRun(): Promise<void> {
    const existing = await this.getConfig();
    if (existing) {
      await db.update(botConfig)
        .set({ lastRunAt: new Date() })
        .where(eq(botConfig.id, existing.id));
    }
  }

  async updateLastNationId(nationId: number): Promise<void> {
    const existing = await this.getConfig();
    if (existing) {
      await db.update(botConfig)
        .set({ lastNationId: nationId })
        .where(eq(botConfig.id, existing.id));
    }
  }

  async getLogs(): Promise<MessagedNation[]> {
    return await db.select()
      .from(messagedNations)
      .orderBy(desc(messagedNations.messagedAt))
      .limit(50);
  }

  // Upsert: inserts a new log entry, or if the nationId already exists (unique constraint),
  // updates the status, error, and messagedAt. This prevents duplicate DB rows and
  // ensures retried nations update their record instead of creating a second one.
  async upsertLog(log: InsertMessagedNation): Promise<MessagedNation> {
    const [entry] = await db.insert(messagedNations)
      .values(log)
      .onConflictDoUpdate({
        target: messagedNations.nationId,
        set: {
          status: log.status,
          error: log.error ?? null,
          messagedAt: new Date(),
          nationName: log.nationName,
          leaderName: log.leaderName,
        },
      })
      .returning();
    return entry;
  }

  // Keep addLog as an alias for upsertLog so existing callers don't break
  async addLog(log: InsertMessagedNation): Promise<MessagedNation> {
    return this.upsertLog(log);
  }

  // Returns true only if a SUCCESS record exists — failed nations return false
  // so they can be picked up by the retry queue
  async hasMessagedNation(nationId: number): Promise<boolean> {
    const existing = await db.select()
      .from(messagedNations)
      .where(and(eq(messagedNations.nationId, nationId), eq(messagedNations.status, 'success')))
      .limit(1);
    return existing.length > 0;
  }

  // Returns all nations that previously failed, so the bot can retry them
  async getFailedNations(): Promise<MessagedNation[]> {
    return await db.select()
      .from(messagedNations)
      .where(eq(messagedNations.status, 'failed'));
  }
}

export const storage = new DatabaseStorage();
