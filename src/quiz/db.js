const fs = require('fs');
const path = require('path');
const { quizDataDir, ensureQuizDataDir, readManagedQuizJson, writeManagedQuizJson } = require('./storage');
const platformStats = require('./platform-stats');

const dbFile = () => path.join(quizDataDir(), 'db.json');
const lockFile = () => `${dbFile()}.lock`;

const DEFAULT_CYCLE_LENGTH_DAYS = 91;
const DEFAULT_CYCLE_PREFIX = 'C';
const DAY_MS = 24 * 60 * 60 * 1000;

function readPositiveNumberEnv(...keys) {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

const WINLEW_PER_POINT = readPositiveNumberEnv('QUIZ_WINLEW_PER_POINT', 'WINLEW_PER_POINT') || 1;

// Hard ceiling on any single on-demand redemption's winlewDue, applied AFTER
// the PoV/Contribute reward multiplier below — closes the gap flagged during
// the 2026-07-19 payout audit (games already had layered ceilings; faucet
// and quiz never did). Env-configurable, defaults to a modest 20% headroom
// over the combined multiplier's own ceiling (src/shared/rewardMultipliers.js's
// MAX_COMBINED_REWARD_MULTIPLIER, 1.25) so it only ever catches something
// that's actually gone wrong, not a legitimately large real redemption.
const QUIZ_MAX_REDEMPTION_WINLEW = readPositiveNumberEnv('QUIZ_MAX_REDEMPTION_WINLEW') || 100000;

// Floor on any single redemption's value, deliberately matched to the
// faucet's DRIP_AMOUNT (1500) — added 2026-07-30 after a handful of users
// settled into redeeming daily off 2-3 questions. A payout should never be
// worth less than one faucet click: points below this accumulate (manual
// /redeem rejects, cycle close carries the balance into the open cycle)
// instead of settling dust on-chain every day.
// PAIRED WITH DRIP_AMOUNT (src/faucet/config.js). /quiz/ tells users the
// minimum is "matched to one faucet drip", and in production both are 1500.
// The CODE DEFAULTS do not agree though — the faucet falls back to 1000 —
// so if DRIP_AMOUNT is ever unset the two silently diverge and that public
// claim stops being true. Change them together. (Audited 2026-08-05.)
const QUIZ_MIN_REDEMPTION_WINLEW = readPositiveNumberEnv('QUIZ_MIN_REDEMPTION_WINLEW') || 1500;

// src/shared/rewardMultipliers.js is ESM; this file is CommonJS, so it's
// loaded via a dynamic import — same pattern as redemption.js's
// fetchSplBalance() for src/mole/solana.js. Failure-safe: any error (or an
// unresolvable/never-verified user) falls back to 1 (no bonus), it never
// blocks or rejects a real redemption.
async function fetchCombinedRewardMultiplier(userId) {
  try {
    const { getCombinedRewardMultiplier } = await import('../shared/rewardMultipliers.js');
    return await getCombinedRewardMultiplier(userId);
  } catch (err) {
    console.warn('[quiz/db] fetchCombinedRewardMultiplier failed, defaulting to 1:', err?.message || err);
    return 1;
  }
}
const SPONSOR_POINT_VALUE = readPositiveNumberEnv('SPONSOR_BASE_POINTS') || 125;
const REGULAR_POINT_VALUES = [100, 150, 225];
const ANY_POINT_VALUES = [100, 125, 150, 225];

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, ms);
}

function init() {
  ensureQuizDataDir();
  if (!fs.existsSync(dbFile())) {
    writeDbAtomic({
      meta: {
        cycleEpochMs: Date.now(),
        cycleLengthDays: DEFAULT_CYCLE_LENGTH_DAYS,
        closedCycles: [],
        wasConfigured: false,
      },
      users: {},
      redemptions: [],
    });
  }
}

function normalizeDb(db) {
  if (!db.meta) {
    db.meta = {
      cycleEpochMs: Date.now(),
      cycleLengthDays: DEFAULT_CYCLE_LENGTH_DAYS,
      cyclePrefix: DEFAULT_CYCLE_PREFIX,
      cycleSchemeHistory: [],
      closedCycles: [],
      wasConfigured: false,
    };
  }
  if (!db.users) db.users = {};
  if (!db.redemptions) db.redemptions = [];
  if (!db.meta.closedCycles) db.meta.closedCycles = [];
  if (!db.meta.cycleLengthDays) db.meta.cycleLengthDays = DEFAULT_CYCLE_LENGTH_DAYS;
  if (!db.meta.cycleEpochMs) db.meta.cycleEpochMs = Date.now();
  // Added 2026-07-18 for the quarterly->monthly cycle-cadence switch — every
  // cycle ID before this field existed was implicitly "C" (91-day), so that's
  // the correct, backward-compatible default rather than inventing a new one.
  if (!db.meta.cyclePrefix) db.meta.cyclePrefix = DEFAULT_CYCLE_PREFIX;
  if (!db.meta.cycleSchemeHistory) db.meta.cycleSchemeHistory = [];
  return db;
}

function readDbUnlocked() {
  init();
  const raw = readManagedQuizJson('db.json', {
    meta: {
      cycleEpochMs: Date.now(),
      cycleLengthDays: DEFAULT_CYCLE_LENGTH_DAYS,
      closedCycles: [],
      wasConfigured: false,
    },
    users: {},
    redemptions: [],
  });
  return normalizeDb(raw);
}

function readDb() {
  return readDbUnlocked();
}

function writeDbAtomic(db) {
  writeManagedQuizJson('db.json', normalizeDb(db));
}

function writeDb(db) {
  writeDbAtomic(normalizeDb(db));
}

function acquireLock(timeoutMs = 5_000) {
  init();
  const started = Date.now();
  while (true) {
    try {
      return fs.openSync(lockFile(), 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - started > timeoutMs) {
        throw new Error('quiz_db_lock_timeout');
      }
      sleepMs(25);
    }
  }
}

function releaseLock(fd) {
  try { if (typeof fd === 'number') fs.closeSync(fd); } catch {}
  try { if (fs.existsSync(lockFile())) fs.unlinkSync(lockFile()); } catch {}
}

function mutateDb(mutator) {
  const lockFd = acquireLock();
  try {
    const db = readDbUnlocked();
    const result = mutator(db);
    writeDbAtomic(db);
    return result;
  } finally {
    releaseLock(lockFd);
  }
}

