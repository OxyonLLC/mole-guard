// Browser-driven proof that the mobile wallet hand-off no longer leaks the
// session token.
//
// Before this fix, tapping "Open in Phantom" navigated to
// `https://phantom.app/ul/browse/<encodeURIComponent(window.location.href)>` —
// and on any page reached from a Discord link that href is
// `…?session=<live token>`. So the token travelled in the path of an HTTPS
// request to Phantom and landed in their logs. wallet-auth.js is loaded by 56
// pages, so this was reachable from nearly anywhere on the site.
//
// The static guards in test/mole/verifyPageSecrecy.test.mjs read the source.
// This one runs it: real Chromium, a real session token in the URL, a real
// click, and an assertion on the URL the browser was actually sent to. Source
// reading cannot catch a leak that emerges from how the pieces compose at
// runtime — this can.
//
// The backend is stubbed via route interception rather than started, because
// what is under test is the client's composition of the URL, not the server
// (which test/mole/webHandoff.test.mjs covers directly).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'src', 'public');

// A recognisable, unmistakable token. If any of these characters reach a
// third-party URL the assertions below will say so loudly.
const SESSION = 'SESSIONTOKEN_MUST_NEVER_LEAVE_THE_ORIGIN_0123456789';
const HANDOFF_ID = 'handoffid_aaaaaaaaaaaaaaaaaaaaaa';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let server;
let baseUrl;
let browser;
let chromiumAvailable = true;

before(async () => {
  const app = express();
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch (err) {
    chromiumAvailable = false;
    console.warn(`[mobile-handoff.e2e] Skipping: Chromium unavailable (${err.message}).`);
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/**
 * Opens /verify/?session=… on a simulated iPhone, stubs the hand-off API, and
 * records every URL the page tries to navigate to (including the wallet
 * universal links, which are cross-origin and must be blocked rather than
 * followed).
 */
async function openMobileVerify({ startFails = false } = {}) {
  const context = await browser.newContext({
    userAgent: IPHONE_UA,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const navigations = [];
  const startRequests = [];

  await page.route('**/api/verify/handoff/start', async (route) => {
    startRequests.push(JSON.parse(route.request().postData() || '{}'));
    if (startFails) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'session_invalid' }) });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ handoffId: HANDOFF_ID, mode: 'direct', ttlSec: 120, pairingCode: '' }),
    });
  });

  // Catch the outbound wallet navigation without letting it leave.
  await page.route(/^https:\/\/(phantom\.app|solflare\.com)\//, async (route) => {
    navigations.push(route.request().url());
    await route.abort();
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  await page.goto(`${baseUrl}/verify/?session=${SESSION}&app=mole`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return { context, page, navigations, startRequests };
}

/**
 * Clicks the real "Open in Phantom" control. The panel it lives in
 * (#mobileWalletActions) starts hidden and is revealed by the connect-failure
 * path, which has its own test — what matters here is the click handler, so the
 * panel is simply shown first.
 */
async function clickPhantom(page) {
  await page.evaluate(() => {
    const el = document.getElementById('mobileWalletActions');
    if (el) el.style.display = 'block';
  });
  const btn = page.locator('#btnOpenPhantom');
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(800);
}

describe('mobile wallet hand-off does not leak the session token', () => {
  test('the URL handed to Phantom contains a hand-off id and no session token', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    const { context, page, navigations, startRequests } = await openMobileVerify();
    try {
      await clickPhantom(page);

      const walletUrls = navigations.filter((u) => /phantom\.app|solflare\.com/.test(u));

      // THE anti-vacuity assertion. The first version of this test used a
      // selector that matched nothing, so no click happened, walletUrls was
      // empty, and every check below was skipped — it passed with the leak
      // fully restored. A test that cannot fail is worse than no test, because
      // it is counted as coverage.
      assert.ok(
        walletUrls.length > 0,
        'No wallet navigation was captured, so this test proved nothing. Fix the selector.'
      );

      for (const url of walletUrls) {
        assert.ok(
          !url.includes(SESSION) && !url.includes(encodeURIComponent(SESSION)),
          `A wallet URL carries the session token:\n  ${url}`
        );
      }
      assert.ok(
        walletUrls.some((u) => u.includes(HANDOFF_ID)),
        `Wallet URL should carry the hand-off id:\n  ${walletUrls.join('\n  ')}`
      );
      assert.ok(startRequests.length > 0, 'the page never asked for a hand-off');
      assert.deepEqual(
        [...new Set(startRequests.map((r) => r.mode))],
        ['direct'],
        'the mobile path must request a DIRECT hand-off'
      );
    } finally {
      await context.close();
    }
  });

  test('no page load sends the session token to any third party', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // The original QR bug fired on load, with no click at all, because an <img>
    // fetches regardless of whether its <details> is open. This watches every
    // request the page makes for the token — the general form of that bug.
    const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const offenders = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith(baseUrl)) return; // same origin is fine
      if (url.includes(SESSION) || url.includes(encodeURIComponent(SESSION))) offenders.push(url);
    });
    try {
      await page.goto(`${baseUrl}/verify/?session=${SESSION}&app=mole`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      assert.deepEqual(offenders, [], 'these off-origin requests carried the session token');
    } finally {
      await context.close();
    }
  });

  test('a failed hand-off does not fall back to the leaking URL', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    const { context, page, navigations } = await openMobileVerify({ startFails: true });
    try {
      await clickPhantom(page);
      const leaked = navigations.filter((u) => !u.startsWith(baseUrl) && u.includes(SESSION));
      assert.deepEqual(leaked, [], 'the failure path navigated somewhere with the session token attached');
      // Fail closed means going nowhere at all, not going somewhere safer.
      assert.deepEqual(
        navigations.filter((u) => /phantom\.app|solflare\.com/.test(u)),
        [],
        'a failed hand-off still opened a wallet URL'
      );
    } finally {
      await context.close();
    }
  });
});
