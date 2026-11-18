// Browser-driven regression test for the /verify/ "Connect wallet" fallback
// fixed 2026-07-17: no wallet extension exists on mobile browsers at all, and
// isMobileDevice()'s UA sniffing is unreliable (a mobile browser's "Desktop
// site" mode fools it), so the connect-failure path must reveal the
// any-wallet picker (#mobileWalletActions) whenever no provider is found —
// never a dead-end alert(), and never dependent on correctly guessing device
// type. A real headless Chromium context has no injected window.solana/
// window.geowallet/window.solflare by default, which is exactly the "no
// provider" condition this fix targets — no need to fake a device or spoof a
// UA to exercise it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'src', 'public');

let server;
let baseUrl;
let browser;
let chromiumAvailable = true;

before(async () => {
  const app = express();
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch (err) {
    chromiumAvailable = false;
    console.warn(`[verify-wallet-fallback.e2e] Skipping: Chromium unavailable (${err.message}).`);
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('/verify/ — connect-wallet fallback when no provider is injected', () => {
  test('clicking "Connect wallet" with no wallet extension reveals the any-wallet picker, not a dead-end alert', async (t) => {
    if (!chromiumAvailable) { t.skip('Chromium not installed'); return; }

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // A real alert() would hang the test waiting on a native dialog Playwright
    // never auto-dismisses unless handled — asserting none fires is itself
    // part of the regression check (the old code's non-mobile branch was a
    // bare alert("Wallet not detected...")).
    let dialogFired = false;
    page.on('dialog', async (dialog) => { dialogFired = true; await dialog.dismiss(); });

    await page.goto(`${baseUrl}/verify/`, { waitUntil: 'networkidle' });

    // Sanity: this headless context genuinely has no injected wallet, so the
    // fallback path is actually exercised, not skipped.
    const hasProvider = await page.evaluate(() => !!(window.solana || window.geowallet || window.solflare));
    assert.equal(hasProvider, false, 'test assumption: no wallet provider should be injected in a bare headless context');

    const picker = page.locator('#mobileWalletActions');
    await assert.rejects(picker.waitFor({ state: 'visible', timeout: 500 }), 'picker should start hidden before any connect attempt');

    await page.click('#btnConnect');
    await picker.waitFor({ state: 'visible', timeout: 3000 });

    assert.equal(dialogFired, false, 'no native alert() should fire — the picker is the fallback now, not a dead end');

    // The picker must offer GeoWallet explicitly, not just Phantom — the
    // second half of the reported bug (auto-connect silently defaulted to
    // Phantom only).
    await assert.doesNotReject(page.locator('#btnOpenGeoWallet').waitFor({ state: 'visible', timeout: 1000 }));
    await assert.doesNotReject(page.locator('#btnOpenPhantom').waitFor({ state: 'visible', timeout: 1000 }));
    await assert.doesNotReject(page.locator('#btnOpenSolflare').waitFor({ state: 'visible', timeout: 1000 }));

    const status = await page.locator('#walletStatus').textContent();
    assert.match(status, /no wallet extension or app detected/i);

    await context.close();
  });

  test('the fallback fires even when isMobileDevice() would misdetect a mobile UA as desktop (the reported "Desktop site" bug)', async (t) => {
    if (!chromiumAvailable) { t.skip('Chromium not installed'); return; }

    // Simulates a phone browser with "Desktop site" mode on: a plain desktop
    // UA/viewport with no injected wallet — isMobileDevice()'s regex (Android|
    // iPhone|iPad|iPod|Mobile, plus a Macintosh+touch special case) matches
    // neither, so the OLD code took the non-mobile branch straight into a
    // dead-end alert(). The fix doesn't consult isMobileDevice() at all for
    // this decision anymore, so this must pass identically to the test above.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    let dialogFired = false;
    page.on('dialog', async (dialog) => { dialogFired = true; await dialog.dismiss(); });

    await page.goto(`${baseUrl}/verify/`, { waitUntil: 'networkidle' });
    await page.click('#btnConnect');
    await page.locator('#mobileWalletActions').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(dialogFired, false);

    await context.close();
  });
});
