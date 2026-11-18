// Sync your account — the routes, driven with a real wallet signature.
//
// The model: the wallet IS the account. Connecting is free and gates nothing;
// syncing Discord or X is what unlocks being PAID. These tests drive the real
// server with a real ed25519 keypair, because the signature check runs before
// anything interesting happens and a stubbed one would test the wrong refusal.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-sync-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
// Fake but well-formed X credentials. Without these isXOAuthConfigured() is
// false and every X route short-circuits to 503, so the interesting behaviour
// would never be reached. Nothing here talks to X — only the authorize URL is
// built, which is local string work.
process.env.X_CLIENT_ID = 'test-x-client-id';
process.env.X_CLIENT_SECRET = 'test-x-client-secret';
process.env.X_REDIRECT_URI = 'http://127.0.0.1:8863/x-oauth-callback';
// These tests mint several anonymous wallets from one IP, which is exactly the
// shape the wallet-only burst detector auto-bans at THREE distinct wallets —
// it fired mid-suite and answered 403 ip_blocked instead of the account the
// assertions were about. Raised here rather than worked around, because the
// subject is which account a wallet joins, not burst detection.
process.env.WALLET_BURST_MAX_WALLETS = '50';
process.env.WALLET_BURST_MAX_EVENTS = '200';
const PORT = 8863;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE = `http://127.0.0.1:${PORT}`;
let session;
let accountId;

async function connectWallet() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const ch = await (await fetch(`${BASE}/api/hub/wallet-login/challenge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet }),
  })).json();
  const signature = JSON.stringify(
    Array.from(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)),
  );
  return (await fetch(`${BASE}/api/hub/wallet-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, signature, message: ch.message }),
  })).json();
}

before(async () => {
  const web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
  const login = await connectWallet();
  session = login.session;
  accountId = login.discordUserId;
});

after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});

