import { db } from "./db";
import { botConfig, messagedNations, type BotConfig, type InsertBotConfig, type UpdateConfigRequest, type MessagedNation, type InsertMessagedNation } from "@shared/schema";
import { eq, desc, and, or, lt, ne } from "drizzle-orm";

export interface IStorage {
  getConfig(): Promise<BotConfig | undefined>;
  updateConfig(config: UpdateConfigRequest): Promise<BotConfig>;
  toggleBot(isActive: boolean): Promise<BotConfig>;
  updateLastRun(): Promise<void>;
  updateLastNationId(nationId: number): Promise<void>;

  getLogs(): Promise<MessagedNation[]>;
  upsertLog(log: InsertMessagedNation): Promise<MessagedNation>;
  // Atomically claim a nation slot BEFORE sending. Returns true if this process
  // won the claim (INSERT succeeded), false if another process already claimed it.
  // messageType distinguishes which campaign sent the message.
  claimNation(nationId: number, nationName: string, leaderName: string, messageType?: string): Promise<boolean>;
  // Returns true for 'pending' or 'success' — i.e., nation has been claimed or done.
  // Returns false only for 'failed' so the retry queue can pick those up.
  hasMessagedNation(nationId: number): Promise<boolean>;
  // Returns nations that need retrying: explicit failures OR pending records stuck
  // for >10 minutes (which means the server crashed mid-send).
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
          existingPlayerSubject: "",
          existingPlayerMessageTemplate: "",
          isActive,
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
      .limit(100);
  }

  // Atomically claim a nation BEFORE sending the message.
  // Uses INSERT ... ON CONFLICT DO NOTHING so that only one server process
  // can claim a given nationId, even if multiple processes run simultaneously.
  // The UNIQUE constraint on nationId means a nation is only ever messaged once,
  // regardless of which campaign (new_player or existing_player) claims it first.
  // Returns true if this process claimed it, false if already claimed.
  async claimNation(nationId: number, nationName: string, leaderName: string, messageType: string = "new_player"): Promise<boolean> {
    const rows = await db.insert(messagedNations)
      .values({ nationId, nationName, leaderName, status: "pending", messageType })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

  // Update an existing record after the send attempt completes.
  // Uses ON CONFLICT DO UPDATE so retries also work (overwrite pending/failed row).
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
          messageType: log.messageType ?? "new_player",
        },
      })
      .returning();
    return entry;
  }

  // Keep addLog as an alias for upsertLog so any existing callers don't break
  async addLog(log: InsertMessagedNation): Promise<MessagedNation> {
    return this.upsertLog(log);
  }

  // Returns true for 'pending' or 'success' status (nation has been claimed/sent).
  // Returns false for 'failed' so the retry queue can pick those up.
  // This is a belt-and-suspenders check; the real guard is claimNation.
  async hasMessagedNation(nationId: number): Promise<boolean> {
    const existing = await db.select()
      .from(messagedNations)
      .where(and(
        eq(messagedNations.nationId, nationId),
        ne(messagedNations.status, 'failed')
      ))
      .limit(1);
    return existing.length > 0;
  }

  // Returns nations that need to be retried:
  //   - status = 'failed': explicit send failure
  //   - status = 'pending' older than 10 min: server crashed after claiming but before updating
  async getFailedNations(): Promise<MessagedNation[]> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    return await db.select()
      .from(messagedNations)
      .where(
        or(
          eq(messagedNations.status, 'failed'),
          and(
            eq(messagedNations.status, 'pending'),
            lt(messagedNations.messagedAt, tenMinutesAgo)
          )
        )
      );
  }
}

export const storage = new DatabaseStorage();
