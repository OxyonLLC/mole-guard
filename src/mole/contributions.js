// Contribution system — a holder voluntarily sends real WinLEW to one of the
// project's own reserve wallets (Dev, Faucet, Burn) and gets it recorded as a
// ranked act of support. Every number here comes from an on-chain transaction
// this module independently verified — never a client-claimed amount. Same
// "evidence over assumptions" standard as burn events, quiz payouts, and
// governance eligibility elsewhere in this codebase.
import fs from "fs";
import path from "path";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
import { getMongoDb } from "../lib/mongo.js";
import { getConfig } from "./config.js";
import { findLinkedProfileByWallet } from "./walletLink.js";

// Same 3 addresses already independently verified and shown on /transparency/
// (src/mole/web.js's TRANSPARENCY_COMPONENTS) and src/mole/burnEvents.js's
// BURN_WALLET_ADDRESS — duplicated here as plain constants rather than
// imported, since TRANSPARENCY_COMPONENTS lives inside a function closure in
// web.js, not a module-level export. If those addresses ever change, this
// map must be updated to match.
export const CONTRIBUTION_CAUSES = {
  dev: { label: "Developer Reserve", address: "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ" },
  faucet: { label: "Discord & Web Faucet Reserve", address: "FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE" },
  burn: { label: "Burn Wallet", address: "EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74" },
  // The wallet behind the separate @WinLewToken X/Twitter faucet program —
  // NOT the website's own /faucet/ (that's the `faucet` cause above). Same
  // address already tracked as "xFaucetReserve" in web.js's
  // TRANSPARENCY_COMPONENTS (2026-07-17).
  xFaucet: { label: "X (Twitter) Faucet Reserve", address: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp" },
  // Governance vote-weight purchases (2026-07-28) — deliberately the SAME
  // address as xFaucet above ("winlew.sol"), not a new dedicated wallet.
  // Tracked as its own cause so getUserContributionSummary().byCause.governance
  // gives an exact "lifetime WinLEW paid toward vote weight" figure, even
  // though it shares a destination with xFaucet. See src/mole/governanceVoteCredits.js
  // for how this total becomes purchased vote weight, and /governance/ for
  // the public reasoning on why this wallet was reused rather than minted new.
  governance: { label: "Governance Vote Fund", address: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp" },
};

// Second, separate reward multiplier (stacks with proofOfValue.js's
// povRewardMultiplier, multiplicatively) based on lifetime Clout
// (getUserContributionSummary().total, already a verified running total —
// see recordContribution() below). Same small, capped philosophy as PoV's
// own multiplier: a thank-you nudge for real reserve contributions, not a
// wealth multiplier. Applied at each system's own payout chokepoint, never
// here.
const CONTRIBUTION_REWARD_TIERS = Object.freeze([
  { min: 5000000, multiplier: 1.05 },
  { min: 500000, multiplier: 1.03 },
  { min: 0, multiplier: 1 },
]);

export function contributionRewardMultiplier(totalContributed) {
  const total = Math.max(0, Number(totalContributed) || 0);
  return (CONTRIBUTION_REWARD_TIERS.find((t) => total >= t.min) || { multiplier: 1 }).multiplier;
}

/**
 * Convenience wrapper for payout call sites — mirrors
 * proofOfValue.js's getPovRewardMultiplier(). Failure-safe: any lookup
 * error falls back to 1 (no bonus, never a penalty).
 */
export async function getContributionRewardMultiplier(discordUserId) {
  try {
    const { total } = await getUserContributionSummary(discordUserId);
    return contributionRewardMultiplier(total);
  } catch (err) {
    console.warn("[contributions] getContributionRewardMultiplier failed, defaulting to 1:", err?.message || err);
    return 1;
  }
}

// External growth actions (locking/vesting/staking/liquidity) happen on
// third-party programs we don't control — Jupiter, Streamflow, Raydium —
// so there is no destination address we can build+verify a transaction
// against the way CONTRIBUTION_CAUSES above works. These are link-outs
// only; recordExternalSubmission() below queues a "please review" record
// (address self-reported, NOT independently verified) for a maintainer to
// manually check on-chain before ever adding it to /transparency/. Never
// treat an entry from here as a confirmed contribution.
//
// `directTransfer` is the odd one out: it's not a third-party platform at
// all — it's for a holder who sent WinLEW straight to one of our OWN
// reserve wallets (Dev/Faucet/xFaucet/Burn) away from the Contribute page,
// so /api/contribute/confirm's automatic on-chain verification never ran
// against it (no session, or it happened before ever connecting). Same
// review-queue mechanics as the third-party rows, but the self-reported
// value is a transaction signature, not a contract/lock address — see
// EXTERNAL_VERIFIED_CONTRIBUTIONS below for where a verified one of these
// ends up. Exactly how millerknoll's 50M burn transfer (2026-07-25) was
// found and added, generalized so a maintainer doesn't have to
// hand-discover the next one.
export const EXTERNAL_CONTRIBUTION_LINKS = {
  jupiterLock: { label: "Jupiter Lock", platform: "Jupiter", type: "lock", url: "https://lock.jup.ag/create", icon: "🔒" },
  streamflowLock: { label: "Streamflow Token Lock", platform: "Streamflow", type: "lock", url: "https://app.streamflow.finance/token-lock", icon: "🔐" },
  streamflowVesting: { label: "Streamflow Vesting", platform: "Streamflow", type: "vesting", url: "https://app.streamflow.finance/vesting", icon: "📅" },
  streamflowStaking: { label: "Streamflow Staking", platform: "Streamflow", type: "staking", url: "https://app.streamflow.finance/staking?created=true", icon: "📈" },
  raydiumLiquidity: {
    label: "Raydium Add Liquidity",
    platform: "Raydium",
    type: "liquidity",
    url: "https://raydium.io/liquidity/increase/?mode=add&pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx",
    icon: "💧",
  },
  directTransfer: {
    label: "Direct Transfer (sent outside Contribute)",
    platform: "WinLEW",
    type: "direct-transfer",
    url: "https://winlew.co/contribute/",
    icon: "💜",
  },
};

// Historical contributions sent directly on-chain, away from this site's own
// Contribute flow — so there was never a linked Discord session for
// recordContribution() to attach them to — but independently verified the
// same way as everything else here. Manually curated by a maintainer after
// on-chain verification, never accepted as a user-submitted claim (that's
// what recordExternalSubmission() below is for). See
// src/mole/burnEvents.js's "transfer-2026-07-25-holder-to-burn-wallet" entry
// for the full verification trail behind this exact transaction.
export const EXTERNAL_VERIFIED_CONTRIBUTIONS = [
  {
    id: "external-2026-07-25-holder-burn",
    cause: "burn",
    amount: 50000000,
    name: "millerknoll",
    wallet: "D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz",
    signature: "4iBFXv2NJvy6ejznafRngZgyz3L5ZbY1kpnqHUVTY28JkeHKoKidM4og36jsLmEMdietLsnzfmkUA9EPk2nCSfw4",
    explorerUrl: "https://solscan.io/tx/4iBFXv2NJvy6ejznafRngZgyz3L5ZbY1kpnqHUVTY28JkeHKoKidM4og36jsLmEMdietLsnzfmkUA9EPk2nCSfw4",
    contributedAt: "2026-07-25T06:05:02.000Z",
    // Same tx as burnEvents.js's matching entry: raises this Clout total, but
    // — exactly as on /burn/ — does NOT mean the tokens have been burned yet,
    // only that they were voluntarily sent to the burn wallet.
  },
  {
    id: "external-2026-07-25-lewsales-xfaucet-to-faucet",
    cause: "faucet",
    amount: 2000000,
    name: "LewSales",
    wallet: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp",
    signature: "5pqvuyfshha5w7pxvj58X35hGnqTkXTgZacqgFcp54kiHww5KnAiL6QFZ4w4iv7RKjnVhth8oH3wLyTcDkXbwDZ8",
    explorerUrl: "https://solscan.io/tx/5pqvuyfshha5w7pxvj58X35hGnqTkXTgZacqgFcp54kiHww5KnAiL6QFZ4w4iv7RKjnVhth8oH3wLyTcDkXbwDZ8",
    contributedAt: "2026-07-25T05:50:56.000Z",
    // A direct transfer from the X Faucet Reserve (GFxz42...EhAp, "Winlew.sol",
    // owned by the same person as the Dev wallet) into the Discord & Web
    // Faucet Reserve — a genuine spl-token transferChecked instruction for
    // exactly 2,000,000.000000 WinLEW, independently verified on-chain. Not
    // built through /contribute/'s own flow, so recorded here the same way
    // as the millerknoll entry above.
  },
];

// Loose base58 shape check — not a cryptographic guarantee, just enough to
// reject obvious junk before it reaches a human reviewer. Covers both a
// Solana address (32-44 chars) and a transaction signature (~86-88 chars,
// the directTransfer submission case above) with one range.
const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

function dataDir() {
  return getConfig().DATA_DIR;
}
function filePath() {
  return path.join(dataDir(), "contributions.json");
}
function externalFilePath() {
  return path.join(dataDir(), "external-contributions.json");
}
function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}
function readFileDbAt(file) {
  ensureDir();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || [];
  } catch {
    return [];
  }
}
function writeFileDbAt(file, rows) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}
function readFileDb() {
  return readFileDbAt(filePath());
}
function writeFileDb(rows) {
  writeFileDbAt(filePath(), rows);
}
function collName() {
  return process.env.MOLE_CONTRIBUTIONS_COLLECTION || "mole_contributions";
}
function externalCollName() {
  return process.env.MOLE_EXTERNAL_CONTRIBUTIONS_COLLECTION || "mole_external_contributions";
}

