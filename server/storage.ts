import { db } from "./db";
import { botConfig, messagedNations, type BotConfig, type InsertBotConfig, type UpdateConfigRequest, type MessagedNation, type InsertMessagedNation } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getConfig(): Promise<BotConfig | undefined>;
  updateConfig(config: UpdateConfigRequest): Promise<BotConfig>;
  toggleBot(isActive: boolean): Promise<BotConfig>;
  updateLastRun(): Promise<void>;
  
  getLogs(): Promise<MessagedNation[]>;
  addLog(log: InsertMessagedNation): Promise<MessagedNation>;
  hasMessagedNation(nationId: number): Promise<boolean>;
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
        .values({ ...update, isActive: false }) // Default to inactive on creation if not specified
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
      // Should create if not exists, though unlikely to toggle before creating
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

  async getLogs(): Promise<MessagedNation[]> {
    return await db.select()
      .from(messagedNations)
      .orderBy(desc(messagedNations.messagedAt))
      .limit(50);
  }

  async addLog(log: InsertMessagedNation): Promise<MessagedNation> {
    const [entry] = await db.insert(messagedNations)
      .values(log)
      .returning();
    return entry;
  }

  async hasMessagedNation(nationId: number): Promise<boolean> {
    const existing = await db.select()
      .from(messagedNations)
      .where(and(eq(messagedNations.nationId, nationId), eq(messagedNations.status, 'success')))
      .limit(1);
    return existing.length > 0;
  }
}

export const storage = new DatabaseStorage();
