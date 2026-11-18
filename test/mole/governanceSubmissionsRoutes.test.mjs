// Governance v1.1 — HTTP-level tests for the proposal submission review
// queue routes (gap 2). Starts the REAL server (src/mole/web.js's
// startWeb()) against an isolated scratch DATA_DIR and MONGO_ENABLED=false,
// so this never touches real sessions/wallets/submissions data or the live
// Mongo cluster — same isolation discipline as the RPC-failure walkthrough.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-submissions-route-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8798;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);
process.env.MOD_IDS = '__test_maintainer_id__';

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../src/mole/sessions.js';
import { readJson, writeJson } from '../../src/mole/storage.js';
import { PROPOSAL_CATEGORIES, GOVERNANCE_MODES } from '../../src/mole/governanceData.js';

const BASE = `http://127.0.0.1:${PORT}`;

// Goes through storage.js's own readJson/writeJson (not a raw fs write) so
// its in-memory managed-JSON cache — which web.js's route handlers read
// from — is updated too. A direct fs.writeFileSync here would be
// invisible to any route that already touched this file once (storage.js
// lazily caches a managed file's content on its first read).
function seedVerifiedWallet(discordUserId, wallet) {
  const existing = readJson('linked_wallets.json', {});
  const now = Math.floor(Date.now() / 1000);
  existing[discordUserId] = {
    wallet,
    wallets: { verified: { address: wallet, linked_at: now } },
    verified_at: now,
    verification_expires_at: now + 999999,
  };
  writeJson('linked_wallets.json', existing);
}

function validFields(overrides = {}) {
  return {
    title: `Route test proposal ${Date.now()}_${Math.random().toString(16).slice(2)}`,
    category: PROPOSAL_CATEGORIES.COMMUNITY,
    summary: 'A short honest summary.',
    problem: 'The problem this addresses.',
    proposedOutcome: 'The outcome we want.',
    requestedGovernanceMode: GOVERNANCE_MODES.ADVISORY,
    ...overrides,
  };
}

// The create route's rate limit is keyed by `${req.ip}:${req.path}` (see
// simpleRateLimit in web.js) — every test in this file hitting the same
// literal path would otherwise share ONE budget and collide with each
// other. `app.set("trust proxy", true)` is already on, so a distinct
// X-Forwarded-For per logical "actor" gives each test group its own
// independent rate-limit bucket, exactly like different real users behind
// different IPs would have — only the DEDICATED rate-limit test below
// reuses a single IP on purpose, to actually trip the limiter.
let ipCounter = 0;
function nextTestIp() {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

function postJson(url, body, ip) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body),
  });
}

function createSubmissionHttp(session, fieldsOverrides, ip) {
  return postJson(`${BASE}/api/governance/submissions`, { session, fields: validFields(fieldsOverrides) }, ip).then((r) => r.json());
}

let web;

before(async () => {
  web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});

after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  // startWeb()'s listening server keeps the event loop alive forever —
  // there is no server handle exposed to close(), so force the process to
  // exit once every test in this file has finished (both `node --test`
  // directly and the full-suite runner would otherwise hang here).
  setImmediate(() => process.exit(0));
});

describe('POST /api/governance/submissions', () => {
  test('an unauthenticated request (no/invalid session) is rejected', async () => {
    const res = await postJson(`${BASE}/api/governance/submissions`, { session: 'not-a-real-session', fields: validFields() }, nextTestIp());
    assert.equal(res.status, 401);
  });

  test('an authenticated session with no verified wallet is rejected', async () => {
    const discordUserId = '__test_user_unverified__';
    const session = createSession(discordUserId, 3600);
    const res = await postJson(`${BASE}/api/governance/submissions`, { session, fields: validFields() }, nextTestIp());
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error, 'verified_wallet_required');
  });

  test('a fully authenticated + verified-wallet submission succeeds and returns a receipt', async () => {
    const discordUserId = '__test_user_valid_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_valid_route__');
    const session = createSession(discordUserId, 3600);
    const body = await createSubmissionHttp(session, {}, nextTestIp());
    assert.equal(body.ok, true);
    assert.ok(body.submission.id, 'a submission receipt must include an id');
    assert.equal(body.submission.status, 'submitted');
  });

  test('unsafe content is rejected at the route with a specific field/reason, never partially accepted', async () => {
    const discordUserId = '__test_user_unsafe_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_unsafe_route__');
    const session = createSession(discordUserId, 3600);
    const body = await createSubmissionHttp(session, { problem: '<script>alert(1)</script>' }, nextTestIp());
    assert.equal(body.ok, false);
    assert.equal(body.error, 'raw_html_not_allowed');
    assert.equal(body.field, 'problem');
  });
});

