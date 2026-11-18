import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { getMongoDb, isMongoEnabled } from "../lib/mongo.js";
import { getConfig } from "./config.js";
import { listAccountIdsForUser, resolveAccountId } from "./userAccounts.js";

// Bug fixed 2026-07-18: this used to be a hardcoded `path.resolve(__dirname,
// "..", "data")` computed once at module load, ignoring the DATA_DIR env var
// entirely — unlike storage.js's own filePath(), which reads getConfig()
// fresh on every call. That mismatch meant a test (or any process) pointing
// DATA_DIR at an isolated directory silently still read/wrote the repo's
// real src/data/game_reward_history.json instead. Now mirrors storage.js's
// filePath() exactly (same DATA_DIR, same resolution — plain path.join, left
// relative to CWD like every other managed file), so both modules agree on
// where "the data dir" is. Moot in production (Mongo is enabled there, so
// this file-fallback path is dead code) — this only changes local/test
// behavior, matching the note already in docs/memory about this exact gap.
function dataDir() {
  return getConfig().DATA_DIR;
}
function filePath() {
  return path.join(dataDir(), "game_reward_history.json");
}

function ensureDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function readFileDb() {
  ensureDir();
  const file = filePath();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || [];
  } catch {
    return [];
  }
}

function writeFileDb(rows) {
  ensureDir();
  fs.writeFileSync(filePath(), JSON.stringify(rows, null, 2));
}

function collName() {
  return process.env.MOLE_GAME_REWARD_HISTORY_COLLECTION || "mole_game_reward_history";
}

async function authoritativeDb() {
  try {
    return await getMongoDb();
  } catch (error) {
    if (isMongoEnabled()) throw error;
    return null;
  }
}

function normalize(input = {}) {
  const sourceIdentity = String(input.sourceIdentity || input.discordUserId || "");
  const canonicalAccountId = resolveAccountId(sourceIdentity);
  const app = String(input.app || "mole");
  const game = String(input.game || "");
  const roundKey = String(input.roundKey || "");
  const idempotencyKey = String(input.idempotencyKey || `${app}:${game}:${roundKey}`);
  return {
    // New events always land on the canonical USER, never whichever login
    // door happened to mint the current session.
    discordUserId: canonicalAccountId,
    canonicalAccountId,
    sourceIdentity,
    eventId: String(input.eventId || crypto.createHash("sha256").update(`${sourceIdentity}:${idempotencyKey}`).digest("hex")),
    eventType: String(input.eventType || "game_reward"),
    idempotencyKey,
    migrationStatus: String(input.migrationStatus || (sourceIdentity === canonicalAccountId ? "native" : "canonicalized")),
    app,
    game,
    roundKey,
    roundLabel: String(input.roundLabel || ""),
    baseReward: Number(input.baseReward || 0),
    multiplier: Number(input.multiplier || 1),
    payout: Number(input.payout || 0),
    wallet: input.wallet ? String(input.wallet) : null,
    meta: input.meta && typeof input.meta === "object" ? input.meta : {},
    claimedAt: input.claimedAt || new Date().toISOString(),
  };
}

export async function recordRewardClaim(input) {
  const row = normalize(input);
  if (!row.discordUserId || !row.game || !row.roundKey) {
    return { ok: false, error: "invalid_reward_claim" };
  }

  // Mongo path (only when enabled + reachable). Falls back to the JSON file when
  // Mongo is disabled (db === null) or a query fails — and logs real failures
  // instead of silently masking them.
  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      await coll.createIndex(
        { discordUserId: 1, app: 1, game: 1, roundKey: 1 },
        { unique: true, name: "reward_event_identity_unique" },
      );
      const key = {
        discordUserId: row.discordUserId,
        app: row.app,
        game: row.game,
        roundKey: row.roundKey,
      };
      const result = await coll.updateOne(key, { $setOnInsert: row }, { upsert: true });
      if (result.upsertedCount === 1) return { ok: true, row };
      const existing = await coll.findOne(key);
      return { ok: true, duplicate: true, row: existing };
    } catch (e) {
      // A configured MongoDB is authoritative. Falling back to a process-local
      // JSON file here creates a second invisible ledger and is exactly how
      // balances become stranded. Local fallback is only for Mongo-disabled
      // development/test environments.
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo write failed, using file:", e?.message || e);
    }
  }

  const rows = readFileDb();
  const exists = rows.find((r) =>
    String(r.discordUserId) === row.discordUserId &&
    String(r.app) === row.app &&
    String(r.game) === row.game &&
    String(r.roundKey) === row.roundKey
  );
  if (exists) return { ok: true, duplicate: true, row: exists };
  rows.push(row);
  writeFileDb(rows);
  return { ok: true, row };
}

