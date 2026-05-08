import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT = "https://politicsandwar.com/api/send-message/";
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
// No city minimum — targets any player who just became unaligned.
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
const BAND_BELOW          = 20;
const BAND_ABOVE          = 10;
// A nation's last_active being older than this → considered offline/inactive
const ACTIVE_THRESHOLD_MS = 10 * 60 * 1000;        // 10 minutes
// After 10 days with no login detected, send as fallback regardless
const TRACKING_EXPIRY_MS  = 10 * 24 * 60 * 60 * 1000; // 10 days
// Catch nations that became unaligned within the last 24h
const RECENTLY_UNALIGNED_MS = 24 * 60 * 60 * 1000; // 24 hours

const MIN_SCAN_INTERVAL_S = 30;
const MAX_SCAN_INTERVAL_S = 180;

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
  params.append("key", config.apiKey);
  params.append("to", String(nationId));
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
async function fetchNationsFromGraphQL(query: string, apiKey: string): Promise<any[] | null> {
  let response;
  try {
    response = await axios.post(
      `${GRAPHQL_ENDPOINT}?api_key=${apiKey}`,
      { query },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Origin": "https://politicsandwar.com",
          "Referer": "https://politicsandwar.com/",
        },
        timeout: 20000,
      }
    );
  } catch (error: any) {
    const data = error?.response?.data;
    if (data && typeof data === "string" && data.includes("Just a moment")) {
      console.error("Blocked by Cloudflare. Will retry next cycle.");
    } else {
      console.error("GraphQL fetch error:", data
        ? JSON.stringify(data).substring(0, 300)
        : error?.message);
    }
    return null;
  }

  const data = response.data;
  if (typeof data === "string" && data.includes("Just a moment")) {
    console.error("Blocked by Cloudflare. Will retry next cycle.");
    return null;
  }

  const nations = data?.data?.nations?.data;
  if (!nations || !Array.isArray(nations)) {
    console.error("Invalid GraphQL response:", JSON.stringify(data).substring(0, 200));
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
    console.log(`[New] First run: anchored baseline to ${maxIdInResponse}`);
  }

  if (maxIdInResponse > config.lastNationId) {
    await storage.updateLastNationId(maxIdInResponse);
    config.lastNationId = maxIdInResponse;
    console.log(`[New] Advanced baseline to ${maxIdInResponse}`);
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
  const failed = await storage.getFailedNations();
  for (const f of failed) {
    if (f.messageType !== "new_player") continue;
    console.log(`[Instant] Retrying ${f.nationId} (${f.nationName})...`);
    const result = await sendMessage(f.nationId, f.nationName, f.leaderName ?? "",
      { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate });
    await storage.upsertLog({
      nationId: f.nationId, nationName: f.nationName, leaderName: f.leaderName ?? "",
      status: result.success ? "success" : "failed",
      error: result.success ? null : result.error,
      messageType: "new_player",
    });
    console.log(result.success
      ? `[Instant] Retry OK: ${f.nationName}`
      : `[Instant] Retry failed: ${f.nationName}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("[Instant] Fetching recent nations...");
  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const { bandMin, bandMax } = await resolveBand(nations, config);
  console.log(`[Instant] Scanning band [${bandMin} – ${bandMax}]`);

  let sent = 0;
  for (const nation of nations) {
    const nationId = parseInt(nation.id);
    if (nationId < bandMin || nationId > bandMax) continue;
    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "new_player");
    if (!claimed) continue;

    sent++;
    console.log(`[Instant] Sending to ${nation.nation_name} (${nationId})...`);
    const result = await sendMessage(nationId, nation.nation_name, nation.leader_name,
      { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate });
    await storage.upsertLog({
      nationId, nationName: nation.nation_name, leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error: result.success ? null : result.error,
      messageType: "new_player",
    });
    if (result.success) console.log(`[Instant] Sent to ${nation.nation_name}`);
    else console.error(`[Instant] Failed: ${nation.nation_name}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`[Instant] Done. Sent ${sent} message(s).`);
}

// ════════════════════════════════════════════════════════════════════════════
// MODE B — Timed new-nation scan
//
// Core algorithm: detect a CHANGE in last_active (not just "is it recent?").
// When the API reports a newer last_active than what we stored, the player
// just logged in. Only then do we check the offline window and send.
// ════════════════════════════════════════════════════════════════════════════
async function runTimedNewNationScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  const minOfflineMs = Math.max(1, config.timedModeOfflineMinutes ?? 5) * 60 * 1000;

  // ── Step 1: discover band nations and add to tracking ────────────────────
  console.log("[Timed] Fetching recent nations...");
  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const { bandMin, bandMax } = await resolveBand(nations, config);
  console.log(`[Timed] Scanning band [${bandMin} – ${bandMax}]`);

  for (const nation of nations) {
    const nationId = parseInt(nation.id);
    if (nationId < bandMin || nationId > bandMax) continue;
    if (await storage.hasMessagedNation(nationId)) continue;
    const added = await storage.addTrackedNation(nationId, nation.nation_name, nation.leader_name);
    if (added) {
      console.log(`[Timed] Now tracking ${nation.nation_name} (${nationId})`);
    }
  }

  // ── Step 2: check activity for all watched nations ───────────────────────
  const watching = await storage.getTrackedWatchingNations();
  if (watching.length === 0) {
    console.log("[Timed] No nations currently being tracked.");
    return;
  }

  console.log(`[Timed] Checking activity for ${watching.length} tracked nation(s)...`);
  const ids = watching.map(n => n.nationId);
  const activityData = await fetchNationsFromGraphQL(buildActivityQuery(ids), config.apiKey);
  if (!activityData) {
    console.log("[Timed] Could not fetch activity data this cycle.");
    return;
  }

  const activityMap = new Map<number, any>();
  for (const n of activityData) activityMap.set(parseInt(n.id), n);

  const now = new Date();

  for (const tracked of watching) {
    // ── 10-day expiry: send as fallback and clear from tracking ─────────────
    const age = now.getTime() - new Date(tracked.firstSeenAt).getTime();
    if (age > TRACKING_EXPIRY_MS) {
      console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) expired after 10 days — sending as fallback`);
      await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "expired");
      continue;
    }

    const apiNation = activityMap.get(tracked.nationId);
    if (!apiNation || !apiNation.last_active) {
      // Nation not found in API (possibly deleted) — skip
      continue;
    }

    const currentLastActive = new Date(apiNation.last_active);
    const prevLastActive    = tracked.lastActiveAt ? new Date(tracked.lastActiveAt) : null;

    // ── First-time activity check (never seen before) ────────────────────────
    if (prevLastActive === null) {
      // Store the initial last_active. If they're already offline, record it.
      const isActive = (now.getTime() - currentLastActive.getTime()) < ACTIVE_THRESHOLD_MS;
      if (isActive) {
        // Online when first seen — wait for them to go offline first
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
        console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) first check — online, waiting for offline`);
      } else {
        // Already offline when first seen
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, now);
        console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) first check — already offline, waiting for return`);
      }
      continue;
    }

    // ── Detect login: last_active changed to a newer timestamp ──────────────
    // This is the ONLY reliable signal that the player just logged in.
    const loginDetected = currentLastActive.getTime() > prevLastActive.getTime();

    if (loginDetected) {
      console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) — new activity detected`);

      if (tracked.wentOfflineAt) {
        const offlineDuration = now.getTime() - new Date(tracked.wentOfflineAt).getTime();
        if (offlineDuration >= minOfflineMs) {
          // ✅ Was offline for required time, just came back → SEND NOW
          console.log(
            `[Timed] ${tracked.nationName} returned after ${Math.round(offlineDuration / 60000)}m offline — SENDING`
          );
          await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "sent");
        } else {
          // Went offline but for less than minimum time — reset, keep watching
          console.log(
            `[Timed] ${tracked.nationName} returned but offline only ${Math.round(offlineDuration / 60000)}m (need ${Math.round(minOfflineMs / 60000)}m) — resetting`
          );
          await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
        }
      } else {
        // Was still online, just more activity — update snapshot
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
      }
    } else {
      // ── No new activity: check if they've gone offline ──────────────────────
      const isCurrentlyActive = (now.getTime() - currentLastActive.getTime()) < ACTIVE_THRESHOLD_MS;

      if (!isCurrentlyActive && !tracked.wentOfflineAt) {
        // Just went offline — record the time
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, now);
        console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) went offline — waiting for return`);
      } else {
        // Still offline (wentOfflineAt already set) or still active with same last_active
        // Just keep the existing wentOfflineAt timestamp unchanged
        await storage.updateTrackedNationActivity(
          tracked.nationId,
          currentLastActive,
          tracked.wentOfflineAt ? new Date(tracked.wentOfflineAt) : null
        );
      }
    }
  }
}

// ── Timed mode: claim + send + log ───────────────────────────────────────────
async function sendTimedMessage(
  nationId: number,
  nationName: string,
  leaderName: string,
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>,
  trackingStatus: 'sent' | 'expired'
) {
  if (await storage.hasMessagedNation(nationId)) {
    console.log(`[Timed] ${nationName} already messaged — skipping`);
    await storage.markTrackedNationDone(nationId, trackingStatus);
    return;
  }

  const claimed = await storage.claimNation(nationId, nationName, leaderName, "new_player");
  if (!claimed) {
    console.log(`[Timed] ${nationName} claimed by another process — skipping`);
    await storage.markTrackedNationDone(nationId, trackingStatus);
    return;
  }

  const result = await sendMessage(nationId, nationName, leaderName,
    { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate });

  await storage.upsertLog({
    nationId, nationName, leaderName,
    status: result.success ? "success" : "failed",
    error: result.success ? null : result.error,
    messageType: "new_player",
  });

  if (result.success) {
    await storage.markTrackedNationDone(nationId, trackingStatus);
    console.log(`[Timed] Successfully sent to ${nationName}`);
  } else {
    console.error(`[Timed] Failed to send to ${nationName}: ${result.error}`);
    // Keep status 'watching' so next cycle retries via the claimNation retry queue
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Existing-player scan
// Targets any nation that recently became unaligned (just left an alliance).
// Ordered by last_active DESC so the freshest unaligned nations are first.
// Active within last 24h ensures we catch them quickly after leaving.
// 1-message-per-nation dedup is enforced via messagedNations UNIQUE constraint.
// ════════════════════════════════════════════════════════════════════════════
async function runExistingPlayerScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  if (!config.existingPlayerSubject || !config.existingPlayerMessageTemplate) {
    console.log("[Existing] No template configured. Skipping.");
    return;
  }

  const failed = await storage.getFailedNations();
  const existingFailed = failed.filter(n => n.messageType === "existing_player");
  for (const f of existingFailed) {
    console.log(`[Existing] Retrying ${f.nationId} (${f.nationName})...`);
    const result = await sendMessage(f.nationId, f.nationName, f.leaderName ?? "",
      { apiKey: config.apiKey, subject: config.existingPlayerSubject, messageTemplate: config.existingPlayerMessageTemplate });
    await storage.upsertLog({
      nationId: f.nationId, nationName: f.nationName, leaderName: f.leaderName ?? "",
      status: result.success ? "success" : "failed",
      error: result.success ? null : result.error,
      messageType: "existing_player",
    });
    console.log(result.success
      ? `[Existing] Retry OK: ${f.nationName}`
      : `[Existing] Retry failed: ${f.nationName}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("[Existing] Fetching recently-unaligned nations...");
  const nations = await fetchNationsFromGraphQL(EXISTING_PLAYER_QUERY, config.apiKey);
  if (!nations) return;

  // Only unaligned nations active within the last 24 hours and not in vacation mode.
  // No city minimum — we want anyone who just left an alliance.
  const oneDayAgo = new Date(Date.now() - RECENTLY_UNALIGNED_MS);

  const eligible = nations.filter((n: any) => {
    const vacationTurns = parseInt(n.vacation_mode_turns) || 0;
    const lastActive    = n.last_active ? new Date(n.last_active) : null;
    const allianceId    = parseInt(n.alliance_id) || 0;
    return (
      allianceId === 0 &&
      vacationTurns === 0 &&
      lastActive !== null &&
      lastActive >= oneDayAgo
    );
  });

  console.log(`[Existing] ${eligible.length} eligible nation(s) after filtering (from ${nations.length} unaligned).`);

  let sent = 0;
  for (const nation of eligible) {
    const nationId = parseInt(nation.id);
    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "existing_player");
    if (!claimed) continue;

    sent++;
    console.log(`[Existing] Sending to ${nation.nation_name} (${nationId})...`);
    const result = await sendMessage(nationId, nation.nation_name, nation.leader_name,
      { apiKey: config.apiKey, subject: config.existingPlayerSubject, messageTemplate: config.existingPlayerMessageTemplate });
    await storage.upsertLog({
      nationId, nationName: nation.nation_name, leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error: result.success ? null : result.error,
      messageType: "existing_player",
    });
    if (result.success) console.log(`[Existing] Sent to ${nation.nation_name}`);
    else console.error(`[Existing] Failed: ${nation.nation_name}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`[Existing] Done. Sent ${sent} message(s).`);
}

// ════════════════════════════════════════════════════════════════════════════
// Main cycle
// ════════════════════════════════════════════════════════════════════════════
export async function runBotCycle() {
  if (cycleRunning) {
    console.log("Cycle already running — skipping.");
    return;
  }
  cycleRunning = true;
  console.log("Starting bot cycle...");

  try {
    const config = await storage.getConfig();
    if (!config) { console.log("No config found. Skipping."); return; }
    if (!config.isActive) { console.log("Bot is inactive. Skipping."); return; }
    if (!config.apiKey) { console.log("No API key configured. Skipping."); return; }

    await storage.updateLastRun();

    const mode = config.newNationRecruitMode ?? "instant";
    console.log(`New-nation mode: ${mode}`);

    if (mode === "timed") {
      await runTimedNewNationScan(config);
    } else {
      await runInstantNewNationScan(config);
    }

    await runExistingPlayerScan(config);
    console.log("Bot cycle complete.");
  } finally {
    cycleRunning = false;
  }
}

export function startBotService() {
  if (schedulerActive) return;
  schedulerActive = true;
  runBotCycle().then(() => scheduleNextRun());
  console.log("Bot service started. Interval is read from config each cycle.");
}