let _conn = null;
function getConnection() {
  if (!_conn) _conn = new Connection(String(getConfig().SOLANA_RPC || "").trim(), "confirmed");
  return _conn;
}

let _decimals = null;
async function getDecimals() {
  if (_decimals === null) {
    const info = await getMint(getConnection(), new PublicKey(getConfig().WINLEW_MINT));
    _decimals = info.decimals;
  }
  return _decimals;
}

/** WinLEW (2dp) → base units, precision-safe — same conversion payout-worker.js uses. */
function toBaseUnits(amount, decimals) {
  const cents = BigInt(Math.round(Number(amount) * 100));
  if (decimals >= 2) return cents * 10n ** BigInt(decimals - 2);
  return cents / 10n ** BigInt(2 - decimals);
}

/**
 * Builds an UNSIGNED WinLEW transfer from the caller's own wallet to the
 * given cause's reserve wallet. The caller is the fee payer — this is their
 * contribution, not a payout, so they cover their own network fee. Returns a
 * base64 transaction the client deserializes and asks the connected wallet
 * to sign + send; nothing is submitted from the server.
 */
export async function buildContributionTransaction({ wallet, cause, amountWinlew }) {
  const causeInfo = CONTRIBUTION_CAUSES[String(cause || "")];
  if (!causeInfo) return { ok: false, error: "unknown_cause" };
  const amount = Number(amountWinlew);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };

  let ownerKey, destKey, mint;
  try {
    ownerKey = new PublicKey(String(wallet));
    destKey = new PublicKey(causeInfo.address);
    mint = new PublicKey(getConfig().WINLEW_MINT);
  } catch {
    return { ok: false, error: "invalid_wallet" };
  }

  const conn = getConnection();
  const decimals = await getDecimals();
  const sourceAta = await getAssociatedTokenAddress(mint, ownerKey);
  const destAta = await getAssociatedTokenAddress(mint, destKey);

  // No ATA-creation instruction here on purpose (2026-07-19): all 3 reserve
  // wallets already hold confirmed WinLEW balances (see /transparency/), so
  // their ATAs are guaranteed to already exist, and a payer-creates-a-
  // third-party's-token-account instruction is exactly the shape wallet
  // security scanners (Phantom/Blowfish) flag as drainer-kit-like — it got
  // this transaction blocked as "potentially malicious" in practice. A
  // single transfer instruction is both sufficient and far less suspicious.
  const tx = new Transaction();
  tx.add(createTransferInstruction(sourceAta, destAta, ownerKey, toBaseUnits(amount, decimals)));

  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = ownerKey;

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { ok: true, transactionBase64: serialized.toString("base64"), destination: causeInfo.address };
}

