#!/usr/bin/env node
// Manage HODL Rewards epochs — `npm run hodl:epoch`.
//
//   npm run hodl:epoch                          list every epoch
//   npm run hodl:epoch -- --create --id=E1      create a DRAFT (dry run without --apply)
//   npm run hodl:epoch -- --create --id=E1 --start=2026-09-29   choose the start date
//   npm run hodl:epoch -- --activate=E1 --apply make a draft live
//   npm run hodl:epoch -- --close=E1 --apply    close an epoch
//   npm run hodl:epoch -- --from-proposal=<id> --id=E2   draft from a passed vote
//
// Creating and closing are dry-run by default like everything else that touches
// money. An epoch does not itself move tokens, but activating one is what lets
// hodl:pay do so, which makes it the same class of decision.
//
// ACTIVATION IS ALWAYS A HUMAN ACTION, including when the terms came from a
// vote. Governance decides the numbers; a person still presses the button, and
// validateEpoch() runs again at that moment. That is the last gate before a
// weekly allocation becomes real.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(ROOT, ".env") });
process.chdir(path.join(ROOT, "src"));

const hodl = await import("../mole/hodlStore.js");
const { flushManagedWrites } = await import("../mole/storage.js");
const { DEFAULT_EPOCH_PARAMS, DEFAULT_BALANCE_RATES, LIMITS, EPOCH_STATUS } = await import("../mole/hodlEpochs.js");
const { epochFromProposal, describeEpochChange } = await import("../mole/hodlGovernance.js");
const { PROPOSALS } = await import("../mole/governanceData.js");

const args = process.argv.slice(2);
const flag = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
const has = (name) => args.includes(`--${name}`);
const apply = has("apply");
const n = (v) => Number(v || 0).toLocaleString("en-US");

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The next occurrence of the payout weekday, so an epoch starts on the day it
 *  pays rather than mid-week. */
function nextPayoutDay(dayOfWeek) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 8; i += 1) {
    if (d.getDay() === dayOfWeek) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function list() {
  const epochs = hodl.listEpochs();
  console.log("");
  if (!epochs.length) {
    console.log("No epochs. HODL Rewards cannot pay anyone until one is created and activated.");
    console.log("  npm run hodl:epoch -- --create --id=E1 --apply");
    return;
  }
  for (const e of epochs) {
    const weeks = Math.round((e.endMs - e.startMs) / WEEK);
    const paid = hodl.listSnapshots(e.id).filter((s) => s.status === "paid").length;
    console.log(`  ${String(e.id).padEnd(6)} ${String(e.status).padEnd(8)} ${n(e.weeklyPool)}/wk  minHold ${n(e.minHold)}  ${weeks}w  paid ${paid}`);
    if (e.decidedBy) console.log(`         from vote ${e.decidedBy.proposalId}`);
  }
  console.log("");
}

/**
 * Resolve --start=YYYY-MM-DD, falling back to the next payout weekday.
 *
 * The start date MUST land on the payout weekday. Week boundaries are counted
 * from the start (`weekIndexFor`), while the payout day is checked against the
 * calendar (`isPayoutDay`) — so a start that is off-weekday silently puts a
 * payout in a different week than the one it settles, and the two disagree
 * forever after. Refusing is the only safe answer.
 */
function resolveStart(payoutDay) {
  const raw = flag("start");
  if (!raw) return nextPayoutDay(payoutDay);

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) { console.error(`--start must be YYYY-MM-DD, got "${raw}"`); process.exit(2); }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) { console.error(`--start is not a real date: "${raw}"`); process.exit(2); }

  if (d.getDay() !== payoutDay) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    console.error(`--start ${raw} is a ${names[d.getDay()]}; an epoch must start on its payout day (${names[payoutDay]}).`);
    process.exit(2);
  }
  return d;
}

