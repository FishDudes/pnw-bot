import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL_OVERRIDE ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set for the application to start.");
}

const ssl = connectionString.includes("sslmode=require")
  ? { rejectUnauthorized: false }
  : false;

export const pool = new Pool({ connectionString, ssl });
export const db = drizzle(pool, { schema });

// Automatically create / update the schema on every startup.
// Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is fully idempotent —
// safe to run against both fresh and existing databases.
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_config (
        id                              SERIAL PRIMARY KEY,
        api_key                         TEXT NOT NULL,
        subject                         TEXT NOT NULL DEFAULT 'Welcome!',
        message_template                TEXT NOT NULL DEFAULT 'Welcome to Politics and War!',
        existing_player_subject         TEXT NOT NULL DEFAULT '',
        existing_player_message_template TEXT NOT NULL DEFAULT '',
        is_active                       BOOLEAN NOT NULL DEFAULT FALSE,
        last_run_at                     TIMESTAMP,
        last_nation_id                  INTEGER,
        scan_interval                   INTEGER NOT NULL DEFAULT 120
      );

      ALTER TABLE bot_config
        ADD COLUMN IF NOT EXISTS existing_player_subject          TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS existing_player_message_template TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS messaged_nations (
        id           SERIAL PRIMARY KEY,
        nation_id    INTEGER NOT NULL,
        nation_name  TEXT NOT NULL,
        leader_name  TEXT,
        messaged_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        status       TEXT NOT NULL,
        error        TEXT,
        message_type TEXT NOT NULL DEFAULT 'new_player'
      );

      ALTER TABLE messaged_nations
        ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'new_player';

      CREATE UNIQUE INDEX IF NOT EXISTS uq_messaged_nations_nation_id
        ON messaged_nations (nation_id);

      CREATE INDEX IF NOT EXISTS idx_messaged_nations_nation_status
        ON messaged_nations (nation_id, status);
    `);
    console.log("Database migrations applied successfully.");
  } finally {
    client.release();
  }
}
