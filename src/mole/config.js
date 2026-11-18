import { z } from "zod";
import { envBool } from "../shared/envBool.js";

const schema = z.object({
  // ─────────────────────────────
  // Discord Bot
  // ─────────────────────────────
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),

  // ─────────────────────────────
  // Primary OAuth App (Mole Guard)
  // ─────────────────────────────
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(),

  // Optional explicit Mole overrides
  MOLE_DISCORD_CLIENT_ID: z.string().optional(),
  MOLE_DISCORD_CLIENT_SECRET: z.string().optional(),
  MOLE_DISCORD_REDIRECT_URI: z.string().url().optional(),
  MOLE_OAUTH_SCOPE: z
    .string()
    .default("identify role_connections.write"),

  // ─────────────────────────────
  // Utility Bot OAuth (optional second app)
  // ─────────────────────────────
  UTILITY_DISCORD_CLIENT_ID: z.string().optional(),
  UTILITY_DISCORD_CLIENT_SECRET: z.string().optional(),
  UTILITY_DISCORD_REDIRECT_URI: z.string().url().optional(),
  UTILITY_OAUTH_SCOPE: z
    .string()
    .default("identify role_connections.write"),
  // ─────────────────────────────
  // Verification webhooks (optional)
  // ─────────────────────────────
  VERIFICATION_WEBHOOK_URL: z.string().url().optional(),
  VERIFICATION_WEBHOOK_URL_MOLE: z.string().url().optional(),
  VERIFICATION_WEBHOOK_URL_UTILITY: z.string().url().optional(),
  VERIFICATION_WEBHOOK_URL_WATCHDOG: z.string().url().optional(),
  // Optional — a Discord channel webhook that gets a message every time a
  // community member submits a new governance proposal idea via
  // /governance/submit/. Unset = silently skipped (see postWebhook's
  // no-op-if-unset behavior in web.js), same as every other webhook here.
  // .env may ship this unset as an empty string rather than absent — allow
  // "" here too (same fix as GAME_PAYOUT_LOG_WEBHOOK_URL below) so a blank
  // line in .env doesn't fail validation and take the whole process down.
  GOVERNANCE_WEBHOOK_URL: z.string().url().or(z.literal("")).optional(),
  // Optional — the same shared "the-logs" channel webhook src/games/
  // payout-worker.js already posts to (GAME_PAYOUT_LOG_WEBHOOK_URL). Reused
  // here, not re-created, for the web process's own operational log
  // messages (2026-07-19: Contribution build/confirm outcomes and
  // client-side wallet errors like Phantom blocking a request) — one
  // already-configured channel, not a second webhook to set up.
  // .env currently ships this unset (empty string) since payout-worker.js
  // reads it straight from process.env without zod — allow "" here too so
  // that pre-existing, still-valid config doesn't fail validation.
  GAME_PAYOUT_LOG_WEBHOOK_URL: z.string().url().or(z.literal("")).optional(),
  // ─────────────────────────────
  // Web / Server
  // ─────────────────────────────
  PUBLIC_BASE_URL: z.string().url().default("https://REPLACE_WITH_YOUR_API_DOMAIN"),
  SITE_BASE_URL: z.string().url().default("https://winlew.co"),
  VERIFY_UI_URL: z.string().url().default("https://winlew.co/verify/"),
  BOT_SERVICES_URL: z.string().url().default("https://winlew.co/discord-bots/"),
  GAMING_HUB_URL: z.string().url().optional(),
  DISCORD_ACTIVITY_ENABLED: envBool(false),
  DISCORD_ACTIVITY_SESSION_TTL_SEC: z.coerce.number().int().positive().default(21_600),
  CORS_ALLOWED_ORIGINS: z.string().default("https://winlew.co,https://www.winlew.co"),
  PORT: z.coerce.number().int().positive().default(8787),

  // ─────────────────────────────
  // Security
  // ─────────────────────────────
  TOKEN_PEPPER: z.string().optional(),
  BOT_SYNC_SECRET: z.string().optional(), // required only if sync-bot is used

  // ─────────────────────────────
  // Solana / WinLEW
  // ─────────────────────────────
  SOLANA_RPC: z.string().url().default("https://solana-rpc.publicnode.com"),
  WINLEW_MINT: z.string().min(1),

  THRESHOLD_1M: z.coerce.number().default(1_000_000),
  THRESHOLD_10M: z.coerce.number().default(10_000_000),
  THRESHOLD_100M: z.coerce.number().default(100_000_000),

  // ─────────────────────────────
  // Guild Role Sync / Diagnostics
  // ─────────────────────────────
  GUILD_ROLE_SYNC_ENABLED: envBool(true),
  GUILD_ROLE_DIAGNOSTICS_ON_START: envBool(true),
  GUILD_ROLE_SYNC_BOT_TOKEN: z.string().optional(),
  MOLE_GUILD_ROLE_SYNC_BOT_TOKEN: z.string().optional(),
  UTILITY_GUILD_ROLE_SYNC_BOT_TOKEN: z.string().optional(),
  // Site activity log (2026-08-14). A webhook is preferred — no bot
  // permissions, cannot read the channel. Falls back to the bot token +
  // channel id when no webhook has been created. Unset = logging is inert,
  // never an error.
  SITE_LOG_WEBHOOK_URL: z.string().optional(),
  SITE_LOG_CHANNEL_ID: z.string().optional(),
  MOLE_DISCORD_BOT_TOKEN: z.string().optional(),
  UTILITY_DISCORD_BOT_TOKEN: z.string().optional(),
  VERIFIED_WALLET_ROLE_ID: z.string().optional(),
  VERIFIED_HOLDERS_ROLE_ID: z.string().optional(),
  LEWCREW_1M_ROLE_ID: z.string().optional(),
  LEWCREW_10M_ROLE_ID: z.string().optional(),
  LEWCREW_100M_ROLE_ID: z.string().optional(),
  CONTRIBUTOR_ROLE_ID: z.string().optional(),
  GOVERNANCE_VOTER_ROLE_ID: z.string().optional(),

  // ─────────────────────────────
  // Storage
  // ─────────────────────────────
  DATA_DIR: z.string().default("./data"),

  // ─────────────────────────────
  // Watchdog / Ops (optional)
  // ─────────────────────────────
  WATCHDOG_URL: z.string().url().default("https://winlew.co/health/"),
  WATCHDOG_HEARTBEAT_TOKEN: z.string().optional(),
  HEARTBEAT_INTERVAL_SEC: z.coerce.number().default(60),

  // ─────────────────────────────
  // Maintenance
  // ─────────────────────────────
  MAINTENANCE_MODE: envBool(false),
  MAINTENANCE_REASON: z.string().default("Planned maintenance"),
});

export function getConfig() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Config validation error:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid configuration. Check your .env");
  }

  return parsed.data;
}
