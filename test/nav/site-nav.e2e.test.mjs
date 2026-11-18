// Browser-driven regression test for the shared site nav (src/public/assets/nav.css
// + nav.js). Serves src/public as static files on an ephemeral port and drives real
// Chromium via Playwright — no forced clicks; every interaction goes through
// Playwright's actionability checks (visible, stable, receiving pointer events)
// so a tap-interception bug fails the test instead of being silently bypassed.
//
// Requires Chromium to be installed once: `npx playwright install chromium`.
// If it isn't installed, this whole file is skipped (not failed) so `npm test`
// stays usable on machines that never run browser tests.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'src', 'public');

// Pages that load the shared nav (src/public/assets/nav.js + nav.css). One
// representative discord-bots policy page stands in for all twelve — they
// share byte-identical nav markup from the scripted retrofit, so testing
// every copy would just repeat the same assertions twelve times.
const PAGES = [
  { path: '/', label: 'Homepage' },
  { path: '/mole-hub/', label: 'Mole Hub (reference implementation)' },
  { path: '/quiz/', label: 'Quiz' },
  { path: '/faucet/', label: 'Faucet' },
  { path: '/leaderboards/', label: 'Leaderboards' },
  { path: '/whitepaper/', label: 'Whitepaper' },
  { path: '/transparency/', label: 'Transparency Center' },
  { path: '/burn/', label: 'Burn Center' },
  { path: '/partners/', label: 'Sponsors & Partners' },
  { path: '/xyo/', label: 'XYO Community Ecosystem' },
  { path: '/events/', label: 'Community Events' },
  { path: '/bounties/', label: 'Bounties' },
  { path: '/who-we-are/', label: 'Who We Are' },
  { path: '/governance/', label: 'Governance' },
  { path: '/governance/proposal/?id=gov-launch-2026', label: 'Governance proposal detail (Launch record)' },
  { path: '/governance/submit/', label: 'Governance submit a proposal' },
  { path: '/verify/', label: 'Verify' },
  { path: '/verify/profile.html', label: 'Dashboard (evolved from Profile, Version 2.2)' },
  { path: '/discord-bots/', label: 'Discord Bots hub' },
  { path: '/discord-bots/terms-mole.html', label: 'Discord Bots policy page (representative)' },
  { path: '/health/', label: 'Health' },
  { path: '/winlew-forge/', label: 'WinLEW Forge' },
  { path: '/modules/', label: 'Modules & Roadmap Status' },
  { path: '/modules/core-infrastructure.html', label: 'Module: Core Infrastructure (representative)' },
  { path: '/roadmap/', label: 'Roadmap (living document)' },
  { path: '/policies/', label: 'Policies & Legal hub' },
  { path: '/contact/', label: 'Contact' },
  { path: '/contribute/', label: 'Contribute' },
];

// The width at which the short primary link row is allowed to appear. Kept as
// a named constant because it is a real product decision with a measured
// value behind it, not a magic number: those five pills need 441px of content
// width and .navPrimary only receives that at roughly 1620px of viewport.
// Below it the row rendered as ellipsised stubs ("Hub" -> "Hu…"). See the
// matching comment in src/public/assets/nav.css.
const PRIMARY_ROW_MIN_WIDTH = 1620;

const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet-768', width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: 'desktop-1440', width: 1440, height: 900, isMobile: false, hasTouch: false },
  // Added 2026-08-20. Without a viewport above PRIMARY_ROW_MIN_WIDTH the
  // "row is visible when it fits" half of the contract would never run, and
  // the row could silently disappear at every width without a test noticing.
  { name: 'wide-1720', width: 1720, height: 900, isMobile: false, hasTouch: false },
];

// Known-noisy console *text* that isn't a nav bug: this test serves plain
// static files with no backend behind it, so page-specific app.js code that
// fetches an API (quiz leaderboard, faucet status, wallet balance) or an
// external price/stats ticker logs a network failure. That's a missing-
// backend/no-internet artifact of this test harness, not a navigation defect.
// It does NOT cover generic "Failed to load resource: 404" text, since that
// text never includes the URL — a real missing shared asset (nav.js, nav.css)
// would look identical. Those are instead checked precisely via 404 response
// tracking below, which DOES know the URL.
function isIgnorableConsoleMessage(text) {
  return (
    /leaderboard load failed/.test(text) ||
    /cycle load failed/.test(text) ||
    /Failed to fetch/.test(text) ||
    /loadStats/.test(text) ||
    // Chromium logs a URL-less generic console.error for every failed
    // resource load IN ADDITION TO the 'response' event this file already
    // inspects precisely (with the URL) via isIgnorable404. Suppressing the
    // generic text here avoids double-counting the same failure; the
    // response-based check below is what actually decides pass/fail.
    /^Failed to load resource: the server responded with a status of 404/.test(text)
  );
}