/**
 * Relays an already-signed contribution transaction to the RPC on the
 * client's behalf. Exists because Phantom desktop's own send pipeline can
 * fail with an opaque "Unexpected error" AFTER the user approves — the
 * wallet signs fine, it just can't submit (observed 2026-07-30, after
 * Phantom confirmed the winlew.co domain itself was cleared). The client
 * falls back to provider.signTransaction() + this endpoint, so the send
 * goes through our own RPC instead of the wallet's.
 *
 * Deliberately NOT a generic relay: it only submits the exact shape
 * buildContributionTransaction() produces — a single SPL-token instruction
 * whose writable destination is this cause's reserve ATA, fee-paid and
 * signed by the caller's own verified wallet. serialize() below also
 * verifies every present signature, so garbage or tampered bytes are
 * rejected before they ever reach the RPC.
 */
export async function submitSignedContributionTransaction({ wallet, cause, signedTransactionBase64 }) {
  const causeInfo = CONTRIBUTION_CAUSES[String(cause || "")];
  if (!causeInfo) return { ok: false, error: "unknown_cause" };

  let ownerKey, destKey, mint;
  try {
    ownerKey = new PublicKey(String(wallet));
    destKey = new PublicKey(causeInfo.address);
    mint = new PublicKey(getConfig().WINLEW_MINT);
  } catch {
    return { ok: false, error: "invalid_wallet" };
  }

  let tx;
  try {
    tx = Transaction.from(Buffer.from(String(signedTransactionBase64 || ""), "base64"));
  } catch {
    return { ok: false, error: "invalid_transaction" };
  }

  if (!tx.feePayer || !tx.feePayer.equals(ownerKey)) return { ok: false, error: "wallet_mismatch" };
  const signedByOwner = (tx.signatures || []).some((s) => s.publicKey.equals(ownerKey) && s.signature);
  if (!signedByOwner) return { ok: false, error: "signature_missing" };

  const destAta = await getAssociatedTokenAddress(mint, destKey);
  const instructions = tx.instructions || [];
  const isContributionShape =
    instructions.length === 1
    && instructions[0].programId.equals(TOKEN_PROGRAM_ID)
    && instructions[0].keys.some((k) => k.pubkey.equals(destAta) && k.isWritable);
  if (!isContributionShape) return { ok: false, error: "unexpected_transaction_shape" };

  let raw;
  try {
    raw = tx.serialize();
  } catch {
    return { ok: false, error: "invalid_signature" };
  }

  try {
    const signature = await getConnection().sendRawTransaction(raw, { skipPreflight: false });
    return { ok: true, signature };
  } catch (error) {
    return { ok: false, error: "submit_failed", message: error?.message || String(error) };
  }
}

