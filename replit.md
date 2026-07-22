# Atlantis Recruitment System

A Politics & War recruitment bot that automatically monitors new nations and sends them configurable welcome/recruitment messages via the P&W in-game messaging API.

## Stack

- **Frontend**: React 18 + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express 5 (TypeScript via tsx)
- **Database**: PostgreSQL (Replit built-in, via Drizzle ORM)
- **Auth/Session**: express-session + passport-local

## How to run

```
npm run dev
```

The app starts on port 5000. Database migrations run automatically on startup.

## Key files

- `server/bot.ts` — core bot logic: scanning new nations, sending messages
- `server/routes.ts` — API routes for config, logs, tracked nations
- `server/storage.ts` — database access layer
- `shared/schema.ts` — database schema (Drizzle + Zod)
- `client/src/` — React frontend

## Environment

- `DATABASE_URL` — managed by Replit automatically (built-in PostgreSQL)
- `SESSION_SECRET` — secret for express-session (set as a Replit Secret)

The bot requires a Politics & War API key configured through the app's settings UI.

## User preferences

<!-- User preferences go here -->
