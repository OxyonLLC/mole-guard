// blitz-bridge runner (pm2 on the WinLEW PC). Pays Oxyon Blitz cash-outs from the GeoHackers reserve in batches.
// Env (its own pm2 app, separate from the arcade worker so the network can differ: beta first week):
//   BLITZ_API_URL, BLITZ_BRIDGE_TOKEN_FILE (600), BLITZ_BRIDGE_MODE=dry-run|live (default dry-run)
//   BLITZ_DAILY_CEILING_XL1 (default 500), BLITZ_BATCH_MAX (default 50), BLITZ_TICK_SECONDS (default 60)
//   XL1_NETWORK, XL1_RPC_URL, XL1_CHAIN_ID, XL1_SENDER_FILE, XL1_SDK_MODULE, XL1_DISTRIBUTOR_ADDRESS (same as the arcade)
//   XL1_VERIFICATION_FILE (GeoHackers bot store, for the Discord fast track), XL1_MIN_DISCORD_AGE_DAYS (default 30)
//   DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD (default 20 XL1, never dip below)
// Pause everything (arcade + Blitz): db.xl1_arcade_worker.updateOne({_id:'control'},{$set:{paused:true}})
// Pause Blitz only:                  db.xl1_arcade_worker.updateOne({_id:'blitz-control'},{$set:{paused:true}},{upsert:true})
import 'dotenv/config';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getMongoDb, closeMongo } from '../lib/mongo.js';
import { getPayoutConfig } from '../xl1-arcade/payout-config.js';
import { decimalToUnits } from '../xl1-arcade/config.js';
import { createSignerAdapter } from '../xl1-arcade/signer-adapter.js';
import { normalizeWallet } from '../xl1-arcade/reward-engine.js';
import { tick } from '../xl1-blitz/bridge.js';
import { blitzNetworkFor, DEFAULT_BATCH_MAX } from '../xl1-blitz/batch.js';
import { createBlitzClient } from '../xl1-blitz/blitz-client.js';
import { createMongoBlitzStore } from '../xl1-blitz/mongo-store.js';

const once = process.argv.includes('--once');
let stopped = false;
process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });

async function main() {
  const env = process.env;
  const mode = env.BLITZ_BRIDGE_MODE === 'live' ? 'live' : 'dry-run';
  const payout = getPayoutConfig(env);
  const blitzNetwork = blitzNetworkFor(payout.network);
  if (!blitzNetwork) throw new Error('blitz_network_unknown');
  const distributor = normalizeWallet(env.XL1_DISTRIBUTOR_ADDRESS);
  if (!distributor) throw new Error('XL1_DISTRIBUTOR_ADDRESS_required');
  const config = { mode, blitzNetwork, batchMax: Math.min(200, Number(env.BLITZ_BATCH_MAX || DEFAULT_BATCH_MAX)),
    dailyCeilingUnits: decimalToUnits(env.BLITZ_DAILY_CEILING_XL1 || '500', 'BLITZ_DAILY_CEILING_XL1').toString(),
    pausedBalanceUnits: payout.pausedBalanceUnits.toString(), minDiscordAgeDays: Number(env.XL1_MIN_DISCORD_AGE_DAYS || 30) };
  const token = (await readFile(env.BLITZ_BRIDGE_TOKEN_FILE, 'utf8')).trim();
  const client = createBlitzClient({ apiUrl: env.BLITZ_API_URL, token });
  // Dry-run never opens the sender file: it only reads, batches and logs.
  const adapter = mode === 'live' ? await createSignerAdapter(payout, distributor) : null;
  const db = await getMongoDb();
  if (!db) throw new Error('blitz_bridge_requires_mongodb');
  const store = await createMongoBlitzStore(db);
  const controls = db.collection('xl1_arcade_worker');
  const leaseId = `distributor:${distributor}`, owner = crypto.randomUUID();
  const readVerification = env.XL1_VERIFICATION_FILE ? async () => JSON.parse(await readFile(env.XL1_VERIFICATION_FILE, 'utf8')) : null;
  console.log(`blitz-bridge: ${mode} on ${payout.network} (Blitz '${blitzNetwork}'), batches up to ${config.batchMax} wallets`);
  do {
    // Shared lease with the arcade worker: the reserve never signs two transactions at once.
    const lease = await controls.findOneAndUpdate({ _id: leaseId, expiresAt: { $lte: new Date() } },
      { $set: { owner, expiresAt: new Date(Date.now() + 120000) } }, { returnDocument: 'after' });
    if (lease) {
      try {
        const result = await tick({ store, client, adapter: adapter ?? dryAdapter, config, readVerification, log: m => console.log(m) });
        await controls.updateOne({ _id: 'blitz-health' }, { $set: { status: result.state, checkedAt: new Date(), mode, network: payout.network } }, { upsert: true });
        if (result.state !== 'IDLE') console.log(`blitz-bridge: ${result.state}${result.batchId ? ` ${result.batchId}` : ''}`);
      } catch (error) {
        // Never print SDK errors, URLs or tokens. Durable batch state is kept for the next tick.
        console.error(`blitz-bridge cycle failed (${String(error?.message || '').replace(/[^a-z0-9_]/gi, '').slice(0, 60)}); state kept for recovery.`);
        await controls.updateOne({ _id: 'blitz-health' }, { $set: { status: 'ERROR', checkedAt: new Date() } }, { upsert: true });
        if (once) process.exitCode = 1;
      } finally {
        await controls.updateOne({ _id: leaseId, owner }, { $set: { expiresAt: new Date(0) } });
      }
    }
    if (!once && !stopped) await new Promise(resolve => setTimeout(resolve, Number(env.BLITZ_TICK_SECONDS || 60) * 1000));
  } while (!once && !stopped);
}

// Dry-run never signs or sends; it can't be asked to (tick stops at DRY_RUN before any adapter call that writes).
const dryAdapter = { balance: async () => 0n, prepareBatch: async () => { throw new Error('dry_run'); },
  broadcast: async () => { throw new Error('dry_run'); }, confirmed: async () => false, expired: async () => false };

main().catch(error => { console.error(`blitz-bridge startup failed (${String(error?.message || '').replace(/[^a-z0-9_]/gi, '').slice(0, 60)})`); process.exitCode = 1; })
  .finally(closeMongo);
