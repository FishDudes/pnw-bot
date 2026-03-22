import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { startBotService, runBotCycle } from "./bot";
import axios from "axios";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Config routes
  app.get(api.config.get.path, async (req, res) => {
    const config = await storage.getConfig();
    if (!config) {
      return res.status(404).json({ message: "Config not found" });
    }
    res.json(config);
  });

  app.post(api.config.update.path, async (req, res) => {
    const input = api.config.update.input.parse(req.body);
    const config = await storage.updateConfig(input);
    res.json(config);
  });

  // Logs routes
  app.get(api.logs.list.path, async (req, res) => {
    const logs = await storage.getLogs();
    res.json(logs);
  });

  // Bot control routes
  app.post(api.bot.toggle.path, async (req, res) => {
    const { isActive } = req.body;
    const config = await storage.toggleBot(isActive);
    res.json(config);
  });

  app.post(api.bot.run.path, async (req, res) => {
    // Run asynchronously, don't wait for full completion to respond
    runBotCycle().catch(console.error);
    res.json({ message: "Bot cycle triggered" });
  });

  // Health check routes for UptimeRobot / Better Stack
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "online", bot: "running", timestamp: new Date().toISOString() });
  });

  // Start the background bot service
  startBotService();

  // Self-ping every 4 minutes to keep the container alive.
  // Uses the public Replit domain so the ping registers as real external traffic,
  // which prevents the container from going to sleep.
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const pingUrl = replitDomain
    ? `https://${replitDomain}/api/health`
    : `http://localhost:${process.env.PORT || 5000}/api/health`;
  console.log(`Bot is running. Keep-alive ping target: ${pingUrl}`);
  setInterval(async () => {
    try {
      await axios.get(pingUrl);
      console.log("Self-ping OK");
    } catch (err) {
      console.warn("Self-ping failed:", (err as Error).message);
    }
  }, 4 * 60 * 1000);

  return httpServer;
}