export async function listRewardClaims(discordUserId, limit = 25) {
  // Clamp raised 100 → 1000 (2026-07-19): Proof of Value's games cap is now
  // 300 claims (see proofOfValue.js v2.4), and getRewardSummary must be able
  // to count past it or heavy players' games sub-score would freeze at
  // sqrt(100/300) ≈ 58 forever — the exact trap docs/proof-of-value.md
  // warned about when the cap was 50.
  const safeLimit = Math.max(1, Math.min(1000, Number(limit || 25)));
  const accountIds = listAccountIdsForUser(String(discordUserId || ""));
  if (!accountIds.length) return [];
  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      return await coll.find({ discordUserId: { $in: accountIds } })
        .sort({ claimedAt: -1 })
        .limit(safeLimit)
        .toArray();
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo read failed, using file:", e?.message || e);
    }
  }
  return readFileDb()
    .filter((r) => accountIds.includes(String(r.discordUserId)))
    .sort((a, b) => String(b.claimedAt).localeCompare(String(a.claimedAt)))
    .slice(0, safeLimit);
}

/**
 * Rolling per-user totals for throughput caps:
 *   { dailyPayout }  — sum of banked payouts in the last 24h
 *   { hourlyClaims } — number of claims in the last 1h
 * Reads the same store the claims are written to (Mongo, falling back to file).
 */
export async function getRecentClaimStats(discordUserId, now = Date.now()) {
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const accountIds = listAccountIdsForUser(String(discordUserId || ""));
  if (!accountIds.length) return { dailyPayout: 0, hourlyClaims: 0 };

  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const rows = await coll
        .find({ discordUserId: { $in: accountIds }, claimedAt: { $gte: dayAgo } })
        .project({ payout: 1, claimedAt: 1 })
        .toArray();
      return tallyStats(rows, hourAgo);
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo stats read failed, using file:", e?.message || e);
    }
  }
  const rows = readFileDb().filter(
    (r) => accountIds.includes(String(r.discordUserId)) && String(r.claimedAt) >= dayAgo,
  );
  return tallyStats(rows, hourAgo);
}

function tallyStats(rows, hourAgo) {
  let dailyPayout = 0;
  let hourlyClaims = 0;
  for (const r of rows) {
    dailyPayout += Number(r.payout || 0);
    if (String(r.claimedAt) >= hourAgo) hourlyClaims += 1;
  }
  return { dailyPayout: Number(dailyPayout.toFixed(2)), hourlyClaims };
}

// Reconciliation compares local lifetime winnings to validated guest claims,
// including rows previously moved to THIS owner. A retry must not see an empty
// guest ledger as a new legacy gap. No new credit or eligibility rule is added.
export async function getGuestReconciliationTotal(fromId, toId) {
  const from = String(fromId || ''), to = resolveAccountId(String(toId || ''));
  if (!from.startsWith('guest:') || !to) throw new Error('invalid_reconciliation_identity');
  const match = { $or: [{ discordUserId: from }, { discordUserId: to, reassignedFrom: from }] };
  const db = await authoritativeDb();
  if (db) {
    try {
      const rows = await db.collection(collName()).aggregate([
        { $match: match }, { $group: { _id: null, total: { $sum: '$payout' } } },
      ]).toArray();
      return Number(Number(rows[0]?.total || 0).toFixed(2));
    } catch (error) { if (isMongoEnabled()) throw error; }
  }
  const total = readFileDb().filter(row => String(row.discordUserId) === from
    || (String(row.discordUserId) === to && String(row.reassignedFrom) === from))
    .reduce((sum, row) => sum + Number(row.payout || 0), 0);
  return Number(total.toFixed(2));
}

