import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT = "https://politicsandwar.com/api/send-message/";
const GRAPHQL_ENDPOINT = "https://api.politicsandwar.com/graphql";

// Fetch recent nations — 500 is enough to cover any realistic band window
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

// ── Scanning band constants ────────────────────────────────────────────────
// Every cycle scans [lastNationId - BAND_BELOW, lastNationId + BAND_ABOVE].
// This catches gap IDs (nations created slightly out of order) and ensures
// new nations above the current max are also covered.
const BAND_BELOW = 20;
const BAND_ABOVE = 10;

// Mutex: prevents two cycles from running concurrently in the same process
let cycleRunning = false;

// ── Scheduler ─────────────────────────────────────────────────────────────
// Uses recursive setTimeout so the interval can change between cycles by
// re-reading scanInterval from the database each time.
let schedulerActive = false;
let schedulerTimeout: NodeJS.Timeout | null = null;

async function scheduleNextRun() {
  if (!schedulerActive) return;
  const config = await storage.getConfig();
  const intervalMinutes = Math.max(1, Math.min(3, config?.scanInterval ?? 2));
  const intervalMs = intervalMinutes * 60 * 1000;
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

export async function runBotCycle() {
  // Prevent concurrent cycles within the same process
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

    // ── PHASE 1: Retry previously failed / stuck-pending nations ─────────────
    const failedNations = await storage.getFailedNations();
    if (failedNations.length > 0) {
      console.log(`Retrying ${failedNations.length} previously failed nation(s)...`);
      for (const failed of failedNations) {
        console.log(`Retrying ${failed.nationId} (${failed.nationName})...`);
        const result = await sendMessage(
          failed.nationId, failed.nationName, failed.leaderName ?? "", config
        );
        await storage.upsertLog({
          nationId: failed.nationId,
          nationName: failed.nationName,
          leaderName: failed.leaderName ?? "",
          status: result.success ? "success" : "failed",
          error: result.success ? null : result.error,
        });
        if (result.success) {
          console.log(`Retry successful: ${failed.nationName}`);
        } else {
          console.error(`Retry failed for ${failed.nationName}: ${result.error}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // ── PHASE 2: Fetch recent nations from P&W ────────────────────────────────
    console.log("Fetching recent nations from P&W...");
    let graphqlResponse;
    try {
      graphqlResponse = await axios.post(
        `${GRAPHQL_ENDPOINT}?api_key=${config.apiKey}`,
        { query: NEW_NATIONS_QUERY },
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
      return;
    }

    const responseData = graphqlResponse.data;
    if (typeof responseData === "string" && responseData.includes("Just a moment")) {
      console.error("Blocked by Cloudflare. Will retry next cycle.");
      return;
    }

    const nations = responseData?.data?.nations?.data;
    if (!nations || !Array.isArray(nations)) {
      console.error("Invalid response from GraphQL API:", JSON.stringify(responseData).substring(0, 200));
      return;
    }

    // ── PHASE 3: Determine scan band ──────────────────────────────────────────
    // Find the highest nation ID in this response
    const maxIdInResponse = Math.max(...nations.map((n: any) => parseInt(n.id)));

    // On first run (no lastNationId stored), anchor the band to the current max
    if (config.lastNationId === null || config.lastNationId === undefined) {
      await storage.updateLastNationId(maxIdInResponse);
      config.lastNationId = maxIdInResponse;
      console.log(`First run: anchored scan baseline to nationId ${maxIdInResponse}`);
    }

    // If new nations appeared above our baseline, advance it
    if (maxIdInResponse > config.lastNationId) {
      await storage.updateLastNationId(maxIdInResponse);
      config.lastNationId = maxIdInResponse;
      console.log(`Advanced baseline to ${maxIdInResponse}`);
    }

    const bandMin = config.lastNationId - BAND_BELOW;
    const bandMax = config.lastNationId + BAND_ABOVE;

    console.log(
      `Scanning band [${bandMin} – ${bandMax}] (baseline: ${config.lastNationId}, ` +
      `response max: ${maxIdInResponse}, total fetched: ${nations.length})`
    );

    // ── PHASE 4: Message nations within the band ──────────────────────────────
    let newCount = 0;

    for (const nation of nations) {
      const nationId = parseInt(nation.id);

      // Only process nations within the scan band
      if (nationId < bandMin || nationId > bandMax) continue;

      // Quick pre-check: skip if already claimed (pending/success)
      const alreadyClaimed = await storage.hasMessagedNation(nationId);
      if (alreadyClaimed) {
        console.log(`Nation ${nationId} (${nation.nation_name}) already claimed/messaged. Skipping.`);
        continue;
      }

      // Atomically claim this nation BEFORE sending — prevents cross-process double sends
      const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name);
      if (!claimed) {
        console.log(`Nation ${nationId} (${nation.nation_name}) claimed by another process. Skipping.`);
        continue;
      }

      newCount++;
      console.log(`Sending to ${nation.nation_name} (${nationId}, founded ${nation.date})...`);

      const result = await sendMessage(nationId, nation.nation_name, nation.leader_name, config);

      await storage.upsertLog({
        nationId,
        nationName: nation.nation_name,
        leaderName: nation.leader_name,
        status: result.success ? "success" : "failed",
        error: result.success ? null : result.error,
      });

      if (result.success) {
        console.log(`Successfully messaged ${nation.nation_name}`);
      } else {
        console.error(`Failed to message ${nation.nation_name}: ${result.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Cycle complete. Messaged ${newCount} new nation(s).`);

  } finally {
    cycleRunning = false;
  }
}

export function startBotService() {
  if (schedulerActive) return;
  schedulerActive = true;

  // Run immediately on start, then schedule repeating runs
  runBotCycle().then(() => scheduleNextRun());
  console.log("Bot service started. Interval is read from config each cycle.");
}
