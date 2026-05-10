import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "./db";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// Paths that are polled automatically — logging them would flood the console
const SILENT_GET_PATHS = new Set([
  "/api/config",
  "/api/logs",
  "/api/tracked-nations",
  "/api/tracked-nations/all",
  "/api/health",
  "/health",
]);

app.use((req, res, next) => {
  const start = Date.now();
  const path  = req.path;

  res.on("finish", () => {
    // Skip high-frequency GET polling routes entirely
    if (req.method === "GET" && SILENT_GET_PATHS.has(path)) return;
    // Skip non-API paths
    if (!path.startsWith("/api")) return;

    const duration = Date.now() - start;
    // For writes, log method + path + status. Omit the response body to keep it clean.
    log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
  });

  next();
});

(async () => {
  await runMigrations();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status  = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("[error]", message);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`Atlantis Recruitment System running on port ${port}`);
  });
})();
