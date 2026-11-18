// Thousands separators for token amounts shown to people in Discord.
//
// The tempting one-liner here is Number(v).toLocaleString(), and it is wrong
// in a way that is easy to ship and hard to notice: it defaults to
// maximumFractionDigits: 3, so a real balance of 34864869.615257 renders as
// "34,864,869.615". On a faucet receipt a quietly rounded number is worse
// than an unformatted one, so these tests pin the exact strings.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatAmountWithCommas } from "../../src/faucet/amount.js";

test("formats the real values seen in Discord", () => {
  // Every one of these was copied from an actual bot reply.
  assert.equal(formatAmountWithCommas("950000000"), "950,000,000");            // !supply
  assert.equal(formatAmountWithCommas("13026704.34"), "13,026,704.34");        // !balance
  assert.equal(formatAmountWithCommas("34864869.615257"), "34,864,869.615257");// !whoami / !me
  assert.equal(formatAmountWithCommas("237255.5695"), "237,255.5695");         // !drip new total
});

test("never rounds — full precision survives", () => {
  const precise = "34864869.615257";
  assert.equal(formatAmountWithCommas(precise), "34,864,869.615257");
  // Guard the guard: prove the naive alternative really does lose digits, so
  // nobody "simplifies" this helper into it later.
  assert.notEqual(Number(precise).toLocaleString("en-US"), "34,864,869.615257");
});

test("does not lose precision at the top of the token's range", () => {
  // 950M with 6 decimals is 15 significant digits — right at the edge of a
  // double. Going through Number() is what would break here, so the helper
  // works on the string.
  assert.equal(formatAmountWithCommas("950000000.123456"), "950,000,000.123456");
});

test("handles numbers, zero, small fractions and negatives", () => {
  assert.equal(formatAmountWithCommas(1500), "1,500");
  assert.equal(formatAmountWithCommas(0), "0");
  assert.equal(formatAmountWithCommas("0.000001"), "0.000001");
  assert.equal(formatAmountWithCommas("-1234567.89"), "-1,234,567.89");
  assert.equal(formatAmountWithCommas("999"), "999");
  assert.equal(formatAmountWithCommas("1000"), "1,000");
});

test("hands back anything that is not a plain decimal, unmangled", () => {
  // These flow through the same reply templates when a balance is unknown.
  // Mangling them would put garbage in a user-facing message.
  assert.equal(formatAmountWithCommas(null), "");
  assert.equal(formatAmountWithCommas(undefined), "");
  assert.equal(formatAmountWithCommas("—"), "—");
  assert.equal(formatAmountWithCommas("n/a"), "n/a");
  assert.equal(formatAmountWithCommas("1,234"), "1,234"); // already formatted
});

test("every user-facing balance line in bot.js goes through the formatter", () => {
  // The point of the helper is consistency; a missed site is a raw number
  // sitting next to formatted ones. Catches new reply templates too.
  const src = readFileSync(new URL("../../src/faucet/bot.js", import.meta.url), "utf8");
  const offenders = [];
  const patterns = [
    /Balance: \$\{(?!fmtAmt)/,
    /balance: \$\{(?!fmtAmt)/,
    /New total: \$\{(?!fmtAmt)/,
    /Total supply: \$\{(?!fmtAmt)/,
  ];
  for (const line of src.split("\n")) {
    if (patterns.some((re) => re.test(line))) offenders.push(line.trim().slice(0, 100));
  }
  assert.deepEqual(
    offenders,
    [],
    `These reply lines print a raw amount without formatAmountWithCommas:\n  ${offenders.join("\n  ")}`
  );
});
