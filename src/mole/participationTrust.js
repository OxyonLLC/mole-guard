// Participation risk engine — Stage 3.
//
// Pure. No I/O, no RPC, no database, no clock beyond what is passed in. That is
// what makes it testable against the household case, which is the case most
// likely to hurt a real person if this is wrong.
//
// It answers one question: does this participant's activity look like one
// person earning, or like one person wearing several hats to beat a limit?
//
// THE RULE THAT MATTERS MOST, stated first because everything else is tuned
// around it: a shared NETWORK is not evidence. Families, flatmates, offices and
// whole mobile carriers behind CGNAT share a /24. Only a shared DEVICE with
// several identities on it is worth anything, and even that is circumstantial
// until it lines up with reward timing.
//
// Ported in spirit from GeoPresence's scoreDeviceTrust(), with the inversion
// recorded there: it scores DEVICES PER WALLET; the abuse here is WALLETS PER
// DEVICE.

export const RULES_VERSION = "participation-trust/1.0.0";

export const BANDS = Object.freeze({
  NORMAL: "normal",
  ELEVATED: "elevated",
  SUSPICIOUS: "suspicious",
  HELD: "held",
});

// Thresholds live here, named, so a tuning change is one reviewable diff and
// shadow-mode results can be argued about with numbers rather than vibes.
export const THRESHOLDS = Object.freeze({
  // Below this many identities on one device, nothing is suspicious at all —
  // shared laptops and a phone plus a desktop are ordinary.
  IDENTITIES_PER_DEVICE_OK: 2,
  IDENTITIES_PER_DEVICE_ELEVATED: 3,
  IDENTITIES_PER_DEVICE_SUSPICIOUS: 4,
  // A wallet swapped this soon after a payout is the farmer's actual move.
  WALLET_SWAP_AFTER_PAYOUT_MS: 60 * 60 * 1000,
  // Answering faster than a human reads, repeatedly.
  FAST_ANSWER_RATIO: 0.8,
  FAST_ANSWER_MIN_SAMPLE: 10,
  // Score at which each band starts.
  ELEVATED_AT: 30,
  SUSPICIOUS_AT: 55,
  HELD_AT: 80,
});

function bandFor(score) {
  if (score >= THRESHOLDS.HELD_AT) return BANDS.HELD;
  if (score >= THRESHOLDS.SUSPICIOUS_AT) return BANDS.SUSPICIOUS;
  if (score >= THRESHOLDS.ELEVATED_AT) return BANDS.ELEVATED;
  return BANDS.NORMAL;
}

/**
 * @param {object} input
 * @param {string} input.userId              whose payout is being judged
 * @param {Array}  input.participation       rows from db.listParticipation()
 *                                           `{userId, deviceHash, netHash, answerBucket, ts}`
 * @param {Array}  [input.recentPayouts]     `{userId, wallet, paidTs}` across all users
 * @param {Array}  [input.walletChanges]     this user's `{wallet, ts}` link history
 * @param {boolean}[input.clusterHit]        funding-cluster walk said "linked to banned"
 * @param {number} [input.now]
 */