/**
 * Independently re-fetches the given signature from the RPC and verifies it
 * actually is what the client claims: a confirmed WinLEW transfer, from the
 * caller's own verified wallet, to the claimed cause's reserve wallet. The
 * recorded amount is read from the transaction's own token-balance delta —
 * never the client-supplied amountWinlew, which is only ever a UI hint for
 * building the transaction in the first place.
 */
// `getParsedTransaction` is injectable (default: the real RPC call below) —
// same dependency-injection pattern governance's checkLiveWinlewEligibility()
// uses for its `getBalance` override — purely so tests can simulate a wrong
// destination/mint/signer/already-erred transaction deterministically,
// without touching real Solana RPC. Production never overrides it.
export async function confirmContribution({
  discordUserId,
  wallet,
  cause,
  signature,
  getParsedTransaction = (sig) => getConnection().getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }),
  checkSignatureRecorded = isSignatureRecorded,
} = {}) {
  const causeInfo = CONTRIBUTION_CAUSES[String(cause || "")];
  if (!causeInfo) return { ok: false, error: "unknown_cause" };
  const sig = String(signature || "").trim();
  if (!sig) return { ok: false, error: "signature_required" };

  if (await checkSignatureRecorded(sig)) return { ok: false, error: "already_recorded" };

  let parsed;
  try {
    parsed = await getParsedTransaction(sig);
  } catch (error) {
    return { ok: false, error: "rpc_lookup_failed", message: error?.message || String(error) };
  }
  if (!parsed) return { ok: false, error: "signature_not_found" };
  if (parsed.meta?.err) return { ok: false, error: "transaction_failed" };

  const signerKeys = (parsed.transaction?.message?.accountKeys || [])
    .filter((k) => k.signer)
    .map((k) => String(k.pubkey));
  if (!signerKeys.includes(String(wallet))) return { ok: false, error: "wallet_mismatch" };

  const mint = getConfig().WINLEW_MINT;
  const pre = parsed.meta?.preTokenBalances || [];
  const post = parsed.meta?.postTokenBalances || [];
  const destPost = post.find((b) => b.owner === causeInfo.address && b.mint === mint);
  if (!destPost) return { ok: false, error: "wrong_destination_or_mint" };
  const destPre = pre.find((b) => b.accountIndex === destPost.accountIndex);
  const before = Number(destPre?.uiTokenAmount?.uiAmount ?? 0);
  const after = Number(destPost?.uiTokenAmount?.uiAmount ?? 0);
  const amount = Number((after - before).toFixed(2));
  if (!(amount > 0)) return { ok: false, error: "no_positive_transfer_found" };

  const result = await recordContribution({ discordUserId, wallet, cause, amount, signature: sig });
  return { ok: true, amount, cause, duplicate: !!result.duplicate };
}

