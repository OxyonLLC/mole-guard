// nav.js's NAV_GROUPS is the site's real menu — if a path is in there, every
// page on the site links to it. Three other places keep their own hardcoded
// copy of "the list of pages": PAGE_CONFIGS (which decides each page's nav
// identity), the header-audit tool's DEFAULT_ROUTES, and the nav e2e test's
// PAGES. Nothing kept them in step, and by 2026-08-05 all three had drifted
// from NAV_GROUPS by 8-14 routes.
//
// That was not cosmetic. PAGE_CONFIGS matching is EXACT, not by prefix, so the
// seven /ecosystem/ sister-project pages and /no-thank-you/promotions/ fell
// through to PAGE_CONFIGS[0] and rendered with the storefront's identity —
// its "WELCOME • LEARN • BEGIN" subtitle, its icon, and "Home" highlighted as
// the active link. Confirmed in a real browser before being fixed. Neither the
// header-audit tool nor the e2e test covered any of those pages, which is
// precisely why it survived so long.
//
// These tests parse the real files rather than importing them: nav.js is a
// browser IIFE with no exports, and header-audit.mjs starts a server on import.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

const navSource = read("src/public/assets/nav.js");

/** Slice a top-level `const NAME = [ … ];` array literal out of nav.js. */
function sliceArray(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} not found — nav.js structure changed`);
  const end = source.indexOf("\n  ];", start);
  assert.notEqual(end, -1, `end of ${declaration} not found`);
  return source.slice(start, end);
}

// Path constants used inside NAV_GROUPS instead of literals.
const pathConstants = Object.fromEntries(
  [...navSource.matchAll(/const ([A-Z_]+_PATH) = '([^']+)'/g)].map((m) => [m[1], m[2]])
);

const navGroupsBlock = sliceArray(navSource, "const NAV_GROUPS = [");
const navRoutes = [
  ...new Set([
    ...[...navGroupsBlock.matchAll(/path: *'([^']+)'/g)].map((m) => m[1]),
    ...[...navGroupsBlock.matchAll(/path: *([A-Z_]+_PATH)/g)].map((m) => pathConstants[m[1]]),
  ]),
].filter((p) => p && p.startsWith("/"));

test("NAV_GROUPS parsed sanely", () => {
  // Guard the guard: if the parse silently returns nothing, every test below
  // would pass vacuously.
  assert.ok(navRoutes.length >= 30, `only parsed ${navRoutes.length} nav routes — parser is broken`);
  assert.ok(navRoutes.includes("/quiz/"), "expected /quiz/ among parsed nav routes");
  assert.ok(navRoutes.includes("/about/"), "expected the ABOUT_PATH constant to resolve");
});

test("every nav route has an exact PAGE_CONFIGS entry", () => {
  const block = sliceArray(navSource, "const PAGE_CONFIGS = [");
  const covered = new Set(
    [...block.matchAll(/match: *\[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    )
  );
  const uncovered = navRoutes.filter((p) => !covered.has(p)).sort();
  assert.deepEqual(
    uncovered,
    [],
    "These pages are in the nav menu but have no PAGE_CONFIGS entry, so they fall back " +
      `to PAGE_CONFIGS[0] and render with the storefront's identity: ${uncovered.join(", ")}`
  );
});

test("header-audit covers every nav route", () => {
  const source = read("src/scripts/header-audit.mjs");
  const routes = new Set(
    [...sliceArray(source, "const DEFAULT_ROUTES = [").matchAll(/'([^']+)'/g)].map((m) => m[1])
  );
  const uncovered = navRoutes.filter((p) => !routes.has(p)).sort();
  assert.deepEqual(
    uncovered,
    [],
    `Nav routes the header audit never visits: ${uncovered.join(", ")}`
  );
});

test("header-audit lives outside the published web root", () => {
  // It is a build tool. Anything under src/public/ is served to the internet.
  assert.throws(
    () => read("src/public/scripts/header-audit.mjs"),
    "header-audit.mjs is back inside src/public/ — it would be downloadable from the live site"
  );
});
