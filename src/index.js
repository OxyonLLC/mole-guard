import 'dotenv/config';
import { ensureDataDir, initMoleStorage, flushManagedWrites } from './mole/storage.js';
import { flushManagedWrites as flushFaucetWrites } from './faucet/storage.js';
import { startWeb } from './mole/web.js';
import { startBot } from './mole/bot.js';
import { startHeartbeatSender } from './mole/heartbeatSender.js';
import { runGuildRoleDiagnostics } from './mole/guildRoles.js';
import { syncAllLinkedWalletMirrors } from './mole/walletLink.js';
import { isMongoEnabled, pingMongo } from './lib/mongo.js';

async function main() {
  ensureDataDir();
  if (isMongoEnabled()) {
    try {
      const ping = await pingMongo();
      if (ping.ok) console.log(`[mongo] Mole-Guard connected to ${ping.database}`);
    } catch (error) {
      console.warn('[mongo] startup ping failed:', error?.message || error);
    }
  }

  await initMoleStorage().catch((error) => {
    console.warn('[mongo-storage] bootstrap failed:', error?.message || error);
  });

  syncAllLinkedWalletMirrors();

  await runGuildRoleDiagnostics().catch((e) => {
    console.warn('[guild-role-diagnostics] startup check failed:', e?.message || e);
  });
  const launches = [startWeb(), startBot(), startHeartbeatSender()];
  await Promise.all(launches);
}

// This process had NO shutdown handler, so `pm2 restart` killed it instantly.
//
// A managed write reaches local disk synchronously and pushes to Mongo on a
// background chain; refreshManagedFile() then writes Mongo's payload back OVER
// the local file. So a session, a governance vote or a wallet link written in
// the moments before a restart could be undone by that restart. This process
// writes through both storage layers — mole/web.js pulls in faucet/service.js
// and faucet/eligibility.js — so both are flushed.
//
// Found 2026-08-16 sweeping for the hodl:pay variant of the same bug.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — flushing pending writes before exit.`);
  await Promise.allSettled([flushManagedWrites(), flushFaucetWrites()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
