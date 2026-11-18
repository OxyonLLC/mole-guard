// Daily game-payout worker.
//
// Fires once a day at 00:00:01 UTC, sums each player's UNPAID validated game
// winnings, and sends WinLEW in BUNDLED transactions (multiple recipients per
// tx) to save gas. Idempotent: paid claims are marked so a re-run never double
// pays; dust (< min) and wallet-less users carry forward to a future night.
//
// The faucet is unrelated and stays automatic/immediate — this only moves the
// in-app game winnings that accrue through /api/rewards/claim.
//
// Ships defaulting to DRY RUN (GAME_PAYOUTS_DRY_RUN=true): it computes + logs the
// exact batch but sends nothing until you flip the flag.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { createRequire } from 'node:module';
const { rpcConnectionOptions } = createRequire(import.meta.url)('../shared/solanaRpcFetch.cjs');
import {
  getMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

import { listUnpaidClaims, markClaimsPaid, markClaimsWithheld } from "../mole/rewardHistory.js";
import { getLinkedWalletRecord } from "../mole/walletLink.js";
import { refreshManagedFile } from "../mole/storage.js";
import { initMoleStorage } from "../mole/storage.js";
import { buildPayoutPlan, chunkBundles } from "./payoutPlanner.js";
import { resolveAccountId } from "../mole/userAccounts.js";
import { loadPayoutBlocklist, checkPayoutEligibility, describePayoutBlock, PAYOUT_BLOCK_REASONS } from "../services/payoutGate.js";
import solanaConfirmPkg from "../shared/solanaConfirm.cjs";

const { confirmSignatureByPolling } = solanaConfirmPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function bool(v, dflt) {
  if (v === undefined || v === null || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
}
function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

const config = {
  dryRun: bool(process.env.GAME_PAYOUTS_DRY_RUN, true), // default: send nothing
  // Floor matched to the faucet's DRIP_AMOUNT (1500) — 2026-07-30: a nightly
  // send should never be smaller than one faucet click. Sub-floor winnings
  // aren't lost, they carry forward to a future night (see file header).
  minPayout: num(process.env.GAME_PAYOUT_MIN, 1500),
  // Defense-in-depth ceiling (2026-07-19 audit): any single user whose nightly
  // total exceeds this is HELD for review instead of auto-paid. Default 25000
  // ~= a bit over 5 days at the 4500/day reward cap, so honest accrual across a
  // few missed runs still pays, but a forged/bugged spike gets caught.
  maxPayoutPerUser: num(process.env.GAME_PAYOUT_MAX_PER_USER, 25000),
  bundleSize: num(process.env.GAME_PAYOUT_BUNDLE_SIZE, 6),
  cronExpr: process.env.GAME_PAYOUT_CRON || "1 0 0 * * *", // 00:00:01
  timezone: process.env.GAME_PAYOUT_TZ || "UTC",
  rpcUrl: process.env.GAME_PAYOUT_RPC_URL || process.env.SOLANA_RPC || process.env.RPC_URL || "https://solana-rpc.publicnode.com",
  mint: String(process.env.WINLEW_MINT || "").trim(),
  keypairPath: process.env.GAME_PAYOUT_KEYPAIR_PATH || path.resolve(__dirname, "..", "faucet", "bot-keypair.json"),
  logWebhook: String(process.env.GAME_PAYOUT_LOG_WEBHOOK_URL || "").trim(), // Discord webhook for the-logs channel
};

// Post a summary to the-logs channel via a Discord webhook (no bot client needed).
// No-op if GAME_PAYOUT_LOG_WEBHOOK_URL is unset.
async function postLog(content) {
  if (!config.logWebhook || !content) return;
  try {
    await fetch(config.logWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
  } catch (e) {
    console.warn("[game-payout] log webhook post failed:", e?.message || e);
  }
}

let _conn = null;
let _signer = null;
let _decimals = null;

function getConnection() {
  if (!_conn) _conn = new Connection(config.rpcUrl, rpcConnectionOptions('confirmed'));
  return _conn;
}
function getSigner() {
  if (!_signer) {
    const bytes = JSON.parse(fs.readFileSync(config.keypairPath, "utf8"));
    _signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  return _signer;
}
async function getDecimals() {
  if (_decimals === null) {
    const info = await getMint(getConnection(), new PublicKey(config.mint));
    _decimals = info.decimals;
  }
  return _decimals;
}

/** WinLEW (2dp) → base units, precision-safe. */
function toBaseUnits(amount, decimals) {
  const cents = BigInt(Math.round(Number(amount) * 100));
  if (decimals >= 2) return cents * 10n ** BigInt(decimals - 2);
  return cents / 10n ** BigInt(2 - decimals);
}

/** Map a Discord user to the wallet that should receive winnings. */
function resolveWallet(discordUserId) {
  const rec = getLinkedWalletRecord(discordUserId);
  return (
    rec?.wallets?.payout?.address ||
    rec?.wallets?.verified?.address ||
    rec?.wallet ||
    rec?.last_verified_wallet ||
    null
  );
}

async function sendBundle(entries, decimals, batchId) {
  const conn = getConnection();
  const signer = getSigner();
  const mint = new PublicKey(config.mint);
  const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);
  if (!(await conn.getAccountInfo(sourceAta, "confirmed"))) {
    throw new Error(`source_ata_missing:${sourceAta.toBase58()}`);
  }

  const tx = new Transaction();
  for (const e of entries) {
    const wallet = new PublicKey(e.wallet);
    const destAta = await getAssociatedTokenAddress(mint, wallet);
    if (!(await conn.getAccountInfo(destAta, "confirmed"))) {
      tx.add(createAssociatedTokenAccountInstruction(signer.publicKey, destAta, wallet, mint));
    }
    tx.add(
      createTransferInstruction(
        sourceAta,
        destAta,
        signer.publicKey,
        toBaseUnits(e.amount, decimals),
      ),
    );
  }

  const latest = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);

  const sig = await conn.sendRawTransaction(tx.serialize());
  const result = await confirmSignatureByPolling(conn, {
    signature: sig,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    commitment: "confirmed",
  });
  if (result?.value?.err) {
    throw new Error(`bundle confirmed with on-chain error: ${JSON.stringify(result.value.err)}`);
  }
  return sig;
}

function writeLedger(record) {
  try {
    const dir = path.resolve(__dirname, "..", "data");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "game_payouts.json");
    const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    rows.push(record);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  } catch (e) {
    console.warn("[game-payout] ledger write failed:", e?.message || e);
  }
}

/**
 * One payout run. Returns the plan + per-bundle results. Safe in dry run.
 *
 * Bug fixed 2026-07-18: resolveWallet() -> getLinkedWalletRecord() reads
 * wallet-link data through storage.js's managed-JSON cache (linked_wallets.json),
 * which is ONLY synced from Mongo by initMoleStorage() — previously called
 * only by the main `mole` service (src/index.js), never by this standalone
 * worker process. Without it, the cache falls through to a local on-disk
 * file this process never populated, so resolveWallet() returned null for
 * every single user — every claim got skipped with reason "no_wallet",
 * plan.userCount was always 0, and the nightly summary always read "No
 * eligible winnings to pay out this run" regardless of how much was
 * actually pending (confirmed via a live, read-only Mongo check: 39 real
 * unpaid claims and 7 real linked wallets existed the whole time). Calling
 * initMoleStorage() here is idempotent (cached bootPromise) and a no-op
 * when it's already been called in-process, so this is safe for every
 * caller — the scheduled cron run, GAME_PAYOUT_RUN_NOW, and tests alike.
 */
/**
 * The Discord alert for held payouts. Pure, so the wording is testable.
 *
 * THE MESSAGE MUST SAY WHY (fixed 2026-08-20, after it got this wrong in
 * production). Rows are held for two very different reasons — an unusually
 * large total, or the payout BLOCKLIST — and this alert used to print
 * "over the ${h.maxPayoutPerUser}/user cap" for both. A blocklist hold carries
 * no maxPayoutPerUser, so a BANNED wallet was announced to Discord as being
 * "over the undefined/user cap", followed by advice to raise the cap or pay
 * manually. That is an alert instructing a human to pay a banned wallet, and it
 * happened on batch gp-2026-08-20232052.
 *
 * The console line in runPayoutBatch() already used describePayoutBlock() and
 * was correct; only the Discord post was wrong — which is the copy anyone
 * actually reads.
 */
export function buildHeldAlert(batchId, held = [], withheld = []) {
  const blocked = held.filter((h) => h.reason !== "over_max");
  const capped = held.filter((h) => h.reason === "over_max");
  const withheldIds = new Set(withheld.map((w) => w.discordUserId));
  return (
    `⛔ **Game payouts — ${held.length} payout(s) HELD for review** \`${batchId}\`\n` +
    held
      .map((h) => {
        const why = h.reason === "over_max"
          ? `over the ${h.maxPayoutPerUser}/user cap`
          : `**BLOCKED** — ${describePayoutBlock(h.reason)}`;
        const done = withheldIds.has(h.discordUserId) ? " · **withheld permanently**" : "";
        return `• \`${h.discordUserId}\` — **${h.amount} WinLEW** (${h.claimCount} claims), ${why}${done}`;
      })
      .join("\n") +
    `\nThese rows were left UNPAID.` +
    (withheld.length
      ? `\n🚫 **${withheld.length} confirmed ban(s) withheld permanently** — those claims are out of the payout queue and will NOT be reported again. Nothing was paid and nothing was deleted; the rows are marked withheld, not paid. If a ban is lifted on appeal, releaseWithheldClaims() puts them back.`
      : "") +
    (blocked.length && !withheld.length
      ? `\n🚫 **${blocked.length} of these are BLOCKED, not merely over a cap. Do NOT pay them manually and do NOT raise the cap to release them** — the cap is not what is holding them. Investigate first; \`!faucetcluster <wallet>\` shows the funding cluster.`
      : "") +
    (capped.length
      ? `\nFor the ${capped.length} cap hold(s): verify the claims are legitimate, then raise \`GAME_PAYOUT_MAX_PER_USER\` for one run or pay manually.`
      : "")
  );
}

export function describeEmptyPayoutPlan(plan, minPayout) {
  const reasons = new Map();
  for (const row of [...(plan.skipped || []), ...(plan.held || [])]) {
    reasons.set(row.reason, (reasons.get(row.reason) || 0) + 1);
  }
  const labels = {
    no_wallet: "missing payout wallet",
    below_min: `below ${minPayout} WinLEW minimum`,
    over_max: "held above per-user cap",
  };
  const details = [...reasons].map(([reason, count]) =>
    `${count} ${labels[reason] || describePayoutBlock(reason)}`);
  return "No eligible winnings to pay out this run. " +
    (details.length ? details.join("; ") + "." : "No unpaid claims found.");
}

export async function runPayoutBatch() {
  await initMoleStorage();
  // initMoleStorage() only bootstraps ONCE per process (cached bootPromise), so
  // in this long-running worker every run after the first was still reading the
  // wallet-link snapshot taken at boot. Anyone who linked a wallet since would
  // resolve to no_wallet on every subsequent nightly run until a restart — the
  // same failure the 2026-07-18 fix above addressed, returning by a different
  // door. One refresh per nightly batch costs nothing.
  await refreshManagedFile('linked_wallets.json').catch((error) => {
    console.warn('[game-payout] wallet-link refresh failed, using cached data:', error?.message || error);
  });
  const batchId = `gp-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;
  const rows = await listUnpaidClaims();

  // Snapshot the ban lists once for the whole batch. If they cannot be read
  // this returns { ok: false } and every row is HELD — deliberately, see the
  // fail-closed note in payoutGate.js. An unreadable list must never be
  // mistaken for an empty one; the live ban list was silently emptied once
  // already (2026-08-15) and nothing downstream noticed.
  const blocklist = loadPayoutBlocklist();
  if (!blocklist.ok) {
    console.error(`[game-payout] ban list unreadable (${blocklist.error}) — holding the entire batch rather than paying unchecked`);
  }

  const plan = buildPayoutPlan(rows, resolveWallet, {
    minPayout: config.minPayout,
    maxPayoutPerUser: config.maxPayoutPerUser,
    isBlocked: (who) => checkPayoutEligibility(who, blocklist),
    resolveAccountId,
  });

  console.log(
    `[game-payout] ${config.dryRun ? "DRY RUN" : "LIVE"} batch=${batchId} ` +
    `unpaidClaims=${rows.length} payable=${plan.userCount} total=${plan.totalToPay} WinLEW ` +
    `skipped=${plan.skipped.length} held=${plan.held.length} (min=${config.minPayout} max/user=${config.maxPayoutPerUser})`,
  );
  for (const e of plan.entries) {
    console.log(`[game-payout]   → ${e.discordUserId} ${e.amount} WinLEW (${e.claimCount} claims) ${e.wallet}`);
  }
  for (const s of plan.skipped) {
    console.log(`[game-payout]   · skip ${s.discordUserId} ${s.amount} WinLEW — ${s.reason}`);
  }
  // Held payouts are a red flag worth a loud, immediate alert — not just a log
  // line — since the only way to exceed the ceiling is many days of accrual or
  // an upstream anomaly. Fire it in both dry-run and live.
  for (const h of plan.held) {
    const why = h.reason === "over_max"
      ? `over ${h.maxPayoutPerUser}/user cap, needs review`
      : describePayoutBlock(h.reason);
    console.warn(`[game-payout]   ⛔ HELD ${h.discordUserId} ${h.amount} WinLEW (${h.claimCount} claims) — ${why}`);
  }
  // A CONFIRMED BAN IS TERMINAL. payoutPlanner holds a blocked row so a human
  // sees it, which is right the first time and noise every night after — the
  // row returns to the queue on every run. The owner watched the same banned
  // wallet reappear nightly: "if he is on the ban list; dont pay him."
  //
  // So a real ban takes those claims out of the queue for good. They are marked
  // `withheld`, NEVER `paid` — the money did not move, and saying it did would
  // put a lie in the reward history the dashboard reads.
  //
  // `blocklist_unavailable` is deliberately excluded. That reason means the ban
  // list could not be READ, and withholding on it would let one outage
  // permanently void every participant's rewards. Those keep holding and retry
  // tomorrow, which is the whole point of failing closed rather than failing
  // permanently.
  const terminalBlocks = plan.held.filter(
    (h) => h.reason === PAYOUT_BLOCK_REASONS.WALLET_BANNED || h.reason === PAYOUT_BLOCK_REASONS.ACCOUNT_BANNED,
  );
  const withheld = [];
  for (const h of terminalBlocks) {
    if (config.dryRun) { withheld.push({ ...h, updated: 0, dryRun: true }); continue; }
    try {
      const res = await markClaimsWithheld(h.rowKeys || [], { reason: h.reason, batchId });
      withheld.push({ ...h, updated: res.updated || 0 });
      console.warn(`[game-payout]   🚫 WITHHELD ${h.discordUserId} ${h.amount} WinLEW (${res.updated || 0} rows) — ${h.reason}`);
    } catch (error) {
      console.error(`[game-payout] withhold failed for ${h.discordUserId}:`, error?.message || error);
    }
  }

  if (plan.held.length) {
    await postLog(buildHeldAlert(batchId, plan.held, withheld));
  }

  if (config.dryRun || plan.userCount === 0) {
    writeLedger({ batchId, at: new Date().toISOString(), dryRun: config.dryRun, total: plan.totalToPay, userCount: plan.userCount, entries: plan.entries, skipped: plan.skipped, held: plan.held, results: [] });
    await postLog(
      `${config.dryRun ? "🧪 **Game payouts — DRY RUN**" : "ℹ️ **Game payouts**"} \`${batchId}\`\n` +
      (plan.userCount === 0
        ? describeEmptyPayoutPlan(plan, config.minPayout)
        : `Would pay **${plan.userCount}** player(s), total **${plan.totalToPay} WinLEW** (${plan.skipped.length} skipped). ` +
          `${config.dryRun ? "No funds sent — set `GAME_PAYOUTS_DRY_RUN=false` to go live." : ""}`),
    );
    return { batchId, dryRun: config.dryRun, plan, results: [] };
  }

  const decimals = await getDecimals();
  const bundles = chunkBundles(plan.entries, config.bundleSize);
  const results = [];
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    try {
      const tx = await sendBundle(bundle, decimals, batchId);
      const rowKeys = bundle.flatMap((e) => e.rowKeys);
      await markClaimsPaid(rowKeys, { tx, batchId });
      results.push({ bundle: i, ok: true, tx, users: bundle.map((e) => e.discordUserId), amount: bundle.reduce((s, e) => s + e.amount, 0) });
      console.log(`[game-payout]   ✓ bundle ${i + 1}/${bundles.length} tx=${tx} (${bundle.length} users)`);
    } catch (err) {
      // Leave these rows unpaid — they retry on the next nightly run.
      results.push({ bundle: i, ok: false, error: err?.message || String(err), users: bundle.map((e) => e.discordUserId) });
      console.error(`[game-payout]   ✗ bundle ${i + 1}/${bundles.length} failed:`, err?.message || err);
    }
  }
  writeLedger({ batchId, at: new Date().toISOString(), dryRun: false, total: plan.totalToPay, userCount: plan.userCount, entries: plan.entries, skipped: plan.skipped, held: plan.held, results });

  const okBundles = results.filter((r) => r.ok);
  const paidUsers = okBundles.reduce((n, r) => n + (r.users?.length || 0), 0);
  const paidTotal = Math.round(okBundles.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;
  const failed = results.length - okBundles.length;
  const txList = okBundles.map((r) => r.tx).filter(Boolean).slice(0, 5)
    .map((sig) => `[${sig.slice(0, 8)}…](https://solscan.io/tx/${sig})`)
    .join(", ") || "none";
  await postLog(
    `💸 **Game payouts sent** \`${batchId}\`\n` +
    `Paid **${paidUsers}** player(s), total **${paidTotal} WinLEW** across ${okBundles.length}/${bundles.length} bundle(s)` +
    `${failed ? ` — ⚠️ ${failed} bundle(s) failed, will retry next run` : ""}.\n` +
    `Tx: ${txList}`,
  );
  return { batchId, dryRun: false, plan, results };
}

