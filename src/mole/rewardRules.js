// Server-side reward-claim validation for the gaming hub.
//
// Reality check: the hub games are client-authoritative (score/wave/level math
// runs in the browser), so the server cannot independently prove a run happened.
// What it CAN do — and what this module does — is stop trusting the client's
// `payout` number outright:
//
//   1. Always apply the per-game economy scale and recompute
//      payout = round(balancedBaseReward * multiplier, 2) server-side.
//      A forged or stale client-side `payout` is simply ignored.
//   2. Constrain `multiplier` to the known reward-box set {0.5,1,1.5,2}.
//   3. Cap baseReward / per-claim payout per game, and per-user throughput
//      (rolling daily WinLEW + hourly claim count) as coarse anti-farm guards.
//
// Enforcement mode (REWARD_VALIDATION_MODE):
//   shadow           — recompute payout (so injection is closed), but treat the
//                      CAPS as log-only: bank baseReward*multiplier, just flag
//                      cap breaches. Rollout-only — do NOT run in production:
//                      a forged baseReward is banked and paid in full.
//   clamp (default)  — additionally clamp banked amount to the base/per-claim/
//                      daily caps. No error shown to the player.
//   reject           — any flag → the claim is refused (caller returns 400).
// Default moved shadow->clamp 2026-07-19 (security audit): clamp fails safe so
// an unset/typo'd env var can never silently re-open the drain.

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function csvNumbers(raw, fallback) {
  const parts = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parts.length ? parts : fallback;
}

function bool(v) {
  return ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
}

/**
 * Resolve the effective validation mode, with a guard: `shadow` banks forged
 * amounts in full (caps are log-only), so it is NEVER used unless explicitly
 * acknowledged with REWARD_ALLOW_SHADOW=true. Otherwise a `shadow` request
 * silently downgrades to the safe `clamp`. This makes it impossible to leave
 * the drain open by a single stray env var — you'd have to set two.
 *
 * Returns { requested, effective, acknowledged } so the boot guard can tell
 * the operator whether their shadow request was honored or overridden.
 */
export function resolveRewardMode(env = process.env) {
  const raw = String(env.REWARD_VALIDATION_MODE || "clamp").trim().toLowerCase();
  const requested = ["shadow", "clamp", "reject"].includes(raw) ? raw : "clamp";
  const acknowledged = bool(env.REWARD_ALLOW_SHADOW);
  const effective = requested === "shadow" && !acknowledged ? "clamp" : requested;
  return { requested, effective, acknowledged };
}

function nearestAllowed(allowed, value) {
  let best = allowed[0];
  let bestDist = Math.abs(value - best);
  for (const m of allowed) {
    const d = Math.abs(value - m);
    if (d < bestDist) { best = m; bestDist = d; }
  }
  return best;
}

export const GAME_REWARD_SCALES = Object.freeze({
  grubdrop: 0.08,
  tunneltap: 0.25,
  pacmole: 0.20,
  burrowblaster: 0.35,
  rootglide: 0.60,
  diglew: 0.75,
  molespades: 0.50,
  // Proposed starting value, not a confirmed final balance — see
  // src/public/mole-hub/js/games/mole-ice.js's offerRoundReward().
  moleice: 0.30,
});

export function getRewardRulesConfig(env = process.env) {
  // Defaults are grounded in the real economy: faucet drips ~1500/day, so games
  // are allowed a 4500/day (3x faucet) per-user ceiling — a user who also uses
  // the faucet can earn ~6000/day total. pacmole is the only unbounded scaler
  // (base = 100 + (level-1)*50); a 1250 base cap * 2x box = the 2500 per-claim
  // ceiling, i.e. honest play up to ~level 24 stays unflagged.
  const mode = resolveRewardMode(env).effective;
  const allowedMultipliers = csvNumbers(env.REWARD_ALLOWED_MULTIPLIERS, [0.5, 1, 1.5, 2]);
  const globalMaxBase = num(env.REWARD_MAX_BASE_REWARD, 1250);

  const perGameMaxBase = (game) => {
    const key = `REWARD_MAX_BASE_REWARD_${String(game || "").toUpperCase()}`;
    return num(env[key], globalMaxBase);
  };

  const rewardScale = (game) => {
    const gameKey = String(game || "").toLowerCase();
    const envKey = `REWARD_SCALE_${gameKey.toUpperCase()}`;
    return Math.max(0, num(env[envKey], GAME_REWARD_SCALES[gameKey] ?? 1));
  };

  return {
    mode,
    allowedMultipliers,
    rewardScale,
    perGameMaxBase,
    perClaimMaxPayout: num(env.REWARD_PER_CLAIM_MAX_PAYOUT, 2500),
    dailyMaxPayout: num(env.REWARD_DAILY_MAX_PAYOUT, 4500),
    hourlyMaxClaims: num(env.REWARD_HOURLY_MAX_CLAIMS, 60),
  };
}

