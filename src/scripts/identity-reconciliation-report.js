#!/usr/bin/env node
// Read-only identity/reward reconciliation report. This script never updates a
// balance or identity. Identifiers are hashed in output so reports are safe to
// attach to an incident without publishing private mappings.
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMongoDb, closeMongo } from "../lib/mongo.js";

const hash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
const owner = (value) => typeof value === "string" ? value : value?.account;
const kind = (id) => String(id || "").startsWith("guest:") ? "guest"
  : String(id || "").startsWith("wallet:") ? "wallet"
  : String(id || "").startsWith("x:") ? "x"
  : /^\d{5,25}$/.test(String(id || "")) ? "discord" : "other";

const db = await getMongoDb();
if (!db) throw new Error("MongoDB is not configured; no authoritative report can be produced.");
const rewards = db.collection(process.env.MOLE_GAME_REWARD_HISTORY_COLLECTION || "mole_game_reward_history");
const managedDoc = async (name) => db.collection(name).findOne({ _id: "global" });
const managed = async (name) => (await managedDoc(name))?.payload || {};

// Storage-sync health for the identity-critical managed stores. This runs in
// its own process (a scheduled report, an on-call's terminal), so it cannot
// see storage.js's in-memory degradedStores map the way the live web server
// can (see /api/health/status) — it infers the same signal by comparing each
// store's Mongo updatedAt against its local file's mtime. A local file newer
// than Mongo by more than the threshold means a write landed on disk but
// never got confirmed upstream: exactly the failure mode this whole audit
// was chasing, one layer below the reward ledger.
const STALE_THRESHOLD_MS = 60_000;
const CRITICAL_STORES = [
  { file: "account_merges.json", collection: process.env.MOLE_ACCOUNT_MERGES_COLLECTION || "mole_account_merges" },
  { file: "account_merge_audit.json", collection: process.env.MOLE_ACCOUNT_MERGE_AUDIT_COLLECTION || "mole_account_merge_audit" },
  { file: "linked_wallets.json", collection: process.env.MOLE_LINKED_WALLETS_COLLECTION || "mole_linked_wallets" },
  { file: "synced_identities.json", collection: process.env.MOLE_SYNCED_IDENTITIES_COLLECTION || "mole_synced_identities" },
];

async function storageSyncHealth() {
  const dataDir = String(process.env.DATA_DIR || "./data").trim();
  const results = [];
  for (const { file, collection } of CRITICAL_STORES) {
    const doc = await managedDoc(collection).catch(() => null);
    const mongoUpdatedAt = doc?.updatedAt ? new Date(doc.updatedAt).getTime() : null;
    let localMtime = null;
    try {
      localMtime = fs.statSync(path.join(dataDir, file)).mtimeMs;
    } catch {
      // No local file (e.g. this box has never been a writer) — nothing to compare.
    }
    const possibleUnconfirmedWrite = Boolean(
      localMtime && mongoUpdatedAt && localMtime - mongoUpdatedAt > STALE_THRESHOLD_MS,
    );
    results.push({ file, hasMongoRecord: Boolean(doc), possibleUnconfirmedWrite });
  }
  return results;
}

const [rows, merges, identities, wallets, mergeAudit, syncHealth] = await Promise.all([
  rewards.find({}).toArray(),
  managed(process.env.MOLE_ACCOUNT_MERGES_COLLECTION || "mole_account_merges"),
  managed(process.env.MOLE_SYNCED_IDENTITIES_COLLECTION || "mole_synced_identities"),
  managed(process.env.MOLE_LINKED_WALLETS_COLLECTION || "mole_linked_wallets"),
  managed(process.env.MOLE_ACCOUNT_MERGE_AUDIT_COLLECTION || "mole_account_merge_audit"),
  storageSyncHealth(),
]);

function canonical(input) {
  let current = String(input || "");
  const seen = new Set();
  while (merges[current] && !seen.has(current)) {
    seen.add(current);
    current = String(merges[current]);
  }
  return current;
}