async function start() {
  if (!config.mint) {
    console.error("[game-payout] WINLEW_MINT not set — refusing to start.");
    process.exit(1);
  }
  // Fail fast and visibly at boot rather than silently at the first cron
  // fire (which could be many hours later) — runPayoutBatch() also calls
  // this itself (idempotent), so this is purely for earlier diagnostics.
  await initMoleStorage().catch((e) => {
    console.warn("[game-payout] storage bootstrap failed at startup (will retry on first run):", e?.message || e);
  });
  console.log(
    `[game-payout] scheduled '${config.cronExpr}' ${config.timezone} | mode=${config.dryRun ? "DRY RUN" : "LIVE"} ` +
    `min=${config.minPayout} bundle=${config.bundleSize} rpc=${config.rpcUrl}`,
  );
  cron.schedule(config.cronExpr, () => {
    runPayoutBatch().catch((e) => console.error("[game-payout] batch error:", e?.message || e));
  }, { timezone: config.timezone });

  // Optional: run immediately once on boot (handy for ops/testing).
  if (bool(process.env.GAME_PAYOUT_RUN_NOW, false)) {
    runPayoutBatch().catch((e) => console.error("[game-payout] run-now error:", e?.message || e));
  }
}

// Only auto-start when run as a service entry (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  start();
}
