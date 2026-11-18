import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startLocalStaging } from '../support/localStaging.mjs';
test('real synthetic reward lifecycle and unified profile integration', async t => {
  const { request, accounts: [A, B], evidence } = await startLocalStaging(t, { funded: true });
  t.after(() => fs.writeFileSync(path.join(process.env.WINLEW_TEST_ROOT, 'synthetic-integration.json'), JSON.stringify(evidence, null, 2)));
  const { GAME_REWARD_SCALES } = await import('../../src/mole/rewardRules.js');
  let total = 0;
  for (const game of ['diglew', 'pacmole', 'rootglide', 'burrowblaster', 'grubdrop', 'moleice', 'tunneltap', 'molespades']) {
    await t.test(game + ': server pricing, duplicate and history', async () => {
      const args = { guestId: 'integration-practice-guest', game, roundKey: `synthetic-full-flow:${game}`, baseReward: 100, multiplier: 1, payout: 999999 };
      const expected = Number((100 * GAME_REWARD_SCALES[game]).toFixed(2));
      const first = await request('/api/rewards/claim', args);
      assert.equal(first.status, 200); assert.equal(first.data.payout, expected); assert.equal(first.data.duplicate, false);
      const duplicate = await request('/api/rewards/claim', args);
      assert.equal(duplicate.status, 200); assert.equal(duplicate.data.duplicate, true);
      total += expected;
      const history = await request('/api/rewards/history?guest=integration-practice-guest');
      assert.equal(history.data.summary.totalPayout, total);
      assert.equal(history.data.history.filter(row => row.game === game).length, 1);
    });
  }
  await t.test('replayed round returns original banked amount despite altered payout inputs', async () => {
    const duplicate = await request('/api/rewards/claim', { guestId: 'integration-practice-guest', game: 'diglew',
      roundKey: 'synthetic-full-flow:diglew', baseReward: 9999, multiplier: 2, payout: 999999 });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.payout, 100 * GAME_REWARD_SCALES.diglew);
    assert.equal((await request('/api/rewards/history?guest=integration-practice-guest')).data.summary.totalPayout, total);
  });
  await t.test('guest-to-member transition moves all eight records exactly once', async () => {
    const body = { guestId: 'integration-practice-guest', localTotal: total };
    const first = await request('/api/rewards/reconcile', body, A.session);
    assert.equal(first.status, 200); assert.equal(first.data.movedRows, 8); assert.equal(first.data.migrationCredit, 0);
    const second = await request('/api/rewards/reconcile', body, A.session);
    assert.equal(second.data.movedRows, 0); assert.equal(second.data.total, total);
    assert.equal((await request('/api/rewards/history?guest=integration-practice-guest')).data.history.length, 0);
    const profile = await request('/api/profile/me', undefined, A.session);
    assert.equal(profile.status, 200); assert.equal(profile.data.games.history.length, 8);
    assert.equal(profile.data.games.summary.totalPayout, total);
    assert.equal(profile.data.proofOfValue.ok, true);
  });
  await t.test('account switching, logout and recovery preserve owner history', async () => {
    assert.equal((await request('/api/rewards/history', undefined, B.session)).data.history.length, 0);
    await request('/api/session/logout', {}, A.session);
    assert.equal((await request('/api/profile/me', undefined, A.session)).status, 401);
    const { createSession } = await import('../../src/mole/sessions.js');
    const recovered = createSession(A.id, 3600);
    A.session = recovered;
    assert.equal((await request('/api/rewards/history', undefined, recovered)).data.summary.totalPayout, total);
  });
  await t.test('faucet and quiz paths require sessions and cannot honor forged identities', async () => {
    for (const url of ['/api/faucet/status', '/api/quiz/me']) assert.equal((await request(url)).status, 401);
    assert.equal((await request('/api/faucet/claim', { discordUserId: A.id, wallet: A.wallet, amount: 999999 })).status, 401);
    assert.equal((await request('/api/quiz/play/next', {})).status, 401);
    assert.equal((await request('/api/quiz/play/answer', { choiceIndex: 0 })).status, 401);
  });
  await t.test('real quiz question, scoring, replay protection and dashboard agree', async () => {
    const next = await request('/api/quiz/play/next', { level: 'easy' }, A.session);
    assert.equal(next.status, 200); assert.equal(next.data.ok, true); assert.equal(next.data.done, undefined);
    const require = createRequire(import.meta.url);
    const question = require('../../src/quiz/questions.js').getPool('easy').find(row => row.q === next.data.q);
    assert.ok(question, 'question comes from the real existing easy pool');
    const choice = next.data.choices.indexOf(question.choices[question.answerIndex]); assert.ok(choice >= 0);
    assert.equal((await request('/api/quiz/play/answer', { instanceId: next.data.instanceId, choice }, B.session)).status, 404);
    const answer = await request('/api/quiz/play/answer', { instanceId: next.data.instanceId, choice }, A.session);
    assert.equal(answer.status, 200); assert.equal(answer.data.correct, true); assert.equal(answer.data.awarded, next.data.points);
    assert.equal((await request('/api/quiz/play/answer', { instanceId: next.data.instanceId, choice }, A.session)).status, 400);
    const profile = await request('/api/profile/me', undefined, A.session);
    assert.equal(profile.data.quiz.lifetimePoints, answer.data.awarded);
    assert.equal((await request('/api/quiz/me', undefined, B.session)).data.quiz.lifetimePoints, 0);
  });
  await t.test('eligible synthetic web faucet reserves one pending claim without signing or paying', async () => {
    const status = await request('/api/faucet/status', undefined, A.session);
    assert.equal(status.status, 200); assert.equal(status.data.eligibility.eligible, true, JSON.stringify(status.data.eligibility));
    const claim = await request('/api/faucet/claim', { requestId: 'integration-web-once', amount: 999999, wallet: B.wallet }, A.session);
    assert.equal(claim.status, 200); assert.equal(claim.data.ok, true); assert.equal(claim.data.pending, true);
    const { listClaimsSince } = await import('../../src/faucet/claimStore.js');
    const getClaimsForUser = async id => (await listClaimsSince()).filter(row => String(row.discordUserId) === String(id));
    const rows = await getClaimsForUser(A.id); assert.equal(rows.length, 1);
    assert.equal(rows[0].wallet, A.wallet); assert.equal(rows[0].status, 'reserved');
    assert.equal(rows[0].amountDisplay, '1000'); assert.equal(rows[0].signature ?? null, null);
    const repeated = await request('/api/faucet/claim', { requestId: 'integration-web-once' }, A.session);
    assert.notEqual(repeated.data.ok, true); assert.equal((await getClaimsForUser(A.id)).length, 1);
    assert.equal((await request('/api/faucet/claim/' + rows[0].id, undefined, B.session)).status, 404);
  });
  await t.test('concurrent zero-gap reconciliation and later retry never duplicate accounting', async () => {
    const guestId = 'integration-concurrent-zero-gap';
    const claim = await request('/api/rewards/claim', { guestId, game: 'diglew', roundKey: 'concurrent-zero-gap', baseReward: 20, multiplier: 1 });
    assert.equal(claim.status, 200);
    const expected = claim.data.payout;
    const body = { guestId, localTotal: expected };
    const results = await Promise.all(Array.from({ length: 4 }, () => request('/api/rewards/reconcile', body, B.session)));
    for (const result of results) {
      assert.equal(result.status, 200); assert.equal(result.data.migrationCredit, 0); assert.equal(result.data.total, expected);
    }
    assert.equal(results.reduce((sum, r) => sum + r.data.movedRows, 0), 1);
    const retry = await request('/api/rewards/reconcile', body, B.session);
    assert.equal(retry.data.migrationCredit, 0); assert.equal(retry.data.total, expected);
    const profile = await request('/api/profile/me', undefined, B.session);
    assert.equal(profile.data.games.history.length, 1); assert.equal(profile.data.games.summary.totalPayout, expected);
    assert.equal((await request('/api/profile/me', undefined, A.session)).data.games.summary.totalPayout, total);
  });
});