function ensureUser(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      points: 0,
      redeemed: 0,
      sponsor: {},
      cycles: {},
      cycleQuestions: {},
      lifetimePoints: null,
      questionWins: null,
      sponsorQuestionWins: null,
      regularQuestionWins: null,
      platforms: platformStats.emptyPlatformStats(),
      tiers: platformStats.emptyTierStats(),
    };
  } else {
    if (!db.users[userId].sponsor) db.users[userId].sponsor = {};
    if (!db.users[userId].cycles) db.users[userId].cycles = {};
    if (!db.users[userId].cycleQuestions) db.users[userId].cycleQuestions = {};
    if (typeof db.users[userId].points !== 'number') db.users[userId].points = 0;
    if (typeof db.users[userId].redeemed !== 'number') db.users[userId].redeemed = 0;
    if (!db.users[userId].platforms || typeof db.users[userId].platforms !== 'object') {
      db.users[userId].platforms = platformStats.emptyPlatformStats();
    } else {
      if (!db.users[userId].platforms.discord) db.users[userId].platforms.discord = platformStats.emptyPlatformBucket();
      if (!db.users[userId].platforms.web) db.users[userId].platforms.web = platformStats.emptyPlatformBucket();
    }
    if (!db.users[userId].tiers || typeof db.users[userId].tiers !== 'object') {
      db.users[userId].tiers = platformStats.emptyTierStats();
    } else {
      for (const tier of platformStats.TIERS) {
        if (!db.users[userId].tiers[tier]) db.users[userId].tiers[tier] = platformStats.emptyPlatformBucket();
      }
    }
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCycleConfig(db) {
  return {
    cycleEpochMs: db.meta.cycleEpochMs,
    cycleLengthDays: db.meta.cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS,
    cyclePrefix: db.meta.cyclePrefix || DEFAULT_CYCLE_PREFIX,
  };
}

// `prefix` added 2026-07-18 for the quarterly->monthly cadence switch —
// defaults to the original 'C' so every pre-existing call site (and any
// caller that never passes it) behaves exactly as before. A cycle's own id
// is a pure function of (epoch, length, prefix, now) — there is no
// historical-scheme resolver here by design: switchToMonthlyCycles() below
// closes out the LAST cycle under the old scheme before ever changing
// db.meta's active epoch/length/prefix, so this function only ever needs to
// know about "the current active scheme," never "what scheme applied on
// some past date." Old, already-closed cycle records keep their own stored
// id/startMs/endMs regardless of what the active scheme becomes later.
function computeCycle(nowMs, epochMs, lengthDays, prefix = DEFAULT_CYCLE_PREFIX) {
  const lengthMs = lengthDays * DAY_MS;
  const idx = Math.floor((nowMs - epochMs) / lengthMs);
  const startMs = epochMs + idx * lengthMs;
  const endMs = startMs + lengthMs;
  const id = `${prefix}${idx + 1}`;
  return { id, index: idx, startMs, endMs, lengthMs };
}

function getCurrentCycle() {
  const db = readDb();
  const { cycleEpochMs, cycleLengthDays, cyclePrefix } = getCycleConfig(db);
  return computeCycle(Date.now(), cycleEpochMs, cycleLengthDays, cyclePrefix);
}

function setCycleEpochIfEmpty(epochMs, lengthDays) {
  return mutateDb((db) => {
    if (!db.meta.wasConfigured) {
      db.meta.cycleEpochMs = epochMs;
      db.meta.cycleLengthDays = lengthDays || db.meta.cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS;
      db.meta.wasConfigured = true;
      return true;
    }
    return false;
  });
}

function getUserCyclePoints(userId, cycleId) {
  const db = readDb();
  ensureUser(db, userId);
  return Number(db.users[userId].cycles?.[cycleId] || 0);
}

function addCyclePoints(db, userId, cycleId, amount) {
  ensureUser(db, userId);
  db.users[userId].cycles[cycleId] = Number(db.users[userId].cycles[cycleId] || 0) + amount;
}

// Manual redemption pays out of the same points pool that closeCycle() later
// pays from (via user.cycles[cycleId]), so without this, a user who redeems
// early gets paid again in full when their cycle closes. Draws down OPEN
// (not yet closed) cycle balances, oldest-earned first (object key order,
// since addCyclePoints only ever appends), so closeCycle() only ever pays
// whatever's left over after any early manual redemptions. Closed cycles'
// records are never touched — they're historical and closeCycle() already
// refuses to re-process them.
function drawDownOpenCyclePoints(db, userId, amount) {
  const closedIds = new Set((db.meta.closedCycles || []).map((c) => c.id));
  const cycles = db.users[userId].cycles || {};
  let remaining = amount;
  for (const id of Object.keys(cycles)) {
    if (remaining <= 0) break;
    if (closedIds.has(id)) continue;
    const bal = Number(cycles[id] || 0);
    if (bal <= 0) continue;
    const draw = Math.min(bal, remaining);
    cycles[id] = bal - draw;
    remaining -= draw;
  }
}

function sumPaidRedemptionPoints(db, userId, kind = null, cycleId = null) {
  return (db.redemptions || [])
    .filter((row) => {
      if (row.userId !== String(userId)) return false;
      if ((row.status || 'pending') !== 'paid') return false;
      if (kind && row.kind !== kind) return false;
      if (cycleId && row.cycleId !== cycleId) return false;
      return true;
    })
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function sumPendingOrFailedLeaderboardPoints(db, userId) {
  return (db.redemptions || [])
    .filter((row) => row.userId === String(userId) && row.kind === 'leaderboard_payout' && ['pending', 'failed'].includes(row.status || 'pending'))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function getCyclePaidPoints(db, userId, cycleId) {
  return sumPaidRedemptionPoints(db, userId, 'cycle_payout', cycleId);
}

function getCycleOutstandingPoints(db, userId, cycleId) {
  ensureUser(db, userId);
  const total = Number(db.users[userId].cycles?.[cycleId] || 0);
  const paid = getCyclePaidPoints(db, userId, cycleId);
  return Math.max(0, total - paid);
}

function getOutstandingCycleReservedPoints(db, userId) {
  ensureUser(db, userId);
  return Object.keys(db.users[userId].cycles || {}).reduce((sum, cycleId) => sum + getCycleOutstandingPoints(db, userId, cycleId), 0);
}

function deriveLifetimePoints(db, userId) {
  ensureUser(db, userId);
  const user = db.users[userId];
  const paidCycle = sumPaidRedemptionPoints(db, userId, 'cycle_payout');
  const paidLeaderboard = sumPaidRedemptionPoints(db, userId, 'leaderboard_payout');
  return Number(user.points || 0) + Number(user.redeemed || 0) + paidCycle + paidLeaderboard;
}

const estimateQuestionCountCache = new Map();
function estimateQuestionCount(points, values = REGULAR_POINT_VALUES, targetAverage = 150) {
  const total = Number(points || 0);
  const key = `${values.join(',')}|${targetAverage}|${total}`;
  if (estimateQuestionCountCache.has(key)) return estimateQuestionCountCache.get(key);
  if (!Number.isFinite(total) || total <= 0) {
    estimateQuestionCountCache.set(key, 0);
    return 0;
  }

  const dp = Array(total + 1).fill(null);
  dp[0] = { count: 0, picks: [] };

  for (let score = 1; score <= total; score += 1) {
    let best = null;
    for (const value of values) {
      if (score - value < 0 || !dp[score - value]) continue;
      const prev = dp[score - value];
      const candidate = { count: prev.count + 1, picks: [...prev.picks, value] };
      if (!best) {
        best = candidate;
        continue;
      }
      const avgA = candidate.picks.reduce((sum, v) => sum + v, 0) / candidate.count;
      const avgB = best.picks.reduce((sum, v) => sum + v, 0) / best.count;
      const scoreA = Math.abs(avgA - targetAverage);
      const scoreB = Math.abs(avgB - targetAverage);
      if (scoreA < scoreB || (scoreA === scoreB && candidate.count > best.count)) best = candidate;
    }
    dp[score] = best;
  }

  const count = dp[total]?.count || 0;
  estimateQuestionCountCache.set(key, count);
  return count;
}

function deriveQuestionWins(db, userId) {
  ensureUser(db, userId);
  const user = db.users[userId];
  const sponsorPoints = Object.values(user.sponsor || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const sponsorQuestionWins = sponsorPoints > 0 ? Math.max(0, Math.round(sponsorPoints / SPONSOR_POINT_VALUE)) : 0;
  const lifetimePoints = typeof user.lifetimePoints === 'number' && user.lifetimePoints >= 0
    ? Number(user.lifetimePoints)
    : deriveLifetimePoints(db, userId);
  const regularPoints = Math.max(0, lifetimePoints - sponsorPoints);
  const regularQuestionWins = estimateQuestionCount(regularPoints, REGULAR_POINT_VALUES, 150);
  return {
    sponsorQuestionWins,
    regularQuestionWins,
    questionWins: sponsorQuestionWins + regularQuestionWins,
  };
}

function estimateCycleQuestionWins(db, userId, cycleId) {
  ensureUser(db, userId);
  const tracked = Number(db.users[userId].cycleQuestions?.[cycleId] || 0);
  if (tracked > 0) return tracked;
  const cyclePoints = Number(db.users[userId].cycles?.[cycleId] || 0);
  return estimateQuestionCount(cyclePoints, ANY_POINT_VALUES, 145);
}

function seedDerivedUserStats(db, userId) {
  ensureUser(db, userId);
  const user = db.users[userId];
  if (typeof user.lifetimePoints !== 'number' || user.lifetimePoints < 0) {
    user.lifetimePoints = deriveLifetimePoints(db, userId);
  }
  if (typeof user.questionWins !== 'number' || user.questionWins < 0 || typeof user.sponsorQuestionWins !== 'number' || typeof user.regularQuestionWins !== 'number') {
    const derived = deriveQuestionWins(db, userId);
    user.questionWins = derived.questionWins;
    user.sponsorQuestionWins = derived.sponsorQuestionWins;
    user.regularQuestionWins = derived.regularQuestionWins;
  }
  return user;
}

function getCyclesPlayedCount(db, userId) {
  ensureUser(db, userId);
  const ids = new Set();
  for (const [cycleId, value] of Object.entries(db.users[userId].cycles || {})) {
    if (Number(value || 0) > 0) ids.add(cycleId);
  }
  for (const row of db.redemptions || []) {
    if (row.userId === String(userId) && row.kind === 'cycle_payout' && row.cycleId) ids.add(row.cycleId);
  }
  return ids.size;
}

function buildRedemptionBase({ userId, amount, kind, cycleId = null, cycleStartMs = null, cycleEndMs = null, requestSource = null, rewardMultiplier = 1 }) {
  // Multiplier applied once, here, at record creation — never recomputed at
  // settlement (src/quiz/payout-worker.js reads winlewDue as-is). Baking it
  // in at the one snapshot point this way, rather than at settlement time,
  // is what keeps this safe under the same point-ledger accounting the
  // 2026-07-18 double-payout fix (drawDownOpenCyclePoints) depends on — see
  // the file-level comment above that function. Only ever >= 1 (no penalty)
  // and clamped to QUIZ_MAX_REDEMPTION_WINLEW regardless of amount*rate.
  const safeMultiplier = Math.max(1, Number(rewardMultiplier) || 1);
  const winlewDue = Math.min(QUIZ_MAX_REDEMPTION_WINLEW, amount * WINLEW_PER_POINT * safeMultiplier);
  return {
    id: makeId(),
    userId,
    amount,
    ts: Date.now(),
    status: 'pending',
    winlewSent: null,
    tx: null,
    paidTs: null,
    rejectedTs: null,
    rejectReason: null,
    kind,
    cycleId,
    // Which surface CREATED this record (web vs discord vs null for
    // system-generated cycle/leaderboard payouts). Purely informational —
    // never read by eligibility/settlement logic, so it's safe to be null
    // for every redemption that predates this field.
    requestSource,
    payoutRate: WINLEW_PER_POINT,
    rewardMultiplier: safeMultiplier,
    winlewDue,
    cycleStartMs,
    cycleEndMs,
    attempts: 0,
    lastError: null,
    lastAttemptTs: null,
    nextAttemptTs: null,
    payoutWallet: null,
    payoutWalletSource: null,
    settlementMode: 'queued',
    settlementWorker: null,
  };
}

function closeCycle(cycleId) {
  return mutateDb((db) => {
    const { cycleEpochMs, cycleLengthDays, cyclePrefix } = getCycleConfig(db);

    const now = Date.now();
    const cur = computeCycle(now, cycleEpochMs, cycleLengthDays, cyclePrefix);

    let idx = cur.index;
    // Only recognizes the CURRENT active scheme's prefix — closing an id from
    // a retired scheme (e.g. passing a "C" id after the switch to "M") isn't
    // supported here by design; that cycle was already closed as part of the
    // switch itself (see switchToMonthlyCycles()), so there's nothing left to
    // close under the old scheme.
    const idPattern = new RegExp(`^${cyclePrefix}\\d+$`, 'i');
    if (cycleId && idPattern.test(cycleId)) {
      idx = Math.max(0, parseInt(cycleId.slice(cyclePrefix.length), 10) - 1);
    }
    const lengthMs = cycleCycleLengthMs(cycleLengthDays);
    const startMs = cycleEpochMs + idx * lengthMs;
    const endMs = startMs + lengthMs;
    const id = `${cyclePrefix}${idx + 1}`;

    if (db.meta.closedCycles.some(c => c.id === id)) {
      return { ok: false, error: `Cycle ${id} is already closed.` };
    }

    let createdCount = 0;
    let carriedCount = 0;
    // Balances below the redemption floor are not worth an on-chain send —
    // instead of settling dust, they roll into the currently-open cycle
    // (or, when closing the current cycle itself, the next one) and pay out
    // at a future close once they've accumulated past the floor. The points
    // stay open-cycle balances the whole time, so manual /redeem drawdown and
    // leaderboard cycle-reserved accounting keep working on them unchanged.
    const minPoints = getMinRedemptionPoints();
    const carryId = cur.id !== id ? cur.id : `${cyclePrefix}${idx + 2}`;
    for (const [userId, u] of Object.entries(db.users)) {
      ensureUser(db, userId);
      const pts = Number(u.cycles?.[id] || 0);
      if (pts > 0 && pts < minPoints) {
        u.cycles[carryId] = Number(u.cycles[carryId] || 0) + pts;
        u.cycles[id] = 0;
        carriedCount += 1;
        continue;
      }
      if (pts > 0) {
        db.redemptions.push(buildRedemptionBase({
          userId,
          amount: pts,
          kind: 'cycle_payout',
          cycleId: id,
          cycleStartMs: startMs,
          cycleEndMs: endMs,
        }));
        createdCount += 1;
      }
    }

    db.meta.closedCycles.push({ id, startMs, endMs, closedMs: Date.now() });
    return { ok: true, id, startMs, endMs, createdCount, carriedCount, carryCycleId: carriedCount ? carryId : null };
  });
}

/**
 * One-time cadence switch (added 2026-07-18, per the project owner's own
 * request — the 91-day wait was discouraging participation). Two steps, not
 * one atomic mutateDb, deliberately:
 *
 *   1. Close out the LAST cycle under the OLD scheme (reuses closeCycle() —
 *      the exact same settlement logic /cycleclose already uses, so there is
 *      no second payout-settlement implementation). If it's already closed
 *      (e.g. a maintainer ran /cycleclose manually first), that's fine, not
 *      an error — the goal ("current activity is settled before the switch")
 *      is already satisfied either way.
 *   2. Flip db.meta to the NEW scheme (new prefix, epoch = now, new length)
 *      in a fresh mutateDb, and append an entry to cycleSchemeHistory —
 *      a permanent, readable record of exactly when and why cycle numbering
 *      changed, so a future reader (human or code) never has to guess why
 *      "C7" is immediately followed by "M1" instead of "C8".
 *
 * The new prefix must differ from every prefix ever used before — this is
 * checked directly against cycleSchemeHistory (plus the original default),
 * not assumed, so a second switch later (e.g. to weekly) can never silently
 * collide with "M" cycle ids the way reusing "C" would have collided here.
 * Old "C"-prefixed closedCycles/redemptions records are never touched,
 * renumbered, or deleted — they remain the permanent historical record of
 * the quarterly era, exactly as they were before the switch.
 */
function switchCycleCadence({ lengthDays, prefix, reason = null } = {}) {
  if (!Number.isFinite(lengthDays) || lengthDays <= 0) {
    return { ok: false, error: 'invalid_length_days' };
  }
  const newPrefix = String(prefix || '').trim();
  if (!/^[A-Za-z]{1,4}$/.test(newPrefix)) {
    return { ok: false, error: 'invalid_prefix' };
  }

  const before = readDb();
  const usedPrefixes = new Set([
    DEFAULT_CYCLE_PREFIX,
    before.meta.cyclePrefix || DEFAULT_CYCLE_PREFIX,
    ...(before.meta.cycleSchemeHistory || []).map((h) => h.prefix),
  ]);
  if (usedPrefixes.has(newPrefix)) {
    return { ok: false, error: `prefix_already_used:${newPrefix}` };
  }

  const cur = getCurrentCycle();
  const closeResult = closeCycle(cur.id);
  // "already closed" is a benign outcome here (see doc comment above) — any
  // OTHER close failure should stop the switch rather than silently proceed
  // with an unsettled cycle.
  if (!closeResult.ok && !/already closed/i.test(closeResult.error || '')) {
    return { ok: false, error: closeResult.error, stage: 'close_previous_cycle' };
  }

  const switchedAtMs = Date.now();
  const oldScheme = mutateDb((db) => {
    const old = {
      prefix: db.meta.cyclePrefix || DEFAULT_CYCLE_PREFIX,
      epochMs: db.meta.cycleEpochMs,
      lengthDays: db.meta.cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS,
    };
    db.meta.cyclePrefix = newPrefix;
    db.meta.cycleEpochMs = switchedAtMs;
    db.meta.cycleLengthDays = lengthDays;
    db.meta.cycleSchemeHistory.push({
      prefix: newPrefix,
      lengthDays,
      startedAtMs: switchedAtMs,
      previousPrefix: old.prefix,
      previousLengthDays: old.lengthDays,
      reason: reason ? String(reason).slice(0, 300) : null,
    });
    return old;
  });

  const firstNewCycle = computeCycle(switchedAtMs, switchedAtMs, lengthDays, newPrefix);
  return {
    ok: true,
    closedPreviousCycle: closeResult.ok ? closeResult : { id: cur.id, alreadyClosed: true },
    previousScheme: oldScheme,
    newScheme: { prefix: newPrefix, lengthDays, epochMs: switchedAtMs },
    firstNewCycleId: firstNewCycle.id,
  };
}

function cycleCycleLengthMs(cycleLengthDays) {
  return (cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS) * DAY_MS;
}

function listCyclePayouts(cycleId, status = 'pending', limit = 50) {
  const db = readDb();
  const id = cycleId || getCurrentCycle().id;
  const wanted = status === undefined || status === null || status === '' ? null : String(status);
  const rows = (db.redemptions || [])
    .filter(r => (r.kind === 'cycle_payout') && r.cycleId === id && (wanted ? (r.status || 'pending') === wanted : true))
    .sort((a,b)=> (b.paidTs || b.ts || 0) - (a.paidTs || a.ts || 0));
  return rows.slice(0, limit);
}

function summarizeCyclePayouts(cycleId) {
  const rows = listCyclePayouts(cycleId, null, 1000);
  const summary = { pending: 0, paid: 0, rejected: 0, failed: 0, total: rows.length, totalWinlewPaid: 0 };
  for (const row of rows) {
    const status = row.status || 'pending';
    if (summary[status] === undefined) summary[status] = 0;
    summary[status] += 1;
    if (status === 'paid') summary.totalWinlewPaid += Number(row.winlewSent || row.winlewDue || 0);
  }
  return summary;
}

function topCycleUsers(cycleId, limit = 10) {
  const db = readDb();
  const id = cycleId || getCurrentCycle().id;
  const entries = Object.entries(db.users).map(([userId]) => {
    const user = seedDerivedUserStats(db, userId);
    const pts = Number(user.cycles?.[id] || 0);
    return {
      userId,
      points: pts,
      unpaidPoints: getCycleOutstandingPoints(db, userId, id),
      questions: estimateCycleQuestionWins(db, userId, id),
    };
  });
  entries.sort((a,b)=> b.points - a.points || b.unpaidPoints - a.unpaidPoints || b.questions - a.questions);
  return entries.slice(0, limit);
}

function getUser(userId) {
  const db = readDb();
  const user = seedDerivedUserStats(db, userId);
  return {
    ...user,
    lifetimePoints: Number(user.lifetimePoints || 0),
    unpaidPoints: Number(user.points || 0),
    questions: Number(user.questionWins || 0),
    cyclesPlayed: getCyclesPlayedCount(db, userId),
  };
}

function addPoints(userId, amount, cycleIdOverride = null) {
  return mutateDb((db) => {
    seedDerivedUserStats(db, userId);
    db.users[userId].points += amount;
    db.users[userId].lifetimePoints += amount;
    db.users[userId].questionWins += 1;
    db.users[userId].regularQuestionWins += 1;

    const cycleId = cycleIdOverride || computeCycle(Date.now(), db.meta.cycleEpochMs, db.meta.cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS, db.meta.cyclePrefix || DEFAULT_CYCLE_PREFIX).id;
    addCyclePoints(db, userId, cycleId, amount);
    db.users[userId].cycleQuestions[cycleId] = Number(db.users[userId].cycleQuestions[cycleId] || 0) + 1;

    return db.users[userId].points;
  });
}

function addSponsorPoints(userId, sponsor, amount, cycleIdOverride = null) {
  return mutateDb((db) => {
    seedDerivedUserStats(db, userId);
    db.users[userId].points += amount;
    db.users[userId].lifetimePoints += amount;
    db.users[userId].questionWins += 1;
    db.users[userId].sponsorQuestionWins += 1;

    const key = sponsor.toLowerCase();
    db.users[userId].sponsor[key] = (db.users[userId].sponsor[key] || 0) + amount;

    const cycleId = cycleIdOverride || computeCycle(Date.now(), db.meta.cycleEpochMs, db.meta.cycleLengthDays || DEFAULT_CYCLE_LENGTH_DAYS, db.meta.cyclePrefix || DEFAULT_CYCLE_PREFIX).id;
    addCyclePoints(db, userId, cycleId, amount);
    db.users[userId].cycleQuestions[cycleId] = Number(db.users[userId].cycleQuestions[cycleId] || 0) + 1;

    return { total: db.users[userId].points, sponsorTotal: db.users[userId].sponsor[key] };
  });
}

// async: fetches the caller's combined PoV/Contribute reward multiplier
// BEFORE acquiring mutateDb()'s (synchronous) file lock — mutateDb itself
// stays untouched, since only this one on-demand redemption path needs the
// multiplier (see the 2026-07-28 scoping decision: cycle-close and
// leaderboard payouts are automatic/batch, not a user actively redeeming,
// and were deliberately left flat rather than threading a per-user
// pre-fetch through those multi-user batch loops too).
async function redeemPoints(userId, amount, requestSource = null) {
  // Authoritative floor check (redemption.js pre-checks too, with a friendlier
  // structured rejection — this one is the backstop for any other caller).
  const minPoints = getMinRedemptionPoints();
  if (Number(amount) < minPoints) {
    return { ok: false, error: `Minimum redemption is ${minPoints} points (${estimateWinlewForPoints(minPoints)} WinLEW).` };
  }
  const rewardMultiplier = await fetchCombinedRewardMultiplier(userId);
  return mutateDb((db) => {
    ensureUser(db, userId);
    if (db.users[userId].points < amount) return { ok: false, error: 'Not enough points.' };

    db.users[userId].points -= amount;
    db.users[userId].redeemed += amount;
    drawDownOpenCyclePoints(db, userId, amount);

    const rec = buildRedemptionBase({ userId, amount, kind: 'user_redeem', requestSource, rewardMultiplier });
    db.redemptions.push(rec);

    return { ok: true, redemption: rec };
  });
}

function sumUserCyclePoints(user) {
  return Object.values(user?.cycles || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function sumQueuedLeaderboardPoints(db, userId) {
  return (db.redemptions || [])
    .filter((row) => row.userId === userId && row.kind === 'leaderboard_payout' && ['pending', 'failed'].includes(row.status || 'pending'))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function getLeaderboardEligiblePoints(userId) {
  const db = readDb();
  seedDerivedUserStats(db, userId);
  const user = db.users[userId];
  const total = Number(user.points || 0);
  const cycleReserved = getOutstandingCycleReservedPoints(db, String(userId));
  const alreadyQueued = sumPendingOrFailedLeaderboardPoints(db, String(userId));
  return Math.max(0, total - cycleReserved - alreadyQueued);
}

function createLeaderboardPayouts({ minPoints = 500, limit = 25 } = {}) {
  return mutateDb((db) => {
    // Floor can never drop below the global redemption minimum — leaderboard
    // residual payouts are on-chain sends like any other.
    const floor = Math.max(getMinRedemptionPoints(), Number(minPoints || 500));
    const rows = [];

    const ranked = Object.entries(db.users || {})
      .map(([userId]) => {
        seedDerivedUserStats(db, userId);
        const user = db.users[userId];
        const total = Number(user.points || 0);
        const cycleReserved = getOutstandingCycleReservedPoints(db, userId);
        const alreadyQueued = sumPendingOrFailedLeaderboardPoints(db, userId);
        const eligible = Math.max(0, total - cycleReserved - alreadyQueued);
        return { userId, total, cycleReserved, alreadyQueued, eligible, lifetimePoints: Number(user.lifetimePoints || 0) };
      })
      .filter((row) => row.eligible >= floor)
      .sort((a, b) => b.eligible - a.eligible || b.lifetimePoints - a.lifetimePoints || b.total - a.total);

    for (const row of ranked.slice(0, Math.max(1, Number(limit || 25)))) {
      const rec = buildRedemptionBase({
        userId: row.userId,
        amount: row.eligible,
        kind: 'leaderboard_payout',
      });
      rec.settlementMode = 'queued';
      db.redemptions.push(rec);
      rows.push({ ...rec, eligiblePoints: row.eligible, cycleReservedPoints: row.cycleReserved, totalPoints: row.total, lifetimePoints: row.lifetimePoints });
    }

    return {
      ok: true,
      minPoints: floor,
      createdCount: rows.length,
      rows,
    };
  });
}

function listLeaderboardPayouts(status = null, limit = 50) {
  const db = readDb();
  const wanted = status === undefined || status === null || status === '' ? null : String(status);
  return (db.redemptions || [])
    .filter((row) => row.kind === 'leaderboard_payout' && (wanted ? (row.status || 'pending') === wanted : true))
    .sort((a, b) => (b.paidTs || b.ts || 0) - (a.paidTs || a.ts || 0))
    .slice(0, limit);
}

function summarizeLeaderboardPayouts() {
  const rows = listLeaderboardPayouts(null, 1000);
  const summary = { pending: 0, paid: 0, rejected: 0, failed: 0, total: rows.length, totalWinlewPaid: 0 };
  for (const row of rows) {
    const status = row.status || 'pending';
    if (summary[status] === undefined) summary[status] = 0;
    summary[status] += 1;
    if (status === 'paid') summary.totalWinlewPaid += Number(row.winlewSent || row.winlewDue || 0);
  }
  return summary;
}

function topUsers(limit = 10) {
  const db = readDb();
  const entries = Object.entries(db.users).map(([userId]) => {
    const user = seedDerivedUserStats(db, userId);
    return {
      userId,
      ...user,
      lifetimePoints: Number(user.lifetimePoints || 0),
      unpaidPoints: Number(user.points || 0),
      questions: Number(user.questionWins || 0),
      cyclesPlayed: getCyclesPlayedCount(db, userId),
      unpaidCyclePoints: getOutstandingCycleReservedPoints(db, userId),
    };
  });
  entries.sort((a,b)=> b.lifetimePoints - a.lifetimePoints || b.unpaidPoints - a.unpaidPoints || b.questions - a.questions);
  return entries.slice(0, limit);
}

// Global lifetime-points rank for one user, using the exact same sort order
// as topUsers() so "rank #N" always agrees with the real leaderboard. Only
// ranks users who have actually played (lifetimePoints > 0) — a user who
// has never answered a question isn't meaningfully "ranked #4 of 4", so
// this returns null for them instead of a technically-true but misleading
// number. Cheap at this project's current user count (a full DB scan); if
// the user base grows large enough for this to matter, that's a caching
// decision for later, not a reason to change the ranking definition itself.
function getUserRank(userId) {
  const db = readDb();
  const id = String(userId);
  const entries = Object.entries(db.users)
    .map(([uid]) => {
      const user = seedDerivedUserStats(db, uid);
      return {
        userId: uid,
        lifetimePoints: Number(user.lifetimePoints || 0),
        unpaidPoints: Number(user.points || 0),
        questions: Number(user.questionWins || 0),
      };
    })
    .filter((entry) => entry.lifetimePoints > 0);
  entries.sort((a, b) => b.lifetimePoints - a.lifetimePoints || b.unpaidPoints - a.unpaidPoints || b.questions - a.questions);
  const idx = entries.findIndex((entry) => entry.userId === id);
  if (idx === -1) return null;
  return { rank: idx + 1, totalRankedPlayers: entries.length };
}

function topSponsorUsers(sponsor, limit = 10) {
  const db = readDb();
  const key = sponsor.toLowerCase();
  const entries = Object.entries(db.users).map(([userId, u]) => {
    const sPts = (u.sponsor && u.sponsor[key]) || 0;
    return { userId, sponsorPoints: sPts };
  });
  entries.sort((a,b)=> b.sponsorPoints - a.sponsorPoints);
  return entries.slice(0, limit);
}

function listRedemptions(userId) {
  const db = readDb();
  return (db.redemptions || []).filter(r => r.userId === userId).sort((a,b)=> b.ts - a.ts);
}

function listPendingRedemptions(limit = 25) {
  const db = readDb();
  const pending = (db.redemptions || []).filter(r => (r.status || 'pending') === 'pending').sort((a,b)=> b.ts - a.ts);
  return pending.slice(0, limit);
}

function listFailedRedemptions(limit = 25) {
  const db = readDb();
  const failed = (db.redemptions || []).filter(r => (r.status || 'pending') === 'failed').sort((a,b)=> b.ts - a.ts);
  return failed.slice(0, limit);
}

function listAutoSettlementCandidates({ limit = 10, allowKinds = [] } = {}) {
  const db = readDb();
  const now = Date.now();
  return (db.redemptions || [])
    .filter((r) => {
      const status = r.status || 'pending';
      if (status !== 'pending') return false;
      // A held record is genuinely parked — what the comment in
      // noteRiskAssessment always claimed and never did. Without this the
      // worker re-scores and re-announces every held payout on every scan.
      // `approved` and `auto_released` both leave this state, so a decision
      // puts the record straight back in the queue.
      if (r.decision === 'held') return false;
      if (allowKinds.length && !allowKinds.includes(r.kind)) return false;
      if (r.nextAttemptTs && Number(r.nextAttemptTs) > now) return false;
      return true;
    })
    .sort((a, b) => a.ts - b.ts)
    .slice(0, limit);
}

function markRedemptionPaidById({ id, winlewSent, tx, walletAddress = null, walletSource = null, settlementMode = 'manual', settlementWorker = null }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => ['pending', 'failed'].includes(r.status || 'pending') && r.id === id);
    if (!rec) return { ok: false, error: 'No matching pending/failed redemption found for that ID.' };

    rec.status = 'paid';
    rec.winlewSent = Number(winlewSent);
    rec.tx = tx || null;
    rec.paidTs = Date.now();
    rec.payoutWallet = walletAddress || rec.payoutWallet || null;
    rec.payoutWalletSource = walletSource || rec.payoutWalletSource || null;
    rec.settlementMode = settlementMode || rec.settlementMode || 'manual';
    rec.settlementWorker = settlementWorker || rec.settlementWorker || null;
    rec.lastError = null;
    rec.nextAttemptTs = null;

    if (rec.kind === 'cycle_payout' || rec.kind === 'leaderboard_payout') {
      seedDerivedUserStats(db, rec.userId);
      db.users[rec.userId].points = Math.max(0, Number(db.users[rec.userId].points || 0) - Number(rec.amount || 0));
    }

    return { ok: true, rec };
  });
}

function noteSettlementAttempt({ id, error, retryAfterMs = 0, maxAttempts = 7, walletAddress = undefined, walletSource = undefined }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => ['pending', 'failed'].includes(r.status || 'pending') && r.id === id);
    if (!rec) return { ok: false, error: 'No matching queued redemption found for that ID.' };

    rec.attempts = Number(rec.attempts || 0) + 1;
    rec.lastAttemptTs = Date.now();
    rec.lastError = error || 'settlement_failed';
    if (walletAddress !== undefined) rec.payoutWallet = walletAddress;
    if (walletSource !== undefined) rec.payoutWalletSource = walletSource;
    rec.nextAttemptTs = retryAfterMs > 0 ? Date.now() + retryAfterMs : null;
    rec.status = rec.attempts >= maxAttempts ? 'failed' : 'pending';
    if (rec.status === 'failed') rec.failedTs = Date.now();
    return { ok: true, rec };
  });
}

// ── Payout intent (2026-08-14) ───────────────────────────────────────────────
//
// Closes a crash window that could pay twice. settleRecord() used to do:
//
//     const tx = await sendWinlew(...)      // money leaves
//     db.markRedemptionPaidById({ ... })    // crash here and the record is
//                                           // still 'pending', so the next
//                                           // run sends AGAIN
//
// Nothing was persisted between those two lines, so a crash or restart in that
// window meant a second transfer of real tokens. Separate from the confirmation
// timeout fixed in f9646f5 — raising that timeout did not close this.
//
// The signature is now written BEFORE confirmation. On the next run,
// reconcilePayoutIntents() asks the chain what happened to it instead of
// assuming failure. Recording an intent is the last thing that happens before
// the transfer, so the worst case is an intent for a transaction that was never
// submitted — which reconciliation resolves as "not found" and clears.
// ── Participation signals (Stage 2, 2026-08-14) ──────────────────────────────
//
// Append-only, hashed, and read by NOTHING yet. The risk engine that consumes
// these lands in Stage 3 behind its own flag; collecting first means that when
// enforcement is finally considered there is real history to tune it against
// instead of guesses.
//
// Only hashes are stored — see src/mole/deviceSignals.js. No raw IP, no raw
// fingerprint value, no GPS.
const PARTICIPATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PARTICIPATION_MAX_ROWS = 50_000;

function recordParticipation({ userId, cycleId = null, deviceHash = null, netHash = null, answerMs = null }) {
  if (!deviceHash && !netHash) return { ok: true, skipped: true };
  return mutateDb((db) => {
    db.participation = db.participation || [];
    db.participation.push({
      userId: String(userId),
      cycleId: cycleId ? String(cycleId) : null,
      deviceHash,
      netHash,
      // Bucketed, not exact. How fast someone answers is a useful automation
      // signal; millisecond precision is a behavioural fingerprint we do not
      // need and should not keep.
      answerBucket: answerMs == null ? null : bucketAnswerMs(Number(answerMs)),
      ts: Date.now(),
    });

    // Pruned on write rather than by a cron: this file is already rewritten on
    // every mutation, so there is no cheaper moment, and it cannot silently
    // stop running.
    const cutoff = Date.now() - PARTICIPATION_RETENTION_MS;
    db.participation = db.participation.filter((row) => Number(row.ts || 0) >= cutoff);
    if (db.participation.length > PARTICIPATION_MAX_ROWS) {
      db.participation = db.participation.slice(-PARTICIPATION_MAX_ROWS);
    }
    return { ok: true };
  });
}

/** Coarse buckets — enough to spot "answered in 300ms every time", not enough
 *  to profile a person's reaction time. */
function bucketAnswerMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return 'under_1s';
  if (ms < 3000) return '1_3s';
  if (ms < 10000) return '3_10s';
  if (ms < 30000) return '10_30s';
  return 'over_30s';
}

