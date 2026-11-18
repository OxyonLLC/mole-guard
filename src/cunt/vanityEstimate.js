// Vanity search estimator (§4).
//
// §4: "Expected time MUST be described probabilistically. Never imply '13 hours
// means it will finish within 13 hours.'"
//
// That warning is the whole reason this file exists. Vanity grinding is a
// memoryless (geometric) process: every key tried is an independent draw, and
// the ones already searched buy NO progress toward the next hit. "Expected
// 13 hours" means the average of a distribution whose median is only 0.69x the
// mean and whose tail is unbounded — there is a 37% chance of still running at
// 13 hours, and a 5% chance of still running at 39.
//
// The W...CUNT search is the worked example: expected 11.1 billion keys, took
// 20.9 billion. Nothing was wrong. That is the 14% tail.
//
// THE BASE58 LEADING-CHARACTER BIAS is computed exactly here, not assumed. A
// Solana pubkey is 32 random bytes, and base58 length boundaries make the FIRST
// character wildly non-uniform — some are ~57x more likely than others. Getting
// this wrong is what made an early estimate 21x too low.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58 = 58n;

const pow = (b, e) => b ** BigInt(e);
const TOTAL = pow(2n, 256); // every 32-byte value

/**
 * Exact probability that a uniformly random 32-byte pubkey encodes to a base58
 * string beginning with each character.
 *
 * Why it is not 1/58: a 32-byte value encodes to 43 or 44 characters depending
 * on its magnitude, and the first character is the leading digit of that
 * representation. 44-char encodings can only begin with indices 1..17; 43-char
 * encodings only with 3..57. So the two length classes cover different, partly
 * disjoint sets of first characters — which is why `W` can ONLY ever lead a
 * 43-character pubkey. The banked W...CUNT address is 43 characters, which is
 * this arithmetic confirming itself against a real key.
 *
 * @returns {Map<string, number>} character -> probability
 */
export function leadingCharDistribution() {
  const counts = new Map(); // char -> BigInt count of 32-byte values

  const add = (idx, n) => {
    if (n <= 0n) return;
    const ch = ALPHABET[idx];
    counts.set(ch, (counts.get(ch) ?? 0n) + n);
  };

  // A leading zero BYTE encodes as a literal '1'. For random bytes that is
  // P = 1/256 for one zero byte (further zeros are vanishingly rarer and are
  // covered by the same range).
  const zeroLead = pow(2n, 248); // values < 2^248 have byte[0] == 0
  add(0, zeroLead);

  const p43 = pow(B58, 42); // divisor for a 43-char encoding's first digit
  const p44 = pow(B58, 43); // divisor for a 44-char encoding's first digit

  // 43-character encodings: values in [2^248, 58^43)
  for (let i = 0; i < 58; i++) {
    const lo = BigInt(i) * p43;
    const hi = lo + p43;
    const from = lo > zeroLead ? lo : zeroLead;
    const to = hi < p44 ? hi : p44;
    add(i, to - from);
  }

  // 44-character encodings: values in [58^43, 2^256)
  for (let i = 0; i < 58; i++) {
    const lo = BigInt(i) * p44;
    const hi = lo + p44;
    const from = lo > p44 ? lo : p44;
    const to = hi < TOTAL ? hi : TOTAL;
    add(i, to - from);
  }

  const out = new Map();
  for (const ch of ALPHABET) {
    const c = counts.get(ch) ?? 0n;
    // Ratio via a scaled division — BigInt has no float division.
    out.set(ch, Number((c * 1_000_000_000_000n) / TOTAL) / 1e12);
  }
  return out;
}

const DIST = leadingCharDistribution();

/** Probability a single random pubkey matches the pattern. */
export function patternProbability({ prefix = "", suffix = "", ignoreCase = false } = {}) {
  for (const ch of prefix + suffix) {
    if (!ALPHABET.includes(ch) && !(ignoreCase && ALPHABET.includes(ch.toLowerCase()))) {
      throw new RangeError(`"${ch}" is not a base58 character — 0, O, I and l do not exist in base58`);
    }
  }

  let p = 1;
  if (prefix) {
    // First character carries the length bias; the rest are ~uniform.
    const first = prefix[0];
    if (ignoreCase) {
      const lo = DIST.get(first.toLowerCase()) ?? 0;
      const up = DIST.get(first.toUpperCase()) ?? 0;
      p *= lo + up;
    } else {
      p *= DIST.get(first) ?? 0;
    }
    const rest = prefix.length - 1;
    p *= Math.pow(ignoreCase ? 2 / 58 : 1 / 58, rest);
  }
  if (suffix) {
    p *= Math.pow(ignoreCase ? 2 / 58 : 1 / 58, suffix.length);
  }
  return p;
}

/**
 * A full estimate. `keysPerSecond` must be MEASURED on the machine that will
 * run the search — §4 requires it, and a benchmark from a different machine is
 * how a 13-hour estimate becomes a 13-day one.
 */
export function estimate({ prefix = "", suffix = "", ignoreCase = false, keysPerSecond }) {
  if (!prefix && !suffix) throw new RangeError("give a prefix, a suffix, or both");
  if (!(keysPerSecond > 0)) throw new RangeError("keysPerSecond must be measured and positive");

  const p = patternProbability({ prefix, suffix, ignoreCase });
  if (p <= 0) throw new RangeError("that pattern is impossible — no pubkey can begin with that character");

  const expectedKeys = 1 / p;
  const expectedSeconds = expectedKeys / keysPerSecond;

  // Geometric distribution. P(found within N attempts) = 1 - (1-p)^N, which for
  // small p is 1 - e^(-N*p). Expressed as multiples of the mean so the shape is
  // visible rather than a single misleading number.
  const byMultiple = [0.5, 1, 2, 3, 5].map((m) => ({
    multiple: m,
    seconds: expectedSeconds * m,
    probability: 1 - Math.exp(-m),
  }));

  return {
    prefix,
    suffix,
    ignoreCase,
    caseSensitive: !ignoreCase,
    leadingCharProbability: prefix ? DIST.get(prefix[0]) ?? 0 : null,
    constrainedChars: prefix.length + suffix.length,
    probabilityPerKey: p,
    expectedKeys,
    keysPerSecond,
    expectedSeconds,
    // The median is what people actually mean by "how long will it take".
    medianSeconds: expectedSeconds * Math.LN2,
    byMultiple,
  };
}

/** How much rarer this leading character is than the luckiest one. */
export function leadingCharPenalty(ch) {
  const best = Math.max(...DIST.values());
  const p = DIST.get(ch) ?? 0;
  return p > 0 ? best / p : Infinity;
}

export { ALPHABET };
