import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT = "https://politicsandwar.com/api/send-message/";
const GRAPHQL_ENDPOINT = "https://api.politicsandwar.com/graphql";

// ── New-nation scan query (most recent 500 by creation date) ────────────────
const NEW_NATIONS_QUERY = `
  query {
    nations(first: 500, orderBy: {column: DATE, order: DESC}) {
      data {
        id
        nation_name
        leader_name
        date
        alliance_id
      }
    }
  }
`;

// ── Existing-player scan query ──────────────────────────────────────────────
// Fetches up to 500 unaligned nations ordered by most-recently-active first.
// Client-side filters then enforce: >15 cities, not in vacation mode, active ≤7 days.
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

// ── Scanning band constants (new-nation scanner) ────────────────────────────
const BAND_BELOW = 20;
const BAND_ABOVE = 10;

// Mutex: prevents two cycles from running concurrently in the same process
let cycleRunning = false;

// ── Scheduler ───────────────────────────────────────────────────────────────
// Uses recursive setTimeout so the interval can change between cycles by
// re-reading scanInterval from the database each time.
let schedulerActive = false;
let schedulerTimeout: NodeJS.Timeout | null = null;

async function scheduleNextRun() {
  if (!schedulerActive) return;
  const config = await storage.getConfig();
  const intervalSeconds = Math.max(60, Math.min(180, config?.scanInterval ?? 120));
  const intervalMs = intervalSeconds * 1000;
  schedulerTimeout = setTimeout(async () => {
    await runBotCycle();
    scheduleNextRun();
  }, intervalMs);
}

// Helper: send a message to one nation; returns { success, error }
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
    const msgResponse = await axios.post(API_ENDPOINT, params, { timeout: 15000 });
    if (msgResponse.data.success) {
      return { success: true };
    } else {
      const errorMsg = msgResponse.data.message || "Unknown error from P&W API";
      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    const detail = error?.response?.data
      ? JSON.stringify(error.response.data).substring(0, 200)
      : error?.message;
    return { success: false, error: detail || "Network error" };
  }
}