function listParticipation({ userId = null, since = null } = {}) {
  const db = readDb();
  const cutoff = since ? Number(since) : 0;
  return (db.participation || []).filter(
    (row) => (!userId || row.userId === String(userId)) && Number(row.ts || 0) >= cutoff,
  );
}

// ── Risk decisions on payouts (Stage 3/4, 2026-08-14) ────────────────────────
//
// A held payout is NOT a rejected one. Points stay earned, the record stays
// queued, and a human decides. The owner's rule: valid points are never
// silently confiscated.
/** Paid redemptions across all users, for the wallet-swap-after-payout signal. */
function listRecentPaidRedemptions({ since = 0 } = {}) {
  const db = readDb();
  return (db.redemptions || [])
    .filter(r => r.status === 'paid' && Number(r.paidTs || 0) >= Number(since))
    .map(r => ({ userId: r.userId, wallet: r.payoutWallet || null, paidTs: Number(r.paidTs || 0) }));
}

/** Attach a payout receipt. Separate from markRedemptionPaidById so a receipt
 *  failure can never roll back a settled payout — the money moved either way. */
function notePayoutReceipt({ id, receipt }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id);
    if (!rec) return { ok: false, error: 'No matching redemption found for that ID.' };
    rec.receipt = receipt || null;
    return { ok: true, rec };
  });
}

