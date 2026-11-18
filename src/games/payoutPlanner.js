// Pure planning logic for the daily game-payout worker — no I/O, no chain calls,
// so it can be tested exhaustively. Turns a flat list of unpaid reward rows into
// a per-user payout plan, applying the dust threshold and wallet resolution.

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

/** Stable identity for a reward row (matches the claim dedup key). */
export function rowKey(row) {
  return [
    String(row.discordUserId || ""),
    String(row.app || "mole"),
    String(row.game || ""),
    String(row.roundKey || ""),
  ].join("|");
}

/**
 * @param {Array} rows         unpaid reward rows ({ discordUserId, app, game, roundKey, payout, ... })
 * @param {(discordUserId:string)=>string|null} resolveWallet  maps a user to their payout wallet
 * @param {{ minPayout?: number, maxPayoutPerUser?: number }} opts
 * @returns {{
 *   entries: Array<{ discordUserId, wallet, amount, rowKeys: string[], claimCount }>,
 *   skipped: Array<{ discordUserId, amount, claimCount, reason }>,
 *   held: Array<{ discordUserId, amount, claimCount, reason }>,
 *   totalToPay: number,
 *   userCount: number,
 *   claimCount: number,
 * }}
 */
export function buildPayoutPlan(rows = [], resolveWallet = () => null, opts = {}) {
  const minPayout = Number.isFinite(Number(opts.minPayout)) ? Number(opts.minPayout) : 100;
  // Sync predicate: ({ discordUserId, wallet }) => reason | null.
  //
  // The DEFAULT BLOCKS EVERYTHING. A caller that forgets to pass this gets a
  // run that pays nobody and is instantly obvious, rather than one that quietly
  // pays banned wallets — which is the exact failure this parameter was added
  // for, and defaulting to `() => null` would have preserved it verbatim.
  const isBlocked = typeof opts.isBlocked === "function"
    ? opts.isBlocked
    : () => "blocklist_unavailable";
  // Defense-in-depth ceiling (2026-07-19 audit): the worker signs real
  // transactions, so a single user's nightly total exceeding this is HELD for
  // human review rather than auto-paid — even a bug or forged claim upstream
  // can't silently drain the treasury in one run. 0/unset disables the check.
  // Rows are left unpaid (not lost) so a release is just a later re-run.
  const maxPayoutPerUser = Number(opts.maxPayoutPerUser) > 0 ? Number(opts.maxPayoutPerUser) : 0;
  const resolveIdentity = typeof opts.resolveAccountId === "function"
    ? opts.resolveAccountId
    : (id) => id;

  const byUser = new Map();
  for (const row of rows) {
    const originalId = String(row.discordUserId || "");
    const id = String(resolveIdentity(originalId) || originalId);
    if (!id) continue;
    if (!byUser.has(id)) byUser.set(id, { discordUserId: id, amount: 0, rowKeys: [], claimCount: 0 });
    const u = byUser.get(id);
    u.amount += Number(row.payout || 0);
    u.rowKeys.push(rowKey(row));
    u.claimCount += 1;
  }

  const entries = [];
  const skipped = [];
  const held = [];
  for (const u of byUser.values()) {
    const amount = round2(u.amount);
    const base = { discordUserId: u.discordUserId, amount, claimCount: u.claimCount };
    const wallet = resolveWallet(u.discordUserId);
    if (!wallet) {
      skipped.push({ ...base, reason: "no_wallet" }); // rows stay unpaid; retry once linked
      continue;
    }
    // Blocklist (2026-08-16). Until this existed, a wallet banned from the
    // faucet for sybil abuse was still paid its game winnings on the nightly
    // run — this planner refused a user for exactly two reasons, neither of
    // them a ban. See src/services/payoutGate.js.
    //
    // HELD, not skipped: a skip carries forward and silently retries every
    // night forever, which is how a banned user's balance would keep queueing
    // itself for payment. A hold keeps the funds on the bot and puts the row
    // in front of a human, which is the point.
    //
    // Checked BEFORE the min-payout test on purpose: a banned user under the
    // floor would otherwise be filed as "below_min" and never appear as a ban.
    const blockReason = isBlocked({ discordUserId: u.discordUserId, wallet });
    if (blockReason) {
      // rowKeys travel with a blocked hold so the caller can act on the exact
      // claims — a confirmed ban withholds them permanently rather than letting
      // them requeue every night (see markClaimsWithheld in rewardHistory.js).
      held.push({ ...base, wallet, reason: blockReason, rowKeys: u.rowKeys });
      continue;
    }
    if (amount < minPayout) {
      skipped.push({ ...base, reason: "below_min" }); // carry forward to a future night
      continue;
    }
    if (maxPayoutPerUser && amount > maxPayoutPerUser) {
      // Suspicious single-run total — hold for review, do NOT auto-pay.
      held.push({ ...base, reason: "over_max", maxPayoutPerUser });
      continue;
    }
    entries.push({ ...base, wallet, rowKeys: u.rowKeys });
  }

  // Largest payouts first — keeps the most valuable transfers in the earliest bundles.
  entries.sort((a, b) => b.amount - a.amount);

  return {
    entries,
    skipped,
    held,
    totalToPay: round2(entries.reduce((sum, e) => sum + e.amount, 0)),
    userCount: entries.length,
    claimCount: entries.reduce((sum, e) => sum + e.claimCount, 0),
  };
}

/** Split plan entries into bundles of at most `size` for per-transaction batching. */
export function chunkBundles(entries = [], size = 6) {
  const n = Math.max(1, Math.floor(Number(size) || 6));
  const out = [];
  for (let i = 0; i < entries.length; i += n) out.push(entries.slice(i, i + n));
  return out;
}
