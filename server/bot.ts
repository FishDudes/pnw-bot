import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT = "https://politicsandwar.com/api/send-message/";
const GRAPHQL_ENDPOINT = "https://api.politicsandwar.com/graphql";

// ── GraphQL queries ──────────────────────────────────────────────────────────

// Instant-mode: most recent 500 nations by creation date
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

// Existing-player scan: unaligned nations for recruitment
const EXISTING_PLAYER_QUERY = `
  query {
    nations(first: 500, alliance_id: 0, orderBy: {column: DATE, order: DESC}) {
      data {
        id
        nation_name
        leader_name
        num_cities
        vacation_mode_turns
        last_active
        alliance_id
      }
    }
  }
`;

// Build a targeted activity query for specific nation IDs (timed mode)
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
const BAND_BELOW = 20;
const BAND_ABOVE = 10;

// Timed-mode thresholds
const ONLINE_THRESHOLD_MS  = 10 * 60 * 1000;  // last_active within 10 min → "online"
const MIN_OFFLINE_MS       =  5 * 60 * 1000;  // must be offline ≥ 5 min before re-trigger
const TRACKING_EXPIRY_MS   =  6 * 60 * 60 * 1000; // 6h max watch time before fallback send

// ── Concurrency guard ────────────────────────────────────────────────────────
let cycleRunning = false;

// ── Scheduler ────────────────────────────────────────────────────────────────
let schedulerActive = false;

