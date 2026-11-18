// Vanity search estimator (§4).
//
// The estimator's job is to stop someone reading "expected 13 hours" as a
// deadline. Its numbers are only worth trusting because they reproduce a search
// that actually happened: W...CUNT, expected ~11.1 billion keys, found after
// 20.9 billion. These tests pin that agreement.
//
// The base58 leading-character bias is the part everyone gets wrong. An early
// estimate in this project was 21x too low because it assumed P(first char) =
// 1/58. It is not: it ranges from 1-in-17 to 1-in-999 depending on the
// character, because a 32-byte value encodes to 43 or 44 characters and the two
// length classes reach different first characters.
import test from "node:test";
import assert from "node:assert/strict";
import {
  leadingCharDistribution, patternProbability, estimate, leadingCharPenalty, ALPHABET,
} from "../../src/cunt/vanityEstimate.js";

const DIST = leadingCharDistribution();

test("the distribution is a real probability distribution", () => {
  // Guard the guard: if this does not sum to 1, every figure below is fiction.
  const sum = [...DIST.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sums to ${sum}, not 1`);
  assert.equal(DIST.size, 58, "every base58 character must have a probability");
  for (const [ch, p] of DIST) assert.ok(p >= 0 && p <= 1, `${ch} has impossible probability ${p}`);
});

test("the first character is NOT uniform — that is the whole point", () => {
  const uniform = 1 / 58;
  const best = Math.max(...DIST.values());
  const worst = Math.min(...DIST.values());
  assert.ok(best > uniform * 3, `best char should be far more likely than 1/58, got 1 in ${(1 / best).toFixed(0)}`);
  assert.ok(worst < uniform / 10, `worst char should be far less likely than 1/58, got 1 in ${(1 / worst).toFixed(0)}`);
  assert.ok(best / worst > 50, `spread should be dramatic, got ${(best / worst).toFixed(1)}x`);
});

test("W is an expensive letter, and the banked key proves it", () => {
  // W can only lead a 43-character pubkey. The banked W...CUNT address is 43
  // characters — the arithmetic confirming itself against a real key.
  const pW = DIST.get("W");
  assert.ok(pW > 0, "W must be reachable");
  assert.ok(1 / pW > 900, `W should be ~1 in 999, got 1 in ${(1 / pW).toFixed(0)}`);
  assert.ok(leadingCharPenalty("W") > 50, "W should be dramatically worse than the best character");

  const banked = "WhPApnQQXf33cJsfboHAijwQqSmfhLAudeBm4aNCUNT";
  assert.equal(banked.length, 43, "a W-leading pubkey can only be 43 characters");
  assert.equal(banked[0], "W");
});

test("matches the real W...CUNT search", () => {
  // Measured: ~253,000 keys/sec, hit after 20.9 billion keys in 24 hours.
  const e = estimate({ prefix: "W", suffix: "CUNT", keysPerSecond: 253_000 });
  assert.ok(
    e.expectedKeys > 10e9 && e.expectedKeys < 12e9,
    `expected ~11.1 billion, model says ${(e.expectedKeys / 1e9).toFixed(2)} billion`
  );
  // The actual run was ~1.85x the mean. A geometric process is still running
  // that long about 16% of the time — unlucky, not broken.
  const ratio = 20.9e9 / e.expectedKeys;
  assert.ok(ratio > 1.5 && ratio < 2.2, `actual/expected should be ~1.85, got ${ratio.toFixed(2)}`);
  const stillRunning = Math.exp(-ratio);
  assert.ok(stillRunning > 0.1 && stillRunning < 0.25, `~16% expected, got ${(stillRunning * 100).toFixed(1)}%`);
});

test("the probability curve is geometric, not a countdown", () => {
  const e = estimate({ prefix: "W", suffix: "CUNT", keysPerSecond: 253_000 });
  const at = (m) => e.byMultiple.find((b) => b.multiple === m).probability;

  // 1 - 1/e at the mean. This is THE number §4 exists to communicate: reaching
  // the "expected" time means a 37% chance of still searching.
  assert.ok(Math.abs(at(1) - 0.6321) < 0.001, `P(by 1x) should be 63.21%, got ${(at(1) * 100).toFixed(2)}%`);
  assert.ok(Math.abs(at(2) - 0.8647) < 0.001);
  assert.ok(Math.abs(at(3) - 0.9502) < 0.001);
  assert.ok(at(5) < 1, "it never reaches certainty — the tail is unbounded");

  // The median is well below the mean, which is why "expected" misleads.
  assert.ok(e.medianSeconds < e.expectedSeconds, "median must be below the mean");
  assert.ok(Math.abs(e.medianSeconds / e.expectedSeconds - Math.LN2) < 1e-9, "median = ln(2) x mean");
});

test("adding characters is exponential, and the first one is special", () => {
  const one = estimate({ prefix: "W", suffix: "CUNT", keysPerSecond: 1 }).expectedKeys;
  const two = estimate({ prefix: "We", suffix: "CUNT", keysPerSecond: 1 }).expectedKeys;
  const three = estimate({ prefix: "Wen", suffix: "CUNT", keysPerSecond: 1 }).expectedKeys;
  assert.ok(Math.abs(two / one - 58) < 0.01, "each character after the first costs exactly 58x");
  assert.ok(Math.abs(three / two - 58) < 0.01);
  // wen vs Wen: both lead with a rare-band character, so the cost is the same.
  const lower = estimate({ prefix: "wen", suffix: "CUNT", keysPerSecond: 1 }).expectedKeys;
  assert.ok(Math.abs(lower / three - 1) < 0.05, "w and W are in the same rarity band — same cost");
});

test("a cheap leading character is worth ~59x", () => {
  // The practical lesson: a prefix starting in the common band is dramatically
  // cheaper than one starting in the rare band, for the same length.
  const rare = estimate({ prefix: "W", suffix: "CUNT", keysPerSecond: 1 }).expectedKeys;
  const common = estimate({ prefix: "5", suffix: "CUNT", keysPerSecond: 1 }).expectedKeys;
  assert.ok(rare / common > 50, `expected >50x cheaper, got ${(rare / common).toFixed(1)}x`);
});

test("--ignore-case is cheaper, and that is the trap", () => {
  // §4 flags this: ignore-case makes the search ~2^n cheaper but returns a hit
  // in any casing, which is usually not what was wanted.
  const exact = patternProbability({ prefix: "W", suffix: "CUNT" });
  const loose = patternProbability({ prefix: "W", suffix: "CUNT", ignoreCase: true });
  assert.ok(loose > exact * 8, "ignoring case on 4 suffix chars should be far cheaper");
});

test("impossible and invalid patterns are refused, not estimated", () => {
  // 0, O, I and l are not in the base58 alphabet. Silently accepting them would
  // produce an estimate for a search that can never succeed.
  for (const bad of ["0", "O", "I", "l"]) {
    assert.throws(() => patternProbability({ prefix: bad }), RangeError, `"${bad}" must be rejected`);
    assert.ok(!ALPHABET.includes(bad));
  }
  assert.throws(() => estimate({ keysPerSecond: 1000 }), RangeError, "no pattern at all");
  assert.throws(() => estimate({ prefix: "W", keysPerSecond: 0 }), RangeError, "rate must be measured");
  assert.throws(() => estimate({ prefix: "W", keysPerSecond: -5 }), RangeError);
});

test("suffix-only searches ignore the leading-character bias", () => {
  // ...CUNT has no prefix, so every character is uniform: exactly 58^4.
  const e = estimate({ suffix: "CUNT", keysPerSecond: 1 });
  assert.ok(Math.abs(e.expectedKeys - Math.pow(58, 4)) < 1, `expected 58^4 = 11,316,496, got ${e.expectedKeys}`);
  assert.equal(e.leadingCharProbability, null, "no prefix means no leading-char term");
});
