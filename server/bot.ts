import axios from "axios";
import { storage } from "./storage";
import { autoLinkUrls } from "./urlLinker";

const API_ENDPOINT = "https://politicsandwar.com/api/send-message/";
const GRAPHQL_ENDPOINT = "https://api.politicsandwar.com/graphql";

// GraphQL query to get new nations with a filter for the last 30 minutes
const NEW_NATIONS_QUERY = `
  query {
    nations(first: 50, orderBy: {column: DATE, order: DESC}) {
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

export async function runBotCycle() {
  console.log("Starting bot cycle...");
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

  try {
    await storage.updateLastRun();

    // 1. Fetch new nations
    console.log("Fetching new nations...");
    const graphqlResponse = await axios.post(`${GRAPHQL_ENDPOINT}?api_key=${config.apiKey}`, {
      query: NEW_NATIONS_QUERY
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Origin': 'https://politicsandwar.com',
        'Referer': 'https://politicsandwar.com/',
      }
    });

    // Detect Cloudflare challenge (returns HTML instead of JSON)
    const responseData = graphqlResponse.data;
    if (typeof responseData === 'string' && responseData.includes('Just a moment')) {
      console.error("GraphQL API returned a Cloudflare challenge. The API may be temporarily rate-limiting this server IP.");
      return;
    }

    const nations = responseData?.data?.nations?.data;

    if (!nations || !Array.isArray(nations)) {
      console.error("Invalid response from GraphQL API:", JSON.stringify(responseData).substring(0, 200));
      return;
    }

    // Track the highest nation ID seen this cycle
    let maxNationIdSeen = config.lastNationId ?? 0;

    // Today's date string (YYYY-MM-DD) for fallback filtering on first run
    const todayStr = new Date().toISOString().split('T')[0];
    // Yesterday's date string as a safety buffer
    const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`Found ${nations.length} recent nations. lastNationId cursor: ${config.lastNationId ?? 'none (first run)'}`);

    let newCount = 0;
    // 2. Process each nation
    for (const nation of nations) {
      const nationId = parseInt(nation.id);

      // Track the highest nation ID we've encountered regardless of filtering
      if (nationId > maxNationIdSeen) {
        maxNationIdSeen = nationId;
      }

      if (config.lastNationId !== null && config.lastNationId !== undefined) {
        // Normal operation: only process nations with ID higher than our cursor
        if (nationId <= config.lastNationId) {
          continue;
        }
      } else {
        // First run (no cursor yet): only process today's and yesterday's nations by date string
        // P&W 'date' field is YYYY-MM-DD (date only, no time component)
        if (nation.date < yesterdayStr) {
          continue;
        }
      }

      // Check if already messaged (deduplication guard)
      const alreadyMessaged = await storage.hasMessagedNation(nationId);
      if (alreadyMessaged) {
        console.log(`Nation ${nationId} (${nation.nation_name}) already messaged. Skipping.`);
        continue;
      }

      newCount++;
      // Send message
      console.log(`Sending message to nation ${nationId} (${nation.nation_name}, founded ${nation.date})...`);
      
      const params = new URLSearchParams();
      params.append('key', config.apiKey);
      params.append('to', nation.id);
      params.append('subject', config.subject);
      params.append('message', autoLinkUrls(config.messageTemplate));

      try {
        const msgResponse = await axios.post(API_ENDPOINT, params);
        
        if (msgResponse.data.success) {
          await storage.addLog({
            nationId,
            nationName: nation.nation_name,
            leaderName: nation.leader_name,
            status: 'success'
          });
          console.log(`Successfully messaged ${nation.nation_name}`);
        } else {
          const errorMsg = msgResponse.data.message || "Unknown error";
          await storage.addLog({
            nationId,
            nationName: nation.nation_name,
            leaderName: nation.leader_name,
            status: 'failed',
            error: errorMsg
          });
          console.error(`Failed to message ${nation.nation_name}: ${errorMsg}`);
        }
      } catch (error: any) {
        const detail = error?.response?.data ? JSON.stringify(error.response.data) : error?.message;
        const errorMsg = detail || "Network Error";
        await storage.addLog({
          nationId,
          nationName: nation.nation_name,
          leaderName: nation.leader_name,
          status: 'failed',
          error: errorMsg
        });
        console.error(`Error sending message to ${nation.nation_name}:`, errorMsg);
      }

      // Small delay between messages to avoid hammering the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update the ID cursor to the highest nation ID seen this cycle
    if (maxNationIdSeen > (config.lastNationId ?? 0)) {
      await storage.updateLastNationId(maxNationIdSeen);
      console.log(`Updated lastNationId cursor to ${maxNationIdSeen}`);
    }

    console.log(`Cycle complete. Messaged ${newCount} new nation(s).`);

  } catch (error: any) {
    const responseData = error?.response?.data;
    if (responseData && typeof responseData === 'string' && responseData.includes('Just a moment')) {
      console.error("Bot cycle blocked by Cloudflare challenge on P&W API. Will retry next cycle (IP may be temporarily rate-limited).");
    } else {
      const detail = responseData ? JSON.stringify(responseData).substring(0, 300) : error?.message;
      console.error("Error in bot cycle:", detail);
    }
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