function create() {
  const id = flag("id");
  if (!id) { console.error("--id is required"); process.exit(2); }

  const start = resolveStart(DEFAULT_EPOCH_PARAMS.payoutDay);
  const weeks = Number(flag("weeks") || 13);
  const epoch = {
    id,
    startMs: start.getTime(),
    endMs: start.getTime() + weeks * WEEK,
    weeklyPool: Number(flag("pool") || DEFAULT_EPOCH_PARAMS.weeklyPool),
    minHold: Number(flag("minhold") || DEFAULT_EPOCH_PARAMS.minHold),
    // --balance-rates selects the owner's 2026-11-13 balance-rate policy with the
    // default 0.100%..0.150% progression; --balance-rates=a,b,...(8 fractions)
    // sets another one (validated <= 0.0015 each). Omitted = equal shares.
    ...(args.some((a) => a === "--balance-rates" || a.startsWith("--balance-rates="))
      ? { balanceRates: flag("balance-rates") ? flag("balance-rates").split(",").map(Number) : [...DEFAULT_BALANCE_RATES] }
      : {}),
  };

  console.log("");
  console.log(`  id             ${epoch.id}`);
  console.log(`  starts         ${start.toDateString()}  (the payout weekday)`);
  console.log(`  ends           ${new Date(epoch.endMs).toDateString()}  (${weeks} weeks)`);
  console.log(`  weekly pool    ${n(epoch.weeklyPool)} WinLEW   (ceiling ${n(LIMITS.MAX_WEEKLY_POOL)})`);
  console.log(`  min hold       ${n(epoch.minHold)} WinLEW`);
  console.log(`  rule           ${epoch.balanceRates ? `balance-rate: ${epoch.balanceRates.map((r) => `${(r * 100).toFixed(3)}%`).join(" / ")} for 0..7 active days; balance counted up to ${n(LIMITS.MAX_QUALIFYING_BALANCE)}; cap ${n(LIMITS.MAX_PER_PARTICIPANT_WEEK)} each; pool is the ceiling` : "equal shares of the pool"}`);
  console.log(`  epoch cost     up to ${n(epoch.weeklyPool * weeks)} WinLEW over ${weeks} weeks`);
  console.log("");

  if (!apply) { console.log("DRY RUN — nothing created. Add --apply."); return; }

  const res = hodl.createEpoch(epoch);
  if (!res.ok) { console.error(`  ❌ ${res.error}`); process.exit(1); }
  console.log(`  ✅ created ${res.epoch.id} as a DRAFT. It pays nobody until activated:`);
  console.log(`     npm run hodl:epoch -- --activate=${res.epoch.id} --apply`);
}

function fromProposal() {
  const proposalId = flag("from-proposal");
  const id = flag("id");
  const proposal = PROPOSALS.find((p) => p.id === proposalId);

  if (!proposal) { console.error(`No proposal "${proposalId}".`); process.exit(2); }

  console.log("");
  console.log(`  proposal   ${proposal.id} — ${proposal.title}`);
  console.log(`  status     ${proposal.status}   mode ${proposal.governanceMode}`);
  console.log("");
  for (const line of describeEpochChange(proposal, hodl.getActiveEpoch())) console.log(`    ${line}`);
  console.log("");

  const start = resolveStart(DEFAULT_EPOCH_PARAMS.payoutDay);
  const weeks = Number(flag("weeks") || 13);
  const res = epochFromProposal(proposal, { id, startMs: start.getTime(), endMs: start.getTime() + weeks * WEEK });

  if (!res.ok) {
    console.error("  ❌ this vote cannot become an epoch:");
    for (const e of res.errors) console.error(`     ${e}`);
    process.exit(1);
  }
  if (res.ignored.length) console.log(`  ⚠️  ignored non-votable fields: ${res.ignored.join(", ")}`);
  if (!apply) { console.log("DRY RUN — nothing created. Add --apply."); return; }

  const saved = hodl.createEpoch(res.epoch);
  if (!saved.ok) { console.error(`  ❌ ${saved.error}`); process.exit(1); }
  console.log(`  ✅ created ${saved.epoch.id} as a DRAFT from vote ${proposal.id}.`);
}

async function main() {
  await hodl.refreshHodlStore().catch(() => {});

  if (has("create")) return create();
  if (flag("from-proposal")) return fromProposal();

  const activate = flag("activate");
  if (activate) {
    const epoch = hodl.getEpoch(activate);
    if (!epoch) { console.error(`No epoch "${activate}".`); process.exit(2); }
    console.log("");
    console.log(`  Activating ${epoch.id}: ${n(epoch.weeklyPool)}/wk, min hold ${n(epoch.minHold)}.`);
    console.log(`  Once active, hodl:pay --apply can move tokens on the payout day.`);
    if (!apply) { console.log("\nDRY RUN — not activated. Add --apply."); return; }
    const res = hodl.activateEpoch(activate);
    if (!res.ok) { console.error(`  ❌ ${res.error}`); process.exit(1); }
    console.log(`  ✅ ${res.epoch.id} is ACTIVE.`);
    return;
  }

  const close = flag("close");
  if (close) {
    if (!apply) { console.log(`DRY RUN — would close ${close}. Add --apply.`); return; }
    const res = hodl.closeEpoch(close);
    if (!res.ok) { console.error(`  ❌ ${res.error}`); process.exit(1); }
    console.log(`  ✅ ${res.epoch.id} is CLOSED. Its terms and every paid week stay on record.`);
    return;
  }

  list();
}

// Creating or activating an epoch is a managed-file write; without the flush it
// reaches local disk and not Mongo, and the next refresh silently undoes it.
main()
  .then(async () => { await flushManagedWrites(); process.exit(process.exitCode || 0); })
  .catch(async (error) => {
    console.error("hodl:epoch failed:", error?.message || error);
    await flushManagedWrites().catch(() => {});
    process.exit(2);
  });
