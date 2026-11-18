import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimalAmountToBaseUnits,
  assertSafeDecimalAmount,
  baseUnitsToDecimalString,
} from '../../src/faucet/amount.js';

describe('amount: parseDecimalAmountToBaseUnits (exact, no floating point)', () => {
  test('integer amount', () => {
    assert.equal(parseDecimalAmountToBaseUnits('1000', 6).toString(), '1000000000');
  });
  test('fractional amount', () => {
    assert.equal(parseDecimalAmountToBaseUnits('1000.5', 6).toString(), '1000500000');
  });
  test('smallest unit for 6 decimals', () => {
    assert.equal(parseDecimalAmountToBaseUnits('0.000001', 6).toString(), '1');
  });
  test('0.1 at 1 decimal is exact (the classic float-imprecision case)', () => {
    // Math.round(0.1 * 10 ** 1) can drift for some amount/decimals pairs in
    // floating point; this must be exact regardless.
    assert.equal(parseDecimalAmountToBaseUnits('0.1', 1).toString(), '1');
  });
  test('accepts a number input too', () => {
    assert.equal(parseDecimalAmountToBaseUnits(1000, 6).toString(), '1000000000');
  });
  test('rejects zero', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('0', 6), /amount_must_be_positive/);
  });
  test('rejects negative', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('-5', 6), /amount_negative/);
  });
  test('rejects scientific notation', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('1e3', 6), /scientific_notation/);
  });
  test('rejects precision beyond the mint decimals', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('1.1234567', 6), /exceeds_mint_precision/);
  });
  test('rejects non-numeric input', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('abc', 6), /not_a_plain_decimal/);
  });
  test('rejects empty input', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('', 6), /amount_empty/);
  });
  test('rejects a leading plus sign', () => {
    assert.throws(() => parseDecimalAmountToBaseUnits('+5', 6));
  });
});

describe('amount: assertSafeDecimalAmount', () => {
  test('accepts a normal amount', () => {
    assert.ok(assertSafeDecimalAmount('1000'));
  });
  test('rejects a catastrophically large amount', () => {
    assert.throws(() => assertSafeDecimalAmount('999999999999999'), /exceeds_safe_operational_limit/);
  });
});

describe('amount: baseUnitsToDecimalString (inverse of parseDecimalAmountToBaseUnits)', () => {
  test('round-trips cleanly', () => {
    const cases = [['1000', 6], ['1000.5', 6], ['0.000001', 6], ['0.1', 1]];
    for (const [decimal, decimals] of cases) {
      const base = parseDecimalAmountToBaseUnits(decimal, decimals);
      assert.equal(baseUnitsToDecimalString(base, decimals), decimal);
    }
  });
});