// A failed/404 response is only acceptable if it's an API call (no backend
// in this test harness) or a known third-party endpoint. Anything under the
// site's own static paths (assets, css, js) failing is a real bug — most
// notably the "missing shared asset on nested routes" failure class, where a
// document-relative reference like "assets/nav.js" 404s or resolves to HTML
// once the page lives under a subdirectory.
function isIgnorable404(url) {
  const u = new URL(url);
  return u.pathname.startsWith('/api/') || u.hostname !== '127.0.0.1';
}

let server;
let baseUrl;
let browser;
let chromiumAvailable = true;

before(async () => {
  const app = express();
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
  } catch (err) {
    // Skipping locally is deliberate — a contributor without Chromium should
    // still be able to run `npm test`. Skipping in CI is not: it silently drops
    // 90 assertions and reports green.
    //
    // This is not hypothetical. `npm audit fix` bumped playwright 1.61 -> 1.62
    // on 2026-08-08, which invalidated the installed browser, and the suite
    // quietly went from 951 passing to 861 passing + 90 skipped. Nothing
    // failed, so nothing drew attention to it.
    if (process.env.CI) {
      throw new Error(
        `Chromium is unavailable in CI (${err.message}). The e2e suite must RUN in CI, not skip — ` +
          `add "npx playwright install --with-deps chromium" to the workflow.`
      );
    }
    chromiumAvailable = false;
    console.warn(`[site-nav.e2e] Skipping: Chromium unavailable (${err.message}). Run "npx playwright install chromium" to enable this suite.`);
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openPage(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isIgnorableConsoleMessage(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    if (!isIgnorableConsoleMessage(err.message)) consoleErrors.push(`pageerror: ${err.message}`);
  });
  page.on('response', (res) => {
    if (res.status() === 404 && !isIgnorable404(res.url())) {
      consoleErrors.push(`404: ${res.url()}`);
    }
  });
  return { context, page, consoleErrors };
}

for (const viewport of VIEWPORTS) {
  describe(`nav @ ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    for (const { path: pagePath, label } of PAGES) {
      test(`${label} — ${pagePath}`, async (t) => {
        if (!chromiumAvailable) {
          t.skip('Chromium not installed');
          return;
        }
        const { context, page, consoleErrors } = await openPage(viewport);
        try {
          await page.goto(baseUrl + pagePath, { waitUntil: 'networkidle' });

          // Catches the class of bug found in the platform completeness
          // audit: a wide table (or any other unconstrained-width content)
          // silently making the whole PAGE scroll sideways on mobile,
          // rather than just the offending element scrolling within its
          // own container. scrollWidth still reports pre-clip content size
          // even once overflow-x:hidden is applied (that's how the DOM API
          // works), so this only catches genuinely-unclipped overflow —
          // exactly the case that's a real user-visible bug.
          const overflowsHorizontally = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
          );
          assert.equal(overflowsHorizontally, false, `${pagePath} must not cause horizontal page scroll at ${viewport.width}px (found scrollWidth > clientWidth)`);

          const toggleCount = await page.locator('.navToggle').count();
          assert.equal(toggleCount, 1, 'exactly one .navToggle button must exist');
          const toggle = page.locator('.navToggle').first();

          // Two-level nav (docs/site-navigation.md): the single full-menu
          // trigger is visible and functional at EVERY width, desktop
          // included — a dead, mobile-only hamburger was the exact defect
          // this shell replaced. The short primary row is the one thing
          // that differs by breakpoint: shown on desktop, hidden on
          // mobile/tablet (where even Home/Mole Hub/Quiz/Faucet only live
          // in the full menu).
          const toggleDisplay = await toggle.evaluate((el) => getComputedStyle(el).display);
          assert.notEqual(toggleDisplay, 'none', 'the menu trigger must be visible at every viewport width');

          const linksId = await toggle.getAttribute('aria-controls');
          assert.ok(linksId, 'toggle must have aria-controls pointing at the menu');
          const links = page.locator('#' + linksId);

          // Mole Hub/Quiz/Faucet intentionally keep their own pre-existing
          // arcade-style nav (marked by .arcadeLinks) rather than adopting
          // the canonical toggle-gated full menu — an explicit, named
          // exception (see nav.js's buildTwoLevelNav skip and
          // docs/site-navigation.md's "Intentional divergences"), not a
          // bug. At desktop width those pages show their full link row
          // unconditionally, same as before this shell existed; at mobile/
          // tablet they still collapse behind the toggle exactly like every
          // other page (covered by the mobile/tablet passes of this same
          // loop). Skip the open/close mechanics below for that one
          // desktop case — there's no "closed" state to open.
          const isArcadeAlwaysOpenDesktop = viewport.width > 860 && (await links.evaluate((el) => el.classList.contains('arcadeLinks')));
          if (isArcadeAlwaysOpenDesktop) {
            assert.equal(await links.isVisible(), true, 'arcade-style pages (Mole Hub/Quiz/Faucet) show their full link row unconditionally on desktop, by design');
            assert.deepEqual(consoleErrors, [], `no unexpected console errors on ${pagePath}`);
            return;
          }

          const primaryCount = await page.locator('.navPrimary').count();
          if (primaryCount > 0) {
            const primaryDisplay = await page.locator('.navPrimary').first().evaluate((el) => getComputedStyle(el).display);
            if (viewport.width >= PRIMARY_ROW_MIN_WIDTH) {
              assert.notEqual(primaryDisplay, 'none', 'the short primary link row must be visible once there is room for it');
            } else {
              assert.equal(
                primaryDisplay,
                'none',
                `the short primary link row must be hidden below ${PRIMARY_ROW_MIN_WIDTH}px — it does not fit there, and every destination is in the full menu`,
              );
            }
          }

          // The full menu panel must be closed by default at every width,
          // and open/close mechanics (mouse, keyboard, outside-click,
          // Escape) must work identically regardless of viewport — this is
          // the "desktop dropdown must actually work" requirement,
          // verified the same way mobile always was.
          assert.equal(await links.isVisible(), false, 'the full menu must be closed by default');

          await assert.doesNotReject(
            toggle.click(),
            'the menu trigger must be clickable with no invisible layer intercepting the click (a forced click is never used here — a real Playwright click fails loudly if something else receives the pointer event)'
          );
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'aria-expanded must flip to true on open');
          assert.equal(await links.isVisible(), true, 'menu must become visible after opening');

          // The panel must stay inside the viewport and not be clipped by
          // an ancestor's overflow/containing-block (the concrete defect:
          // .nav's backdrop-filter was silently clipping this panel to
          // .nav's own small box before it was made a direct <body> child).
          const panelBox = await links.boundingBox();
          assert.ok(panelBox, 'open menu panel must have a real, measurable box');
          assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width + 1, `menu panel must stay within the ${viewport.width}px viewport (got x=${panelBox.x}, width=${panelBox.width})`);

          // Every anchor in the open menu must have a real, non-placeholder href.
          const anchors = links.locator('a[href]');
          const anchorCount = await anchors.count();
          assert.ok(anchorCount > 0, 'menu must contain at least one link');
          for (let i = 0; i < anchorCount; i += 1) {
            const href = await anchors.nth(i).getAttribute('href');
            assert.ok(href && href !== '#' && !href.startsWith('javascript:'), `menu link ${i} must not be a placeholder href (got "${href}")`);
          }

          // Click/tap the first non-active (non-self) link to prove real
          // navigation works end-to-end, not just that the element is visible.
          const nonActive = links.locator('a.pill:not(.active)').first();
          const hasNonActive = (await nonActive.count()) > 0;
          if (hasNonActive) {
            const href = await nonActive.getAttribute('href');
            const isInternalSamePage = href.startsWith('#');
            const urlBefore = page.url();
            const activate = viewport.isMobile ? () => nonActive.tap() : () => nonActive.click();
            await assert.doesNotReject(activate(), 'activating a menu link must not be blocked by an intercepting element');
            // Wait for the navigation, not for a fixed duration. This was
            // waitForTimeout(300), which is a race: 300ms is ample on an idle
            // machine and not always enough during a full-suite run, so the
            // assertion below would intermittently compare the OLD url and fail
            // with actual === expected. Diagnosed 2026-08-08 after one failure
            // inside `npm test` and 3/3 passes in isolation.
            //
            // The .catch is deliberate: if navigation genuinely never happens,
            // the assertion below reports it with a message naming the href,
            // which a bare timeout error would not.
            if (!isInternalSamePage) {
              await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 10_000 }).catch(() => {});
            }
            await page.waitForTimeout(150);
            if (!isInternalSamePage) {
              assert.notEqual(page.url(), urlBefore, `activating "${href}" must navigate somewhere new`);
              const stillOpen = await page.evaluate(() => !!document.querySelector('.navFullMenuPanel.navOpen'));
              assert.equal(stillOpen, false, 'menu must not remain open after navigating to a new page');
              await page.goBack({ waitUntil: 'networkidle' });
            }
          }

          // Reopen, then verify Escape closes it AND returns focus to the trigger.
          await toggle.click();
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape must close the open menu');
          const focusedIsToggle = await page.evaluate(() => document.activeElement?.classList.contains('navToggle'));
          assert.equal(focusedIsToggle, true, 'focus must return to the trigger after Escape');

          // Reopen, then verify outside-click closes it.
          await toggle.click();
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
          await page.mouse.click(5, 5);
          await page.waitForTimeout(150);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'a click outside the menu must close it');

          // Reopening after a close must still work (no stuck state), and
          // keyboard activation (Enter) must work identically to a click.
          await toggle.focus();
          await page.keyboard.press('Enter');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'menu must be able to reopen via keyboard Enter after closing');
          await toggle.click();

          // Body scrolling must be restored after the menu closes — no
          // invisible overlay/scroll-lock left behind.
          const bodyOverflowAfterClose = await page.evaluate(() => document.body.classList.contains('navMenuLock'));
          assert.equal(bodyOverflowAfterClose, false, 'body scroll lock must be released once the menu is closed');

          assert.deepEqual(consoleErrors, [], `no unexpected console errors on ${pagePath}`);
        } finally {
          await context.close();
        }
      });
    }
  });
}
