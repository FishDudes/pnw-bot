import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT = "https://politicsandwar.com/api/send-message/";
const GRAPHQL_ENDPOINT = "https://api.politicsandwar.com/graphql";

// Fetch up to 500 recent nations — large enough to catch up after a long outage
// (P&W creates ~10–20 nations/hour; 500 covers ~25–50 hours of downtime)
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

// Mutex: prevents two cycles from running concurrently (e.g. auto + manual trigger)
let cycleRunning = false;

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
  // Prevent concurrent cycles — if one is already running, skip
  if (cycleRunning) {
    console.log("Cycle already running. Skipping this trigger to prevent duplicates.");
    return;
  }
  cycleRunning = true;

  console.log("Starting bot cycle...");

  try {
    const config = await storage.getConfig();

    if (!config) {
      console.log("No configuration found. Skipping cycle.");
      return;
    }

    if (!config.isActive) {
      console.log("Bot is inactive. Skipping cycle.");
      return;
    }

    if (!config.apiKey) {
      console.log("No API key configured. Skipping cycle.");
      return;
    }

    await storage.updateLastRun();

    // ── PHASE 1: Retry previously failed nations ──────────────────────────────
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

        // Small delay between retries
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // ── PHASE 2: Fetch and message new nations ────────────────────────────────
    console.log("Fetching new nations...");
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
        console.error(
          "Bot cycle blocked by Cloudflare challenge on P&W API. Will retry next cycle."
        );
      } else {
        const detail = responseData
          ? JSON.stringify(responseData).substring(0, 300)
          : error?.message;
        console.error("Error fetching nations from GraphQL:", detail);
      }
      return;
    }

    // Detect Cloudflare challenge returned as 200 with HTML body
    const responseData = graphqlResponse.data;
    if (typeof responseData === "string" && responseData.includes("Just a moment")) {
      console.error(
        "Bot cycle blocked by Cloudflare challenge on P&W API. Will retry next cycle."
      );
      return;
    }

    const nations = responseData?.data?.nations?.data;
    if (!nations || !Array.isArray(nations)) {
      console.error(
        "Invalid response from GraphQL API:",
        JSON.stringify(responseData).substring(0, 200)
      );
      return;
    }

    // Yesterday's date as a fallback filter for first-run (no cursor set yet)
    const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    console.log(
      `Found ${nations.length} recent nations. lastNationId cursor: ${
        config.lastNationId ?? "none (first run)"
      }`
    );

    // Track the highest nation ID seen this cycle to advance the cursor
    let maxNationIdSeen = config.lastNationId ?? 0;
    let newCount = 0;

    for (const nation of nations) {
      const nationId = parseInt(nation.id);

      // Always track max ID regardless of filtering
      if (nationId > maxNationIdSeen) {
        maxNationIdSeen = nationId;
      }

      // Cursor filter: skip nations at or below our last-seen cursor
      if (config.lastNationId !== null && config.lastNationId !== undefined) {
        if (nationId <= config.lastNationId) {
          continue;
        }
      } else {
        // First run: filter to last 2 days by date string
        if (nation.date < yesterdayStr) {
          continue;
        }
      }

      // Quick pre-check: skip if already claimed (pending/success) or succeeded.
      // The real guard is claimNation below, but this avoids unnecessary DB writes.
      const alreadyClaimed = await storage.hasMessagedNation(nationId);
      if (alreadyClaimed) {
        console.log(`Nation ${nationId} (${nation.nation_name}) already claimed/messaged. Skipping.`);
        continue;
      }

      // Atomically claim this nation in the DB BEFORE sending the message.
      // Uses INSERT ... ON CONFLICT DO NOTHING — if two server processes are
      // running simultaneously, only ONE wins the insert and proceeds to send.
      const claimed = await storage.claimNation(nationId, nation.nation_name, nation.leader_name);
      if (!claimed) {
        console.log(`Nation ${nationId} (${nation.nation_name}) already claimed by another process. Skipping.`);
        continue;
      }

      newCount++;
      console.log(
        `Sending message to nation ${nationId} (${nation.nation_name}, founded ${nation.date})...`
      );

      const result = await sendMessage(nationId, nation.nation_name, nation.leader_name, config);

      // Update the pending record to success or failed
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

      // Small delay between messages to avoid hammering the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Advance the cursor to the highest ID seen this cycle
    if (maxNationIdSeen > (config.lastNationId ?? 0)) {
      await storage.updateLastNationId(maxNationIdSeen);
      console.log(`Updated lastNationId cursor to ${maxNationIdSeen}`);
    }

    console.log(`Cycle complete. Messaged ${newCount} new nation(s).`);

  } finally {
    // Always release the mutex, even if an error occurs
    cycleRunning = false;
  }
}

// Start the interval
let intervalId: NodeJS.Timeout | null = null;

export function startBotService() {
  if (intervalId) return;

  // Run immediately on start
  runBotCycle();

  // Then every 2 minutes
  intervalId = setInterval(runBotCycle, 2 * 60 * 1000);
  console.log("Bot service started (2 minute interval).");
}