async function scheduleNextRun() {
  if (!schedulerActive) return;
  const config = await storage.getConfig();
  const intervalSeconds = Math.max(60, Math.min(180, config?.scanInterval ?? 120));
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

// ── Band helper ───────────────────────────────────────────────────────────────
async function resolveBand(nations: any[], config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>): Promise<{ bandMin: number; bandMax: number }> {
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
// MODE A — Instant new-nation scan (original behaviour)
// ════════════════════════════════════════════════════════════════════════════
async function runInstantNewNationScan(config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>) {
  // Retry previously failed new-player sends
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
    console.log(result.success ? `[Instant] Retry OK: ${f.nationName}` : `[Instant] Retry failed: ${f.nationName}: ${result.error}`);
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
    else console.error(`[Instant] Failed to send to ${nation.nation_name}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`[Instant] Done. Sent ${sent} message(s).`);
}

// ════════════════════════════════════════════════════════════════════════════
// MODE B — Timed new-nation scan
// Step 1: Add band nations to tracking table (don't message yet)
// Step 2: Each cycle, check last_active of tracked nations via targeted query
//         When a nation goes offline (last_active > 10 min) and then returns
//         online, send the message immediately so it is first in their inbox.
// ════════════════════════════════════════════════════════════════════════════
async function runTimedNewNationScan(config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>) {
  // ── Step 1: discover new nations in band and add to tracking ────────────
  console.log("[Timed] Fetching recent nations...");
  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const { bandMin, bandMax } = await resolveBand(nations, config);
  console.log(`[Timed] Scanning band [${bandMin} – ${bandMax}] for new nations to track`);

  for (const nation of nations) {
    const nationId = parseInt(nation.id);
    if (nationId < bandMin || nationId > bandMax) continue;

    // Skip if already messaged by any campaign
    if (await storage.hasMessagedNation(nationId)) continue;

    const added = await storage.addTrackedNation(nationId, nation.nation_name, nation.leader_name);
    if (added) {
      console.log(`[Timed] Now tracking ${nation.nation_name} (${nationId}) — waiting for offline→online cycle`);
    }
  }

  // ── Step 2: check activity of all currently-watched nations ─────────────
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

  // Build a lookup map for fast access
  const activityMap = new Map<number, any>();
  for (const n of activityData) activityMap.set(parseInt(n.id), n);

  const now = new Date();

  for (const tracked of watching) {
    // Expire after 6 hours — send as fallback so nation isn't missed
    const age = now.getTime() - new Date(tracked.firstSeenAt).getTime();
    if (age > TRACKING_EXPIRY_MS) {
      console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) expired after 6h — sending as fallback`);
      await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "expired");
      continue;
    }

    const apiNation = activityMap.get(tracked.nationId);
    if (!apiNation || !apiNation.last_active) {
      // Nation not found in API (possibly deleted) — skip
      continue;
    }

    const lastActive = new Date(apiNation.last_active);
    const isOnline = (now.getTime() - lastActive.getTime()) < ONLINE_THRESHOLD_MS;

    if (!isOnline) {
      // Nation is offline
      if (!tracked.wentOfflineAt) {
        // First time we detect them offline — record it
        await storage.updateTrackedNationActivity(tracked.nationId, lastActive, now);
        console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) went offline — waiting for return`);
      } else {
        // Still offline — just update last_active snapshot
        await storage.updateTrackedNationActivity(tracked.nationId, lastActive, new Date(tracked.wentOfflineAt));
      }
    } else {
      // Nation is online
      if (tracked.wentOfflineAt) {
        const offlineDuration = now.getTime() - new Date(tracked.wentOfflineAt).getTime();
        if (offlineDuration >= MIN_OFFLINE_MS) {
          // Was offline ≥ 5 min and is now back → SEND immediately
          console.log(`[Timed] ${tracked.nationName} (${tracked.nationId}) returned online after ${Math.round(offlineDuration / 60000)}m offline — SENDING`);
          await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "sent");
        } else {
          // Offline window too short — might just be a brief connection blip
          console.log(`[Timed] ${tracked.nationName} back online but offline duration only ${Math.round(offlineDuration / 60000)}m — waiting longer`);
          await storage.updateTrackedNationActivity(tracked.nationId, lastActive, new Date(tracked.wentOfflineAt));
        }
      } else {
        // Still online since we started tracking — update snapshot
        await storage.updateTrackedNationActivity(tracked.nationId, lastActive, null);
      }
    }
  }
}

// Helper: claim + send + log for timed mode
async function sendTimedMessage(
  nationId: number,
  nationName: string,
  leaderName: string,
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>,
  trackingStatus: 'sent' | 'expired'
) {
  // Double-check dedup before sending
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

  // On failure keep status 'watching' so the next cycle retries via messagedNations retry queue
  if (result.success) {
    await storage.markTrackedNationDone(nationId, trackingStatus);
  }

  if (result.success) console.log(`[Timed] Successfully sent to ${nationName}`);
  else console.error(`[Timed] Failed to send to ${nationName}: ${result.error}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Existing-player scan (unchanged)
// ════════════════════════════════════════════════════════════════════════════
async function runExistingPlayerScan(config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>) {
  if (!config.existingPlayerSubject || !config.existingPlayerMessageTemplate) {
    console.log("[Existing] No template configured. Skipping.");
    return;
  }

  // Retry failed existing-player sends
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
    console.log(result.success ? `[Existing] Retry OK: ${f.nationName}` : `[Existing] Retry failed: ${f.nationName}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("[Existing] Fetching unaligned nations...");
  const nations = await fetchNationsFromGraphQL(EXISTING_PLAYER_QUERY, config.apiKey);
  if (!nations) return;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const eligible = nations.filter((n: any) => {
    const cities = parseInt(n.num_cities) || 0;
    const vacationTurns = parseInt(n.vacation_mode_turns) || 0;
    const lastActive = n.last_active ? new Date(n.last_active) : null;
    const allianceId = parseInt(n.alliance_id) || 0;
    return allianceId === 0 && cities > 15 && vacationTurns === 0 && lastActive !== null && lastActive >= sevenDaysAgo;
  });

  console.log(`[Existing] ${eligible.length} eligible nation(s) after filtering.`);

  let sent = 0;
  for (const nation of eligible) {
    const nationId = parseInt(nation.id);
    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "existing_player");
    if (!claimed) continue;

    sent++;
    console.log(`[Existing] Sending to ${nation.nation_name} (${nationId}, cities: ${nation.num_cities})...`);
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
// Main cycle — reads mode from DB each run
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
