// Exact arithmetic for HODL balance-rate rewards (owner decision 2026-11-13).
//
// Why: `Math.floor(100000 * 0.0012)` is 119, not 120, because 0.0012 has no
// exact binary form and the product lands at 119.99999999999999. Rounding down
// a value that is *meant* to be a whole number underpaid by one token. The fix
// is not an epsilon; it is never doing the multiplication in floating point:
//
//   - a rate is read from its exact decimal digits into an integer count of
//     10^-RATE_DECIMALS (a 0.12% rate is 1,200,000 nano-units, exactly);
//   - a balance is the on-chain integer amount in base units when the caller
//     has it (`balanceUnits` + `balanceDecimals`), or else the exact decimal
//     digits of the number it was given;
//   - every product, cap, comparison and pool-scaling division is BigInt, and
//     the only rounding is the policy's own: whole tokens, rounded down.
//
// The rule itself is unchanged (hodlEpochs.computeWeeklyAllocation documents it).

export const RATE_DECIMALS = 9;
const TEN = 10n;
const pow10 = (n) => TEN ** BigInt(n);

/** The shortest decimal string that round-trips `n` — what JavaScript prints —
 *  with any exponent expanded ("1.5e-7" -> "0.00000015"). Non-negative only. */
export function plainDecimal(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error(`not a non-negative finite number: ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const [mant, expStr] = s.toLowerCase().split("e");
  const exp = Number(expStr);
  const [intPart, fracPart = ""] = mant.split(".");
  const digits = intPart + fracPart;
  const point = intPart.length + exp;
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A non-negative decimal (string, number or bigint) as an integer count of
 * 10^-decimals units. `exact` (default) refuses digits beyond `decimals`
 * rather than silently dropping them; `floor` truncates them.
 */
export function toUnits(value, decimals, { mode = "exact" } = {}) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("negative amount");
    return value * pow10(decimals);
  }
  const s = typeof value === "number" ? plainDecimal(value) : String(value).trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`not a non-negative decimal: ${s}`);
  const intPart = m[1];
  const frac = m[2] || "";
  if (frac.length > decimals && mode === "exact" && /[1-9]/.test(frac.slice(decimals))) {
    throw new Error(`${s} has more than ${decimals} decimal places`);
  }
  return BigInt(intPart + frac.slice(0, decimals).padEnd(decimals, "0"));
}

/** Decimal places needed to hold a number's exact printed value. */
function decimalsOf(n) {
  const s = plainDecimal(n);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** A rate (e.g. 0.00105) as exact nano-units; throws if it needs more than 9 places. */
export function rateToNanos(rate) {
  return toUnits(typeof rate === "number" ? rate : String(rate), RATE_DECIMALS);
}

/** A participant's balance as exact base units: `{ units: bigint, decimals }`. */
export function balanceUnitsOf(p = {}) {
  if (p.balanceUnits !== undefined && p.balanceUnits !== null && p.balanceDecimals !== undefined && p.balanceDecimals !== null) {
    const decimals = Number(p.balanceDecimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error(`bad balanceDecimals ${p.balanceDecimals}`);
    const units = BigInt(p.balanceUnits);
    return { units: units > 0n ? units : 0n, decimals };
  }
  const n = Number(p.balance);
  if (!Number.isFinite(n) || n <= 0) return { units: 0n, decimals: 0 };
  const decimals = decimalsOf(n);
  return { units: toUnits(n, decimals), decimals };
}

/** floor(tokens x rate) in whole tokens, exactly. For examples such as "on 100,000 WinLEW". */
export function rewardForWholeTokens(tokens, rate) {
  return Number((BigInt(tokens) * rateToNanos(rate)) / pow10(RATE_DECIMALS));
}

/**
 * The balance-rate allocation, exactly.
 *
 * For each participant: counted = min(balance, maxQualifyingBalance);
 * raw = counted x rate[activeDays]; capped = min(raw, maxPerPerson). If the
 * capped total exceeds the pool, each is scaled by pool / total. Then whole
 * tokens, rounded down. The sum of amounts can never exceed the pool.
 *
 * @returns {{ rows: Array<{days, rate, rateAmount, amount}>, poolScale: number }}
 */
export function balanceRateAllocation(participants, { rates, weeklyPool, maxPerPerson, maxQualifyingBalance, maxRate }) {
  const maxNanos = rateToNanos(maxRate);
  const rateNanos = rates.map((r) => {
    const n = Number(r);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    const nanos = rateToNanos(r);
    return nanos > maxNanos ? maxNanos : nanos;
  });

  const balances = participants.map(balanceUnitsOf);
  const D = balances.reduce((m, b) => Math.max(m, b.decimals), 0);
  const DEN = pow10(D + RATE_DECIMALS); // every value below is a numerator over DEN tokens
  const maxQualifyingUnits = toUnits(maxQualifyingBalance, D, { mode: "floor" });
  const capN = toUnits(maxPerPerson, D + RATE_DECIMALS, { mode: "floor" });
  const poolN = toUnits(weeklyPool, D + RATE_DECIMALS, { mode: "floor" });

  const wanted = participants.map((p, i) => {
    const days = Math.min(7, Math.max(0, Math.floor(Number(p.activeDays) || 0)));
    const b = balances[i];
    const units = b.units * pow10(D - b.decimals);
    const counted = units < maxQualifyingUnits ? units : maxQualifyingUnits;
    const raw = counted * rateNanos[days];
    const capped = raw < capN ? raw : capN;
    return { days, rateNanos: rateNanos[days], raw, capped };
  });

  const total = wanted.reduce((s, w) => s + w.capped, 0n);
  const scaled = total > poolN;
  const rows = wanted.map((w) => ({
    days: w.days,
    rate: Number(w.rateNanos) / 10 ** RATE_DECIMALS, // display; the arithmetic used rateNanos
    rateAmount: Number(w.raw / DEN),
    amount: Number(scaled ? (w.capped * poolN) / (total * DEN) : w.capped / DEN),
  }));
  // Display only: the factor everyone was scaled by. The amounts above did not use it.
  const poolScale = scaled ? Number((poolN * 1_000_000_000n) / total) / 1_000_000_000 : 1;
  return { rows, poolScale };
}