describe('a wallet connects and becomes an account, with no hurdle', () => {
  test('a brand-new wallet gets a session and a wallet-rooted account', () => {
    assert.ok(session, 'connecting must not require anything else — that was the hurdle being removed');
    assert.match(accountId, /^wallet:[0-9a-f]{32}$/);
  });

  test('it can play, but cannot yet be paid', async () => {
    const res = await fetch(`${BASE}/api/account/identities`, { headers: { 'x-winlew-session': session } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.rootedIn, 'wallet');
    assert.equal(body.canBePaid, false, 'a wallet is free to generate, so it is not evidence of a person');
    assert.deepEqual(body.identities, []);
  });

  test('X availability tracks the credentials, in both directions', async () => {
    const body = await (await fetch(`${BASE}/api/account/identities`, { headers: { 'x-winlew-session': session } })).json();
    assert.equal(body.providers.discord.available, true);
    // Configured in this file's env, so it reads true here.
    assert.equal(body.providers.x.available, true);

    // The other direction is the one that matters for the UI: with any of the
    // three missing, the page must say "coming soon" rather than render a
    // button that cannot work. Checked against the predicate itself, because
    // the running server cannot un-configure itself mid-suite.
    const { isXOAuthConfigured } = await import('../../src/mole/xOAuth.js');
    assert.equal(isXOAuthConfigured({}), false, 'nothing set');
    assert.equal(isXOAuthConfigured({ X_CLIENT_ID: 'a' }), false, 'id alone is not enough');
    assert.equal(isXOAuthConfigured({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b' }), false,
      'without a redirect URI the token exchange has nothing to send');
    assert.equal(isXOAuthConfigured({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b', X_REDIRECT_URI: 'c' }), true);
  });

  test('the provider user id is never returned to the page', async () => {
    // It identifies a real person on another platform and the UI only needs to
    // know THAT a provider is synced.
    const raw = await (await fetch(`${BASE}/api/account/identities`, { headers: { 'x-winlew-session': session } })).text();
    assert.ok(!/providerUserId/.test(raw));
  });
});

describe('starting a sync', () => {
  test('it needs a session — an anonymous caller cannot nominate an account', async () => {
    const res = await fetch(`${BASE}/api/account/sync/discord/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });

  test('it returns a real Discord authorize URL', async () => {
    const body = await (await fetch(`${BASE}/api/account/sync/discord/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': session },
      body: JSON.stringify({ next: '/events/' }),
    })).json();
    assert.equal(body.ok, true);
    assert.match(body.url, /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  });

  test('the account id never travels in the state — the browser cannot forge one', async () => {
    const body = await (await fetch(`${BASE}/api/account/sync/discord/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': session },
      body: JSON.stringify({ next: '/events/' }),
    })).json();
    const state = new URL(body.url).searchParams.get('state');
    assert.ok(state && state.length > 8);
    assert.ok(!state.includes('wallet:'), 'the state is a server-side session id, not a payload');
    assert.ok(!state.includes(accountId));
  });

  test('a hostile return path is dropped rather than honoured', async () => {
    const body = await (await fetch(`${BASE}/api/account/sync/discord/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': session },
      body: JSON.stringify({ next: 'https://evil.example' }),
    })).json();
    assert.equal(body.ok, true, 'it falls back to a safe default rather than failing the sync');
  });
});

describe('unsync', () => {
  test('it needs a session', async () => {
    const res = await fetch(`${BASE}/api/account/unsync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'discord' }),
    });
    assert.equal(res.status, 401);
  });

  test('unsyncing something that was never synced is a 404, not a silent success', async () => {
    const res = await fetch(`${BASE}/api/account/unsync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': session },
      body: JSON.stringify({ provider: 'discord' }),
    });
    assert.equal(res.status, 404);
  });
});

// The nav's sign-in pill has to know what to OFFER before anyone is signed in.
// Until this endpoint existed it could only hardcode Discord, so a correct X
// credential on the server still produced no X button anywhere a visitor
// clicks. It is also the one-curl way to tell "not configured" apart from
// "configured but the process was never restarted".
describe('what this deployment can offer', () => {
  test('it answers without a session', async () => {
    const res = await fetch(`${BASE}/api/account/providers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.providers.discord.available, true);
    assert.equal(typeof body.providers.x.available, 'boolean');
  });

  test('X can both sign in and sync once it is configured', async () => {
    const body = await (await fetch(`${BASE}/api/account/providers`)).json();
    assert.equal(body.providers.x.canSignIn, true);
    assert.equal(body.providers.x.canSync, true);
    assert.equal(body.providers.discord.canSignIn, true);
  });

  test('X availability tracks the credentials, and agrees with what /identities reports', async () => {
    const body = await (await fetch(`${BASE}/api/account/providers`)).json();
    const configured = Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.X_REDIRECT_URI);
    assert.equal(body.providers.x.available, configured);
    assert.equal(body.providers.x.canSync, configured);

    const identities = await (await fetch(`${BASE}/api/account/identities`, {
      headers: { 'x-winlew-session': session },
    })).json();
    assert.equal(identities.providers.x.available, body.providers.x.available);
  });
});

// A callback URL is not a page. The owner opened /x-oauth-callback directly to
// test the integration on 2026-08-21, got `400 Missing code` on a blank page,
// and read it as a broken integration with a missing credential. It was
// neither — there is no `?code=` because only X's redirect puts one there.
describe('arriving at a callback with no authorization code', () => {
  for (const provider of ['x', 'discord']) {
    test(`${provider}: a direct visit explains what the URL is instead of saying "Missing code"`, async () => {
      const res = await fetch(`${BASE}/${provider}-oauth-callback`);
      assert.equal(res.status, 400, 'the request really is malformed');
      const html = await res.text();
      assert.ok(!html.includes('Missing code'), 'the two-word answer is what caused the confusion');
      assert.match(html, /callback URL, not a page/);
      assert.match(html, /\/verify\/profile\.html/, 'it points at a way out');
    });

    test(`${provider}: pressing Cancel on the consent screen is not reported as a fault`, async () => {
      const res = await fetch(`${BASE}/${provider}-oauth-callback?error=access_denied`);
      assert.equal(res.status, 200, 'a completed round trip whose answer was "no"');
      const html = await res.text();
      assert.match(html, /cancelled/i);
      assert.ok(!/not a page/.test(html), 'a decline is a different arrival from a hand-typed URL');
    });
  }

  test('no inline script — script-src is \'self\' and would block it', async () => {
    const html = await (await fetch(`${BASE}/x-oauth-callback`)).text();
    assert.ok(!/<script/i.test(html));
  });
});

// Signing in with X, not merely attaching it.
//
// The first cut of the chooser wired only the sync mode, so a visitor with no
// session still got Discord and nothing else — "when i click sign-in ONLY
// DISCORD LOADS". The premise is that not everyone has Discord, which is worth
// little if Discord is the only front door.
describe('signing in with X', () => {
  test('it needs no session — this is how the session comes into being', async () => {
    const res = await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 200, 'a 401 here would be a door that requires the key it hands out');
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  test('the authorize URL carries PKCE, and asks for no more than it needs', async () => {
    const body = await (await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })).json();
    const url = new URL(body.url);
    assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'), 'X rejects an authorize request without one');
    assert.ok(url.searchParams.get('state'));
    // offline.access would return a refresh token this flow never uses.
    assert.ok(!url.searchParams.get('scope').includes('offline.access'));
  });

  test('the state is an opaque server-side id — it never carries an account', async () => {
    const body = await (await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })).json();
    const state = new URL(body.url).searchParams.get('state');
    assert.ok(!state.includes('sync:'), 'the blob stays on the server; the browser holds only the id');
    assert.ok(!state.includes(accountId));
  });

  test('two sign-in attempts get different states and different challenges', async () => {
    const start = async () => (await (await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })).json()).url;
    const [a, b] = [new URL(await start()), new URL(await start())];
    assert.notEqual(a.searchParams.get('state'), b.searchParams.get('state'));
    assert.notEqual(a.searchParams.get('code_challenge'), b.searchParams.get('code_challenge'),
      'a reused verifier would make an intercepted code usable');
  });

  test('a hostile return path is not honoured', async () => {
    const res = await fetch(`${BASE}/api/account/signin/x/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next: 'https://evil.example' }),
    });
    assert.equal((await res.json()).ok, true, 'it falls back to a safe default rather than failing');
  });
});