/**
 * Validate one claim. `recentStats` = { dailyPayout, hourlyClaims } for this user
 * (already-banked totals in the rolling windows), used for throughput caps.
 *
 * Returns:
 *   {
 *     ok,            // no flags raised
 *     mode,
 *     flags: [...],  // machine-readable reasons
 *     clientPayout,  // what the browser claimed
 *     bankedPayout,  // what the server will record (depends on mode)
 *     baseReward, multiplier, serverMultiplier,
 *   }
 */
export function validateRewardClaim({ game, baseReward, multiplier, payout, recentStats, rewardMultiplier = 1 } = {}, config = getRewardRulesConfig()) {
  const flags = [];
  const rawBase = Math.max(0, num(baseReward, 0));
  const scale = typeof config.rewardScale === "function" ? config.rewardScale(game) : 1;
  // clientComparableBase (no reward multiplier) is what an honest client
  // could actually have computed — it has no way to know its own PoV/Clout
  // standing server-side, so the payout_mismatch check below must compare
  // against THIS, not the boosted `base`, or every legitimately-multiplied
  // claim would flag as tampered. `base` (WITH the multiplier) is what
  // drives every cap comparison and the banked amount instead — baked in
  // BEFORE those caps, so maxBase/perClaimMaxPayout/dailyMaxPayout already
  // account for it. Never applied after the caps — that would let a
  // boosted amount bypass the 2026-07-19 audit's ceilings instead of
  // riding inside them.
  const safeRewardMultiplier = Math.max(1, num(rewardMultiplier, 1));
  const clientComparableBase = round2(rawBase * scale);
  const base = round2(clientComparableBase * safeRewardMultiplier);
  const claimedMult = num(multiplier, 1);
  const clientPayout = round2(payout);
  const stats = recentStats || {};
  const dailyPayout = Math.max(0, num(stats.dailyPayout, 0));
  const hourlyClaims = Math.max(0, num(stats.hourlyClaims, 0));

  // (2) Multiplier must be a known reward-box value.
  let serverMultiplier = claimedMult;
  if (!config.allowedMultipliers.includes(claimedMult)) {
    flags.push("bad_multiplier");
    serverMultiplier = nearestAllowed(config.allowedMultipliers, claimedMult);
  }

  // (1) Recompute payout. `clientComparablePayout` is what an honest client
  // also computed (no reward multiplier knowledge) — compared against
  // clientPayout for tamper detection. `recomputed` (WITH the multiplier)
  // is the server-authoritative amount used everywhere below.
  const clientComparablePayout = round2(clientComparableBase * serverMultiplier);
  const recomputed = round2(base * serverMultiplier);
  if (Math.abs(clientPayout - clientComparablePayout) > 0.01) flags.push("payout_mismatch");

  // (3) Coarse caps — flagged always; enforced per mode below.
  const maxBase = config.perGameMaxBase(game);
  if (base > maxBase) flags.push("base_over_cap");
  if (recomputed > config.perClaimMaxPayout) flags.push("payout_over_cap");

  // Throughput (rolling per-user windows).
  if (hourlyClaims + 1 > config.hourlyMaxClaims) flags.push("hourly_cap");
  if (dailyPayout + recomputed > config.dailyMaxPayout) flags.push("daily_cap");

  // Decide the banked amount.
  let bankedPayout = recomputed;
  if (config.mode === "clamp") {
    const cappedBase = Math.min(base, maxBase);
    let amount = Math.min(round2(cappedBase * serverMultiplier), config.perClaimMaxPayout);
    const remainingDaily = Math.max(0, config.dailyMaxPayout - dailyPayout);
    amount = Math.min(amount, remainingDaily);
    if (hourlyClaims + 1 > config.hourlyMaxClaims) amount = 0; // over hourly cap → no new winnings
    bankedPayout = round2(amount);
  }
  // shadow + reject both bank the pure recomputed amount (reject is gated by the
  // caller on `ok` before we ever get here for an accepted claim).

  return {
    ok: flags.length === 0,
    mode: config.mode,
    flags,
    clientPayout,
    bankedPayout,
    rawBaseReward: rawBase,
    baseReward: base,
    multiplier: claimedMult,
    serverMultiplier,
    rewardMultiplier: safeRewardMultiplier,
  };
}
