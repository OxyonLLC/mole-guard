// /modules/ must actually draw what the registry contains.
//
// It is the one page rendered entirely in the browser from
// /api/modules/status, so nothing in the repo proves a registry record reaches
// a visitor. modulesData.test.mjs validates the data and
// roadmapGenerated.test.mjs covers /roadmap/, which is generated — but between
// a correct registry and a correct page sits client-side rendering that no test
// exercised. A rendering regression would blank the status centre while every
// other test stayed green.
//
// Found the need for this on 2026-08-12: six live modules had no registry
// record at all, and neither /modules/ nor /roadmap/ could have told anyone.
// Having fixed the data, the display deserves the same treatment.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { MODULES, MODULE_STATUSES, getModulesStatusPayload } from "../../src/mole/modulesData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = resolve(repoRoot, "src/public");

let server;
let baseUrl;
let browser;
let chromiumAvailable = true;
let rendered = { cardTitles: [], cardCount: 0, statusPills: [], text: "" };

before(async () => {
  const app = express();
  app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  } catch {
    chromiumAvailable = false;
    return;
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  // ORDER MATTERS: Playwright tries the most recently registered route first,
  // so the catch-all goes on FIRST and the specific stub LAST. Registered the
  // other way round, the catch-all wins, /api/modules/status answers
  // {"ok":true} with no modules array, and the page correctly renders "No
  // modules match this filter" — which looks exactly like a broken page and
  // cost a real detour before the cause was found.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  // The real registry payload rather than a fixture: a fixture would let the
  // page and the registry drift apart, which is the failure this is guarding.
  await page.route("**/api/modules/status*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...getModulesStatusPayload() }),
    }),
  );
  await page.goto(`${baseUrl}/modules/`, { waitUntil: "networkidle" });
  rendered = await page.evaluate(() => ({
    // Card HEADINGS, not whole-page text. Matching module titles against
    // document.innerText false-positives against the roadmap-phase list on the
    // same page — "Leaderboards" is a Phase 3 item label as well as a module —
    // so a page rendering zero cards can look fully populated.
    cardTitles: [...document.querySelectorAll(".moduleCard h3")].map((h) => h.textContent.trim()),
    cardCount: document.querySelectorAll(".moduleCard").length,
    statusPills: [...new Set([...document.querySelectorAll(".statusPill")].map((p) => p.textContent.trim()))],
    text: document.body.innerText,
  }));
  await page.close();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
});

describe("/modules/ renders the registry", { skip: !chromiumAvailable }, () => {
  test("the page actually drew module cards", () => {
    // Guard the guard, and the assertion that would have caught the harness bug
    // above immediately: the page has three distinct empty states — a load
    // failure, "No modules match this filter", and the initial "Loading
    // modules…" — and all three leave plenty of surrounding text on the page.
    // Only a card count proves the render ran.
    assert.ok(
      rendered.cardCount >= 25,
      `only ${rendered.cardCount} module cards rendered — the page is showing an empty state`,
    );
    assert.ok(!/Could not load module status/i.test(rendered.text), "page showed its load-failure message");
    assert.ok(!/No modules match this filter/i.test(rendered.text), "page showed its empty-filter message");
    assert.ok(!/Loading modules/i.test(rendered.text), "page never got past its loading placeholder");
  });

  test("every publicly visible module appears", () => {
    const expected = MODULES.filter(
      (m) =>
        m.publicVisibility !== false &&
        m.status !== MODULE_STATUSES.INTERNAL,
    );
    assert.ok(expected.length >= 25, `only ${expected.length} public modules — check the filter`);
    const missing = expected.filter((m) => !rendered.cardTitles.includes(m.title)).map((m) => m.id);
    assert.deepEqual(
      missing,
      [],
      `registry modules that never reach the page: ${missing.join(", ")}`,
    );
  });

  test("the two PARTIAL modules are not presented as finished", () => {
    // Merch and the Forge are the records most likely to be read as promises.
    // Their own limitations text is what keeps that honest, so it has to render.
    for (const id of ["merch-store", "winlew-forge"]) {
      const m = MODULES.find((x) => x.id === id);
      assert.ok(m, `${id} missing from the registry`);
      assert.equal(m.status, MODULE_STATUSES.PARTIAL, `${id} is no longer PARTIAL — re-check this test`);
      assert.ok(rendered.cardTitles.includes(m.title), `${m.title} has no card on the page`);
    }
    assert.ok(
      rendered.statusPills.some((p) => /PARTIAL/i.test(p)),
      `no PARTIAL status pill rendered (saw: ${rendered.statusPills.join(", ")}), so a partial ` +
        `module is indistinguishable from a live one`,
    );
  });
});