/** How many payouts this user has already been paid. Zero means the next one is
 *  their first, which is the one the provenance check exists for. Counts across
 *  every kind — on-demand, cycle and leaderboard — because "first money out of
 *  the system to this person" is the question, not "first of this type". */
function countPaidPayouts(userId) {
  const db = readDb();
  const uid = String(userId);
  return (db.redemptions || []).filter(r => String(r.userId) === uid && r.status === 'paid').length;
}

/** Every wallet this system has ever actually paid, with who it was paid to.
 *  A funder that appears here is not a stranger — we funded them, and a first
 *  payout being funded by an earlier payout is the exact shape of the abuse
 *  seen on 2026-08-14. */
function listPaidWalletOwners() {
  const db = readDb();
  const out = new Map();
  for (const r of db.redemptions || []) {
    if (r.status !== 'paid' || !r.payoutWallet) continue;
    const key = String(r.payoutWallet);
    const prev = out.get(key);
    if (!prev || Number(r.paidTs || 0) > prev.paidTs) {
      out.set(key, { wallet: key, userId: String(r.userId), paidTs: Number(r.paidTs || 0) });
    }
  }
  return [...out.values()];
}

/** Every payout that carries a receipt, for `npm run receipts:verify`.
 *  Returns the WHOLE record, not a projection — replay has to recompute the
 *  decision from the same fields the worker saw, so a trimmed copy would make
 *  every receipt look tampered with. */
