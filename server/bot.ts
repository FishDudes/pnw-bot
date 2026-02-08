import axios from "axios";
import { storage } from "./storage";

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
        founded
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
    });

    const nations = graphqlResponse.data?.data?.nations?.data;

    if (!nations || !Array.isArray(nations)) {
      console.error("Invalid response from GraphQL API:", JSON.stringify(graphqlResponse.data));
      return;
    }

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    console.log(`Found ${nations.length} recent nations. Filtering for those founded after ${thirtyMinutesAgo.toISOString()}`);

    // 2. Process each nation
    for (const nation of nations) {
      const foundedDate = new Date(nation.founded);
      
      // Only process if founded in the last 30 minutes
      if (foundedDate < thirtyMinutesAgo) {
        continue;
      }

      // Check if already messaged
      const alreadyMessaged = await storage.hasMessagedNation(parseInt(nation.id));
      if (alreadyMessaged) {
        continue;
      }

      // Send message
      console.log(`Sending message to nation ${nation.id} (${nation.nation_name})...`);
      
      const params = new URLSearchParams();
      params.append('key', config.apiKey);
      params.append('to', nation.id);
      params.append('subject', config.subject);
      params.append('message', config.messageTemplate);

      try {
        const msgResponse = await axios.post(API_ENDPOINT, params);
        
        if (msgResponse.data.success) {
          await storage.addLog({
            nationId: parseInt(nation.id),
            nationName: nation.nation_name,
            leaderName: nation.leader_name,
            status: 'success'
          });
          console.log(`Successfully messaged ${nation.nation_name}`);
        } else {
           // P&W API sometimes returns { success: false, message: "Reason" }
           const errorMsg = msgResponse.data.message || "Unknown error";
           await storage.addLog({
            nationId: parseInt(nation.id),
            nationName: nation.nation_name,
            leaderName: nation.leader_name,
            status: 'failed',
            error: errorMsg
          });
          console.error(`Failed to message ${nation.nation_name}: ${errorMsg}`);
        }
      } catch (error: any) {
        const errorMsg = error.message || "Network Error";
        await storage.addLog({
          nationId: parseInt(nation.id),
          nationName: nation.nation_name,
          leaderName: nation.leader_name,
          status: 'failed',
          error: errorMsg
        });
        console.error(`Error sending message to ${nation.nation_name}:`, errorMsg);
      }

      // Add a small delay to avoid rate limits (though 2 min interval is large)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error("Error in bot cycle:", error);
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
