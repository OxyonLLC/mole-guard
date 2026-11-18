#!/usr/bin/env node
// Move the quiz onto the epoch calendar — `npm run quiz:cadence`.
//
//   npm run quiz:cadence                          DRY RUN — shows what would happen
//   npm run quiz:cadence -- --apply               switch to 91-day cycles
//   npm run quiz:cadence -- --apply --prefix=E    choose the new cycle prefix
//
// DRY RUN IS THE DEFAULT, because --apply CLOSES THE CURRENT CYCLE, and closing
// a cycle settles payouts. This is not a configuration change; it moves money
// and it renumbers cycle ids permanently.
//
// WHY THIS IS A SCRIPT AND NOT PART OF A DEPLOY. v4 aligns the quiz with HODL's
// three-month epochs (spec §9), but the switch has a right and a wrong moment.
// Running it mid-cycle cuts that cycle short for everyone currently playing and
// settles their points early. Run it just AFTER a cycle closes naturally, when
// there is nothing in flight to truncate.
//
// The heavy lifting is switchCycleCadence() in src/quiz/db.js, which already
// closes the old cycle through the same settlement path /cycleclose uses,
// records the change in cycleSchemeHistory, and refuses a prefix that has ever
// been used before. This only decides WHEN, and shows the consequences first.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(ROOT, ".env") });
process.chdir(path.join(ROOT, "src"));

const require_ = createRequire(import.meta.url);
const db = require_("../quiz/db.js");
const { flushManagedQuizWrites } = require_("../quiz/storage.js");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const prefixArg = (args.find((a) => a.startsWith("--prefix=")) || "").split("=")[1];
const LENGTH_DAYS = 91;

function main() {
  const cycle = db.getCurrentCycle();
  const lengthDays = Math.round((cycle.endMs - cycle.startMs) / 86_400_000);
  const endsInHours = (cycle.endMs - Date.now()) / 3_600_000;

  console.log("");
  console.log(`Quiz cadence — ${apply ? "APPLYING" : "DRY RUN, nothing changes"}`);
  console.log("──────────────────────────────────────────────────────");
  console.log(`  current cycle    ${cycle.id}  (${lengthDays} days)`);
  console.log(`  ends             ${new Date(cycle.endMs).toISOString()}  (${endsInHours.toFixed(1)}h from now)`);
  console.log(`  target           ${LENGTH_DAYS}-day cycles, aligned to HODL epochs`);

  if (lengthDays === LENGTH_DAYS) {
    console.log("");
    console.log("  Already on the epoch cadence. Nothing to do.");
    return;
  }

  // The check that actually matters. Everything else is presentation.
  if (endsInHours > 0) {
    console.log("");
    console.log(`  ⚠️  THE CURRENT CYCLE HAS NOT FINISHED — ${endsInHours.toFixed(1)} hours left.`);
    console.log("      Switching now closes it early and settles everyone's points ahead of");
    console.log("      time. Players mid-cycle lose the rest of their window.");
    console.log("      Wait for it to close naturally, then run this.");
    if (apply) {
      console.log("");
      console.log("  Refusing to apply. Re-run after the cycle has closed.");
      process.exitCode = 1;
      return;
    }
  }

  const prefix = prefixArg || "E";
  console.log(`  new prefix       ${prefix}  (cycle ids become ${prefix}1, ${prefix}2, …)`);
  console.log("");
  console.log("  Old cycle ids and their records are never renumbered or deleted — they stay");
  console.log("  as the permanent record of the weekly era, exactly as they are.");

  if (!apply) {
    console.log("");
    console.log("DRY RUN — nothing changed. Re-run with --apply once the cycle has closed.");
    return;
  }

  const res = db.switchCycleCadence({
    lengthDays: LENGTH_DAYS,
    prefix,
    reason: "v4.0.0 — aligned to the HODL Rewards epoch calendar",
  });

  if (!res?.ok) {
    console.error(`  ❌ ${res?.error || "switch failed"}`);
    process.exitCode = 1;
    return;
  }
  const next = db.getCurrentCycle();
  console.log("");
  console.log(`  ✅ switched. New cycle ${next.id}, ${LENGTH_DAYS} days, ending ${new Date(next.endMs).toISOString().slice(0, 10)}.`);
}

// switchCycleCadence() closes a cycle, and closing settles payouts. Exiting
// without flushing would leave that write on local disk only, so Mongo — the
// copy that becomes truth if the local db is ever lost — would still describe
// the old cycle as open.
try {
  main();
  await flushManagedQuizWrites();
  process.exit(process.exitCode || 0);
} catch (error) {
  console.error("quiz:cadence failed:", error?.message || error);
  await flushManagedQuizWrites().catch(() => {});
  process.exit(2);
}
