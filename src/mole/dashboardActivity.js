// Version 2.2 — Dashboard recent-activity feed. Merges existing per-system
// records (faucet claims, game reward claims, quiz redemptions) into one
// sorted list. This is deliberately NOT a unified event log: no new storage
// was added, and no event exists for wallet verification or profile edits
// (neither system persists a history of past events, only current state).
// See docs/unified-dashboard.md for the full explanation of that gap.
const DEFAULT_LIMIT = 10;

function faucetActivityItems(faucetClaims = []) {
  return faucetClaims
    .filter((c) => c.status === "confirmed")
    .map((c) => ({
      type: "faucet_claim",
      label: `Faucet claim confirmed${c.amountDisplay ? ` (${c.amountDisplay} WinLEW)` : ""}`,
      at: Number(c.createdAt || 0),
      detail: { amountDisplay: c.amountDisplay ?? null, source: c.source || null },
    }));
}

function gameActivityItems(gameHistory = []) {
  return gameHistory.map((row) => ({
    type: "game_reward",
    label: `${row.roundLabel || row.game || "Game"} reward (${Number(row.payout || 0)} WinLEW)`,
    at: Date.parse(row.claimedAt) || 0,
    detail: { game: row.game || null, payout: Number(row.payout || 0) },
  }));
}

function quizActivityItems(quizRedemptions = []) {
  return quizRedemptions.map((row) => ({
    type: "quiz_redemption",
    label: `Quiz redemption ${row.status || "pending"} (${Number(row.amount || 0)} pts)`,
    at: Number(row.ts || 0),
    detail: { status: row.status || "pending", amount: Number(row.amount || 0) },
  }));
}

/**
 * Pure — takes already-fetched record arrays (no I/O), returns `{items}`
 * sorted newest-first and capped at `limit`. An item with no valid
 * timestamp is dropped rather than sorted arbitrarily.
 */
export function buildRecentActivity({ faucetClaims = [], gameHistory = [], quizRedemptions = [] } = {}, { limit = DEFAULT_LIMIT } = {}) {
  const items = [
    ...faucetActivityItems(faucetClaims),
    ...gameActivityItems(gameHistory),
    ...quizActivityItems(quizRedemptions),
  ]
    .filter((item) => item.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  return { items };
}