// Which account does a wallet join?
//
// The owner's ordering: "Discord is our MAIN Gateway, but not everyone has
// this." So a Discord link on the wallet outranks everything; failing that, a
// signed-in person keeps the account they are already using; failing that, a
// new wallet-rooted account as before. Before this, connecting a wallet after
// signing in with X minted a fresh account and left the X-rooted one behind —
// losing your account by following the instructions.
describe('connecting a wallet while already signed in', () => {
  test('a proven account keeps its identity and gains the wallet', async () => {
    const { syncIdentity, IDENTITY_PROVIDERS } = await import('../../src/mole/syncedIdentities.js');
    const first = await connectWallet();
    // Stand in for a completed X round trip: the account is now proven.
    syncIdentity({
      accountId: first.discordUserId,
      provider: IDENTITY_PROVIDERS.X,
      providerUserId: `x-test-${Date.now()}`,
    });

    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const ch = await (await fetch(`${BASE}/api/hub/wallet-login/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': first.session },
      body: JSON.stringify({ wallet }),
    })).json();
    const signature = JSON.stringify(
      Array.from(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)),
    );
    const login = await (await fetch(`${BASE}/api/hub/wallet-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': first.session },
      body: JSON.stringify({ wallet, signature, message: ch.message }),
    })).json();

    assert.equal(login.ok, true);
    assert.equal(login.discordUserId, first.discordUserId,
      'the second wallet joined the account they were signed into, not a new one');
  });

  test('an UNPROVEN session does not absorb further wallets', async () => {
    // Anonymous wallet sessions have proved nothing, so letting one collect
    // wallets would make an account's membership depend on connection order.
    const first = await connectWallet();

    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const ch = await (await fetch(`${BASE}/api/hub/wallet-login/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': first.session },
      body: JSON.stringify({ wallet }),
    })).json();
    const signature = JSON.stringify(
      Array.from(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)),
    );
    const login = await (await fetch(`${BASE}/api/hub/wallet-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-winlew-session': first.session },
      body: JSON.stringify({ wallet, signature, message: ch.message }),
    })).json();

    assert.equal(login.ok, true);
    assert.notEqual(login.discordUserId, first.discordUserId);
  });

});
