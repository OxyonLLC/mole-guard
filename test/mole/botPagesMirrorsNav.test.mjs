// Discord's !pages must teach the same site map as the website's nav.
//
// buildWebsiteLinks() in src/shared/command-inventory.js is hand-mirrored from
// nav.js's NAV_GROUPS, and its own comment says "if nav.js's groups/order
// change again, update this function too." On 2026-08-11 the nav was reordered
// and "START HERE" renamed to "LEARN & CONNECT"; this list was not updated, so
// for two days Discord users were handed a different site map — different
// ordering, an outdated group name, and no /contact/ at all.
//
// A comment asking the next person to remember is not a mechanism. nav.js is a
// classic browser script that cannot be imported into the bot's Node process,
// which is why the duplication exists — but a test can read both and compare,
// the same way navExternalLinks.test.mjs already parses nav.js.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildWebsiteLinks } from "../../src/shared/command-inventory.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const navSource = readFileSync(resolve(repoRoot, "src/public/assets/nav.js"), "utf8");

/** NAV_GROUPS as [{ title, paths }], comments stripped. */
function parseNavGroups() {
  const start = navSource.indexOf("const NAV_GROUPS = [");
  assert.notEqual(start, -1, "NAV_GROUPS not found — nav.js changed shape");
  const end = navSource.indexOf("\n  ];", start);
  assert.notEqual(end, -1, "end of NAV_GROUPS not found");
  // Comments are stripped first: the explanatory prose around NAV_GROUPS quotes
  // old labels and paths as the record of what changed, and matching those
  // would judge the commentary instead of the code.
  const body = navSource.slice(start, end).replace(/^\s*\/\/.*$/gm, " ");

  // Some entries write `path: ABOUT_PATH` rather than a literal, so resolve the
  // file's own `const NAME = '/path'` declarations first. Matching only string
  // literals silently drops those entries — which it did on this test's first
  // run, reporting /about/ and /roadmap/ as pages the nav does not have.
  const consts = new Map(
    [...navSource.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*'(\/[^']*)'/g)].map((m) => [m[1], m[2]]),
  );

  return body.split("title: '").slice(1).map((block) => {
    const title = block.slice(0, block.indexOf("'"));
    const entries = [...block.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]);
    const paths = [];
    for (const entry of entries) {
      const literal = entry.match(/path: '([^']*)'/);
      const named = entry.match(/path: ([A-Z][A-Z0-9_]*)/);
      if (literal) {
        // Internal routes only; external URLs are a documented exception below.
        if (literal[1].startsWith("/")) paths.push(literal[1]);
      } else if (named) {
        const resolved = consts.get(named[1]);
        assert.ok(
          resolved,
          `nav.js entry uses path constant ${named[1]}, which this test cannot resolve — ` +
            `it would silently drop that page from the comparison`,
        );
        paths.push(resolved);
      } else if (/label:/.test(entry)) {
        assert.fail(`nav.js entry has a label but no parsable path: ${entry.trim()}`);
      }
    }
    return { title, paths };
  });
}

const navGroups = parseNavGroups();
const botText = buildWebsiteLinks({ baseUrl: "https://winlew.co" });
const botGroupTitles = botText
  .split("\n")
  .filter((line) => line.startsWith("**"))
  .map((line) => line.replace(/\*\*/g, "").replace(/[^\p{L}&\s/]/gu, "").trim());

// nav.js keeps this group; !pages deliberately does not repeat it. That command
// answers "what pages does the site have", and !links already owns the external
// set. Asserted rather than assumed, so dropping any OTHER group still fails.
const BOT_OMITS = new Set(["THIRD-PARTY LINKS"]);

test("both sides parsed", () => {
  // Guard the guard: an empty parse on either side makes everything below vacuous.
  assert.ok(navGroups.length >= 6, `only parsed ${navGroups.length} nav groups`);
  assert.ok(botGroupTitles.length >= 5, `only parsed ${botGroupTitles.length} bot groups`);
  assert.ok(botText.length > 500, "bot catalog is suspiciously short");
});

describe("!pages mirrors nav.js", () => {
  test("group titles and their order match", () => {
    const expected = navGroups.map((g) => g.title).filter((t) => !BOT_OMITS.has(t));
    const actual = botGroupTitles.map((t) => t.toUpperCase());
    assert.deepEqual(
      actual,
      expected,
      "Discord's !pages lists groups in a different order or under different names than the " +
        "website nav, so the two teach different mental models of the same site.",
    );
  });

  test("every internal nav destination is reachable from !pages", () => {
    const missing = [];
    for (const group of navGroups) {
      for (const path of group.paths) {
        if (!botText.includes(`${path}>`)) missing.push(`${group.title}: ${path}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `pages in the website nav that !pages never mentions:\n${missing.join("\n")}`,
    );
  });

  test("!pages invents no destination the nav does not have", () => {
    // The reverse direction. Without it, a page could be deleted from the site
    // and linger in Discord indefinitely.
    const navPaths = new Set(navGroups.flatMap((g) => g.paths));
    // Not in NAV_GROUPS by design: the site root, and the dashboard deep link
    // that the nav carries as its own pill rather than a group entry.
    const ALLOWED_EXTRA = new Set(["/", "/verify/profile.html"]);
    const botPaths = [...botText.matchAll(/<https:\/\/winlew\.co(\/[^>]*)>/g)].map((m) => m[1]);
    const extra = [...new Set(botPaths)].filter((p) => !navPaths.has(p) && !ALLOWED_EXTRA.has(p));
    assert.deepEqual(
      extra,
      [],
      `!pages links pages the website nav does not list: ${extra.join(", ")}`,
    );
  });
});