function listRedemptionsWithReceipts({ since = 0 } = {}) {
  const db = readDb();
  return (db.redemptions || [])
    .filter(r => r.receipt?.decisionHash && Number(r.paidTs || 0) >= Number(since));
}

/** Record the first-payout provenance report on the redemption. Stored whatever
 *  the verdict, including a clean one — the point of a one-time check is that it
 *  is not repeated, and a clear result is only useful if it is written down. */
function noteFirstPayoutCheck({ id, provenance }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id);
    if (!rec) return { ok: false, error: 'No matching redemption found for that ID.' };
    rec.firstPayoutCheck = provenance || null;
    return { ok: true, rec };
  });
}

function noteRiskAssessment({ id, risk, decision = 'settle', heldReason = null }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id);
    if (!rec) return { ok: false, error: 'No matching redemption found for that ID.' };
    rec.risk = risk || null;
    rec.decision = decision;
    if (decision === 'held') {
      rec.heldReason = heldReason || 'risk_review';
      // Set ONCE. Re-holding must not restart the clock: the review SLA in
      // reviewQueue.js ages from this, and the worker re-scores every 45s, so
      // an unconditional assignment kept pushing the deadline forward and a
      // hold could never age out. The bug hid behind the comment below, which
      // claimed `nextAttemptTs = null` parked the record — it does not, since
      // listAutoSettlementCandidates only skips a FUTURE nextAttemptTs.
      if (!rec.heldTs) rec.heldTs = Date.now();
      // Deliberately NOT 'failed' — failed records stop being retried and read
      // as an error. This is a pause with a human at the end of it.
      rec.status = 'pending';
      rec.nextAttemptTs = null;
    }
    return { ok: true, rec };
  });
}

