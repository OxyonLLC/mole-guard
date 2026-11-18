#!/usr/bin/env node
// Trace one person's faucet history end to end — `npm run faucet:trace`.
//
//   npm run faucet:trace -- <wallet|accountId>
//   npm run faucet:trace -- <wallet|accountId> --days=90
//   npm run faucet:trace -- <wallet|accountId> --no-chain
//
// WHY THIS EXISTS. When somebody is dripped twice there are exactly two
// causes, and they need opposite fixes:
//
//   1. ONE claim row, TWO on-chain transfers. The web payout worker took the
//      same reserved row twice. That is the race closed by
//      claimStore.takeReservedClaimForProcessing(); seeing it here on a claim
//      OLDER than that fix is a confirmation, seeing it on a NEWER one means
//      the fix is not holding.
//   2. TWO claim rows under DIFFERENT account ids. Nothing raced — the person
//      holds two doors (a Discord login and an X login, say) that were never
//      joined, so the cooldown gate never saw them as one user. The repair is
//      `npm run identity -- merge <idA> <idB>`, not anything in the worker.
//
// Telling those apart by eye means cross-referencing three places at once, so
// this does it in one command.
//
// STRICTLY READ-ONLY. It issues finds and RPC reads and nothing else — no
// writes to Mongo, no writes to the local data dir. That matters because the
// identity and claim stores are managed files: a dev checkout holds a stale
// mirror, and merely booting the normal storage layer can push that stale copy
// back to Mongo. So this reads the Mongo documents directly and never calls
// initMoleStorage(). It is therefore safe to run from any checkout, and it
// REQUIRES Mongo rather than falling back to the local file — a local answer
// would be a confidently wrong one.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SRC_DIR, "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
process.chdir(SRC_DIR);

const { getMongoDb, isMongoEnabled, closeMongo } = await import("../lib/mongo.js");
const { deriveRecipientAta } = await import("../faucet/reconcileClaims.js");
const { FAUCET_ATA } = await import("../mole/evidence/faucetDistributionScanner.js");
const { getSignaturesForAddressRpc, getTransactionRpc } = await import("../mole/evidence/solanaRpcClient.js");

const DOC_ID = "global";
const MERGES_COLLECTION = String(process.env.MOLE_ACCOUNT_MERGES_COLLECTION || "mole_account_merges").trim();
const LINKS_COLLECTION = String(process.env.MOLE_LINKED_WALLETS_COLLECTION || "mole_linked_wallets").trim();

