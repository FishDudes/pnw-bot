import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT     = "https://politicsandwar.com/api/send-message/";
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

// Unaligned nations — used for discovering new existing-player candidates
const EXISTING_PLAYER_QUERY = `
  query {
    nations(first: 500, alliance_id: 0) {
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

function buildExistingCheckQuery(nationIds: number[]): string {
  return `
    query {
      nations(id: [${nationIds.join(",")}], first: 500) {
        data {
          id
          nation_name
          leader_name
          last_active
          alliance_id
        }
      }
    }
  `;
}

// ── Constants ────────────────────────────────────────────────────────────────
const BAND_BELOW              = 20;
const BAND_ABOVE              = 10;
const ACTIVE_THRESHOLD_MS     = 10 * 60 * 1000;           // 10 min → considered offline
const TRACKING_EXPIRY_MS      = 2  * 24 * 60 * 60 * 1000; // 2 days → fallback send (new player)
const TWO_WEEKS_MS            = 14 * 24 * 60 * 60 * 1000; // 2-week inactivity threshold
const MIN_SCAN_INTERVAL_S     = 30;
const MAX_SCAN_INTERVAL_S     = 180;

// ── Cloudflare back-off state ────────────────────────────────────────────────
let cfBlockedUntil: number = 0;
let cfBackoffMs: number    = 60_000;

function recordCloudflareBlock() {
  cfBlockedUntil = Date.now() + cfBackoffMs;
  console.warn(`[API] Cloudflare block detected. Pausing API calls for ${Math.round(cfBackoffMs / 60000)}m.`);
  cfBackoffMs = Math.min(cfBackoffMs * 2, 30 * 60_000);
}

function clearCloudflareBlock() {
  if (cfBlockedUntil > 0) {
    cfBlockedUntil = 0;
    cfBackoffMs    = 60_000;
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
async function fetchNationsFromGraphQL(query: string, apiKey: string): Promise<any[] | null> {
  if (Date.now() < cfBlockedUntil) return null;

  let response;
  try {
    response = await axios.post(
      `${GRAPHQL_ENDPOINT}?api_key=${apiKey}`,
      { query },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept":        "application/json",
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
// ════════════════════════════════════════════════════════════════════════════
async function runTimedNewNationScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  const minOfflineMs = Math.max(15, config.timedModeOfflineMinutes ?? 15) * 60 * 1000;

  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const { bandMin, bandMax } = await resolveBand(nations, config);

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
    if (now.getTime() - new Date(tracked.firstSeenAt).getTime() > TRACKING_EXPIRY_MS) {
      console.log(`[Timed] Expiry → ${tracked.nationName} (#${tracked.nationId}) — sending fallback after 2d`);
      await sendTimedMessage(tracked.nationId, tracked.nationName, tracked.leaderName ?? "", config, "expired");
      continue;
    }

    const apiNation = activityMap.get(tracked.nationId);
    if (!apiNation?.last_active) continue;

    const currentLastActive = new Date(apiNation.last_active);
    const prevLastActive    = tracked.lastActiveAt ? new Date(tracked.lastActiveAt) : null;

    if (prevLastActive === null) {
      const isActive = (now.getTime() - currentLastActive.getTime()) < ACTIVE_THRESHOLD_MS;
      await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, isActive ? null : now);
      continue;
    }

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
          await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
        }
      } else {
        await storage.updateTrackedNationActivity(tracked.nationId, currentLastActive, null);
      }
    } else {
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
// Existing-player scan — timed mode
//
// Discovers unaligned nations each cycle. Tracks their last_active.
// When last_active changes (login detected) AND they were inactive for ≥2 weeks,
// sends the existing-player message immediately.
// Skips nations in an alliance or already messaged.
// ════════════════════════════════════════════════════════════════════════════
async function runExistingPlayerScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  if (!config.existingPlayerSubject || !config.existingPlayerMessageTemplate) return;

  // ── Step 1: Discover new unaligned candidates ──────────────────────────
  const discovered = await fetchNationsFromGraphQL(EXISTING_PLAYER_QUERY, config.apiKey);
  if (!discovered) return;

  let newlyTracked = 0;
  for (const nation of discovered) {
    const nationId     = parseInt(nation.id);
    const allianceId   = parseInt(nation.alliance_id) || 0;
    const vacationMode = parseInt(nation.vacation_mode_turns) || 0;
    if (allianceId !== 0 || vacationMode > 0) continue;
    if (await storage.hasMessagedNation(nationId)) continue;

    const lastActiveAt = nation.last_active ? new Date(nation.last_active) : null;
    const added = await storage.addTrackedExistingNation(
      nationId, nation.nation_name, nation.leader_name, lastActiveAt
    );
    if (added) newlyTracked++;
  }
  if (newlyTracked > 0) console.log(`[Existing] Now tracking ${newlyTracked} new candidate(s).`);

  // ── Step 2: Check tracked nations for logins ───────────────────────────
  const watching = await storage.getTrackedExistingWatchingNations();
  if (watching.length === 0) return;

  // Query in batches of 500
  const BATCH = 500;
  const apiMap = new Map<number, any>();
  for (let i = 0; i < watching.length; i += BATCH) {
    const ids   = watching.slice(i, i + BATCH).map(n => n.nationId);
    const batch = await fetchNationsFromGraphQL(buildExistingCheckQuery(ids), config.apiKey);
    if (!batch) return; // blocked — try again next cycle
    for (const n of batch) apiMap.set(parseInt(n.id), n);
  }

  const now = Date.now();
  let sent = 0;

  for (const tracked of watching) {
    const apiNation = apiMap.get(tracked.nationId);

    // Nation not returned by API — likely deleted or data gap; skip this cycle
    if (!apiNation) continue;

    const allianceId = parseInt(apiNation.alliance_id) || 0;

    // Joined an alliance → disqualify
    if (allianceId !== 0) {
      await storage.disqualifyTrackedExistingNation(tracked.nationId);
      continue;
    }

    const currentLastActive = apiNation.last_active ? new Date(apiNation.last_active) : null;
    if (!currentLastActive) continue;

    const storedLastActive = tracked.lastSeenActiveAt ? new Date(tracked.lastSeenActiveAt) : null;

    // First time we have an activity reading — just store it
    if (!storedLastActive) {
      await storage.updateTrackedExistingNationActivity(tracked.nationId, currentLastActive);
      continue;
    }

    // Check for login: last_active moved forward = they just logged in
    const loginDetected = currentLastActive.getTime() > storedLastActive.getTime();
    if (!loginDetected) continue; // no change this cycle

    // Login detected — check inactivity gap
    const inactivityMs = currentLastActive.getTime() - storedLastActive.getTime();

    if (inactivityMs >= TWO_WEEKS_MS) {
      // ≥2 weeks inactive — send message immediately
      if (await storage.hasMessagedNation(tracked.nationId)) {
        await storage.markTrackedExistingNationSent(tracked.nationId, new Date());
        continue;
      }
      const claimed = await storage.claimNation(
        tracked.nationId, tracked.nationName, tracked.leaderName ?? "", "existing_player"
      );
      if (!claimed) {
        await storage.markTrackedExistingNationSent(tracked.nationId, new Date());
        continue;
      }

      const result = await sendMessage(
        tracked.nationId, tracked.nationName, tracked.leaderName ?? "",
        {
          apiKey:           config.apiKey,
          subject:          config.existingPlayerSubject,
          messageTemplate:  config.existingPlayerMessageTemplate,
        }
      );
      await storage.upsertLog({
        nationId:    tracked.nationId,
        nationName:  tracked.nationName,
        leaderName:  tracked.leaderName ?? "",
        status:      result.success ? "success" : "failed",
        error:       result.success ? null : result.error,
        messageType: "existing_player",
      });

      if (result.success) {
        await storage.markTrackedExistingNationSent(tracked.nationId, new Date());
        sent++;
        const weeks = Math.floor(inactivityMs / (7 * 24 * 60 * 60 * 1000));
        const days  = Math.floor((inactivityMs % (7 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));
        console.log(
          `[Existing] Sent → ${tracked.nationName} (#${tracked.nationId}) ` +
          `returned after ${weeks}w${days}d inactive`
        );
      } else {
        console.error(`[Existing] Failed → ${tracked.nationName}: ${result.error}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    } else {
      // Logged in but gap < 2 weeks — update stored last_active and keep watching
      await storage.updateTrackedExistingNationActivity(tracked.nationId, currentLastActive);
    }
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
