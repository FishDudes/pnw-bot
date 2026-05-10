import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT   = "https://politicsandwar.com/api/send-message/";
const GRAPHQL_ENDPOINT = "https://api.politicsandwar.com/graphql";

// ── GraphQL queries ──────────────────────────────────────────────────────────

const NEW_NATIONS_QUERY = `
  query {
    nations(first: 500, orderBy: {column: DATE, order: DESC}) {
      data {
        id
        nation_name
        leader_name
        date
        alliance_id
        last_active
      }
    }
  }
`;

// Existing-player: unaligned nations ordered by most-recently-active first.
// Catches nations that just left an alliance (they'll be near the top).
const EXISTING_PLAYER_QUERY = `
  query {
    nations(first: 500, alliance_id: 0, orderBy: {column: LAST_ACTIVE, order: DESC}) {
      data {
        id
        nation_name
        leader_name
        vacation_mode_turns
        last_active
        alliance_id
      }
    }
  }
`;

function buildActivityQuery(nationIds: number[]): string {
  return `
    query {
      nations(id: [${nationIds.join(",")}], first: 500) {
        data {
          id
          nation_name
          leader_name
          last_active
        }
      }
    }
  `;
}

// ── Constants ────────────────────────────────────────────────────────────────
const BAND_BELOW            = 20;
const BAND_ABOVE            = 10;
const ACTIVE_THRESHOLD_MS   = 10 * 60 * 1000;         // 10 min → considered offline
const TRACKING_EXPIRY_MS    = 2  * 24 * 60 * 60 * 1000; // 2 days → fallback send
const RECENTLY_UNALIGNED_MS = 24 * 60 * 60 * 1000;    // 24 h window for existing scan
const MIN_SCAN_INTERVAL_S   = 30;
const MAX_SCAN_INTERVAL_S   = 180;

// ── Cloudflare back-off state ────────────────────────────────────────────────
// If Cloudflare blocks us, we pause API calls for an increasing duration
// before retrying, rather than hammering and making it worse.
let cfBlockedUntil: number = 0;       // epoch ms
let cfBackoffMs: number    = 60_000;  // starts at 1 min, doubles each time up to 30 min

function recordCloudflareBlock() {
  cfBlockedUntil = Date.now() + cfBackoffMs;
  console.warn(`[API] Cloudflare block detected. Pausing API calls for ${Math.round(cfBackoffMs / 60000)}m.`);
  cfBackoffMs = Math.min(cfBackoffMs * 2, 30 * 60_000); // max 30 min back-off
}

function clearCloudflareBlock() {
  if (cfBlockedUntil > 0) {
    cfBlockedUntil = 0;
    cfBackoffMs    = 60_000; // reset back-off on success
  }
}

// ── Concurrency guard ────────────────────────────────────────────────────────
let cycleRunning = false;

// ── Scheduler ────────────────────────────────────────────────────────────────
let schedulerActive = false;

async function scheduleNextRun() {
  if (!schedulerActive) return;
  const config = await storage.getConfig();
  const intervalSeconds = Math.max(
    MIN_SCAN_INTERVAL_S,
    Math.min(MAX_SCAN_INTERVAL_S, config?.scanInterval ?? 120)
  );
  setTimeout(async () => {
    await runBotCycle();
    scheduleNextRun();
  }, intervalSeconds * 1000);
}

// ── Message sender ───────────────────────────────────────────────────────────
async function sendMessage(
  nationId: number,
  nationName: string,
  leaderName: string,
  config: { apiKey: string; subject: string; messageTemplate: string }
): Promise<{ success: boolean; error?: string }> {
  const params = new URLSearchParams();
  params.append("key",     config.apiKey);
  params.append("to",      String(nationId));
  params.append("subject", config.subject);
  params.append("message", autoLinkUrls(config.messageTemplate));

  try {
    const res = await axios.post(API_ENDPOINT, params, { timeout: 15000 });
    if (res.data.success) return { success: true };
    return { success: false, error: res.data.message || "Unknown error from P&W API" };
  } catch (error: any) {
    const detail = error?.response?.data
      ? JSON.stringify(error.response.data).substring(0, 200)
      : error?.message;
    return { success: false, error: detail || "Network error" };
  }
}