const socialOwners = new Set(Object.values(identities).map(owner).filter(Boolean).map(canonical));
const walletOwners = new Set(Object.keys(wallets).map(canonical));
const groups = new Map();
const eventKeys = new Map();
for (const row of rows) {
  const original = String(row.discordUserId || "");
  const account = canonical(original);
  const entry = groups.get(account) || {
    account: hash(account), kind: kind(account), identities: new Map(),
    total: 0, paid: 0, unpaid: 0, withheld: 0, claims: 0,
  };
  const identity = entry.identities.get(original) || { id: hash(original), kind: kind(original), total: 0, claims: 0 };
  const amount = Number(row.payout || 0);
  identity.total += amount; identity.claims += 1;
  entry.identities.set(original, identity);
  entry.total += amount; entry.claims += 1;
  if (row.paid === true) entry.paid += amount;
  else if (row.withheld === true) entry.withheld += amount;
  else entry.unpaid += amount;
  groups.set(account, entry);

  const eventKey = `${account}|${row.app || "mole"}|${row.game || ""}|${row.roundKey || ""}`;
  const duplicate = eventKeys.get(eventKey) || [];
  duplicate.push(row);
  eventKeys.set(eventKey, duplicate);
}

const normalizedGroups = [...groups.entries()].map(([raw, entry]) => ({
  ...entry,
  total: Number(entry.total.toFixed(2)),
  paid: Number(entry.paid.toFixed(2)),
  unpaid: Number(entry.unpaid.toFixed(2)),
  withheld: Number(entry.withheld.toFixed(2)),
  identities: [...entry.identities.values()].map((identity) => ({ ...identity, total: Number(identity.total.toFixed(2)) })),
  linkedSocial: socialOwners.has(raw),
  linkedWalletRecord: walletOwners.has(raw),
})).sort((a, b) => b.total - a.total);

const duplicateEvents = [...eventKeys.entries()]
  .filter(([, matches]) => matches.length > 1)
  .map(([key, matches]) => ({ key: hash(key), count: matches.length, amount: Number(matches.reduce((sum, row) => sum + Number(row.payout || 0), 0).toFixed(2)) }));
const proposedMoves = rows
  .filter((row) => canonical(row.discordUserId) !== String(row.discordUserId || ""))
  .map((row) => ({ event: hash(`${row.discordUserId}|${row.app}|${row.game}|${row.roundKey}`), from: hash(row.discordUserId), to: hash(canonical(row.discordUserId)), amount: Number(row.payout || 0) }));
const orphans = normalizedGroups.filter((entry) =>
  (entry.kind === "guest" || entry.kind === "wallet" || entry.kind === "x")
  && !entry.linkedSocial && !entry.linkedWalletRecord && entry.identities.length === 1
);

const report = {
  generatedAt: new Date().toISOString(),
  mode: "read-only-dry-run",
  totals: {
    claims: rows.length,
    accounts: normalizedGroups.length,
    payout: Number(rows.reduce((sum, row) => sum + Number(row.payout || 0), 0).toFixed(2)),
    paid: Number(rows.filter((row) => row.paid === true).reduce((sum, row) => sum + Number(row.payout || 0), 0).toFixed(2)),
    unpaid: Number(rows.filter((row) => row.paid !== true && row.withheld !== true).reduce((sum, row) => sum + Number(row.payout || 0), 0).toFixed(2)),
    withheld: Number(rows.filter((row) => row.withheld === true).reduce((sum, row) => sum + Number(row.payout || 0), 0).toFixed(2)),
  },
  balancesByCanonicalAccount: normalizedGroups,
  orphanedIdentityBalances: orphans,
  storageSyncHealth: syncHealth,
  duplicateEvents,
  failedOrBlockedMigrations: Object.values(mergeAudit).filter((row) => row?.status !== "merged").map((row) => ({ event: hash(row.eventId), status: row.status, at: row.at, reason: row.reason })),
  recoveryDryRun: {
    eventsEligibleForKnownAliasMove: proposedMoves,
    duplicateEventsRejected: duplicateEvents,
    orphanedEventsRequiringOwnershipProof: orphans.reduce((sum, entry) => sum + entry.claims, 0),
    note: "No production records were changed. Orphaned identities require verified ownership before any proposal can include them.",
  },
};

console.log(JSON.stringify(report, null, 2));
await closeMongo();
