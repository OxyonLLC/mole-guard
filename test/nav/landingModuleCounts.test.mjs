// The landing page prints "<live> of <total> registered modules are live
// today" and links straight to /modules/. Both figures are derived in the
// browser from /api/modules/status, and BOTH pages must derive them the same
// way or the sentence contradicts the page it points at.
//
// This nearly shipped wrong. The obvious source is the payload's own
// countsByStatus, which tallies the entire registry — but modules/js/app.js
// hides modules with publicVisibility === false or status === 'internal'
// before rendering. Using countsByStatus would have printed a denominator of
// 30 above a list of 29. Nothing about that is visible from either file alone;
// it only shows up when you read them together, which is what this test does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = resolve(repoRoot, "src/public");

const landing = readFileSync(resolve(publicDir, "index.html"), "utf8");
const modulesApp = readFileSync(resolve(publicDir, "modules/js/app.js"), "utf8");

// Comments in both files quote the predicate to explain it. Strip them first
// so the test matches executable code and cannot be satisfied by prose — a
// guard matching its own explanatory comment has bitten this repo before.
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

// Captures the predicate of any .filter() that tests publicVisibility.
const VISIBILITY_FILTER = /\.filter\(\((\w+)\)\s*=>\s*(\1\.publicVisibility[^;]*?)\)\s*[;,)]/;

function visibilityPredicate(src, label) {
  const match = stripComments(src).match(VISIBILITY_FILTER);
  assert.ok(
    match,
    `${label} no longer filters modules on publicVisibility. If the visibility ` +
      `rule moved or changed shape, update this test with it — do not delete it.`
  );
  // Normalise the parameter name and whitespace so `(m)` vs `(mod)` and line
  // breaks are not treated as a real disagreement.
  return match[2].replace(new RegExp(`\\b${match[1]}\\.`, "g"), "·.").replace(/\s+/g, " ").trim();
}

test("the landing page hides exactly the modules /modules/ hides", () => {
  assert.equal(
    visibilityPredicate(landing, "src/public/index.html"),
    visibilityPredicate(modulesApp, "src/public/modules/js/app.js"),
    "The landing page's module count and the /modules/ list must apply the SAME " +
      "visibility rule. They are one claim rendered twice: the landing page says " +
      "'N of M registered modules', and /modules/ shows the M. If these drift, the " +
      "site contradicts itself on a number, one click apart."
  );
});

test("the landing page counts live modules from the filtered set, not the whole registry", () => {
  const code = stripComments(landing);

  // The denominator must come from the filtered array. countsByStatus covers
  // the full registry including internal modules, so reading it here is the
  // exact bug this file exists to prevent.
  assert.ok(
    !/countsByStatus/.test(code),
    "src/public/index.html reads countsByStatus. That tallies the WHOLE registry, " +
      "including internal and non-public modules that /modules/ never shows — the " +
      "printed total would exceed the list a visitor sees after clicking through. " +
      "Derive both figures from data.modules with the same filter app.js uses."
  );

  // And the numerator must be taken from the filtered array too — counting
  // live modules across the unfiltered list would let an internal module
  // inflate it.
  assert.match(
    code,
    /const visible = [\w.]+\.filter\([\s\S]{0,120}?\);\s*const live = visible\.filter\(/,
    "index.html must count live modules from the visibility-filtered array " +
      "(`visible`), not from the raw payload — otherwise an internal module " +
      "counts toward 'live' while being absent from /modules/."
  );
});

test("the module-count line stays hidden unless both figures resolved", () => {
  const code = stripComments(landing);

  assert.match(
    code,
    /id="moduleCountLine"[^>]*\shidden/,
    "#moduleCountLine must ship with the `hidden` attribute set. /api/modules/status " +
      "404s on winlew.co whenever the proxy hop is down, and an em-dash where a count " +
      "belongs reads as 'zero modules'."
  );

  assert.match(
    code,
    /if \(live > 0 && visible\.length > 0\)/,
    "Only reveal #moduleCountLine once both figures are real. A count of 0 means the " +
      "fetch or the filter is wrong, never that the ecosystem has no live modules."
  );
});
