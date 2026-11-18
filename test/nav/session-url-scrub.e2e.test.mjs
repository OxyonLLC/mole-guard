// Browser-driven proof that /verify/ takes the session token out of the address
// bar WITHOUT logging the visitor out.
//
// Discord hands out /verify/?session=<token>, and that URL used to just stay
// there: in the address bar, in browser history, in any screenshot of the page,
// in the shared host's access log, and in whatever the user copied when asking
// for help. The token is a bearer credential — whoever holds it inside its life
// can link THEIR wallet to the account.
//
// The risk in removing it is precise and worth stating: the page's own flow read
// the session ONLY from the query string (hasUsableSession, getChallenge,
// verifyAndSync). Scrub the URL without first making those storage-aware and
// every visitor lands logged out on a page that says "didn't come from a Discord
// link?". That is why this is a browser test and not a source-shape one — the
// thing to prove is that the page still knows who you are afterwards.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'src', 'public');

const SESSION = 'SESSION_TOKEN_SHOULD_LEAVE_THE_ADDRESS_BAR_42';

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
    console.warn(`[session-url-scrub.e2e] Skipping: Chromium unavailable (${err.message}).`);
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openVerify() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(`${baseUrl}/verify/?session=${SESSION}&app=mole`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  return { context, page };
}

describe('/verify/ scrubs the session from the address bar', () => {
  test('the token is gone from the URL after load', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    const { context, page } = await openVerify();
    try {
      const url = page.url();
      assert.ok(!url.includes(SESSION), `the session token is still in the address bar: ${url}`);
      assert.ok(url.includes('/verify/'), `navigated somewhere unexpected: ${url}`);
    } finally {
      await context.close();
    }
  });

  test('it is not left in browser history either', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // replaceState, not pushState — going back must not resurrect the URL that
    // carried the credential.
    const { context, page } = await openVerify();
    try {
      const entries = await page.evaluate(() => window.history.length);
      assert.ok(entries <= 2, `history grew to ${entries} entries — pushState was used somewhere`);
    } finally {
      await context.close();
    }
  });

  test('THE ONE THAT MATTERS: the page still knows it is authenticated', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // If hasUsableSession() were still URL-only, scrubbing would make every
    // visitor look logged out. The banner is the visible symptom.
    const { context, page } = await openVerify();
    try {
      const bannerShown = await page.evaluate(() => {
        const el = document.getElementById('noSessionBanner');
        return Boolean(el && el.style.display === 'block');
      });
      assert.equal(bannerShown, false, 'the "no session" banner is showing despite a valid session');

      const stored = await page.evaluate(() => localStorage.getItem('winlew.verify.session'));
      assert.equal(stored, SESSION, 'the session was not persisted before the URL was scrubbed');
    } finally {
      await context.close();
    }
  });

  test('the dashboard link still carries a session', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // buildProfileHref() falls back to storage. If that fallback broke, the
    // dashboard would open logged out.
    const { context, page } = await openVerify();
    try {
      const href = await page.evaluate(() => document.getElementById('profileNavLink')?.href || '');
      assert.ok(href.includes('profile.html'), `profile link looks wrong: ${href}`);
      assert.ok(href.includes(SESSION), 'the dashboard link lost its session');
    } finally {
      await context.close();
    }
  });

  test('a visitor with no session still gets the recovery banner', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // The scrub must not have made "logged out" indistinguishable from
    // "logged in" — that would hide the only recovery path on the page.
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(`${baseUrl}/verify/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const bannerShown = await page.evaluate(() => {
        const el = document.getElementById('noSessionBanner');
        return Boolean(el && el.style.display === 'block');
      });
      assert.equal(bannerShown, true, 'a visitor with no session was not offered the Discord recovery path');
    } finally {
      await context.close();
    }
  });

  test('a returning visitor stays logged in on a bare /verify/', async (t) => {
    if (!chromiumAvailable) return t.skip('Chromium unavailable');
    // The real second visit: storage holds the session, the URL never will
    // again. This is the case the old URL-only check could not have handled.
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(`${baseUrl}/verify/?session=${SESSION}&app=mole`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      await page.goto(`${baseUrl}/verify/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const bannerShown = await page.evaluate(() => {
        const el = document.getElementById('noSessionBanner');
        return Boolean(el && el.style.display === 'block');
      });
      assert.equal(bannerShown, false, 'a returning visitor was treated as logged out');
    } finally {
      await context.close();
    }
  });
});
