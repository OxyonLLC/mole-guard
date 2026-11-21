// Moderator decisions on held Oxyon Blitz cash-outs (Discord fast-track first payouts, 200+ XL1).
//   node src/scripts/xl1-blitz-review.js list
//   node src/scripts/xl1-blitz-review.js approve <requestId>
//   node src/scripts/xl1-blitz-review.js decline <requestId> "<reason the player will see>"
// Approved items join the next hourly batch. Declines are reported to Blitz on the bridge's next tick.
import 'dotenv/config';
import { getMongoDb, closeMongo } from '../lib/mongo.js';
import { createMongoBlitzStore } from '../xl1-blitz/mongo-store.js';
import { review } from '../xl1-blitz/bridge.js';

const [cmd, id, ...rest] = process.argv.slice(2);
try {
  const db = await getMongoDb();
  if (!db) throw new Error('mongodb_required');
  const store = await createMongoBlitzStore(db);
  if (cmd === 'list') {
    for (const it of await store.items(['REVIEW'])) {
      console.log(`${it._id}  ${(Number(BigInt(it.units)) / 1e6).toFixed(4)} XL1  to ${it.wallet.slice(0, 6)}…${it.wallet.slice(-4)}  (${it.reviewReason})`);
    }
  } else if (cmd === 'approve' || cmd === 'decline') {
    await review(store, id, cmd, rest.join(' '));
    console.log(`${cmd}d ${id}`);
  } else console.log('usage: list | approve <requestId> | decline <requestId> "<reason>"');
} catch (error) { console.error(String(error?.message || error)); process.exitCode = 1; }
finally { await closeMongo(); }
