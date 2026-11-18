// The committed /roadmap/ must match what npm run roadmap:build produces.
//
// Register #22: the page shared no data source with the module registry, so it
// could contradict modulesData.js — or, worse because nothing could see it, say
// nothing at all about a module. Six live modules were missing that way until
// 2026-08-12. roadmapPageRegistry.test.mjs guards the facts a test can compute
// (the module count, the Bridge's retention, Phase 4/5 coverage); this file
// guards the rest, by asserting the generated cards are exactly what the
// registry currently implies.
//
// The failure this exists for: someone edits modulesData.js, does not re-run the
// build, and /roadmap/ silently describes the previous state.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MODULES, MODULE_STATUSES } from "../../src/mole/modulesData.js";
import {
  ROADMAP_PATH,
  REGION_IDS,
  applyToHtml,
  roadmapModules,
} from "../../src/scripts/build-roadmap.mjs";

const committed = readFileSync(ROADMAP_PATH, "utf8");

describe("/roadmap/ is generated from the module registry", () => {
  test("the committed page matches the generator's output", () => {
    assert.equal(
      applyToHtml(committed),
      committed,
      "src/public/roadmap/index.html is out of date with src/mole/modulesData.js. " +
        "Run `npm run roadmap:build` and commit the result — do not hand-edit " +
        "between the roadmap:generated markers.",
    );
  });

  test("regenerating twice changes nothing the second time", () => {
    // Guard the guard. If applyToHtml were not idempotent — say it appended
    // instead of replacing — the check above would still pass on a freshly
    // built file while the page grew a duplicate set of cards on every run.
    const once = applyToHtml(committed);
    assert.equal(applyToHtml(once), once, "applyToHtml is not idempotent");
  });

  test("every generated region is present and non-empty", () => {
    for (const regionId of REGION_IDS) {
      const start = committed.indexOf(`<!-- roadmap:generated:start ${regionId} -->`);
      const end = committed.indexOf(`<!-- roadmap:generated:end ${regionId} -->`);
      assert.notEqual(start, -1, `missing start marker for ${regionId}`);
      assert.notEqual(end, -1, `missing end marker for ${regionId}`);
      assert.ok(end > start, `${regionId} end marker precedes its start marker`);
      assert.match(
        committed.slice(start, end),
        /<div class="rmCard"/,
        `${regionId} generated no cards — a section that renders empty is the ` +
          `same silence #22 was about`,
      );
    }
  });

  test("every public, shippable module reaches the page or is explicitly excluded", () => {
    // Deliberately does NOT use roadmapModules() as its expectation — that is
    // the generator's own filter, so asserting against it would only prove the
    // filter agrees with itself. This states the rule independently: a module
    // that is public and neither internal nor historical must have a card,
    // unless it carries roadmapVisible: false. That way a future change to the
    // generator's filters cannot drop a module without this going red.
    const shippable = MODULES.filter(
      (m) =>
        m.publicVisibility !== false &&
        m.status !== MODULE_STATUSES.INTERNAL &&
        m.status !== MODULE_STATUSES.HISTORICAL,
    );
    assert.ok(shippable.length >= 20, `only ${shippable.length} shippable modules — check the filter`);

    const rendered = new Set(roadmapModules(MODULES).map((m) => m.id));
    const missing = shippable.filter((m) => !rendered.has(m.id) && m.roadmapVisible !== false);
    assert.deepEqual(
      missing.map((m) => m.id),
      [],
      `registry modules with no card on /roadmap/ and no roadmapVisible: false: ${missing
        .map((m) => m.id)
        .join(", ")}`,
    );
    // No second assertion that each card's text appears in the page: the
    // byte-exact match at the top of this file already proves that, and the
    // first draft here reimplemented the generator's HTML escaping to do it —
    // then failed on the four titles containing "&". A check that restates
    // what a stronger check already covers only adds somewhere to be wrong.
  });

  test("nothing internal or historical leaked onto the page", () => {
    const hidden = MODULES.filter(
      (m) => m.status === MODULE_STATUSES.INTERNAL || m.status === MODULE_STATUSES.HISTORICAL,
    );
    assert.ok(hidden.length > 0, "expected the registry to still hold internal/historical records");
    const leaked = hidden.filter((m) => committed.includes(`<h3>${m.title}</h3>`));
    assert.deepEqual(
      leaked.map((m) => m.id),
      [],
      `internal/historical modules must not appear on the public roadmap: ${leaked
        .map((m) => m.id)
        .join(", ")}`,
    );
  });
});