// ── GraphQL fetcher ──────────────────────────────────────────────────────────
// Uses a clean bot User-Agent instead of spoofing browser headers.
// Browser-header spoofing makes Cloudflare MORE suspicious because the TLS
// fingerprint from Node.js/axios never matches a real browser fingerprint.
async function fetchNationsFromGraphQL(query: string, apiKey: string): Promise<any[] | null> {
  // Respect active Cloudflare back-off window
  if (Date.now() < cfBlockedUntil) {
    return null; // silent skip — we're in back-off
  }

  let response;
  try {
    response = await axios.post(
      `${GRAPHQL_ENDPOINT}?api_key=${apiKey}`,
      { query },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept":        "application/json",
          // Honest bot User-Agent — API endpoints with a valid key don't need spoofing
          "User-Agent": "AtlantisRecruitmentBot/1.0 (+https://politicsandwar.com/alliance/id=14921)",
        },
        timeout: 20000,
      }
    );
  } catch (error: any) {
    const data = error?.response?.data;
    const body = typeof data === "string" ? data : JSON.stringify(data ?? "");

    if (body.includes("Just a moment") || body.includes("Cloudflare") || error?.response?.status === 429) {
      recordCloudflareBlock();
    } else {
      console.error("[API] GraphQL fetch error:", body.substring(0, 200) || error?.message);
    }
    return null;
  }

  const data = response.data;
  if (typeof data === "string" && (data.includes("Just a moment") || data.includes("Cloudflare"))) {
    recordCloudflareBlock();
    return null;
  }

  // Successful response — reset back-off
  clearCloudflareBlock();

  const nations = data?.data?.nations?.data;
  if (!nations || !Array.isArray(nations)) {
    console.error("[API] Unexpected GraphQL response:", JSON.stringify(data).substring(0, 200));
    return null;
  }

  return nations;
}

