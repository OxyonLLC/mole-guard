// POST /api/rewards/claim, driven against the real running server — the
// route every Mole Hub game's postRewardClaim() actually hits.
//
// The property being proven here is the one the whole games-payout audit
// turned on: the server never trusts the browser's own numbers. A forged or
// inflated client `payout` must be ignored and recomputed from
// baseReward * multiplier * the SERVER's own GAME_REWARD_SCALES entry, an
// over-cap claim must be clamped rather than paid in full, and the same
// {game, roundKey} submitted twice must bank exactly once.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewards-claim-route-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8875;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = `http://127.0.0.1:${PORT}`;

function guestId(label) {
  // sanitizeGuestId requires 8-64 chars of [a-zA-Z0-9_-].
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`.slice(0, 64);
}

async function claim(body) {
  const res = await fetch(`${BASE}/api/rewards/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function historyTotal(guest) {
  const res = await fetch(`${BASE}/api/rewards/history?guest=${encodeURIComponent(guest)}`);
  const data = await res.json();
  return Number(data?.summary?.totalPayout || 0);
}

before(async () => {
  const web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});

after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});

describe('server-authoritative claim pricing', () => {
  test('an honest claim is banked at the server-recomputed amount', async () => {
    const guest = guestId('honest');
    // diglew scale is 0.75 (rewardRules.js) -> base 100 * 0.75 = 75, * 1x multiplier = 75.
    const { status, body } = await claim({
      guestId: guest, game: 'diglew', roundKey: `r-${guest}`,
      baseReward: 100, multiplier: 1, payout: 75,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.payout, 75);
    assert.equal(await historyTotal(guest), 75);
  });

  test('a forged/inflated client payout is ignored and recomputed server-side', async () => {
    const guest = guestId('forged');
    // Claims baseReward 100 (honest scale -> 75) but asserts a wildly inflated payout.
    const { status, body } = await claim({
      guestId: guest, game: 'diglew', roundKey: `r-${guest}`,
      baseReward: 100, multiplier: 1, payout: 999999,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true, 'a payout_mismatch flag alone does not reject in clamp mode');
    assert.equal(body.payout, 75, 'the banked amount ignores the forged client payout entirely');
    assert.ok(body.flags.includes('payout_mismatch'));
    assert.equal(await historyTotal(guest), 75, 'nothing close to the forged 999999 was ever banked');
  });

  test('a claim over the per-game base cap is clamped, not paid in full', async () => {
    const guest = guestId('overcap');
    // diglew scale 0.75 * baseReward 5000 = 3750, above the 1250 default cap.
    const { status, body } = await claim({
      guestId: guest, game: 'diglew', roundKey: `r-${guest}`,
      baseReward: 5000, multiplier: 1, payout: 3750,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.flags.includes('base_over_cap'));
    assert.equal(body.payout, 1250, 'clamped to the per-game max base, not the full recomputed 3750');
    assert.equal(await historyTotal(guest), 1250);
  });

  test('an unknown multiplier is snapped to the nearest allowed reward-box value', async () => {
    const guest = guestId('badmult');
    const { body } = await claim({
      guestId: guest, game: 'diglew', roundKey: `r-${guest}`,
      baseReward: 100, multiplier: 7, payout: 700,
    });
    assert.equal(body.ok, true);
    assert.ok(body.flags.includes('bad_multiplier'));
    // scale 0.75 * base 100 = 75, nearest allowed multiplier to 7 is 2 -> 150.
    assert.equal(body.payout, 150);
  });

  test('mole-ice claims price through the real GAME_REWARD_SCALES.moleice entry', async () => {
    const guest = guestId('moleice');
    // moleice scale is 0.30 (rewardRules.js) -> base 200 * 0.30 = 60, * 1x multiplier = 60.
    const { status, body } = await claim({
      guestId: guest, game: 'moleice', roundKey: `r-${guest}`,
      baseReward: 200, multiplier: 1, payout: 60,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.payout, 60);
    assert.equal(await historyTotal(guest), 60);
  });
});

describe('duplicate-claim protection', () => {
  test('the same {game, roundKey} submitted twice banks exactly once', async () => {
    const guest = guestId('dup');
    const args = { guestId: guest, game: 'diglew', roundKey: `r-${guest}`, baseReward: 100, multiplier: 1, payout: 75 };
    const first = await claim(args);
    const second = await claim(args);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.duplicate, false);
    assert.equal(second.body.ok, true);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.payout, first.body.payout, 'the replay reports the original banked amount, not a new one');
    assert.equal(await historyTotal(guest), 75, 'banked once, not twice');
  });

  test('two concurrent submissions of the same roundKey still bank exactly once', async () => {
    const guest = guestId('race');
    const args = { guestId: guest, game: 'diglew', roundKey: `r-${guest}`, baseReward: 100, multiplier: 1, payout: 75 };
    const [a, b] = await Promise.all([claim(args), claim(args)]);
    const duplicateCount = [a, b].filter((r) => r.body.duplicate).length;
    assert.equal(duplicateCount, 1);
    assert.equal(await historyTotal(guest), 75);
  });
});

describe('identity requirements', () => {
  test('a claim with neither a session nor a guest id is refused', async () => {
    const { status, body } = await claim({ game: 'diglew', roundKey: 'no-identity', baseReward: 100, multiplier: 1, payout: 75 });
    assert.equal(status, 401);
    assert.equal(body.error, 'session_or_guest_required');
  });
});
