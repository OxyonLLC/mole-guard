#!/usr/bin/env node
// Replay payout receipts against the database — `npm run receipts:verify`.
//
// A receipt nobody ever checks is decoration. This is the check.
//
// For every paid redemption that carries a receipt, it recomputes the decision
// from the record as it stands right now and compares the hash to the one that
// was issued at payout time. A mismatch means the record changed after the money
// moved: the amount, the wallet, the risk verdict or the rules version is no
// longer what was decided.
//
// WHAT A MISMATCH DOES *NOT* MEAN. There is one honest false positive:
// PAYOUT_RECEIPT_SALT is part of every reference in the payload, so rotating the
// salt invalidates every earlier receipt by design. That is the same retention
// mechanism as PARTICIPATION_HASH_SALT — old correlations stop being checkable
// on purpose. If everything mismatches at once, suspect the salt before
// suspecting the database.
//
// Read-only. It writes nothing and settles nothing.

import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { replayPayoutDecision } from '../mole/payoutReceipt.js';

dotenv.config();

// src/quiz/db.js is CommonJS; this repo is ESM. Same interop the payout worker
// uses, in reverse.
const db = createRequire(import.meta.url)('../quiz/db.js');

function parseArgs(argv) {
  const args = { days: 0, json: false, verbose: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--verbose' || arg === '-v') args.verbose = true;
    else if (arg.startsWith('--days=')) args.days = Number(arg.slice(7)) || 0;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.PAYOUT_RECEIPT_SALT) {
    console.error('PAYOUT_RECEIPT_SALT is not set — receipts cannot be replayed without it.');
    console.error('It is the same salt the payout worker used; without it every check would fail for the wrong reason.');
    process.exit(2);
  }

  const since = args.days > 0 ? Date.now() - args.days * 24 * 60 * 60 * 1000 : 0;
  const records = db.listRedemptionsWithReceipts({ since });

  if (!records.length) {
    console.log('No receipted payouts found.');
    console.log('Receipts are issued only while GEOPROOF_RECEIPTS_ENABLED=true, and only for payouts made since it was turned on.');
    return;
  }

  const mismatches = [];
  let attested = 0;
  let anchored = 0;

  for (const record of records) {
    const result = replayPayoutDecision(record, record.receipt);
    if (!result.matches) mismatches.push({ record, result });
    if (record.receipt?.attestation?.proofHash) attested += 1;
    if (record.receipt?.attestation?.anchored) anchored += 1;

    if (args.verbose && result.matches) {
      console.log(`  ok  ${record.id}  ${result.recomputedHash.slice(0, 16)}…  ${record.decision || 'settle'}/${record.risk?.band || 'normal'}`);
    }
  }

  const summary = {
    checked: records.length,
    verified: records.length - mismatches.length,
    mismatched: mismatches.length,
    attested,
    anchored,
  };

  if (args.json) {
    console.log(JSON.stringify({
      ...summary,
      // Ids and hashes only. This output is meant to be pasteable into a
      // channel, so it must not carry wallets or Discord ids.
      mismatches: mismatches.map(({ record, result }) => ({
        id: record.id,
        issuedHash: result.receiptHash,
        recomputedHash: result.recomputedHash,
      })),
    }, null, 2));
  } else {
    console.log(`\nChecked ${summary.checked} receipted payout${summary.checked === 1 ? '' : 's'}${args.days ? ` from the last ${args.days} days` : ''}.`);
    console.log(`  verified   ${summary.verified}`);
    console.log(`  mismatched ${summary.mismatched}`);
    console.log(`  attested   ${summary.attested}  (a GeoProof service signed the hash)`);
    console.log(`  anchored   ${summary.anchored}  (commitment published; evidence never is)`);

    for (const { record, result } of mismatches) {
      console.log(`\n  MISMATCH  ${record.id}`);
      console.log(`    issued     ${result.receiptHash}`);
      console.log(`    recomputed ${result.recomputedHash}`);
      console.log('    the record no longer matches the decision it was paid under');
    }
  }

  // Non-zero on mismatch so this can be a cron/CI gate rather than something
  // someone has to remember to read.
  if (mismatches.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('receipts:verify failed:', error?.message || error);
  process.exit(2);
});