function listHeldRedemptions() {
  const db = readDb();
  return (db.redemptions || []).filter(r => r.decision === 'held' && (r.status || 'pending') === 'pending');
}

/** Approve a held payout — it re-enters the normal settlement queue. */
function approveHeldRedemption({ id, byDiscordUserId = null }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id && r.decision === 'held');
    if (!rec) return { ok: false, error: 'No held redemption found for that ID.' };
    rec.decision = 'approved';
    rec.heldReason = null;
    rec.reviewedBy = byDiscordUserId;
    rec.reviewedTs = Date.now();
    rec.nextAttemptTs = Date.now();
    return { ok: true, rec };
  });
}

/** Reject a held payout. The ONLY path that removes a payout, and it requires a
 *  human and a reason — never the automatic outcome of a score. */
function rejectHeldRedemption({ id, byDiscordUserId = null, reason = '' }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id && r.decision === 'held');
    if (!rec) return { ok: false, error: 'No held redemption found for that ID.' };
    rec.decision = 'rejected';
    rec.status = 'rejected';
    rec.rejectedTs = Date.now();
    rec.reviewedBy = byDiscordUserId;
    rec.reviewedTs = Date.now();
    rec.lastError = reason || 'rejected_after_review';
    return { ok: true, rec };
  });
}

