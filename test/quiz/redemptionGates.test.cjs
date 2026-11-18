// Quiz redemption must run the same gates as the faucet.
//
// The abuse this exists for, observed 2026-08-14: buy a fraction of a token,
// pass a `balance > 0` check, redeem 1,500 WinLEW, move the payout to another
// wallet, repeat. The anti-abuse system built for the faucet — ban list,
// funding-cluster walk, configurable holder minimum — was never wired to this
// path. The whole src/quiz/ tree imported none of it, while a comment here
// claimed it "mirrors src/faucet/eligibility.js's existing holder check
// exactly".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Strip comments before judging ORDER or PRESENCE of code. This file's subject
// documents itself heavily — "db.redeemPoints()" and "balance > 0" both appear
// in prose — and matching raw source judges the commentary instead of the code.
// Four separate assertions in this session failed that way before this existed.
function codeOnly(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SRC = fs.readFileSync(path.join(__dirname, '../../src/quiz/redemption.js'), 'utf8');
const { REDEMPTION_REASONS } = require('../../src/quiz/redemption.js');

test('the gate is no longer a bare balance > 0', () => {
  // The exact expression that allowed dust to pass.
  assert.ok(
    !/if \(!\(balance > 0\)\)/.test(SRC),
    'redemption still refuses only a zero balance — a fraction of a token passes that',
  );
  assert.match(SRC, /balance >= minHold/, 'no configurable minimum is applied');
});

test('the holder minimum is configurable, and its default is called out as weak', () => {
  assert.match(SRC, /QUIZ_MIN_HOLDER_BALANCE/, 'no dedicated env var for the quiz minimum');
  // The default inherits the faucet's 1 WinLEW. That is a fraction of a cent
  // and must not be mistaken for protection just because a number exists.
  assert.match(SRC, /NOT a\s*\n\/\/ meaningful barrier|not a meaningful barrier/i,
    'the weak default is not flagged in the source');
});

test('the ban list and cluster walk are actually consulted', () => {
  assert.match(SRC, /walletBans\.js/, 'the ban module is never imported');
  assert.match(SRC, /findBannedLink\(/, 'the funding-cluster walk is never called');
  assert.equal(REDEMPTION_REASONS.WALLET_BANNED, 'wallet_banned');
  assert.equal(REDEMPTION_REASONS.LINKED_TO_BANNED, 'linked_to_banned');
});

test('a refusal never names the wallet that matched', () => {
  // Naming the matched address teaches a prober which wallet to stop funding
  // from — the same rule the faucet's refusals already follow.
  const banBlock = SRC.slice(SRC.indexOf('findBannedLink('), SRC.indexOf('findBannedLink(') + 1200);
  // `link.banned` is the boolean check and is fine; what must never appear in
  // the message is the ban record or the path that matched.
  assert.ok(
    !/error:[^\n]*link\.(ban\b|path)/.test(banBlock),
    'a ban refusal appears to disclose the matched wallet or path',
  );
  // And the user-facing sentence must not distinguish direct from linked.
  const messages = [...banBlock.matchAll(/error: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(new Set(messages).size, messages.length ? 1 : 0,
    `a linked-wallet refusal reads differently from a direct ban: ${messages.join(' / ')}`);
});

test('the ban check fails open, but a direct ban is local state', () => {
  // An RPC outage refusing every honest redeemer is worse than briefly missing
  // a linked wallet — the faucet made the same call for the same reason.
  assert.match(SRC, /catch \(error\) \{[\s\S]{0,200}ban check unavailable/,
    'an unreachable chain should not hard-fail the redemption');
});

test('the holder check still fails CLOSED on an unreadable balance', () => {
  // Different from the ban walk on purpose: "could not verify" must never be
  // treated as "eligible", because that is the gate protecting the payout.
  // The USE of the code, not its definition at the top of the file — the first
  // occurrence is the enum entry and proves nothing.
  const idx = SRC.indexOf('HOLDER_CHECK_UNAVAILABLE', SRC.indexOf('async function redeemQuizPoints'));
  assert.ok(idx > 0, 'the holder-check failure code is never used');
  assert.ok(SRC.slice(idx - 700, idx).includes('catch'),
    'an unreadable balance is not caught — "could not verify" must never mean "eligible"');
});

// ── System-only redemption (owner decision, 2026-08-14) ──────────────────────
//
// The reasoning, in the owner's words: the amount held was never the issue —
// a farmer sends the payout from wallet one to wallet two and keeps redeeming
// while the first cools off, so any per-wallet limit is beaten by owning
// another wallet. What cannot be faked is TIME. Take the timing out of the
// user's hands and "claim ten times a day" stops existing.
//
// Also economics: three 1,500-point redemptions cost three transactions in gas;
// the same points settled once at cycle close cost one.
const { redeemQuizPoints, REDEMPTION_REASONS: R } = require('../../src/quiz/redemption.js');

test('on-demand redeeming is off by default', async () => {
  delete process.env.QUIZ_MANUAL_REDEEM_ENABLED;
  const res = await redeemQuizPoints({ userId: 'test-user', amount: 1500, source: 'web' });
  assert.equal(res.ok, false);
  assert.equal(res.code, R.MANUAL_REDEEM_DISABLED);
});

test('the refusal says points are not lost', async () => {
  delete process.env.QUIZ_MANUAL_REDEEM_ENABLED;
  const res = await redeemQuizPoints({ userId: 'test-user', amount: 1500, source: 'web' });
  // A user told "you cannot claim" without being told "and you keep the points"
  // reasonably assumes the points are gone.
  assert.match(res.error, /keep counting|automatically|cycle closes/i,
    `refusal does not explain that points still accrue: ${res.error}`);
});

test('it refuses before touching the points ledger or the chain', async () => {
  // The switch must sit above the balance read: a closed path should cost no
  // RPC call, and must not mutate anything on its way to saying no.
  const code = codeOnly(SRC);
  const src = code.slice(code.indexOf('async function redeemQuizPoints'));
  const switchAt = src.indexOf('MANUAL_REDEEM_DISABLED');
  const balanceAt = src.indexOf('await getBalance');
  const redeemAt = src.indexOf('db.redeemPoints');
  assert.ok(switchAt > 0 && balanceAt > 0 && redeemAt > 0,
    `a marker was not found in code: switch=${switchAt} balance=${balanceAt} ledger=${redeemAt}`);
  assert.ok(switchAt > 0 && balanceAt > switchAt, 'the balance RPC runs before the switch');
  assert.ok(redeemAt > switchAt, 'the points ledger is touched before the switch');
});

test('both surfaces go through the one service', () => {
  // Discord's /redeem and the website both call redeemQuizPoints, so the switch
  // closes both. If a surface ever calls db.redeemPoints directly it bypasses
  // every gate in this file.
  const web = fs.readFileSync(path.join(__dirname, '../../src/mole/web.js'), 'utf8');
  const bot = fs.readFileSync(path.join(__dirname, '../../src/quiz/index.js'), 'utf8');
  for (const [name, src] of [['web.js', web], ['quiz/index.js', bot]]) {
    assert.ok(src.includes('redeemQuizPoints('), `${name} no longer calls the service`);
    assert.ok(!/db\.redeemPoints\(/.test(codeOnly(src)),
      `${name} calls db.redeemPoints directly, bypassing the gates`);
  }
});

test('the system-driven payout paths are untouched', () => {
  const db = fs.readFileSync(path.join(__dirname, '../../src/quiz/db.js'), 'utf8');
  // Closing the manual path must not close cycle close or the leaderboard
  // payout — those are how people actually get paid now.
  assert.match(db, /kind: 'cycle_payout'/);
  assert.match(db, /kind: 'leaderboard_payout'/);
});
