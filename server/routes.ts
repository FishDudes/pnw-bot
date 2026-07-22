import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { updateConfigSchema } from "@shared/schema";
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

  // Import config from a saved export file
  app.post(api.config.import.path, async (req, res) => {
    try {
      const { _exported, _version, ...rest } = req.body;
      const input = updateConfigSchema.parse(rest);
      const config = await storage.updateConfig(input);
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Invalid import file" });
    }
  });

  // Logs routes
  app.get(api.logs.list.path, async (req, res) => {
    const logs = await storage.getLogs();
    res.json(logs);
  });

  // Export ALL alliance leader logs (no row cap) — used to save messaged leaders before a DB wipe
  app.get(api.logs.allianceLeaders.path, async (req, res) => {
    const logs = await storage.getAllianceLeaderLogs();
    res.json(logs);
  });

  // Import alliance leader logs from a saved export file
  app.post(api.logs.allianceLeadersImport.path, async (req, res) => {
    try {
      const body = req.body;
      if (!body || !Array.isArray(body.records)) {
        return res.status(400).json({ message: "Invalid file: missing 'records' array" });
      }
      const result = await storage.importAllianceLeaderLogs(body.records);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Import failed" });
    }
  });

  // Tracked nations — currently watching only
  app.get(api.trackedNations.list.path, async (req, res) => {
    const tracked = await storage.getTrackedWatchingNations();
    res.json(tracked);
  });

  // All tracked nations — full history including sent/expired
  app.get(api.trackedNations.all.path, async (req, res) => {
    const tracked = await storage.getAllTrackedNations();
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

  // Health check — silent in logs
  app.get("/health",     (req, res) => res.json({ status: "ok" }));
  app.get("/api/health", (req, res) => res.json({ status: "online" }));

  startBotService();

  // ── Keep-alive: ping self + keep DB connection warm ──────────────────────
  // Runs silently every 4 minutes. Prevents Replit container hibernation.
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const pingUrl = replitDomain
    ? `https://${replitDomain}/api/health`
    : `http://localhost:${process.env.PORT || 5000}/api/health`;

  setInterval(async () => {
    try { await axios.get(pingUrl, { timeout: 10000 }); } catch { /* ignore */ }
    try { await pool.query("SELECT 1"); }               catch { /* ignore */ }
  }, 4 * 60 * 1000);

  return httpServer;
}
