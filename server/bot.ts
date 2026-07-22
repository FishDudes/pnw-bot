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

// Unaligned nations — discovery feed for existing-player scanner
const UNALIGNED_NATIONS_QUERY = `
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

// Alliances — for the small-alliance leader scanner.
// Uses nested nations + alliance_position (LEADER/HEIR/OFFICER string enum) so the
// leader is found by structural position, not by custom role title.
const ALLIANCES_QUERY = `
  query {
    alliances(first: 500) {
      data {
        id
        name
        date
        nations {
          id
          nation_name
          leader_name
          alliance_position
          vacation_mode_turns
          num_cities
        }
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
const ACTIVE_THRESHOLD_MS     = 10 * 60 * 1000;            // 10 min → considered offline
const TRACKING_EXPIRY_MS      = 2  * 24 * 60 * 60 * 1000;  // 2 days → fallback send (new player)
const RECENTLY_UNALIGNED_MS   = 24 * 60 * 60 * 1000;       // 24h → instant existing-player scan
const TWO_WEEKS_MS            = 14 * 24 * 60 * 60 * 1000;  // 2-week inactivity threshold
const MAX_ALLIANCE_SIZE       = 8;
const TWO_YEARS_MS            = 2 * 365.25 * 24 * 60 * 60 * 1000; // alliance age ceiling
const SMALL_ALLIANCE_CITY_CAP = 15;                                  // micro-alliances (1-2 members) skipped if leader >15 cities
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

// ── GraphQL fetcher (nations) ────────────────────────────────────────────────
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

// ── GraphQL fetcher (alliances) ──────────────────────────────────────────────
async function fetchAlliancesFromGraphQL(apiKey: string): Promise<any[] | null> {
  if (Date.now() < cfBlockedUntil) return null;

  let response;
  try {
    response = await axios.post(
      `${GRAPHQL_ENDPOINT}?api_key=${apiKey}`,
      { query: ALLIANCES_QUERY },
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
      console.error("[API] Alliance fetch error:", body.substring(0, 200) || error?.message);
    }
    return null;
  }

  const data = response.data;
  if (typeof data === "string" && (data.includes("Just a moment") || data.includes("Cloudflare"))) {
    recordCloudflareBlock();
    return null;
  }
  clearCloudflareBlock();

  const alliances = data?.data?.alliances?.data;
  if (!alliances || !Array.isArray(alliances)) {
    console.error("[API] Unexpected alliances response:", JSON.stringify(data).substring(0, 200));
    return null;
  }
  return alliances;
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
// Existing-player scan — DUAL MODE (runs simultaneously each cycle)
//
// Trigger 1 — INSTANT: nation is unaligned and active within the last 24h
//             → catches players the moment they leave an alliance
//
// Trigger 2 — TIMED:   nation was inactive for ≥2 weeks and just logged in
//             → catches returning veterans the moment they return
//
// Both triggers use the same existingPlayerMessageTemplate.
// The messagedNations UNIQUE constraint ensures no nation is ever messaged twice.
// ════════════════════════════════════════════════════════════════════════════
async function runExistingPlayerScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  if (!config.existingPlayerSubject || !config.existingPlayerMessageTemplate) return;

  const epConfig = {
    apiKey:          config.apiKey,
    subject:         config.existingPlayerSubject,
    messageTemplate: config.existingPlayerMessageTemplate,
  };

  // ── Fetch unaligned nations ──────────────────────────────────────────────
  const nations = await fetchNationsFromGraphQL(UNALIGNED_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  const oneDayAgo = new Date(Date.now() - RECENTLY_UNALIGNED_MS);
  let instantSent = 0;

  // ── TRIGGER 1: Instant send for recently-active unaligned nations ────────
  for (const nation of nations) {
    const nationId     = parseInt(nation.id);
    const allianceId   = parseInt(nation.alliance_id) || 0;
    const vacationMode = parseInt(nation.vacation_mode_turns) || 0;
    const lastActive   = nation.last_active ? new Date(nation.last_active) : null;

    if (allianceId !== 0 || vacationMode > 0 || !lastActive) continue;
    if (lastActive < oneDayAgo) continue; // not recently active

    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "existing_instant");
    if (!claimed) continue;

    instantSent++;
    const result = await sendMessage(nationId, nation.nation_name, nation.leader_name, epConfig);
    await storage.upsertLog({
      nationId, nationName: nation.nation_name, leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error:  result.success ? null : result.error,
      messageType: "existing_instant",
    });
    if (result.success) console.log(`[Existing/Instant] Sent → ${nation.nation_name} (#${nationId})`);
    else console.error(`[Existing/Instant] Failed → ${nation.nation_name}: ${result.error}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  if (instantSent > 0) console.log(`[Existing/Instant] ${instantSent} message(s) sent this cycle.`);

  // ── TRIGGER 2: Timed — track all unaligned, fire on 2-week return ────────

  // Add newly discovered unaligned nations to the tracking table
  let newlyTracked = 0;
  for (const nation of nations) {
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
  if (newlyTracked > 0) console.log(`[Existing/Timed] Now tracking ${newlyTracked} new candidate(s).`);

  // Check all currently-watching nations for logins
  const watching = await storage.getTrackedExistingWatchingNations();
  if (watching.length === 0) return;

  const BATCH = 500;
  const apiMap = new Map<number, any>();
  for (let i = 0; i < watching.length; i += BATCH) {
    const ids   = watching.slice(i, i + BATCH).map(n => n.nationId);
    const batch = await fetchNationsFromGraphQL(buildExistingCheckQuery(ids), config.apiKey);
    if (!batch) return;
    for (const n of batch) apiMap.set(parseInt(n.id), n);
  }

  const now = Date.now();
  let timedSent = 0;

  for (const tracked of watching) {
    const apiNation = apiMap.get(tracked.nationId);
    if (!apiNation) continue;

    const allianceId = parseInt(apiNation.alliance_id) || 0;

    // Joined an alliance → disqualify from timed tracking
    if (allianceId !== 0) {
      await storage.disqualifyTrackedExistingNation(tracked.nationId);
      continue;
    }

    const currentLastActive = apiNation.last_active ? new Date(apiNation.last_active) : null;
    if (!currentLastActive) continue;

    const storedLastActive = tracked.lastSeenActiveAt ? new Date(tracked.lastSeenActiveAt) : null;

    if (!storedLastActive) {
      await storage.updateTrackedExistingNationActivity(tracked.nationId, currentLastActive);
      continue;
    }

    const loginDetected = currentLastActive.getTime() > storedLastActive.getTime();
    if (!loginDetected) continue;

    const inactivityMs = currentLastActive.getTime() - storedLastActive.getTime();

    if (inactivityMs >= TWO_WEEKS_MS) {
      if (await storage.hasMessagedNation(tracked.nationId)) {
        await storage.markTrackedExistingNationSent(tracked.nationId, new Date());
        continue;
      }
      const claimed = await storage.claimNation(
        tracked.nationId, tracked.nationName, tracked.leaderName ?? "", "existing_timed"
      );
      if (!claimed) {
        await storage.markTrackedExistingNationSent(tracked.nationId, new Date());
        continue;
      }

      const result = await sendMessage(
        tracked.nationId, tracked.nationName, tracked.leaderName ?? "", epConfig
      );
      await storage.upsertLog({
        nationId:    tracked.nationId,
        nationName:  tracked.nationName,
        leaderName:  tracked.leaderName ?? "",
        status:      result.success ? "success" : "failed",
        error:       result.success ? null : result.error,
        messageType: "existing_timed",
      });

      if (result.success) {
        await storage.markTrackedExistingNationSent(tracked.nationId, new Date());
        timedSent++;
        const weeks = Math.floor(inactivityMs / (7 * 24 * 60 * 60 * 1000));
        const days  = Math.floor((inactivityMs % (7 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));
        console.log(
          `[Existing/Timed] Sent → ${tracked.nationName} (#${tracked.nationId}) ` +
          `returned after ${weeks}w${days}d inactive`
        );
      } else {
        console.error(`[Existing/Timed] Failed → ${tracked.nationName}: ${result.error}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    } else {
      // Login but gap < 2 weeks — update stored value and keep watching
      await storage.updateTrackedExistingNationActivity(tracked.nationId, currentLastActive);
    }
  }

  if (timedSent > 0) console.log(`[Existing/Timed] ${timedSent} message(s) sent this cycle.`);
}

// ════════════════════════════════════════════════════════════════════════════
// Alliance scanner
//
// Finds alliances with ≤8 members and sends the alliance-leader template to
// the highest-ranking officer found, by numeric position:
//   5 = Leader  4 = Heir  3 = Officer
// This is position-based, not title-based, so custom role names ("Emperor",
// "Chancellor", etc.) don't affect detection. Uses the messagedNations dedup
// table so a leader never receives more than one message across all scanners.
// ════════════════════════════════════════════════════════════════════════════
async function runAllianceScan(
  config: NonNullable<Awaited<ReturnType<typeof storage.getConfig>>>
) {
  if (!config.allianceSubject || !config.allianceMessageTemplate) return;

  const alliances = await fetchAlliancesFromGraphQL(config.apiKey);
  if (!alliances) return;

  const allianceConfig = {
    apiKey:          config.apiKey,
    subject:         config.allianceSubject,
    messageTemplate: config.allianceMessageTemplate,
  };

  let sent = 0;

  for (const alliance of alliances) {
    // Skip invalid member counts
    const memberCount = alliance.nations?.length ?? 0;
    if (memberCount === 0 || memberCount > MAX_ALLIANCE_SIZE) continue;

    // Skip alliances older than 2 years — established alliances are not recruiting targets
    if (alliance.date) {
      const foundedMs = new Date(alliance.date).getTime();
      if (!isNaN(foundedMs) && Date.now() - foundedMs > TWO_YEARS_MS) continue;
    }

    const members: any[] = alliance.nations ?? [];
    if (members.length === 0) continue;

    // Exclude vacation-mode members — they cannot receive messages.
    // We still try heir/officer if the leader is on vacation.
    const pos = (n: any): string => (n.alliance_position ?? "").toUpperCase();
    const eligible = members.filter((n: any) => (parseInt(n.vacation_mode_turns) || 0) === 0);

    // Find highest-ranking eligible member by position string enum:
    // "LEADER" > "HEIR" > "OFFICER" > "MEMBER" > "APPLICANT"
    const leader =
      eligible.find((n: any) => pos(n) === "LEADER") ??
      eligible.find((n: any) => pos(n) === "HEIR") ??
      eligible.find((n: any) => pos(n) === "OFFICER");

    if (!leader) continue;

    // Micro-alliance filter (1–2 members): skip if the actual Leader has >15 cities.
    // Offshore bank nations typically have many cities; real small alliances have fewer.
    // We always check the Leader position's city count — even if that person is on
    // vacation mode — so a vacation Leader can't bypass this filter.
    // Alliances with 3–8 members are always eligible regardless of city count.
    if (memberCount <= 2) {
      const actualLeader = members.find((n: any) => pos(n) === "LEADER");
      const leaderCities = parseInt((actualLeader ?? leader).num_cities ?? "0") || 0;
      if (leaderCities > SMALL_ALLIANCE_CITY_CAP) {
        console.log(
          `[Alliance] Skip "${alliance.name}" — ${memberCount} member(s), ` +
          `leader has ${leaderCities} cities (>${SMALL_ALLIANCE_CITY_CAP} cap for micro-alliances)`
        );
        continue;
      }
    }

    const nationId   = parseInt(leader.id);
    const nationName = leader.nation_name ?? `Nation #${nationId}`;
    const leaderName = leader.leader_name ?? "";

    if (await storage.hasMessagedNation(nationId)) continue;
    const claimed = await storage.claimNation(nationId, nationName, leaderName, "alliance_leader");
    if (!claimed) continue;

    sent++;
    const result = await sendMessage(nationId, nationName, leaderName, allianceConfig);
    await storage.upsertLog({
      nationId, nationName, leaderName,
      status:      result.success ? "success" : "failed",
      error:       result.success ? null : result.error,
      messageType: "alliance_leader",
    });

    if (result.success) {
      console.log(
        `[Alliance] Sent → ${nationName} (#${nationId}), ` +
        `leader of "${alliance.name}" (${memberCount} members)`
      );
    } else {
      console.error(`[Alliance] Failed → ${nationName}: ${result.error}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (sent > 0) console.log(`[Alliance] ${sent} message(s) sent this cycle.`);
}

// ════════════════════════════════════════════════════════════════════════════
// Main cycle — all scanners run every cycle
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
    await runAllianceScan(config);
  } finally {
    cycleRunning = false;
  }
}

export function startBotService() {
  if (schedulerActive) return;
  schedulerActive = true;
  runBotCycle().then(() => scheduleNextRun());
}
