#!/usr/bin/env node
// Preview a Tuesday HODL distribution — `npm run hodl:preview`.
//
//   npm run hodl:preview                 the coming Tuesday, against live data
//   npm run hodl:preview -- --json       machine-readable, ids and amounts only
//   npm run hodl:preview -- --verbose    per-participant lines
//
// READ-ONLY BY CONSTRUCTION, not by a flag. There is no --apply here and there
// never will be: this script imports nothing that can sign or send a
// transaction, so the worst a bug in it can do is print the wrong number. Stage
// C's payout worker is a separate file for exactly that reason — the thing that
// checks the arithmetic should not be the thing that can move tokens.
//
// This is the last human checkpoint before money moves. It prints what spec §19
// asks for: qualified users, weekly allocation, base distribution, PoV bonuses,
// total proposed, and what remains in the reserve afterwards.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(ROOT, ".env") });
process.chdir(path.join(ROOT, "src"));

const { LIMITS, buildWeeklySnapshot, validateEpoch, isPayoutDay, weekIndexFor } =
  await import("../mole/hodlEpochs.js");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const { gatherIdentities, summariseExclusions } = await import("../mole/hodlEligibility.js");
const { getSplBalance, getSplBalanceUnits } = await import("../mole/solana.js");
const { isDirectlyBanned } = await import("../faucet/walletBans.js");
const { isUserBanned } = await import("../faucet/userBans.js");
const { getProofOfValueScore } = await import("../mole/proofOfValue.js");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const verbose = args.includes("--verbose") || args.includes("-v");

const n = (v) => Number(v || 0).toLocaleString("en-US");

/** The next occurrence of the epoch's payout day, today included, never before the epoch starts. */
function nextPayoutDate(epoch, from = new Date()) {
  if (Number.isFinite(Number(epoch?.startMs)) && from.getTime() < Number(epoch.startMs)) from = new Date(Number(epoch.startMs));
  const d = new Date(from);
  for (let i = 0; i < 8; i += 1) {
    if (isPayoutDay(epoch, d)) return d;
    d.setDate(d.getDate() + 1);
  }
  return from;
}

