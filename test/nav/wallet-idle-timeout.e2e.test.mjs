// Browser test for the wallet idle auto-disconnect in
// src/public/assets/wallet-auth.js.
//
// A connected session used to persist indefinitely, so an unlocked machine
// stayed one click away from contributing, voting or redeeming as its owner.
// This drives the real script in real Chromium rather than unit-testing the
// timer, because the behaviour that matters is emergent: a localStorage
// clock shared across tabs, a polling interval, and listeners on real DOM
// events.
//
// The idle threshold has a 60s floor (a bad override must not make the site
// unusable), which is far too long for a test — so instead of shortening the
// timeout, these tests age the stored activity timestamp and wait for the
// watcher's own 15s poll to fire. That exercises the shipped code path with
// no test-only branch in production code.
//
// Requires Chromium once: `npx playwright install chromium`. If it isn't
// installed the whole file skips rather than fails, matching site-nav.e2e.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'src', 'public');

// The watcher polls every 15s; allow a margin for browser scheduling.
const POLL_WAIT_MS = 19_000;
const SESSION_KEY = 'winlew.verify.session';
const ACTIVITY_KEY = 'winlew.verify.lastActivity';

let server;
let baseUrl;
let browser;
let chromiumAvailable = true;

before(async () => {
  const app = express();
  app.use(express.static(PUBLIC_DIR));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch (err) {
    chromiumAvailable = false;
    console.warn(`[wallet-idle.e2e] Skipping: Chromium unavailable (${err.message}).`);
  }
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

// Opens a page with a connected session already in localStorage, with its
// last-activity timestamp aged by `idleForMs`.
async function openWithSession(idleForMs) {
  const context = await browser.newContext();
  await context.addInitScript(([sessionKey, activityKey, ageMs]) => {
    localStorage.setItem(sessionKey, 'test-session-token');
    localStorage.setItem('winlew.verify.app', 'mole');
    localStorage.setItem('winlew.verify.wallet', 'TestWa11etAddress1111111111111111111111111');
    localStorage.setItem(activityKey, String(Date.now() - ageMs));
  }, [SESSION_KEY, ACTIVITY_KEY, idleForMs]);

  const page = await context.newPage();
  // /faucet/ loads wallet-auth.js and has the nav connect button.
  await page.goto(`${baseUrl}/faucet/`, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

const readSession = (page) => page.evaluate((k) => localStorage.getItem(k), SESSION_KEY);

describe('wallet idle auto-disconnect', () => {
  test('clears a session that has been idle past the threshold', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    const { context, page } = await openWithSession(10 * 60 * 1000); // 10 min idle
    try {
      assert.equal(await readSession(page), 'test-session-token', 'session should start present');

      await page.waitForFunction(
        (k) => !localStorage.getItem(k),
        SESSION_KEY,
        { timeout: POLL_WAIT_MS },
      );

      assert.equal(await readSession(page), null, 'idle session should have been cleared');
      // The wallet label must go too — a stale "connected" pill after a
      // disconnect is exactly the false sense of safety this guards against.
      assert.equal(
        await page.evaluate(() => localStorage.getItem('winlew.verify.wallet')),
        null,
        'cached wallet should be cleared with the session',
      );
      await page.waitForSelector('#winlewIdleNotice', { timeout: 5000 });
    } finally {
      await context.close();
    }
  });

  test('keeps a session that is still active', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    const { context, page } = await openWithSession(5 * 1000); // 5s idle — fresh
    try {
      await new Promise((r) => setTimeout(r, POLL_WAIT_MS));
      assert.equal(
        await readSession(page),
        'test-session-token',
        'an active session must survive a poll tick',
      );
      assert.equal(await page.locator('#winlewIdleNotice').count(), 0);
    } finally {
      await context.close();
    }
  });

  test('real interaction refreshes the idle clock', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // Starts almost-expired, then a genuine keypress should reset it — this
    // is the case that would break if the listeners were attached wrongly
    // (wrong target, missing capture, or throttled into never firing).
    const { context, page } = await openWithSession(4 * 60 * 1000 + 50 * 1000);
    try {
      await page.keyboard.press('a');
      await new Promise((r) => setTimeout(r, POLL_WAIT_MS));
      assert.equal(
        await readSession(page),
        'test-session-token',
        'a keypress should have reset the idle clock',
      );
    } finally {
      await context.close();
    }
  });

  test('activity in another tab keeps the first tab connected', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // Same origin, so both tabs share the localStorage clock. Being busy in
    // one tab must not disconnect the other.
    const { context, page } = await openWithSession(4 * 60 * 1000 + 50 * 1000);
    try {
      const second = await context.newPage();
      await second.goto(`${baseUrl}/quiz/`, { waitUntil: 'domcontentloaded' });
      await second.keyboard.press('b');

      await new Promise((r) => setTimeout(r, POLL_WAIT_MS));
      assert.equal(
        await readSession(page),
        'test-session-token',
        'activity in a sibling tab should keep this tab connected',
      );
      await second.close();
    } finally {
      await context.close();
    }
  });
});
