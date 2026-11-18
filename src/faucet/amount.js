// Exact decimal-string → base-unit BigInt conversion for SPL token amounts.
// No floating-point arithmetic anywhere in this file — that's the whole point.
// The old faucet.js did `BigInt(Math.round(DRIP_AMOUNT * (10 ** decimals)))`,
// which silently loses precision for many decimal/decimals combinations
// (e.g. 0.1 is not exactly representable in binary floating point). This
// module works entirely on strings/BigInt so the configured amount is
// represented exactly or the value is rejected outright — never rounded to
// something adjacent.

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Convert a decimal amount (string or number) to base units for a token with
 * the given number of decimals. Throws a descriptive error instead of
 * silently rounding or truncating.
 *
 * @param {string|number} input - e.g. "1000", "1000.5", "0.000001", 1000
 * @param {number} decimals - the mint's decimals (non-negative integer)
 * @returns {bigint} exact base-unit amount
 */
export function parseDecimalAmountToBaseUnits(input, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid_decimals:${decimals}`);
  }

  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('amount_empty');
  if (/[eE]/.test(raw)) throw new Error('amount_scientific_notation_not_supported');
  if (raw.startsWith('-')) throw new Error('amount_negative');
  if (raw.startsWith('+')) throw new Error('amount_leading_plus_not_supported');

  const match = DECIMAL_RE.exec(raw);
  if (!match) throw new Error(`amount_not_a_plain_decimal:${raw}`);

  const integerPart = match[1];
  const fractionPart = match[2] || '';

  if (fractionPart.length > decimals) {
    throw new Error(
      `amount_exceeds_mint_precision:${fractionPart.length}_digits_but_mint_has_${decimals}_decimals`
    );
  }

  const paddedFraction = fractionPart.padEnd(decimals, '0');
  const digits = `${integerPart}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  const baseUnits = BigInt(digits);

  if (baseUnits <= 0n) throw new Error('amount_must_be_positive');

  return baseUnits;
}

/**
 * Guard against a catastrophically misconfigured DRIP_AMOUNT (e.g. an extra
 * zero) rather than silently sending it. `maxDecimalAmount` is compared as a
 * plain decimal-string magnitude check (integer-digit-count based), so it
 * doesn't need floating point either.
 */
export function assertSafeDecimalAmount(input, { maxIntegerDigits = 12 } = {}) {
  const raw = String(input ?? '').trim();
  const match = DECIMAL_RE.exec(raw.replace(/^-/, ''));
  if (!match) throw new Error(`amount_not_a_plain_decimal:${raw}`);
  if (match[1].replace(/^0+(?=\d)/, '').length > maxIntegerDigits) {
    throw new Error(`amount_exceeds_safe_operational_limit:${raw}`);
  }
  return true;
}

/**
 * Thousands separators for a token amount that is about to be shown to a
 * person. `!supply` read "950000000", `!balance` read "13026704.34" and
 * `!whoami` read "34864869.615257" — all correct and all genuinely hard to
 * read at a glance.
 *
 * Deliberately string-based rather than Number(v).toLocaleString():
 *
 *  - toLocaleString() defaults to maximumFractionDigits: 3, so it SILENTLY
 *    rounds a balance. "34864869.615257" would have been shown as
 *    "34,864,869.615". Wrong numbers are worse than unformatted ones on a
 *    faucet receipt.
 *  - Going through Number at all costs precision at the top of this token's
 *    range (950M with 6 decimals is 15 significant digits, right at the edge
 *    of a double).
 *
 * Grouping the digits as text has neither problem. Anything that is not a
 * plain decimal — already-formatted text, an em dash, exponential notation —
 * is handed back untouched rather than mangled.
 *
 * @param {string|number|bigint|null|undefined} value
 * @returns {string}
 */
export function formatAmountWithCommas(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const [, sign, intPart, fracPart] = match;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

/**
 * Base units back to a human display string (for receipts/UI), given the
 * same exact-arithmetic guarantee in reverse.
 */
export function baseUnitsToDecimalString(baseUnits, decimals) {
  const units = BigInt(baseUnits);
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const s = abs.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals) || '0';
  const fracPart = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${out}` : out;
}