export function evaluateParticipation({
  userId,
  participation = [],
  recentPayouts = [],
  walletChanges = [],
  clusterHit = false,
  now = Date.now(),
} = {}) {
  const signals = [];
  let score = 0;

  const uid = String(userId || "");
  const mine = participation.filter((row) => String(row.userId) === uid);

  // No signal is not a bad signal. Someone who plays entirely through Discord,
  // or blocks everything, produces nothing here and must score clean — this
  // must never become "you didn't let us fingerprint you, so you're suspect".
  if (!mine.length) {
    return { band: BANDS.NORMAL, score: 0, signals: ["no_signal"], rulesVersion: RULES_VERSION };
  }

  // ── Identities per device ────────────────────────────────────────────────
  const myDevices = new Set(mine.map((r) => r.deviceHash).filter(Boolean));
  let worstSharing = 1;
  for (const device of myDevices) {
    const identities = new Set(
      participation.filter((r) => r.deviceHash === device).map((r) => String(r.userId)),
    );
    worstSharing = Math.max(worstSharing, identities.size);
  }

  if (worstSharing >= THRESHOLDS.IDENTITIES_PER_DEVICE_SUSPICIOUS) {
    // Four or more identities on ONE device reaches review on its own. A family
    // of five sharing a single tablet is possible, which is exactly why this
    // lands at SUSPICIOUS (a human looks) and not HELD (money stops). The
    // deliberate shape of this engine: one strong signal earns a look, two
    // strong signals stop the payout.
    score += 55;
    signals.push("many_identities_one_device");
  } else if (worstSharing >= THRESHOLDS.IDENTITIES_PER_DEVICE_ELEVATED) {
    score += 25;
    signals.push("several_identities_one_device");
  } else if (worstSharing > THRESHOLDS.IDENTITIES_PER_DEVICE_OK) {
    score += 10;
    signals.push("shared_device");
  }

  // ── Shared network ONLY — explicitly worth almost nothing ────────────────
  // Recorded so a reviewer can see it was considered, scored at a token amount
  // so it can never on its own move a band. A household must not be flagged.
  const myNets = new Set(mine.map((r) => r.netHash).filter(Boolean));
  const netSharers = new Set(
    participation.filter((r) => myNets.has(r.netHash)).map((r) => String(r.userId)),
  );
  if (netSharers.size > 1 && worstSharing <= THRESHOLDS.IDENTITIES_PER_DEVICE_OK) {
    score += 2;
    signals.push("shared_network_only");
  }

  // ── Wallet swapped right after being paid ────────────────────────────────
  // The move the owner described: collect, move the tokens on, relink, repeat.
  const paidTimes = recentPayouts
    .filter((p) => String(p.userId) === uid && p.paidTs)
    .map((p) => Number(p.paidTs));
  let swapsAfterPayout = 0;
  for (const change of walletChanges) {
    const at = Number(change?.ts || 0);
    if (!at) continue;
    if (paidTimes.some((paid) => at > paid && at - paid <= THRESHOLDS.WALLET_SWAP_AFTER_PAYOUT_MS)) {
      swapsAfterPayout += 1;
    }
  }
  if (swapsAfterPayout >= 2) {
    score += 40;
    signals.push("repeated_wallet_swap_after_payout");
  } else if (swapsAfterPayout === 1) {
    score += 20;
    signals.push("wallet_swap_after_payout");
  }

  // ── Answer cadence ───────────────────────────────────────────────────────
  const timed = mine.filter((r) => r.answerBucket);
  if (timed.length >= THRESHOLDS.FAST_ANSWER_MIN_SAMPLE) {
    const fast = timed.filter((r) => r.answerBucket === "under_1s").length;
    if (fast / timed.length >= THRESHOLDS.FAST_ANSWER_RATIO) {
      score += 30;
      signals.push("machine_like_answer_cadence");
    }
  }

  // ── Funding-cluster hit ──────────────────────────────────────────────────
  // Computed elsewhere (walletBans.findBannedLink) because it needs the chain.
  // Weighted heavily: it is the one signal already proven on real abuse here.
  if (clusterHit) {
    // The only signal here already proven against real abuse on this project,
    // and the faucet refuses outright on it. On the payout path it earns a
    // review by itself — same "one strong signal = look" rule as above.
    score += 55;
    signals.push("linked_to_banned_wallet");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { band: bandFor(score), score, signals, rulesVersion: RULES_VERSION };
}

/** Enabled separately from enforcement — Stage 3 scores, Stage 4 acts. */
export function riskEngineEnabled() {
  return String(process.env.QUIZ_RISK_ENGINE_ENABLED || "").toLowerCase() === "true";
}

export function riskEnforcementEnabled() {
  return String(process.env.QUIZ_RISK_ENFORCEMENT_ENABLED || "").toLowerCase() === "true";
}