export async function getRewardSummary(discordUserId) {
  const rows = await listRewardClaims(discordUserId, 1000);
  const byGame = {};
  let total = 0;
  let paidPayout = 0;
  let pendingPayout = 0;
  let paidClaims = 0;
  let pendingClaims = 0;
  for (const row of rows) {
    const game = String(row.game || "unknown");
    byGame[game] ||= { game, claims: 0, payout: 0 };
    byGame[game].claims += 1;
    byGame[game].payout += Number(row.payout || 0);
    total += Number(row.payout || 0);
    if (row.paid === true) {
      paidPayout += Number(row.payout || 0);
      paidClaims += 1;
    } else {
      pendingPayout += Number(row.payout || 0);
      pendingClaims += 1;
    }
  }
  return {
    totalClaims: rows.length,
    totalPayout: Number(total.toFixed(2)),
    paidClaims,
    paidPayout: Number(paidPayout.toFixed(2)),
    pendingClaims,
    pendingPayout: Number(pendingPayout.toFixed(2)),
    byGame: Object.values(byGame).sort((a, b) => b.payout - a.payout),
  };
}

// ── Global per-game leaderboard (2026-07-19) ────────────────────────────────
// Ranks ALL players for one game by total WinLEW earned, not raw score — a
// pure score leaderboard floods with a handful of grinders; earned + top
// level/round is a better "who's actually invested in this game" signal.
// "Web only" today: every Gaming Hub claim is web-sourced (the games don't
// exist on Discord yet) — there is no `source` field to split on, unlike
// Quiz/Faucet's platform buckets.
//
// Grub Drop has no round/level concept (it's a session-scored puzzle, not a
// progression game), so its entries carry `topLevel: null` and callers
// should show `topScore` instead — this function always returns both rather
// than guessing per-game which one a caller wants to display.
export async function getGameLeaderboard({ game, limit = 50 } = {}) {
  const gameKey = String(game || "").trim();
  if (!gameKey) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));

  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const rows = await coll.aggregate([
        { $match: { game: gameKey } },
        { $group: {
            _id: "$discordUserId",
            totalEarned: { $sum: "$payout" },
            claims: { $sum: 1 },
            topLevel: { $max: { $ifNull: ["$meta.round", "$meta.level"] } },
            topScore: { $max: "$meta.score" },
        } },
        { $sort: { totalEarned: -1 } },
        { $limit: safeLimit },
      ]).toArray();
      return rows.map((r) => ({
        discordUserId: String(r._id || ""),
        totalEarned: Number((r.totalEarned || 0).toFixed(2)),
        claims: Number(r.claims || 0),
        topLevel: Number.isFinite(r.topLevel) ? r.topLevel : null,
        topScore: Number.isFinite(r.topScore) ? r.topScore : null,
      }));
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo game-leaderboard read failed, using file:", e?.message || e);
    }
  }

  const byUser = new Map();
  for (const row of readFileDb()) {
    if (String(row.game) !== gameKey) continue;
    const id = String(row.discordUserId);
    const entry = byUser.get(id) || { discordUserId: id, totalEarned: 0, claims: 0, topLevel: null, topScore: null };
    entry.totalEarned += Number(row.payout || 0);
    entry.claims += 1;
    const lvl = Number(row.meta?.round ?? row.meta?.level);
    if (Number.isFinite(lvl)) entry.topLevel = entry.topLevel == null ? lvl : Math.max(entry.topLevel, lvl);
    const score = Number(row.meta?.score);
    if (Number.isFinite(score)) entry.topScore = entry.topScore == null ? score : Math.max(entry.topScore, score);
    byUser.set(id, entry);
  }
  return [...byUser.values()]
    .map((e) => ({ ...e, totalEarned: Number(e.totalEarned.toFixed(2)) }))
    .sort((a, b) => b.totalEarned - a.totalEarned)
    .slice(0, safeLimit);
}

