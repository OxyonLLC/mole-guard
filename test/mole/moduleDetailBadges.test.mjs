// The /modules/ detail pages must agree with the registry about their own status.
//
// docs/modules-system.md states that the registry owns status/progress/phase and
// that nothing may hand-duplicate them — then all six detail pages hardcode a
// status badge and none fetches /api/modules/status. Only /modules/index.html
// renders from the registry. So the rule was stated but not enforced, and
// validate-modules.js could never catch a violation: it validates the registry
// and never opens these files. The 2026-08-04 audit found one page already
// saying "ONLINE", which is not one of the ten controlled values.
//
// WHY ENFORCE RATHER THAN RENDER. The doc's preferred fix was to have each page
// fetch its badge from the API, removing the duplication instead of policing it.
// That trade looks worse after working through the same question for /roadmap/:
// these are static pages a crawler can read and that keep working when the
// backend is down, and a status badge that renders empty during an outage — or
// says "loading" forever — is worse than one that is briefly stale. Build-time
// generation (the /roadmap/ pattern) would get both, and is the right answer if
// the duplication ever grows past one badge and one phase per page. For two
// fields it is heavier machinery than the failure justifies, so this pins them
// instead.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { MODULES, STATUS_LABELS, ROADMAP_PHASES } from "../../src/mole/modulesData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readPage(name) {
  return readFileSync(resolve(repoRoot, `src/public/modules/${name}`), "utf8")
    // Explanatory comments on these pages quote the OLD wrong value as the
    // record of what changed. Judge the markup, never the prose about it.
    .replace(/<!--[\s\S]*?-->/g, " ");
}

// Phase titles contain "&", written as &amp; in HTML and as a bare & in the
// registry. Comparing raw markup reports a mismatch on text that renders
// identically — a false positive this test produced on its first run.
function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8212;|&mdash;/g, "—");
}

/** The `Status: X` badge text, with tags stripped. */
function statusBadge(source) {
  const m = source.match(/<strong>Status:<\/strong>\s*([^<]+)</);
  return m ? decodeEntities(m[1]).trim() : null;
}

function phaseBadge(source) {
  const m = source.match(/<strong>Phase:<\/strong>\s*([^<]+)</);
  return m ? decodeEntities(m[1]).trim() : null;
}

// Pages whose route IS a module record's `route`.
const BY_ROUTE = MODULES.filter((m) => /^\/modules\/[a-z-]+\.html$/.test(String(m.route || "")));

test("the detail pages this guards are still routed from the registry", () => {
  // Guard the guard: if `route` values change shape, every case below vanishes
  // and the file passes while checking nothing.
  assert.ok(BY_ROUTE.length >= 5, `only ${BY_ROUTE.length} registry-routed detail pages found`);
});

describe("detail-page badges match their registry record", () => {
  for (const module of BY_ROUTE) {
    const file = module.route.replace("/modules/", "");
    test(`${file} — status`, () => {
      const badge = statusBadge(readPage(file));
      assert.ok(badge, `${file} has no "Status:" badge to check`);

      const label = STATUS_LABELS[module.status];
      // `partial` carries its percentage, e.g. "PARTIAL (40%)". Any other
      // status is the bare label.
      const expected = module.status === "partial" && module.progress != null
        ? `${label} (${module.progress}%)`
        : label;
      assert.equal(
        badge,
        expected,
        `${file} says "${badge}" while the registry says "${expected}" for ${module.id}. ` +
          `Only the ten values in STATUS_LABELS are allowed, and only the registry sets them.`,
      );
    });

    test(`${file} — phase`, () => {
      const badge = phaseBadge(readPage(file));
      if (!badge) return; // not every page carries a phase badge
      const phase = ROADMAP_PHASES.find((p) => p.phase === module.roadmapPhase);
      assert.ok(phase, `${module.id} has roadmapPhase ${module.roadmapPhase}, which no phase matches`);
      assert.equal(
        badge,
        `Phase ${phase.phase} — ${phase.title}`,
        `${file}'s phase badge disagrees with the registry for ${module.id}`,
      );
    });
  }

  test("games-trivia.html is not a module, and still may not invent a status", () => {
    // The one detail page with no record of its own: it is a shared docs[]
    // entry on `quiz` and `mole-hub`. It has a badge anyway, so it can drift
    // exactly like the others — it just has two records to answer to.
    const owners = MODULES.filter((m) =>
      (m.docs || []).some((d) => String(d.url).includes("games-trivia")),
    );
    assert.equal(owners.length, 2, `expected quiz and mole-hub to own games-trivia, found ${owners.length}`);

    const badge = statusBadge(readPage("games-trivia.html"));
    assert.ok(badge, "games-trivia.html has no Status badge");
    const distinct = [...new Set(owners.map((m) => STATUS_LABELS[m.status]))];
    assert.equal(
      distinct.length,
      1,
      `${owners.map((m) => `${m.id}=${m.status}`).join(", ")} no longer agree, so this page ` +
        `cannot state one status for both — it needs splitting or re-scoping.`,
    );
    assert.equal(badge, distinct[0], `games-trivia.html says "${badge}" but its owners are ${distinct[0]}`);
  });
});