describe('ownership boundaries on GET /api/governance/submissions/:id', () => {
  test('the owner can read their own submission in full', async () => {
    const discordUserId = '__test_user_owner_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_owner_route__');
    const session = createSession(discordUserId, 3600);
    const created = await createSubmissionHttp(session, {}, nextTestIp());

    const res = await fetch(`${BASE}/api/governance/submissions/${created.submission.id}?session=${session}`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.submission.id, created.submission.id);
  });

  test('a different authenticated user cannot read another user\'s private draft', async () => {
    const owner = '__test_user_owner_2_route__';
    const stranger = '__test_user_stranger_route__';
    seedVerifiedWallet(owner, '__test_wallet_owner_2_route__');
    seedVerifiedWallet(stranger, '__test_wallet_stranger_route__');
    const ownerSession = createSession(owner, 3600);
    const strangerSession = createSession(stranger, 3600);

    const created = await createSubmissionHttp(ownerSession, {}, nextTestIp());

    const res = await fetch(`${BASE}/api/governance/submissions/${created.submission.id}?session=${strangerSession}`);
    assert.equal(res.status, 404, 'must not leak existence via a 403 vs 404 distinction either');
  });

  test('listing "mine" never includes another user\'s submissions', async () => {
    const userA = '__test_user_mine_a_route__';
    const userB = '__test_user_mine_b_route__';
    seedVerifiedWallet(userA, '__test_wallet_mine_a_route__');
    seedVerifiedWallet(userB, '__test_wallet_mine_b_route__');
    const sessionA = createSession(userA, 3600);
    const sessionB = createSession(userB, 3600);
    await createSubmissionHttp(sessionA, {}, nextTestIp());
    await createSubmissionHttp(sessionB, {}, nextTestIp());
    const mineA = await fetch(`${BASE}/api/governance/submissions/mine?session=${sessionA}`).then((r) => r.json());
    assert.ok(mineA.submissions.length > 0);
    assert.ok(mineA.submissions.every((s) => s.discordUserId === userA));
  });
});

describe('maintainer-only routes', () => {
  test('a non-maintainer cannot list all submissions', async () => {
    const discordUserId = '__test_user_notmaintainer_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_notmaintainer_route__');
    const session = createSession(discordUserId, 3600);
    const res = await fetch(`${BASE}/api/governance/submissions?session=${session}`);
    assert.equal(res.status, 403);
  });

  test('a maintainer (MOD_IDS) can list all submissions and review one', async () => {
    const author = '__test_user_for_review_route__';
    seedVerifiedWallet(author, '__test_wallet_for_review_route__');
    const authorSession = createSession(author, 3600);
    const created = await createSubmissionHttp(authorSession, {}, nextTestIp());

    const maintainerSession = createSession('__test_maintainer_id__', 3600);
    const list = await fetch(`${BASE}/api/governance/submissions?session=${maintainerSession}`).then((r) => r.json());
    assert.equal(list.ok, true);
    assert.ok(list.submissions.some((s) => s.id === created.submission.id));

    const underReview = await postJson(`${BASE}/api/governance/submissions/${created.submission.id}/review`, { session: maintainerSession, toStatus: 'under-review' }).then((r) => r.json());
    assert.equal(underReview.ok, true);

    const rejectNoReason = await postJson(`${BASE}/api/governance/submissions/${created.submission.id}/review`, { session: maintainerSession, toStatus: 'rejected' });
    const rejectNoReasonBody = await rejectNoReason.json();
    assert.equal(rejectNoReason.status, 400);
    assert.equal(rejectNoReasonBody.error, 'reason_required');

    const rejected = await postJson(`${BASE}/api/governance/submissions/${created.submission.id}/review`, { session: maintainerSession, toStatus: 'rejected', reason: 'Not a fit for v1.' }).then((r) => r.json());
    assert.equal(rejected.ok, true);
    assert.equal(rejected.submission.status, 'rejected');
  });

  test('a non-maintainer cannot call the review endpoint even with a valid session', async () => {
    const discordUserId = '__test_user_review_attacker_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_review_attacker_route__');
    const authorSession = createSession(discordUserId, 3600);
    const created = await createSubmissionHttp(authorSession, {}, nextTestIp());

    const res = await postJson(`${BASE}/api/governance/submissions/${created.submission.id}/review`, { session: authorSession, toStatus: 'approved-for-drafting' });
    assert.equal(res.status, 403);
  });
});

describe('withdraw', () => {
  test('the owner can withdraw their own submission via the route', async () => {
    const discordUserId = '__test_user_withdraw_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_withdraw_route__');
    const session = createSession(discordUserId, 3600);
    const created = await createSubmissionHttp(session, {}, nextTestIp());

    const res = await postJson(`${BASE}/api/governance/submissions/${created.submission.id}/withdraw`, { session });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.submission.status, 'withdrawn');
  });
});

// Run LAST and deliberately reuses ONE fixed IP for every request so it
// alone exhausts that IP's create-route budget — every other test above
// used its own distinct nextTestIp(), so this is the only test that can
// ever observe a 429 from this route.
describe('rate limiting (dedicated, isolated IP)', () => {
  test('per-route rate limiting kicks in on rapid repeated submissions from the same IP', async () => {
    const discordUserId = '__test_user_ratelimit_route__';
    seedVerifiedWallet(discordUserId, '__test_wallet_ratelimit_route__');
    const session = createSession(discordUserId, 3600);
    const floodIp = '10.99.99.99';
    const results = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await postJson(`${BASE}/api/governance/submissions`, { session, fields: validFields({ title: `Rate limit test ${i}` }) }, floodIp);
      results.push(res.status);
    }
    assert.ok(results.includes(429), `expected at least one 429 among ${JSON.stringify(results)}`);
  });
});