/**
 * Release a held payout that no human ever reviewed.
 *
 * DELIBERATELY NOT approveHeldRedemption(). That one means "a mod looked and
 * said yes"; this means "nobody looked, and the wait had gone on long enough."
 * Recording them identically would let an unattended queue masquerade as a
 * reviewed one, which is the exact failure this mechanism exists to stop.
 */
function autoReleaseHeldRedemption({ id, reason = 'review_sla_expired', heldForMs = 0 }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id && r.decision === 'held');
    if (!rec) return { ok: false, error: 'No held redemption found for that ID.' };
    rec.decision = 'auto_released';
    rec.heldReason = null;
    rec.autoReleased = { at: Date.now(), reason, heldForMs, reviewedByHuman: false };
    rec.reviewedBy = null;
    rec.nextAttemptTs = Date.now();
    return { ok: true, rec };
  });
}

/** Escalation bookkeeping, so a reminder can get louder instead of repeating
 *  identically forever — an alert that never changes is one people stop reading. */
function noteHoldEscalation({ id, now = Date.now() }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id);
    if (!rec) return { ok: false, error: 'No matching redemption found for that ID.' };
    rec.escalations = Number(rec.escalations || 0) + 1;
    rec.lastEscalatedTs = now;
    return { ok: true, rec };
  });
}

function getReviewDigestTs() {
  return Number(readDb().meta?.lastReviewDigestTs || 0);
}

function setReviewDigestTs(ts = Date.now()) {
  return mutateDb((db) => {
    db.meta = db.meta || {};
    db.meta.lastReviewDigestTs = Number(ts);
    return { ok: true };
  });
}

// ── Watchlist ────────────────────────────────────────────────────────────────
//
// The owner's call, 2026-08-14: "lets pay out the First one instant, and put
// them on a list."
//
// A first payout is never held. Making a brand new participant wait three days
// for money they earned, on circumstantial evidence, to catch a farmer who will
// simply wait three days, is a bad trade — it costs every honest newcomer and
// stops nobody. So the first payout goes out, and what the chain said about
// their wallet is written down here instead.
//
// The watchlist is what makes that safe: it gates the SECOND payout, not the
// first. One payout is the price of getting real evidence; the pattern this
// exists to catch only becomes visible on the repeat anyway.

function watchlistDb(db) {
  db.meta = db.meta || {};
  db.meta.watchlist = db.meta.watchlist || {};
  return db.meta.watchlist;
}

function addToWatchlist({ userId, reason = 'first_payout_review', signals = [], wallet = null, redemptionId = null, report = null }) {
  return mutateDb((db) => {
    const list = watchlistDb(db);
    const key = String(userId);
    // Re-flagging does not restart anything or overwrite the original evidence.
    // The first entry is the one an admin was asked to look at.
    if (list[key] && !list[key].clearedTs) return { ok: true, entry: list[key], alreadyListed: true };
    list[key] = {
      userId: key,
      addedTs: Date.now(),
      reason,
      signals: [...signals],
      wallet: wallet || null,
      redemptionId: redemptionId || null,
      report: report || null,
      clearedTs: null,
      clearedBy: null,
      note: null,
    };
    return { ok: true, entry: list[key], alreadyListed: false };
  });
}

/** Cleared BY A PERSON. There is no timer here on purpose: nobody is waiting on
 *  a cleared flag, so nothing is being withheld while it sits. */
function clearWatchlist({ userId, byDiscordUserId = null, note = '' }) {
  return mutateDb((db) => {
    const list = watchlistDb(db);
    const entry = list[String(userId)];
    if (!entry) return { ok: false, error: 'That user is not on the watchlist.' };
    if (entry.clearedTs) return { ok: false, error: 'That user was already cleared.' };
    entry.clearedTs = Date.now();
    entry.clearedBy = byDiscordUserId;
    entry.note = note || null;

    // Release anything this flag is currently holding, in the same write.
    // Clearing someone and then leaving their payout parked would be the same
    // silent-withholding bug in a new place — and the admin was told this ends
    // it, so it has to actually end it.
    const released = [];
    for (const rec of db.redemptions || []) {
      if (String(rec.userId) !== String(userId)) continue;
      if (rec.decision !== 'held') continue;
      if (!String(rec.heldReason || '').startsWith('watchlist:')) continue;
      rec.decision = 'approved';
      rec.heldReason = null;
      rec.reviewedBy = byDiscordUserId;
      rec.reviewedTs = Date.now();
      rec.nextAttemptTs = Date.now();
      released.push(rec.id);
    }
    return { ok: true, entry, released };
  });
}

/** Kept, not deleted — a cleared entry is the record that somebody looked. */
function listWatchlist({ includeCleared = false } = {}) {
  const list = readDb().meta?.watchlist || {};
  return Object.values(list).filter((e) => includeCleared || !e.clearedTs);
}

function getWatchlistEntry(userId) {
  return readDb().meta?.watchlist?.[String(userId)] || null;
}

/** Outstanding means flagged and not yet looked at by a human. */
function isWatchlisted(userId) {
  const entry = getWatchlistEntry(userId);
  return Boolean(entry && !entry.clearedTs);
}

function notePayoutIntent({ id, signature, lastValidBlockHeight = null }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => ['pending', 'failed'].includes(r.status || 'pending') && r.id === id);
    if (!rec) return { ok: false, error: 'No matching queued redemption found for that ID.' };
    rec.payoutIntent = {
      signature: String(signature),
      sentAt: Date.now(),
      lastValidBlockHeight: lastValidBlockHeight == null ? null : Number(lastValidBlockHeight),
    };
    return { ok: true, rec };
  });
}

function clearPayoutIntent({ id, reason = '' }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => r.id === id);
    if (!rec) return { ok: false, error: 'No matching redemption found for that ID.' };
    rec.payoutIntent = null;
    if (reason) rec.lastError = reason;
    return { ok: true, rec };
  });
}

/** Queued records carrying an unresolved intent — a transfer we know was sent
 *  but never confirmed. These must be reconciled against the chain before any
 *  new transfer is submitted for them. */
function listPayoutIntents() {
  const db = readDb();
  return (db.redemptions || []).filter(
    r => ['pending', 'failed'].includes(r.status || 'pending') && r.payoutIntent?.signature,
  );
}

function requeueRedemptionById({ id }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => ['failed', 'pending'].includes(r.status || 'pending') && r.id === id);
    if (!rec) return { ok: false, error: 'No matching failed/pending redemption found for that ID.' };

    rec.status = 'pending';
    rec.lastError = null;
    rec.nextAttemptTs = null;
    rec.failedTs = null;
    rec.settlementMode = rec.settlementMode === 'manual' ? 'manual' : 'queued';
    return { ok: true, rec };
  });
}