// Which games are most played, aggregated across ALL users — feeds the hub's
// "most popular" game ordering. A "play" here is a completed, reward-claimed
// round/session (the only server-recorded signal that exists today), not
// raw button clicks or launches, which nothing currently tracks.
export async function getGamePopularity() {
  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const rows = await coll.aggregate([
        { $match: { game: { $ne: "migration" } } },
        { $group: { _id: "$game", claims: { $sum: 1 }, players: { $addToSet: "$discordUserId" } } },
      ]).toArray();
      return rows
        .map((r) => ({ game: String(r._id || ""), claims: Number(r.claims || 0), players: (r.players || []).length }))
        .filter((r) => r.game)
        .sort((a, b) => b.claims - a.claims);
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo popularity read failed, using file:", e?.message || e);
    }
  }

  const byGame = new Map();
  for (const row of readFileDb()) {
    const g = String(row.game || "");
    // "migration" is an internal bookkeeping marker (the one-time local-
    // winnings credit in the guest-reconcile route), not a real game — it
    // must never appear in a "most played games" ranking.
    if (!g || g === "migration") continue;
    const entry = byGame.get(g) || { game: g, claims: 0, players: new Set() };
    entry.claims += 1;
    entry.players.add(String(row.discordUserId));
    byGame.set(g, entry);
  }
  return [...byGame.values()]
    .map((e) => ({ game: e.game, claims: e.claims, players: e.players.size }))
    .sort((a, b) => b.claims - a.claims);
}

// ── Payout bookkeeping (for the daily game-payout worker) ──────────────────
// A claim is "unpaid" until the worker sends its WinLEW and marks it paid.
// Marking paid does NOT change getRewardSummary totals (winnings stay counted);
// it only stops the worker from paying the same rows twice.

function parseRowKey(key) {
  const parts = String(key || "").split("|");
  return {
    discordUserId: parts[0] || "",
    app: parts[1] || "mole",
    game: parts[2] || "",
    roundKey: parts.slice(3).join("|"),
  };
}

export async function listUnpaidClaims(limit = 5000) {
  const safeLimit = Math.max(1, Math.min(50000, Number(limit || 5000)));
  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      // `withheld` rows are deliberately excluded alongside paid ones — see
      // markClaimsWithheld() for why a banned wallet's balance must stop
      // requeueing itself every night.
      return await coll.find({ paid: { $ne: true }, withheld: { $ne: true } }).limit(safeLimit).toArray();
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo unpaid read failed, using file:", e?.message || e);
    }
  }
  return readFileDb().filter((r) => r.paid !== true && r.withheld !== true).slice(0, safeLimit);
}

// Move every claim row from one identity to another (guest -> Discord user on
// connect). Idempotent: once moved, a re-run matches nothing. roundKeys carry
// random tokens so guest/user collisions are effectively impossible.
export async function reassignClaims(fromId, toId) {
  const from = String(fromId || "");
  const to = resolveAccountId(String(toId || ""));
  if (!from || !to || from === to) return { ok: true, moved: 0 };
  const set = { discordUserId: to, reassignedFrom: from, reassignedAt: new Date().toISOString() };

  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const res = await coll.updateMany({ discordUserId: from }, { $set: set });
      return { ok: true, moved: res.modifiedCount || 0 };
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo reassign failed, using file:", e?.message || e);
    }
  }
  const rows = readFileDb();
  let moved = 0;
  for (const r of rows) {
    if (String(r.discordUserId) === from) { Object.assign(r, set); moved += 1; }
  }
  if (moved) writeFileDb(rows);
  return { ok: true, moved };
}

/**
 * Take rows OUT of the payout queue without paying them.
 *
 * WHY THIS IS NOT `paid: true`. The money never moved. Marking a banned
 * wallet's claims paid would put a lie in the ledger — the reward history is
 * read by the dashboard and by Proof of Value, and "paid" there means tokens
 * were sent. `withheld` says exactly what happened: owed, refused, and why.
 *
 * WHY IT EXISTS AT ALL. payoutPlanner HOLDS a blocked row rather than skipping
 * it, so a human sees it — correct the first time, and noise every night after,
 * because the row returns to the queue on every run. The owner watched the same
 * banned wallet reappear nightly and said it plainly: "if he is on the ban
 * list; dont pay him." Alert fatigue is how a real alert eventually gets
 * ignored, so a decided case has to stop asking.
 *
 * ONLY EVER FOR A CONFIRMED BAN. The caller must not use this for
 * `blocklist_unavailable` — that means the ban list could not be READ, and
 * withholding on it would let one Mongo outage permanently void every
 * participant's rewards. That case keeps holding and retries tomorrow.
 *
 * Reversible by design: releaseWithheldClaims() puts them straight back in the
 * queue if a ban is lifted on appeal, and nothing is deleted.
 */