async function main() {
  const mint = process.env.WINLEW_MINT;
  if (!mint) {
    console.error("WINLEW_MINT is not set — cannot read balances, so eligibility cannot be judged.");
    process.exit(2);
  }

  // The STORED epoch, exactly as hodl-pay will use it — never one derived from
  // defaults. A derived epoch silently previewed the old equal-share rule while
  // the stored E1 uses the balance-rate rule, so preview and payout disagreed.
  // `--epoch=ID` (or HODL_EPOCH_ID) previews a named epoch, e.g. a draft before
  // activation; otherwise the active one.
  const hodl = await import("../mole/hodlStore.js");
  await hodl.refreshHodlStore(); // decide from Mongo's current state, not a boot-time cache
  const wanted = (args.find((a) => a.startsWith("--epoch=")) || "").slice("--epoch=".length) || process.env.HODL_EPOCH_ID || "";
  const epoch = wanted ? hodl.getEpoch(wanted) : hodl.getActiveEpoch();
  if (!epoch) {
    console.error(wanted
      ? `No stored epoch "${wanted}". Create it with hodl:epoch first.`
      : "No active epoch. Preview a draft with --epoch=<id>, or create/activate one with hodl:epoch.");
    process.exit(2);
  }

  const valid = validateEpoch(epoch);
  if (!valid.ok) {
    console.error("This epoch cannot be activated:");
    for (const e of valid.errors) console.error("  -", e);
    process.exit(2);
  }

  const result = await gatherIdentities({
    epoch,
    // Exact base units (same reader as hodl-pay), so the preview computes
    // exactly what would be paid. A failed read throws -> recorded as degraded,
    // never treated as an empty wallet.
    getBalance: async (wallet) => getSplBalanceUnits(wallet, mint),
    isWalletBanned: async (wallet) => isDirectlyBanned(wallet),
    isAccountBanned: async (userId) => isUserBanned(userId),
    getPovScore: async (userId) => (await getProofOfValueScore(userId))?.score ?? 0,
    getActiveDays: await (await import("../mole/hodlActiveDaysLive.js")).makeLiveActiveDaysReader(),
  });

  const snapshot = buildWeeklySnapshot({ epoch, participants: result.qualified });

  // What is left to pay from. Read, never spent, by this script.
  //
  // Derived from the treasury KEYPAIR when no pubkey is configured, because
  // "reserve after: unknown" silently disables the single most important check
  // below — whether the reserve can actually cover the batch. A safety check
  // that quietly does not run is worse than one that is absent, since the
  // output still reads as if everything passed.
  //
  // Only the PUBLIC key is taken from the keypair. Nothing here signs anything.
  let reserve = null;
  let reserveWallet = process.env.HODL_RESERVE_PUBKEY || process.env.FAUCET_TREASURY_PUBKEY || null;
  if (!reserveWallet) {
    try {
      const { loadTreasuryKeypair } = await import("../faucet/keypair.js");
      const { getFaucetConfig } = await import("../faucet/config.js");
      reserveWallet = loadTreasuryKeypair(getFaucetConfig().botKeypairPath).publicKey.toBase58();
    } catch (error) {
      console.warn(`  (could not resolve the reserve wallet: ${error?.message || error})`);
    }
  }
  if (reserveWallet) {
    try {
      const res = await getSplBalance(reserveWallet, mint);
      reserve = Number(res?.uiAmount ?? res);
    } catch { reserve = null; }
  }

  if (asJson) {
    // Discord ids are omitted. This output is meant to be pasteable.
    console.log(JSON.stringify({
      epochId: epoch.id,
      payoutDate: nextPayoutDate(epoch).toISOString().slice(0, 10),
      weeklyPool: snapshot.weeklyPool,
      qualifiedCount: snapshot.qualifiedCount,
      baseShare: snapshot.baseShare,
      totalAllocated: snapshot.totalAllocated,
      undistributed: snapshot.undistributed,
      reserve,
      exclusions: summariseExclusions(result.excluded),
      degraded: result.degraded.length,
    }, null, 2));
    return;
  }

  const when = nextPayoutDate(epoch);
  const totalWeeks = Math.round((epoch.endMs - epoch.startMs) / WEEK_MS);
  const balanceRate = Array.isArray(epoch.balanceRates);
  console.log("");
  console.log("HODL Rewards — Tuesday preview          DRY RUN, nothing moves");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  epoch            ${epoch.id} (${epoch.status})   week ${weekIndexFor(epoch, when.getTime()) ?? "—"} of ${totalWeeks}`);
  console.log(`  payout date      ${when.toDateString()}`);
  console.log(`  weekly pool      ${n(snapshot.weeklyPool)} WinLEW`);
  console.log(`  min hold         ${n(epoch.minHold)} WinLEW`);
  if (balanceRate) {
    const w = snapshot.params.activeDaysWindow;
    console.log(`  rule             balance x rate by active days: ${epoch.balanceRates.map((r) => `${(r * 100).toFixed(3)}%`).join(" / ")} (0..7 days)`);
    console.log(`  balance counted  up to ${n(LIMITS.MAX_QUALIFYING_BALANCE)} per identity; cap ${n(LIMITS.MAX_PER_PARTICIPANT_WEEK)} each`);
    console.log(`  active days in   ${w.startIso.slice(0, 10)} .. ${w.endIso.slice(0, 10)} (UTC, end exclusive) — counted as if the snapshot were taken NOW`);
  }
  console.log("");
  console.log(`  considered       ${result.considered} linked profiles${result.sourceRefreshed ? "" : "  ⚠️ NOT REFRESHED"}`);
  console.log(`  QUALIFIED        ${snapshot.qualifiedCount}`);
  if (!balanceRate) console.log(`  base share       ${n(snapshot.baseShare)} WinLEW each (before PoV)`);
  if (balanceRate && snapshot.poolScale != null && snapshot.poolScale < 1) {
    console.log(`  pool scaling     x${Number(snapshot.poolScale).toFixed(4)} (requested exceeded the pool; everyone scaled equally)`);
  }
  console.log("");

  const bonusTotal = snapshot.allocations.reduce(
    (sum, a) => sum + Math.max(0, a.amount - snapshot.baseShare), 0);
  console.log(`  total proposed   ${n(snapshot.totalAllocated)} WinLEW`);
  if (!balanceRate) console.log(`  of which PoV     ${n(bonusTotal)} redistributed within the pool`);
  console.log(`  undistributed    ${n(snapshot.undistributed)} (stays in reserve)`);
  console.log(`  reserve after    ${reserve == null ? "unknown" : n(reserve - snapshot.totalAllocated)} WinLEW`);
  console.log("");

  if (result.excluded.length) {
    console.log("  not qualifying:");
    for (const { reason, count } of summariseExclusions(result.excluded)) {
      console.log(`    ${String(count).padStart(3)}  ${reason}`);
    }
    console.log("");
  }

  if (result.degraded.length) {
    console.log(`  ⚠️  ${result.degraded.length} profile(s) could not be read — treat this preview as incomplete:`);
    for (const d of result.degraded.slice(0, 5)) console.log(`      ${d.reason}`);
    console.log("");
  }

  if (verbose) {
    console.log("  per participant:");
    for (const a of snapshot.allocations) {
      console.log(balanceRate
        ? `    ${String(a.payoutWallet).slice(0, 8)}…  ${String(n(a.amount)).padStart(7)}  days=${a.activeDays}  rate=${(Number(a.rate) * 100).toFixed(3)}%  balance=${n(a.balance)}`
        : `    ${String(a.payoutWallet).slice(0, 8)}…  ${String(n(a.amount)).padStart(7)}  x${a.multiplier}  pov=${a.povScore ?? "—"}`);
    }
    console.log("");
  }

  // Sanity checks a human would otherwise have to do by eye. These are the
  // invariants Stage C's payout worker will also enforce, stated here so a
  // violation is visible BEFORE anything is built on top of the numbers.
  const problems = [];
  if (snapshot.totalAllocated > snapshot.weeklyPool) problems.push("total exceeds the weekly pool");
  if (snapshot.allocations.some((a) => a.amount > LIMITS.MAX_PER_PARTICIPANT_WEEK)) {
    problems.push("a participant exceeds the per-week cap");
  }
  if (reserve != null && snapshot.totalAllocated > reserve) problems.push("the reserve cannot cover this batch");
  if (reserve == null) problems.push("the reserve balance is UNKNOWN — the coverage check did not run");
  // A payout decided from a boot-time cache silently skips anyone who verified
  // since the process started. Better to refuse the batch than to short someone.
  if (!result.sourceRefreshed) problems.push("the participant list was NOT refreshed from the authoritative store");
  if (snapshot.allocations.some((a) => !a.payoutWallet)) problems.push("an allocation has no payout wallet");
  // A failed activity read would pay someone a lower rate than they earned.
  // Shown per person and treated as a blocker, never as "0 active days".
  const activityFailures = result.activityReadFailures || [];
  if (activityFailures.length) {
    problems.push(`participation (active days) could not be read for ${activityFailures.length} identity(ies) — their rate would be understated`);
    for (const f of activityFailures.slice(0, 10)) {
      problems.push(`  ••${String(f.discordUserId).slice(-4)}: ${f.errors.join("; ")}`);
    }
  }

  if (problems.length) {
    console.log("  ❌ NOT SAFE TO PAY:");
    for (const p of problems) console.log(`      ${p}`);
    process.exitCode = 1;
  } else {
    console.log("  ✅ checks pass — safe to pay once Stage C exists.");
  }
  console.log("");
}

main()
  .then(() => {
    // Explicit exit. Mongo and the RPC client keep handles open, so without
    // this a read-only script that has finished its work sits there forever
    // looking like it hung.
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error("hodl:preview failed:", error?.message || error);
    process.exit(2);
  });