function rejectRedemptionById({ id, reason }) {
  return mutateDb((db) => {
    const rec = (db.redemptions || []).find(r => ['pending', 'failed'].includes(r.status || 'pending') && r.id === id);
    if (!rec) return { ok: false, error: 'No matching pending redemption found for that ID.' };

    rec.status = 'rejected';
    rec.rejectReason = reason || null;
    rec.rejectedTs = Date.now();

    if (rec.kind === 'user_redeem') {
      ensureUser(db, rec.userId);
      db.users[rec.userId].points += rec.amount;
      db.users[rec.userId].redeemed = Math.max(0, (db.users[rec.userId].redeemed || 0) - rec.amount);
    }

    return { ok: true, rec };
  });
}

function getSettlementStats() {
  const db = readDb();
  const rows = db.redemptions || [];
  const totals = { pending: 0, paid: 0, rejected: 0, failed: 0, cycle: 0, redeem: 0, leaderboard: 0 };
  for (const row of rows) {
    const status = row.status || 'pending';
    if (totals[status] !== undefined) totals[status] += 1;
    if (row.kind === 'cycle_payout') totals.cycle += 1;
    if (row.kind === 'user_redeem') totals.redeem += 1;
    if (row.kind === 'leaderboard_payout') totals.leaderboard += 1;
  }
  return totals;
}

function getPayoutRate() {
  return WINLEW_PER_POINT;
}

function estimateWinlewForPoints(points) {
  return Number(points || 0) * WINLEW_PER_POINT;
}

function getMinRedemptionWinlew() {
  return QUIZ_MIN_REDEMPTION_WINLEW;
}

// The floor expressed in points at the current rate — what callers actually
// compare a redemption amount against.
function getMinRedemptionPoints() {
  return Math.max(1, Math.ceil(QUIZ_MIN_REDEMPTION_WINLEW / WINLEW_PER_POINT));
}

// ── Web-play bookkeeping (anti-farm for winlew.co/quiz/) ────────────────────
// Tracks which questions a user has already scored this cycle (answer-once) and
// how many web questions they've scored today (UTC daily cap). Awarding itself
// reuses addPoints() — web points are identical to Discord points.
function webDayKeyUTC(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function ensureWebBucket(user) {
  if (!user.web || typeof user.web !== 'object') user.web = {};
  if (!user.web.answeredByCycle || typeof user.web.answeredByCycle !== 'object') user.web.answeredByCycle = {};
  if (!user.web.daily || typeof user.web.daily !== 'object') user.web.daily = {};
  return user.web;
}
function getWebDailyCount(userId, date = webDayKeyUTC()) {
  const db = readDb();
  return Number(db.users[String(userId)]?.web?.daily?.[date] || 0);
}
function getWebAnsweredThisCycle(userId, cycleId) {
  const db = readDb();
  const list = db.users[String(userId)]?.web?.answeredByCycle?.[cycleId];
  return Array.isArray(list) ? list.slice() : [];
}
function recordWebAnswer(userId, cycleId, questionId, date = webDayKeyUTC()) {
  return mutateDb((db) => {
    ensureUser(db, String(userId));
    const web = ensureWebBucket(db.users[String(userId)]);
    if (!Array.isArray(web.answeredByCycle[cycleId])) web.answeredByCycle[cycleId] = [];
    if (!web.answeredByCycle[cycleId].includes(questionId)) web.answeredByCycle[cycleId].push(questionId);
    web.daily[date] = Number(web.daily[date] || 0) + 1;
    return { dailyCount: web.daily[date], answeredCount: web.answeredByCycle[cycleId].length };
  });
}

// ── Platform-attributed stats (Discord vs Web leaderboards) ────────────────
// Purely informational: tracks per-platform points/accuracy/streaks so the
// Discord and Web leaderboards can be shown separately, and so a Web vs
// Discord comparison can be built. Deliberately does NOT touch `points` /
// `cycles` / `lifetimePoints` — those remain the single, unchanged
// payout-eligible pool exactly as before this feature existed. See
// docs/quiz-web-expansion.md for why the two are kept separate.
//
// Pre-existing users have no history of *which* platform earned their past
// points (no per-answer platform tag was ever recorded), so platform stats
// intentionally start at zero for everyone as of this feature shipping,
// rather than guessing/backfilling. Documented in docs/quiz-web-expansion.md.
function recordPlatformAnswer(userId, platform, { correct, points = 0 } = {}) {
  const p = platformStats.normalizePlatform(platform);
  return mutateDb((db) => {
    ensureUser(db, String(userId));
    const user = db.users[String(userId)];
    user.platforms[p] = platformStats.applyAnswerToBucket(user.platforms[p], { correct, points });
    return { ...user.platforms[p] };
  });
}

function getUserPlatformStats(userId) {
  const db = readDb();
  ensureUser(db, String(userId));
  const user = db.users[String(userId)];
  return { discord: { ...user.platforms.discord }, web: { ...user.platforms.web } };
}

// Per-tier (easy/medium/hard/sponsor) accuracy — same informational-only
// contract as recordPlatformAnswer: never touches payout-eligible points,
// purely for the web quiz's "your accuracy per tier" display. New users (and
// pre-existing users answering their first web question after this feature
// shipped) start at zero for every tier, same rationale as platform stats.
function recordTierAnswer(userId, tier, { correct, points = 0 } = {}) {
  const t = platformStats.normalizeTier(tier);
  return mutateDb((db) => {
    ensureUser(db, String(userId));
    const user = db.users[String(userId)];
    user.tiers[t] = platformStats.applyAnswerToBucket(user.tiers[t], { correct, points });
    return { ...user.tiers[t] };
  });
}

function getUserTierStats(userId) {
  const db = readDb();
  ensureUser(db, String(userId));
  const user = db.users[String(userId)];
  const out = {};
  for (const tier of platformStats.TIERS) out[tier] = { ...user.tiers[tier] };
  return out;
}

function topUsersByPlatform(platform, limit = 25) {
  const db = readDb();
  return platformStats.rankUsersByPlatform(db.users, platform, limit);
}

function getPlatformComparisonStats() {
  const db = readDb();
  return platformStats.buildPlatformComparison(db.users);
}

module.exports = {
  readDb, writeDb, getUser, addPoints, addSponsorPoints, redeemPoints,
  topUsers, topSponsorUsers, listRedemptions,
  listPendingRedemptions, listFailedRedemptions, markRedemptionPaidById, rejectRedemptionById,
  getCurrentCycle, setCycleEpochIfEmpty, getUserCyclePoints, topCycleUsers, getUserRank,
  closeCycle, switchCycleCadence, listCyclePayouts, summarizeCyclePayouts, getPayoutRate, estimateWinlewForPoints,
  getMinRedemptionWinlew, getMinRedemptionPoints,
  getCycleOutstandingPoints: (userId, cycleId) => {
    const db = readDb();
    return getCycleOutstandingPoints(db, userId, cycleId);
  },
  getOutstandingCycleReservedPoints: (userId) => {
    const db = readDb();
    return getOutstandingCycleReservedPoints(db, userId);
  },
  listAutoSettlementCandidates, noteSettlementAttempt, requeueRedemptionById,
  notePayoutIntent, clearPayoutIntent, listPayoutIntents,
  recordParticipation, listParticipation,
  noteRiskAssessment, listHeldRedemptions, approveHeldRedemption, rejectHeldRedemption,
  listRecentPaidRedemptions, notePayoutReceipt, listRedemptionsWithReceipts,
  countPaidPayouts, listPaidWalletOwners, noteFirstPayoutCheck,
  autoReleaseHeldRedemption, noteHoldEscalation, getReviewDigestTs, setReviewDigestTs,
  addToWatchlist, clearWatchlist, listWatchlist, getWatchlistEntry, isWatchlisted,
  getSettlementStats, getLeaderboardEligiblePoints, createLeaderboardPayouts,
  listLeaderboardPayouts, summarizeLeaderboardPayouts,
  getWebDailyCount, getWebAnsweredThisCycle, recordWebAnswer,
  recordPlatformAnswer, getUserPlatformStats, topUsersByPlatform, getPlatformComparisonStats,
  recordTierAnswer, getUserTierStats,
};