export async function markClaimsWithheld(rowKeys = [], meta = {}) {
  const ids = (Array.isArray(rowKeys) ? rowKeys : [])
    .map(parseRowKey)
    .filter((p) => p.discordUserId && p.game && p.roundKey);
  if (!ids.length) return { ok: true, updated: 0 };

  const set = {
    withheld: true,
    withheldAt: meta.withheldAt || new Date().toISOString(),
    withheldReason: meta.reason || "payout_blocked",
    withheldBatch: meta.batchId || null,
  };

  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const or = ids.map((p) => ({ discordUserId: p.discordUserId, app: p.app, game: p.game, roundKey: p.roundKey }));
      const res = await coll.updateMany({ $or: or, paid: { $ne: true } }, { $set: set });
      return { ok: true, updated: res.modifiedCount || 0 };
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo markWithheld failed, using file:", e?.message || e);
    }
  }

  const rows = readFileDb();
  const idSet = new Set(ids.map((p) => `${p.discordUserId}|${p.app}|${p.game}|${p.roundKey}`));
  let updated = 0;
  for (const r of rows) {
    const k = `${r.discordUserId}|${r.app || "mole"}|${r.game}|${r.roundKey}`;
    if (idSet.has(k) && r.paid !== true) { Object.assign(r, set); updated += 1; }
  }
  if (updated) writeFileDb(rows);
  return { ok: true, updated };
}

/** Put withheld rows back in the queue — for a ban lifted on appeal. The
 *  withholding record is cleared rather than kept alongside a live row, so the
 *  next run treats them as ordinary unpaid claims. */
export async function releaseWithheldClaims(discordUserId) {
  const id = String(discordUserId || "").trim();
  if (!id) return { ok: false, error: "discord_user_id_required", updated: 0 };
  const unset = { withheld: "", withheldAt: "", withheldReason: "", withheldBatch: "" };

  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const res = await coll.updateMany({ discordUserId: id, withheld: true }, { $unset: unset });
      return { ok: true, updated: res.modifiedCount || 0 };
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo release failed, using file:", e?.message || e);
    }
  }

  const rows = readFileDb();
  let updated = 0;
  for (const r of rows) {
    if (String(r.discordUserId) === id && r.withheld === true) {
      delete r.withheld; delete r.withheldAt; delete r.withheldReason; delete r.withheldBatch;
      updated += 1;
    }
  }
  if (updated) writeFileDb(rows);
  return { ok: true, updated };
}

export async function markClaimsPaid(rowKeys = [], meta = {}) {
  const ids = (Array.isArray(rowKeys) ? rowKeys : [])
    .map(parseRowKey)
    .filter((p) => p.discordUserId && p.game && p.roundKey);
  if (!ids.length) return { ok: true, updated: 0 };

  const set = {
    paid: true,
    paidAt: meta.paidAt || new Date().toISOString(),
    paidTx: meta.tx || null,
    paidBatch: meta.batchId || null,
  };

  const db = await authoritativeDb();
  if (db) {
    try {
      const coll = db.collection(collName());
      const or = ids.map((p) => ({ discordUserId: p.discordUserId, app: p.app, game: p.game, roundKey: p.roundKey }));
      const res = await coll.updateMany({ $or: or, paid: { $ne: true } }, { $set: set });
      return { ok: true, updated: res.modifiedCount || 0 };
    } catch (e) {
      if (isMongoEnabled()) throw e;
      console.warn("[rewardHistory] mongo markPaid failed, using file:", e?.message || e);
    }
  }

  const rows = readFileDb();
  const idSet = new Set(ids.map((p) => `${p.discordUserId}|${p.app}|${p.game}|${p.roundKey}`));
  let updated = 0;
  for (const r of rows) {
    const k = `${r.discordUserId}|${r.app || "mole"}|${r.game}|${r.roundKey}`;
    if (idSet.has(k) && r.paid !== true) { Object.assign(r, set); updated += 1; }
  }
  if (updated) writeFileDb(rows);
  return { ok: true, updated };
}