async function isSignatureRecorded(signature) {
  const db = await getMongoDb().catch(() => null);
  if (db) {
    try {
      const existing = await db.collection(collName()).findOne({ signature });
      return !!existing;
    } catch (e) {
      console.warn("[contributions] mongo dedupe check failed, using file:", e?.message || e);
    }
  }
  return readFileDb().some((r) => r.signature === signature);
}

async function recordContribution({ discordUserId, wallet, cause, amount, signature }) {
  const row = {
    discordUserId: String(discordUserId || ""),
    wallet: String(wallet || ""),
    cause: String(cause),
    amount: Number(amount),
    signature: String(signature),
    contributedAt: new Date().toISOString(),
  };

  const db = await getMongoDb().catch((e) => {
    console.warn("[contributions] mongo unavailable, using file:", e?.message || e);
    return null;
  });
  if (db) {
    try {
      const coll = db.collection(collName());
      const existing = await coll.findOne({ signature: row.signature });
      if (existing) return { ok: true, duplicate: true, row: existing };
      await coll.insertOne(row);
      return { ok: true, row };
    } catch (e) {
      console.warn("[contributions] mongo write failed, using file:", e?.message || e);
    }
  }

  const rows = readFileDb();
  const exists = rows.find((r) => r.signature === row.signature);
  if (exists) return { ok: true, duplicate: true, row: exists };
  rows.push(row);
  writeFileDb(rows);
  return { ok: true, row };
}

// Same explorer used throughout /burn/ and /transparency/ — every entry the
// Clout leaderboard shows a tx for links here, never a bare signature string.
function solscanTxUrl(signature) {
  return `https://solscan.io/tx/${signature}`;
}

// Folds EXTERNAL_VERIFIED_CONTRIBUTIONS into a leaderboard's rows, keyed by
// wallet (these are hand-added for off-platform transfers, not written
// through the normal /contribute/ flow, so they carry no discordUserId of
// their own). Each row's discordUserId is backfilled here — dynamically, not
// stored — via findLinkedProfileByWallet(), the same wallet->Discord lookup
// already used for verification elsewhere. This is what lets
// getUserContributionSummary() (below) find these on a user's own Dashboard;
// previously it couldn't, since it filters strictly by discordUserId and
// these rows never had one. Self-healing for any future manual entry, and
// correctly resolves to null (no match) for rows whose wallet is a shared
// reserve address rather than a personal, linked wallet.
function externalRowsForCause(causeFilter) {
  const byWallet = new Map();
  for (const ext of EXTERNAL_VERIFIED_CONTRIBUTIONS) {
    if (causeFilter && ext.cause !== causeFilter) continue;
    const key = ext.wallet || ext.id;
    const entry = byWallet.get(key) || {
      externalId: key,
      name: ext.name,
      discordUserId: findLinkedProfileByWallet(ext.wallet)?.discordUserId || null,
      total: 0,
      contributions: 0,
      externalVerified: true,
      signatures: [],
    };
    entry.total += Number(ext.amount || 0);
    entry.contributions += 1;
    if (ext.signature) entry.signatures.push(ext.signature);
    byWallet.set(key, entry);
  }
  return [...byWallet.values()];
}