function parseArgs(argv) {
  const out = { subject: "", days: 45, chain: true };
  for (const raw of argv) {
    if (raw === "--no-chain") out.chain = false;
    else if (raw.startsWith("--days=")) out.days = Math.max(1, Number(raw.slice(7)) || 45);
    else if (!raw.startsWith("--") && !out.subject) out.subject = raw.trim();
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.subject) {
  console.log("Usage: npm run faucet:trace -- <wallet|accountId> [--days=45] [--no-chain]");
  process.exit(1);
}

if (!isMongoEnabled()) {
  console.error("Mongo is disabled here. This tool reads the live stores only — set MONGO_ENABLED/MONGO_URI, or run it on the serving machine.");
  process.exit(1);
}
const db = await getMongoDb();
if (!db) {
  console.error("Could not reach Mongo. Refusing to answer from the local file mirror, which is stale on any non-serving checkout.");
  process.exit(1);
}

async function managedPayload(collectionName, fallback) {
  const doc = await db.collection(collectionName).findOne({ _id: DOC_ID }).catch(() => null);
  return doc?.payload && typeof doc.payload === "object" ? doc.payload : fallback;
}

const merges = await managedPayload(MERGES_COLLECTION, {});
const links = await managedPayload(LINKS_COLLECTION, {});

/** Follow the absorbed -> canonical alias chain, with the same hop cap userAccounts.js uses. */
function resolveAccount(id) {
  let cur = String(id || "").trim();
  for (let hop = 0; hop < 12; hop += 1) {
    const next = merges[cur];
    if (!next || next === cur) break;
    cur = String(next);
  }
  return cur;
}

/** Every address that record has ever held — expired and historical included,
 *  because a forensic trace wants the widest net, not the payable set. */
function walletsInRecord(record) {
  const out = new Set();
  const add = (w) => { const s = String(w || "").trim(); if (s) out.add(s); };
  add(record?.wallet);
  add(record?.last_verified_wallet);
  for (const entry of Object.values(record?.wallets || {})) add(entry?.address);
  for (const address of Object.keys(record?.verified_wallets || {})) add(address);
  for (const w of Array.isArray(record?.wallet_history) ? record.wallet_history : []) add(w);
  return [...out];
}

// ── 1. resolve the subject to a USER ────────────────────────────────────
// Three ways in, in order of authority:
//   a) an account id (or one that has been merged away) -> follow the chain;
//   b) a wallet that some account has on record         -> that account's user;
//   c) a wallet with NO identity record at all          -> fall back to the
//      claim rows themselves, because a wallet-only drip leaves a claim
//      trail even when nothing ever linked it to a login. Without (c) the
//      wallet string becomes its own "user" and every real account id looks
//      unmerged, which is a false alarm rather than a finding.
const subjectLooksLikeWallet = !/^\d{5,}$/.test(args.subject) && args.subject.length >= 32;
let rootAccountId = resolveAccount(args.subject);
let rootSource = "account id";

if (subjectLooksLikeWallet) {
  const owner = Object.entries(links).find(([, record]) => walletsInRecord(record).includes(args.subject));
  if (owner) {
    rootAccountId = resolveAccount(owner[0]);
    rootSource = "wallet -> linked account";
  } else {
    // (c) whichever user holds the most claim rows on this wallet is the
    // owner; anyone else on it is the finding.
    const rows = await db.collection("faucet_claims").find({ wallet: args.subject }).toArray();
    const tally = new Map();
    for (const row of rows) {
      const canonical = resolveAccount(row.discordUserId);
      if (!canonical) continue;
      tally.set(canonical, (tally.get(canonical) || 0) + 1);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length) {
      rootAccountId = ranked[0][0];
      rootSource = `wallet -> busiest claiming account (${ranked[0][1]} of ${rows.length} rows)`;
    } else {
      rootSource = "wallet with no identity record and no claims";
    }
  }
}

// Accounts the merge map already knows belong to this user.
const knownAccountIds = new Set([rootAccountId]);
for (const [absorbed] of Object.entries(merges)) {
  if (resolveAccount(absorbed) === rootAccountId) knownAccountIds.add(absorbed);
}

// Wallets across all of them, plus the subject itself if it is an address.
const knownWallets = new Set();
if (subjectLooksLikeWallet) knownWallets.add(args.subject);
for (const id of knownAccountIds) for (const w of walletsInRecord(links[id])) knownWallets.add(w);

console.log(`\nUSER      ${rootAccountId}${rootAccountId !== args.subject ? `   (asked about ${args.subject})` : ""}`);
console.log(`RESOLVED  ${rootSource}`);
console.log(`ACCOUNTS  ${[...knownAccountIds].join(", ")}`);
console.log(`WALLETS   ${knownWallets.size ? [...knownWallets].join(", ") : "— none on record"}`);

// ── 2. every claim row that touches this user, by EITHER key ────────────
// Querying by wallet as well as by account id is the whole point: a row filed
// under an account id the merge map has never heard of is case 2, and an
// account-id-only query would never surface it.
const or = [];
if (knownAccountIds.size) or.push({ discordUserId: { $in: [...knownAccountIds] } });
if (knownWallets.size) or.push({ wallet: { $in: [...knownWallets] } });
const claims = or.length
  ? await db.collection("faucet_claims").find({ $or: or }).sort({ createdAt: 1 }).toArray()
  : [];

console.log(`\nCLAIM ROWS (${claims.length})`);
if (!claims.length) console.log("  — none");
for (const c of claims) {
  const when = new Date(Number(c.createdAt || 0)).toISOString().slice(0, 16).replace("T", " ");
  const cid = String(c.discordUserId || "");
  const foreign = !cid || cid === "null"
    ? "   <-- CLAIM ROW HAS NO ACCOUNT ID"
    : resolveAccount(cid) === rootAccountId ? "" : "   <-- ACCOUNT NOT MERGED INTO THIS USER";
  console.log(`  ${when}  ${String(c.status || "?").padEnd(11)} ${String(c.source || "?").padEnd(7)} ${c.id}`);
  console.log(`      account ${c.discordUserId}   wallet ${c.wallet}   ${c.amountDisplay || c.amountBaseUnits}${foreign}`);
  if (c.signature) console.log(`      signature ${c.signature}`);
}

// Account ids that paid out under this user's wallets but were never merged.
const foreignAccountIds = [...new Set(
  claims
    .map((c) => String(c.discordUserId))
    .filter((id) => id && id !== "null" && resolveAccount(id) !== rootAccountId),
)];

// ── 3. what the chain actually shows ────────────────────────────────────
let transfers = null;
if (args.chain && knownWallets.size) {
  const wantedAtas = new Map();
  for (const w of knownWallets) {
    try {
      wantedAtas.set(deriveRecipientAta(w, process.env.WINLEW_MINT), w);
    } catch { /* not a valid address — skip it rather than abort the trace */ }
  }
  const cutoff = Date.now() - args.days * 86400000;
  transfers = [];
  let before;
  let scanned = 0;
  outer: for (;;) {
    const { result } = await getSignaturesForAddressRpc(FAUCET_ATA, { limit: 1000, ...(before ? { before } : {}) });
    const page = result || [];
    if (!page.length) break;
    for (const s of page) {
      if ((s.blockTime || 0) * 1000 < cutoff) break outer;
      if (s.err) continue;
      scanned += 1;
      process.stdout.write(`  scanning chain: ${scanned}\r`);
      const { result: tx } = await getTransactionRpc(s.signature, {});
      if (!tx || tx.meta?.err) continue;
      const ins = [
        ...(tx.transaction.message.instructions || []),
        ...((tx.meta.innerInstructions || []).flatMap((x) => x.instructions || [])),
      ];
      for (const ix of ins) {
        const p = ix.parsed;
        if (!p || typeof p !== "object") continue;
        if (p.type !== "transfer" && p.type !== "transferChecked") continue;
        if (p.info?.source !== FAUCET_ATA) continue;
        if (!wantedAtas.has(p.info.destination)) continue;
        transfers.push({
          signature: s.signature,
          blockTimeMs: (tx.blockTime || 0) * 1000,
          wallet: wantedAtas.get(p.info.destination),
          amountBaseUnits: String(p.info.amount || p.info.tokenAmount?.amount || "0"),
        });
      }
    }
    before = page[page.length - 1].signature;
    if (page.length < 1000) break;
  }
  process.stdout.write("                              \r");

  console.log(`\nON-CHAIN FAUCET TRANSFERS TO THESE WALLETS, last ${args.days} days (${transfers.length})`);
  if (!transfers.length) console.log("  — none");
  const recorded = new Set(claims.map((c) => c.signature).filter(Boolean));
  for (const t of transfers.sort((a, b) => a.blockTimeMs - b.blockTimeMs)) {
    const when = new Date(t.blockTimeMs).toISOString().slice(0, 16).replace("T", " ");
    const tag = recorded.has(t.signature) ? "" : "   <-- NO CLAIM ROW RECORDS THIS SIGNATURE";
    console.log(`  ${when}  ${t.wallet}  ${t.amountBaseUnits}${tag}`);
    console.log(`      ${t.signature}${tag ? "" : ""}`);
  }
}

// ── 4. verdict ──────────────────────────────────────────────────────────
console.log("\nVERDICT");
const paidStatuses = new Set(["submitted", "confirmed", "reconciling"]);
// Window the claim side to the SAME period the chain was scanned over.
// Comparing every claim ever against a --days slice of the chain would report
// a fake shortfall on any wallet older than the window.
const windowStart = args.chain ? Date.now() - args.days * 86400000 : 0;
const paidClaims = claims.filter(
  (c) => paidStatuses.has(String(c.status)) && Number(c.createdAt || 0) >= windowStart,
);

if (foreignAccountIds.length) {
  console.log(`  SPLIT IDENTITY — ${foreignAccountIds.length} account id(s) claimed against this user's wallets but are not merged into them:`);
  for (const id of foreignAccountIds) console.log(`      ${id}`);
  console.log(`  This is case 2: two doors, never joined, so the cooldown gate treated them as two people.`);
  console.log(`  Repair:  npm run identity -- show ${rootAccountId}`);
  console.log(`           npm run identity -- show ${foreignAccountIds[0]}`);
  console.log(`           npm run identity -- merge ${rootAccountId} ${foreignAccountIds[0]}    (only after reading both)`);
}

if (transfers) {
  const byWallet = new Map();
  for (const t of transfers) byWallet.set(t.wallet, (byWallet.get(t.wallet) || 0) + 1);
  const unrecorded = transfers.filter((t) => !claims.some((c) => c.signature === t.signature));
  // An unrecorded transfer is only the worker-race shape if it is actually a
  // DRIP. The reserve key also signs manual sends, and those legitimately have
  // no claim row — counting them as duplicate payouts turns routine treasury
  // activity into a false alarm, which is how this tool first misread a pair
  // of 10-WinLEW test sends as a double-drip.
  const dripAmounts = new Set(claims.map((c) => String(c.amountBaseUnits || "")).filter(Boolean));
  const duplicateDrips = unrecorded.filter((t) => dripAmounts.has(t.amountBaseUnits));
  const offAmount = unrecorded.filter((t) => !dripAmounts.has(t.amountBaseUnits));

  if (duplicateDrips.length) {
    console.log(`  DUPLICATE PAYOUT — ${duplicateDrips.length} transfer(s) carry a drip-sized amount that no claim row records.`);
    for (const t of duplicateDrips) console.log(`      ${t.signature}  ${t.amountBaseUnits}`);
    console.log(`  That is the worker-race shape. Compare each date against the`);
    console.log(`  claimStore.takeReservedClaimForProcessing() fix — before it, expected; after it, the fix is not holding.`);
  }
  if (offAmount.length) {
    console.log(`  ${offAmount.length} transfer(s) left the faucet in this window at an amount the faucet never drips.`);
    console.log(`  These are manual sends from the reserve key, NOT missing claim rows:`);
    for (const t of offAmount) {
      console.log(`      ${new Date(t.blockTimeMs).toISOString().slice(0, 16).replace("T", " ")}  ${t.amountBaseUnits}  ${t.signature}`);
    }
  }

  if (transfers.length > paidClaims.length && !duplicateDrips.length && !offAmount.length) {
    console.log(`  MORE TRANSFERS THAN CLAIMS — ${transfers.length} vs ${paidClaims.length}, but every signature is recorded. Check for a claim row paid twice under one signature.`);
  } else if (transfers.length < paidClaims.length) {
    console.log(`  UNDER-PAID OR UNSCANNED — ${paidClaims.length} paid claim row(s) but only ${transfers.length} transfer(s) in a ${args.days}-day window.`);
    console.log(`  Widen the window with --days= before treating this as a real gap.`);
  } else if (!foreignAccountIds.length && !duplicateDrips.length && !offAmount.length) {
    console.log(`  CLEAN — ${paidClaims.length} paid claim row(s) and ${transfers.length} transfer(s) over the last ${args.days} days, one user, nothing to repair.`);
  } else if (!duplicateDrips.length && !offAmount.length) {
    console.log(`  Claim rows and transfers agree (${transfers.length}); the split identity above is the only finding.`);
  }
} else if (!foreignAccountIds.length) {
  console.log(`  ${paidClaims.length} paid claim row(s), all under one user. Re-run without --no-chain to confirm against the chain.`);
}
console.log("");

await closeMongo();
