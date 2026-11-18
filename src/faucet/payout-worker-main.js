// Actual process entry point for the `faucetpayouts` service (see
// src/runner.js). All logic lives in payout-worker.js, which has no
// import-time side effects and is safe to import from tests — this file's
// only job is "load env, then start", so there's nothing to get confused
// about when running directly vs. being imported.
import 'dotenv/config';
import { start } from './payout-worker.js';
import { assertSingleInstance } from '../shared/singleInstance.js';

async function main() {
  await assertSingleInstance({
    service: 'winlew-faucet-payouts',
    token: process.env.DISCORD_BOT_TOKEN || process.env.FAUCET_TOKEN || process.env.BOT_KEYPAIR_PATH || 'winlew-faucet-payouts',
  });
  start();
}

main().catch((error) => {
  console.error('[faucet-payouts] fatal:', error?.message || error);
  process.exit(1);
});
