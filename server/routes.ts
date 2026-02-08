import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { startBotService, runBotCycle } from "./bot";

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

  // Start the background service
  startBotService();

  return httpServer;
}