/** Per-cause + overall totals, ranked — the "Clout" leaderboard. */
export async function getContributionLeaderboard({ cause, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const causeFilter = cause ? String(cause) : null;

  let rows = null;
  const db = await getMongoDb().catch(() => null);
  if (db) {
    try {
      const coll = db.collection(collName());
      const match = causeFilter ? { cause: causeFilter } : {};
      const aggRows = await coll.aggregate([
        { $match: match },
        { $group: { _id: "$discordUserId", total: { $sum: "$amount" }, contributions: { $sum: 1 }, signatures: { $push: "$signature" } } },
      ]).toArray();
      rows = aggRows.map((r) => ({
        discordUserId: String(r._id || ""),
        total: Number(r.total || 0),
        contributions: Number(r.contributions || 0),
        signatures: (r.signatures || []).filter(Boolean),
      }));
    } catch (e) {
      console.warn("[contributions] mongo leaderboard read failed, using file:", e?.message || e);
    }
  }

  if (rows === null) {
    const byUser = new Map();
    for (const row of readFileDb()) {
      if (causeFilter && row.cause !== causeFilter) continue;
      const id = String(row.discordUserId);
      const entry = byUser.get(id) || { discordUserId: id, total: 0, contributions: 0, signatures: [] };
      entry.total += Number(row.amount || 0);
      entry.contributions += 1;
      if (row.signature) entry.signatures.push(row.signature);
      byUser.set(id, entry);
    }
    rows = [...byUser.values()];
  }

  return [...rows, ...externalRowsForCause(causeFilter)]
    .map((r) => ({
      ...r,
      total: Number((r.total || 0).toFixed(2)),
      evidenceUrls: (r.signatures || []).map(solscanTxUrl),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, safeLimit);
}

/** One user's own per-cause totals + overall rank, for the Dashboard card. */
export async function getUserContributionSummary(discordUserId) {
  const userId = String(discordUserId || "");
  const overall = await getContributionLeaderboard({ limit: 100000 });
  const rank = overall.findIndex((r) => r.discordUserId === userId);
  const totalAll = overall.find((r) => r.discordUserId === userId)?.total || 0;

  const byCause = {};
  for (const cause of Object.keys(CONTRIBUTION_CAUSES)) {
    const board = await getContributionLeaderboard({ cause, limit: 100000 });
    const mine = board.find((r) => r.discordUserId === userId);
    byCause[cause] = Number((mine?.total || 0).toFixed(2));
  }

  return {
    total: Number(totalAll.toFixed(2)),
    rank: rank >= 0 ? rank + 1 : null,
    totalContributors: overall.length,
    byCause,
  };
}

/**
 * Queues a self-reported external growth action (Jupiter/Streamflow lock,
 * vesting, staking, or Raydium liquidity) for manual maintainer review —
 * this is NOT independently verified the way CONTRIBUTION_CAUSES transfers
 * are (there's no destination we control to check a balance delta against),
 * so it never touches the Clout leaderboard or recordContribution() above.
 * A maintainer checks the address on-chain and, only if it holds up, adds
 * it to /transparency/ by hand — same as every other entry there today.
 */
export async function recordExternalSubmission({ discordUserId, wallet, linkId, address, note }) {
  const link = EXTERNAL_CONTRIBUTION_LINKS[String(linkId || "")];
  if (!link) return { ok: false, error: "unknown_link" };
  const addr = String(address || "").trim();
  if (!BASE58_ADDRESS_RE.test(addr)) return { ok: false, error: "invalid_address" };

  const row = {
    discordUserId: String(discordUserId || ""),
    wallet: String(wallet || ""),
    linkId: String(linkId),
    platform: link.platform,
    type: link.type,
    address: addr,
    note: String(note || "").slice(0, 500),
    status: "pending_review",
    submittedAt: new Date().toISOString(),
  };

  const db = await getMongoDb().catch((e) => {
    console.warn("[contributions] mongo unavailable for external submission, using file:", e?.message || e);
    return null;
  });
  if (db) {
    try {
      await db.collection(externalCollName()).insertOne(row);
      return { ok: true, submission: row };
    } catch (e) {
      console.warn("[contributions] mongo external submission write failed, using file:", e?.message || e);
    }
  }

  const rows = readFileDbAt(externalFilePath());
  rows.push(row);
  writeFileDbAt(externalFilePath(), rows);
  return { ok: true, submission: row };
}