// ── Band resolver ─────────────────────────────────────────────────────────────
async function resolveBand(
  nations: any[],
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
): Promise<{ bandMin: number; bandMax: number }> {
  const maxIdInResponse = Math.max(...nations.map((n: any) => parseInt(n.id)));

  if (config.lastNationId === null || config.lastNationId === undefined) {
    await storage.updateLastNationId(maxIdInResponse);
    config.lastNationId = maxIdInResponse;
    console.log(`[Bot] Baseline anchored at nation #${maxIdInResponse}`);
  } else if (maxIdInResponse > config.lastNationId) {
    await storage.updateLastNationId(maxIdInResponse);
    config.lastNationId = maxIdInResponse;
  }

  return {
    bandMin: config.lastNationId - BAND_BELOW,
    bandMax: config.lastNationId + BAND_ABOVE,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MODE A — Instant new-nation scan
// ════════════════════════════════════════════════════════════════════════════
async function runInstantNewNationScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  // Retry previously failed messages
  const failed = await storage.getFailedNations();
  for (const f of failed) {
    if (f.messageType !== "new_player") continue;
    const result = await sendMessage(f.nationId, f.nationName, f.leaderName ?? "",
      { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate });
    await storage.upsertLog({
      nationId: f.nationId, nationName: f.nationName, leaderName: f.leaderName ?? "",
      status: result.success ? "success" : "failed",
      error:  result.success ? null : result.error,
      messageType: "new_player",
    });
    if (result.success) console.log(`[Instant] Retry sent → ${f.nationName}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const { bandMin, bandMax } = await resolveBand(nations, config);

  let sent = 0;
  for (const nation of nations) {
    const nationId = parseInt(nation.id);
    if (nationId < bandMin || nationId > bandMax) continue;
    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "new_player");
    if (!claimed) continue;

    sent++;
    const result = await sendMessage(nationId, nation.nation_name, nation.leader_name,
      { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate });
    await storage.upsertLog({
      nationId, nationName: nation.nation_name, leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error:  result.success ? null : result.error,
      messageType: "new_player",
    });
    if (result.success) console.log(`[Instant] Sent → ${nation.nation_name} (#${nationId})`);
    else console.error(`[Instant] Failed → ${nation.nation_name}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  if (sent > 0) console.log(`[Instant] ${sent} message(s) sent this cycle.`);
}

// ════════════════════════════════════════════════════════════════════════════
// MODE B — Timed new-nation scan
// Detects logins by watching for changes in last_active (not just "is recent").
// ════════════════════════════════════════════════════════════════════════════
async function runTimedNewNationScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  const minOfflineMs = Math.max(15, config.timedModeOfflineMinutes ?? 15) * 60 * 1000;

  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const { bandMin, bandMax } = await resolveBand(nations, config);

  // Add newly-seen band nations to tracking
  for (const nation of nations) {
    const nationId = parseInt(nation.id);
    if (nationId < bandMin || nationId > bandMax) continue;
    if (await storage.hasMessagedNation(nationId)) continue;
    const added = await storage.addTrackedNation(nationId, nation.nation_name, nation.leader_name);
    if (added) console.log(`[Timed] Tracking → ${nation.nation_name} (#${nationId})`);
  }

  const watching = await storage.getTrackedWatchingNations();
  if (watching.length === 0) return;

  const activityData = await fetchNationsFromGraphQL(
    buildActivityQuery(watching.map(n => n.nationId)), config.apiKey
  );
  if (!activityData) return;

  const activityMap = new Map<number, any>();
  for (const n of activityData) activityMap.set(parseInt(n.id), n);

  const now = new Date();

  for (const tracked of watching) {
    // 2-day expiry fallback
    if (now.getTime() - new Date(tracked.firstSeenAt).getTime() > TRACKING_EXPIRY_MS) {
      console.log(`[Timed] Expiry → ${tracked.nationName} (#${tracked.nationId}) — sending fallback after 2d`);
      await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "expired");
      continue;
    }

    const apiNation = activityMap.get(tracked.nationId);
    if (!apiNation?.last_active) continue;

    const currentLastActive = new Date(apiNation.last_active);
    const prevLastActive    = tracked.lastActiveAt ? new Date(tracked.lastActiveAt) : null;

    // First time seeing this nation's activity
    if (prevLastActive === null) {
      const isActive = (now.getTime() - currentLastActive.getTime()) < ACTIVE_THRESHOLD_MS;
      await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, isActive ? null : now);
      continue;
    }

    // Detect login: last_active moved forward = player just logged in
    const loginDetected = currentLastActive.getTime() > prevLastActive.getTime();

    if (loginDetected) {
      if (tracked.wentOfflineAt) {
        const offlineDuration = now.getTime() - new Date(tracked.wentOfflineAt).getTime();
        if (offlineDuration >= minOfflineMs) {
          console.log(
            `[Timed] Send → ${tracked.nationName} (#${tracked.nationId}) ` +
            `returned after ${Math.round(offlineDuration / 60000)}m offline`
          );
          await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "sent");
        } else {
          // Came back too soon — reset and keep watching
          await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
        }
      } else {
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
      }
    } else {
      // No new activity — check if they just went offline
      const isCurrentlyActive = (now.getTime() - currentLastActive.getTime()) < ACTIVE_THRESHOLD_MS;
      if (!isCurrentlyActive && !tracked.wentOfflineAt) {
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, now);
      } else {
        await storage.updateTrackedNationActivity(
          tracked.nationId,
          currentLastActive,
          tracked.wentOfflineAt ? new Date(tracked.wentOfflineAt) : null
        );
      }
    }
  }
}

async function sendTimedMessage(
  nationId: number,
  nationName: string,
  leaderName: string,
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>,
  trackingStatus: 'sent' | 'expired'
) {
  if (await storage.hasMessagedNation(nationId)) {
    await storage.markTrackedNationDone(nationId, trackingStatus);
    return;
  }
  const claimed = await storage.claimNation(nationId, nationName, leaderName, "new_player");
  if (!claimed) {
    await storage.markTrackedNationDone(nationId, trackingStatus);
    return;
  }

  const result = await sendMessage(nationId, nationName, leaderName,
    { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate });

  await storage.upsertLog({
    nationId, nationName, leaderName,
    status: result.success ? "success" : "failed",
    error:  result.success ? null : result.error,
    messageType: "new_player",
  });

  if (result.success) {
    await storage.markTrackedNationDone(nationId, trackingStatus, new Date());
  } else {
    console.error(`[Timed] Failed → ${nationName}: ${result.error}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Existing-player scan
// Targets any unaligned nation active in the last 24h (just left an alliance).
// ════════════════════════════════════════════════════════════════════════════
async function runExistingPlayerScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  if (!config.existingPlayerSubject || !config.existingPlayerMessageTemplate) return;

  // Retry failed existing-player messages
  const failed = (await storage.getFailedNations()).filter(n => n.messageType === "existing_player");
  for (const f of failed) {
    const result = await sendMessage(f.nationId, f.nationName, f.leaderName ?? "",
      { apiKey: config.apiKey, subject: config.existingPlayerSubject, messageTemplate: config.existingPlayerMessageTemplate });
    await storage.upsertLog({
      nationId: f.nationId, nationName: f.nationName, leaderName: f.leaderName ?? "",
      status: result.success ? "success" : "failed",
      error:  result.success ? null : result.error,
      messageType: "existing_player",
    });
    if (result.success) console.log(`[Existing] Retry sent → ${f.nationName}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const nations = await fetchNationsFromGraphQL(EXISTING_PLAYER_QUERY, config.apiKey);
  if (!nations) return;

  const oneDayAgo = new Date(Date.now() - RECENTLY_UNALIGNED_MS);
  const eligible  = nations.filter((n: any) => {
    const vacationTurns = parseInt(n.vacation_mode_turns) || 0;
    const lastActive    = n.last_active ? new Date(n.last_active) : null;
    const allianceId    = parseInt(n.alliance_id) || 0;
    return allianceId === 0 && vacationTurns === 0 && lastActive !== null && lastActive >= oneDayAgo;
  });

  let sent = 0;
  for (const nation of eligible) {
    const nationId = parseInt(nation.id);
    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "existing_player");
    if (!claimed) continue;

    sent++;
    const result = await sendMessage(nationId, nation.nation_name, nation.leader_name,
      { apiKey: config.apiKey, subject: config.existingPlayerSubject, messageTemplate: config.existingPlayerMessageTemplate });
    await storage.upsertLog({
      nationId, nationName: nation.nation_name, leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error:  result.success ? null : result.error,
      messageType: "existing_player",
    });
    if (result.success) console.log(`[Existing] Sent → ${nation.nation_name} (#${nationId})`);
    else console.error(`[Existing] Failed → ${nation.nation_name}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  if (sent > 0) console.log(`[Existing] ${sent} message(s) sent this cycle.`);
}

// ════════════════════════════════════════════════════════════════════════════
// Main cycle
// ════════════════════════════════════════════════════════════════════════════
export async function runBotCycle() {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    const config = await storage.getConfig();
    if (!config?.isActive || !config.apiKey) return;

    await storage.updateLastRun();

    const mode = config.newNationRecruitMode ?? "instant";
    if (mode === "timed") {
      await runTimedNewNationScan(config);
    } else {
      await runInstantNewNationScan(config);
    }

    await runExistingPlayerScan(config);
  } finally {
    cycleRunning = false;
  }
}

export function startBotService() {
  if (schedulerActive) return;
  schedulerActive = true;
  runBotCycle().then(() => scheduleNextRun());
}
