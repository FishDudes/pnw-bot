import { db } from "./db";
import {
  botConfig, messagedNations, trackedNewNations,
  type BotConfig, type UpdateConfigRequest,
  type MessagedNation, type InsertMessagedNation,
  type TrackedNewNation,
} from "@shared/schema";
import { eq, desc, and, or, lt, ne } from "drizzle-orm";

export interface IStorage {
  getConfig(): Promise<BotConfig | undefined>;
  updateConfig(config: UpdateConfigRequest): Promise<BotConfig>;
  toggleBot(isActive: boolean): Promise<BotConfig>;
  updateLastRun(): Promise<void>;
  updateLastNationId(nationId: number): Promise<void>;

  getLogs(): Promise<MessagedNation[]>;
  upsertLog(log: InsertMessagedNation): Promise<MessagedNation>;
  claimNation(nationId: number, nationName: string, leaderName: string, messageType?: string): Promise<boolean>;
  hasMessagedNation(nationId: number): Promise<boolean>;
  getFailedNations(): Promise<MessagedNation[]>;

  // Timed-mode tracking
  addTrackedNation(nationId: number, nationName: string, leaderName: string): Promise<boolean>;
  getTrackedWatchingNations(): Promise<TrackedNewNation[]>;
  getAllTrackedNations(): Promise<TrackedNewNation[]>;
  updateTrackedNationActivity(nationId: number, lastActiveAt: Date, wentOfflineAt: Date | null): Promise<void>;
  markTrackedNationDone(nationId: number, status: 'sent' | 'expired', messagedAt?: Date): Promise<void>;
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
      .limit(200);
  }

  async claimNation(nationId: number, nationName: string, leaderName: string, messageType: string = "new_player"): Promise<boolean> {
    const rows = await db.insert(messagedNations)
      .values({ nationId, nationName, leaderName, status: "pending", messageType })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

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

  async addLog(log: InsertMessagedNation): Promise<MessagedNation> {
    return this.upsertLog(log);
  }

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

  // ── Timed-mode tracking ──────────────────────────────────────────────────

  async addTrackedNation(nationId: number, nationName: string, leaderName: string): Promise<boolean> {
    const rows = await db.insert(trackedNewNations)
      .values({ nationId, nationName, leaderName, status: "watching" })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

  async getTrackedWatchingNations(): Promise<TrackedNewNation[]> {
    return await db.select()
      .from(trackedNewNations)
      .where(eq(trackedNewNations.status, "watching"))
      .orderBy(desc(trackedNewNations.firstSeenAt));
  }

  // Returns ALL tracked nations (watching + sent + expired) for audit/history view
  async getAllTrackedNations(): Promise<TrackedNewNation[]> {
    return await db.select()
      .from(trackedNewNations)
      .orderBy(desc(trackedNewNations.firstSeenAt))
      .limit(200);
  }

  async updateTrackedNationActivity(
    nationId: number,
    lastActiveAt: Date,
    wentOfflineAt: Date | null
  ): Promise<void> {
    await db.update(trackedNewNations)
      .set({ lastActiveAt, wentOfflineAt })
      .where(eq(trackedNewNations.nationId, nationId));
  }

  async markTrackedNationDone(nationId: number, status: 'sent' | 'expired', messagedAt?: Date): Promise<void> {
    await db.update(trackedNewNations)
      .set({ status, messagedAt: messagedAt ?? null })
      .where(eq(trackedNewNations.nationId, nationId));
  }
}

export const storage = new DatabaseStorage();
