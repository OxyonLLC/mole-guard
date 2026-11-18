import { z } from 'zod';

export const ConfigSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().optional(),
  PUBLIC_BASE_URL: z.string().optional(),

  // Solana / WinLEW
  SOLANA_RPC: z.string().optional(),
  WINLEW_MINT: z.string().optional(),

  // Discord common
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),

  // Service tokens (optional; services may read their own)
  DISCORD_TOKEN: z.string().optional(),
  MOLE_TOKEN: z.string().optional(),
  FAUCET_TOKEN: z.string().optional(),
  QUIZ_TOKEN: z.string().optional(),
  WATCHDOG_DISCORD_TOKEN: z.string().optional(),

  WATCHDOG_URL: z.string().optional(),
  WATCHDOG_ALERT_CHANNEL_ID: z.string().optional(),
}).passthrough();

export function getConfig() {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return parsed.data;
}
