// Governance vote-weight pricing (2026-07-28) — see src/mole/governancePricing.js's
// file header for the full reasoning. Two groups of tests: pure math
// (computeVotePriceFromSamples, no I/O at all) and the thin storage-backed
// wrappers (recordPriceSample/getVotePriceInWinlew), which follow the same
// backup/restore discipline as test/mole/governanceStore.test.mjs so a test
// run can never touch real data.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_PATH = path.resolve(__dirname, '..', '..', 'data', 'governance_price_samples.json');
const BACKUP_PATH = `${SAMPLES_PATH}.test-backup`;
let existedBefore = false;

let computeVotePriceFromSamples, recordPriceSample, getVotePriceInWinlew, USD_PER_VOTE, MAX_PURCHASED_VOTES_PER_PROPOSAL;

before(async () => {
  existedBefore = fs.existsSync(SAMPLES_PATH);
  if (existedBefore) fs.copyFileSync(SAMPLES_PATH, BACKUP_PATH);
  const mod = await import('../../src/mole/governancePricing.js');
  ({ computeVotePriceFromSamples, recordPriceSample, getVotePriceInWinlew, USD_PER_VOTE, MAX_PURCHASED_VOTES_PER_PROPOSAL } = mod);
});

after(() => {
  if (existedBefore) {
    fs.copyFileSync(BACKUP_PATH, SAMPLES_PATH);
    fs.unlinkSync(BACKUP_PATH);
  } else if (fs.existsSync(SAMPLES_PATH)) {
    fs.unlinkSync(SAMPLES_PATH);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

describe('computeVotePriceFromSamples — pure math, no I/O', () => {
  test('no samples in the 3-day window is a clean failure, not a crash or a fabricated price', () => {
    const r = computeVotePriceFromSamples([], { supply: 1_000_000_000 });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no_price_samples_in_window');
  });

  test('a sample older than 3 days is excluded from the average', () => {
    const samples = [{ tsIso: isoAgo(4 * DAY_MS), priceUsd: 0.5, marketCapUsd: 500_000_000 }];
    const r = computeVotePriceFromSamples(samples, { supply: 1_000_000_000 });
    assert.equal(r.ok, false, 'the one sample is outside the window, so there is nothing to average');
  });

  test('a brief spike is heavily diluted by a steady 3-day average (the real anti-manipulation defense)', () => {
    const steady = 0.00001;
    const samples = [
      { tsIso: isoAgo(2.9 * DAY_MS), priceUsd: steady, marketCapUsd: null },
      { tsIso: isoAgo(2 * DAY_MS), priceUsd: steady, marketCapUsd: null },
      { tsIso: isoAgo(1 * DAY_MS), priceUsd: steady, marketCapUsd: null },
      { tsIso: isoAgo(1000), priceUsd: steady * 10, marketCapUsd: null }, // 10x spike moments ago
    ];
    const r = computeVotePriceFromSamples(samples, { supply: 1_000_000_000 });
    assert.equal(r.ok, true);
    // Average of [1,1,1,10]x steady = 3.25x steady — nowhere near the full 10x
    // spike, proving one recent sample can't dominate the price used.
    assert.ok(r.avgPriceUsd < steady * 4, `expected the spike to be heavily diluted, got avgPriceUsd=${r.avgPriceUsd}`);
    assert.ok(r.avgPriceUsd > steady * 3, `expected the spike to still move the average some, got avgPriceUsd=${r.avgPriceUsd}`);
  });

  test('market-cap/supply divergence beyond threshold picks the LOWER price (higher WinLEW-per-vote, the conservative direction)', () => {
    const samples = [{ tsIso: isoAgo(DAY_MS), priceUsd: 0.001, marketCapUsd: 100_000 }]; // implies 0.0001 via MC/supply
    const supply = 1_000_000_000;
    const r = computeVotePriceFromSamples(samples, { supply });
    assert.equal(r.ok, true);
    assert.equal(r.usedCrossCheck, true);
    assert.equal(r.effectivePriceUsd, 0.0001, 'the lower (cross-check) price should win, not the higher spot average');
    assert.ok(r.winlewPerVote > USD_PER_VOTE / 0.001, 'a lower effective price must produce MORE WinLEW required per vote, never less');
  });

  test('market-cap/supply agreement within threshold uses the plain average, cross-check present but unused', () => {
    const samples = [{ tsIso: isoAgo(DAY_MS), priceUsd: 0.0001, marketCapUsd: 100_000 }]; // implies exactly 0.0001 too
    const r = computeVotePriceFromSamples(samples, { supply: 1_000_000_000 });
    assert.equal(r.ok, true);
    assert.equal(r.usedCrossCheck, false);
    assert.equal(r.effectivePriceUsd, r.avgPriceUsd);
  });

  test('missing/zero supply skips the cross-check entirely rather than dividing by zero', () => {
    const samples = [{ tsIso: isoAgo(DAY_MS), priceUsd: 0.0001, marketCapUsd: 100_000 }];
    const r = computeVotePriceFromSamples(samples, { supply: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.crossCheckPriceUsd, null);
    assert.equal(r.usedCrossCheck, false);
  });

  test('winlewPerVote is always positive and finite for any reasonable price', () => {
    const samples = [{ tsIso: isoAgo(DAY_MS), priceUsd: 0.00000001, marketCapUsd: null }];
    const r = computeVotePriceFromSamples(samples, { supply: 1_000_000_000 });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.winlewPerVote) && r.winlewPerVote > 0);
  });
});

describe('recordPriceSample + getVotePriceInWinlew — real storage round-trip', () => {
  test('a recorded sample is readable back through getVotePriceInWinlew', () => {
    recordPriceSample({ priceUsd: 0.00002, marketCapUsd: 20_000_000 });
    const r = getVotePriceInWinlew({ supply: 1_000_000_000 });
    assert.equal(r.ok, true);
    assert.ok(r.sampleCount >= 1);
  });

  test('a broken sample (zero/negative/non-finite price) is never recorded', () => {
    const before = getVotePriceInWinlew({ supply: 1_000_000_000 });
    recordPriceSample({ priceUsd: 0, marketCapUsd: 1000 });
    recordPriceSample({ priceUsd: -5, marketCapUsd: 1000 });
    recordPriceSample({ priceUsd: NaN, marketCapUsd: 1000 });
    const after = getVotePriceInWinlew({ supply: 1_000_000_000 });
    assert.equal(before.ok, after.ok);
    assert.equal(before.sampleCount, after.sampleCount, 'none of the broken samples should have been appended');
  });
});

describe('constants', () => {
  test('USD_PER_VOTE and MAX_PURCHASED_VOTES_PER_PROPOSAL match the decided pricing', () => {
    assert.equal(USD_PER_VOTE, 1);
    assert.equal(MAX_PURCHASED_VOTES_PER_PROPOSAL, 10);
  });
});