// ── Helper: fetch nations from GraphQL ──────────────────────────────────────
async function fetchNationsFromGraphQL(
  query: string,
  apiKey: string
): Promise<any[] | null> {
  let response;
  try {
    response = await axios.post(
      `${GRAPHQL_ENDPOINT}?api_key=${apiKey}`,
      { query },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Origin": "https://politicsandwar.com",
          "Referer": "https://politicsandwar.com/",
        },
        timeout: 20000,
      }
    );
  } catch (error: any) {
    const responseData = error?.response?.data;
    if (responseData && typeof responseData === "string" && responseData.includes("Just a moment")) {
      console.error("Blocked by Cloudflare. Will retry next cycle.");
    } else {
      const detail = responseData
        ? JSON.stringify(responseData).substring(0, 300)
        : error?.message;
      console.error("Error fetching nations from GraphQL:", detail);
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

// ── New-nation scan ──────────────────────────────────────────────────────────
async function runNewNationScan(config: Awaited<ReturnType<typeof storage.getConfig>>) {
  if (!config) return;

  // ── PHASE 1: Retry previously failed / stuck-pending nations ──────────────
  const failedNations = await storage.getFailedNations();
  if (failedNations.length > 0) {
    console.log(`[New] Retrying ${failedNations.length} previously failed nation(s)...`);
    for (const failed of failedNations) {
      if (failed.messageType !== "new_player") continue; // each scanner retries its own type
      console.log(`[New] Retrying ${failed.nationId} (${failed.nationName})...`);
      const result = await sendMessage(
        failed.nationId, failed.nationName, failed.leaderName ?? "",
        { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate }
      );
      await storage.upsertLog({
        nationId: failed.nationId,
        nationName: failed.nationName,
        leaderName: failed.leaderName ?? "",
        status: result.success ? "success" : "failed",
        error: result.success ? null : result.error,
        messageType: "new_player",
      });
      if (result.success) {
        console.log(`[New] Retry successful: ${failed.nationName}`);
      } else {
        console.error(`[New] Retry failed for ${failed.nationName}: ${result.error}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // ── PHASE 2: Fetch recent nations ─────────────────────────────────────────
  console.log("[New] Fetching recent nations from P&W...");
  const nations = await fetchNationsFromGraphQL(NEW_NATIONS_QUERY, config.apiKey);
  if (!nations) return;

  // ── PHASE 3: Determine scan band ──────────────────────────────────────────
  const maxIdInResponse = Math.max(...nations.map((n: any) => parseInt(n.id)));

  if (config.lastNationId === null || config.lastNationId === undefined) {
    await storage.updateLastNationId(maxIdInResponse);
    config.lastNationId = maxIdInResponse;
    console.log(`[New] First run: anchored scan baseline to nationId ${maxIdInResponse}`);
  }

  if (maxIdInResponse > config.lastNationId) {
    await storage.updateLastNationId(maxIdInResponse);
    config.lastNationId = maxIdInResponse;
    console.log(`[New] Advanced baseline to ${maxIdInResponse}`);
  }

  const bandMin = config.lastNationId - BAND_BELOW;
  const bandMax = config.lastNationId + BAND_ABOVE;

  console.log(
    `[New] Scanning band [${bandMin} – ${bandMax}] (baseline: ${config.lastNationId}, ` +
    `response max: ${maxIdInResponse}, total fetched: ${nations.length})`
  );

  // ── PHASE 4: Message nations within the band ──────────────────────────────
  let newCount = 0;

  for (const nation of nations) {
    const nationId = parseInt(nation.id);
    if (nationId < bandMin || nationId > bandMax) continue;

    const alreadyClaimed = await storage.hasMessagedNation(nationId);
    if (alreadyClaimed) {
      console.log(`[New] Nation ${nationId} (${nation.nation_name}) already claimed/messaged. Skipping.`);
      continue;
    }

    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "new_player");
    if (!claimed) {
      console.log(`[New] Nation ${nationId} (${nation.nation_name}) claimed by another process. Skipping.`);
      continue;
    }

    newCount++;
    console.log(`[New] Sending to ${nation.nation_name} (${nationId}, founded ${nation.date})...`);

    const result = await sendMessage(
      nationId, nation.nation_name, nation.leader_name,
      { apiKey: config.apiKey, subject: config.subject, messageTemplate: config.messageTemplate }
    );

    await storage.upsertLog({
      nationId,
      nationName: nation.nation_name,
      leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error: result.success ? null : result.error,
      messageType: "new_player",
    });

    if (result.success) {
      console.log(`[New] Successfully messaged ${nation.nation_name}`);
    } else {
      console.error(`[New] Failed to message ${nation.nation_name}: ${result.error}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[New] Scan complete. Messaged ${newCount} new nation(s).`);
}

// ── Existing-player scan ─────────────────────────────────────────────────────
// Criteria: unaligned (alliance_id = 0), more than 15 cities, not in vacation
// mode (vacation_mode_turns = 0), and active within the last 7 days.
async function runExistingPlayerScan(config: Awaited<ReturnType<typeof storage.getConfig>>) {
  if (!config) return;
  if (!config.existingPlayerSubject || !config.existingPlayerMessageTemplate) {
    console.log("[Existing] No existing-player template configured. Skipping.");
    return;
  }

  // ── PHASE 1: Retry previously failed existing-player nations ──────────────
  const failedNations = await storage.getFailedNations();
  if (failedNations.length > 0) {
    const existingFailed = failedNations.filter(n => n.messageType === "existing_player");
    if (existingFailed.length > 0) {
      console.log(`[Existing] Retrying ${existingFailed.length} previously failed nation(s)...`);
      for (const failed of existingFailed) {
        console.log(`[Existing] Retrying ${failed.nationId} (${failed.nationName})...`);
        const result = await sendMessage(
          failed.nationId, failed.nationName, failed.leaderName ?? "",
          {
            apiKey: config.apiKey,
            subject: config.existingPlayerSubject,
            messageTemplate: config.existingPlayerMessageTemplate,
          }
        );
        await storage.upsertLog({
          nationId: failed.nationId,
          nationName: failed.nationName,
          leaderName: failed.leaderName ?? "",
          status: result.success ? "success" : "failed",
          error: result.success ? null : result.error,
          messageType: "existing_player",
        });
        if (result.success) {
          console.log(`[Existing] Retry successful: ${failed.nationName}`);
        } else {
          console.error(`[Existing] Retry failed for ${failed.nationName}: ${result.error}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // ── PHASE 2: Fetch unaligned nations from P&W ─────────────────────────────
  console.log("[Existing] Fetching unaligned nations from P&W...");
  const nations = await fetchNationsFromGraphQL(EXISTING_PLAYER_QUERY, config.apiKey);
  if (!nations) return;

  // ── PHASE 3: Apply client-side filters ────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const eligible = nations.filter((n: any) => {
    const cities = parseInt(n.num_cities) || 0;
    const vacationTurns = parseInt(n.vacation_mode_turns) || 0;
    const lastActive = n.last_active ? new Date(n.last_active) : null;
    const allianceId = parseInt(n.alliance_id) || 0;

    return (
      allianceId === 0 &&               // must be unaligned
      cities > 15 &&                    // must have more than 15 cities
      vacationTurns === 0 &&            // must not be in vacation mode
      lastActive !== null &&
      lastActive >= sevenDaysAgo        // must have been active within 7 days
    );
  });

  console.log(
    `[Existing] ${eligible.length} eligible nation(s) after filtering ` +
    `(from ${nations.length} unaligned fetched).`
  );

  // ── PHASE 4: Message eligible nations not already in logs ─────────────────
  let sentCount = 0;

  for (const nation of eligible) {
    const nationId = parseInt(nation.id);

    const alreadyClaimed = await storage.hasMessagedNation(nationId);
    if (alreadyClaimed) {
      console.log(`[Existing] Nation ${nationId} (${nation.nation_name}) already messaged. Skipping.`);
      continue;
    }

    // Atomic claim — UNIQUE on nationId means if new-player bot already messaged
    // this nation, this INSERT fails and we skip it correctly.
    const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name, "existing_player");
    if (!claimed) {
      console.log(`[Existing] Nation ${nationId} (${nation.nation_name}) claimed by another process. Skipping.`);
      continue;
    }

    sentCount++;
    console.log(`[Existing] Sending to ${nation.nation_name} (${nationId}, cities: ${nation.num_cities})...`);

    const result = await sendMessage(
      nationId, nation.nation_name, nation.leader_name,
      {
        apiKey: config.apiKey,
        subject: config.existingPlayerSubject,
        messageTemplate: config.existingPlayerMessageTemplate,
      }
    );

    await storage.upsertLog({
      nationId,
      nationName: nation.nation_name,
      leaderName: nation.leader_name,
      status: result.success ? "success" : "failed",
      error: result.success ? null : result.error,
      messageType: "existing_player",
    });

    if (result.success) {
      console.log(`[Existing] Successfully messaged ${nation.nation_name}`);
    } else {
      console.error(`[Existing] Failed to message ${nation.nation_name}: ${result.error}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[Existing] Scan complete. Messaged ${sentCount} existing nation(s).`);
}

// ── Main bot cycle: runs both scanners in sequence ───────────────────────────
export async function runBotCycle() {
  if (cycleRunning) {
    console.log("Cycle already running. Skipping this trigger to prevent duplicates.");
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

    await runNewNationScan(config);
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
