import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { startBotService, runBotCycle } from "./bot";
import { pool } from "./db";
import axios from "axios";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Config routes
  app.get(api.config.get.path, async (req, res) => {
    const config = await storage.getConfig();
    if (!config) return res.status(404).json({ message: "Config not found" });
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

  // Tracked nations (timed mode) — returns currently-watching rows
  app.get(api.trackedNations.list.path, async (req, res) => {
    const tracked = await storage.getTrackedWatchingNations();
    res.json(tracked);
  });

  // Bot control routes
  app.post(api.bot.toggle.path, async (req, res) => {
    const { isActive } = req.body;
    const config = await storage.toggleBot(isActive);
    res.json(config);
  });

  app.post(api.bot.run.path, async (req, res) => {
    runBotCycle().catch(console.error);
    res.json({ message: "Bot cycle triggered" });
  });

  // Health check routes
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "online", bot: "running", timestamp: new Date().toISOString() });
  });

  startBotService();

  // Self-ping every 4 minutes to keep container + DB alive
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const pingUrl = replitDomain
    ? `https://${replitDomain}/api/health`
    : `http://localhost:${process.env.PORT || 5000}/api/health`;
  console.log(`Bot running. Keep-alive ping target: ${pingUrl}`);

  setInterval(async () => {
    try {
      await axios.get(pingUrl);
      console.log("Self-ping OK");
    } catch (err) {
      console.warn("Self-ping failed:", (err as Error).message);
    }
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      console.warn("DB keepalive failed:", (err as Error).message);
    }
  }, 4 * 60 * 1000);

  return httpServer;
}
