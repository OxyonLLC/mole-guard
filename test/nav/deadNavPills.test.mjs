// Hand-written pills inside .navLinks never render, so they must never return.
//
// nav.js removes the .navLinks row and rebuilds it from NAV_GROUPS on every
// page. Anything written into that row by hand is therefore dead markup: it can
// only ever appear in the instant before nav.js runs, or if nav.js fails to
// load — which is precisely the moment a stale menu is worst. Register item 15
// of WINLEW_PUBLIC_CONTENT_AUDIT.md found 473 such pills across 30+ pages; they
// were retired in bdf9ef1, and the last ten (the two /ecosystem/ pages the sweep
// skipped) on 2026-08-12.
//
// The trap this guards is not the rendering — it is maintenance. Editing nav
// there looks like it works and does nothing, so the next person to "fix the
// menu" on a page fixes markup no visitor will ever see. The element itself must
// stay: nav.js bails out entirely if .navLinks is absent.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = resolve(repoRoot, "src/public");

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

// The row has never contained a nested element other than <a>, so matching to
// the first </div> is exact. If one is ever nested, this under-scopes rather
// than over-scopes — it would miss a pill, not invent one.
const NAV_LINKS_BLOCK = /<div class="navLinks"[^>]*>(.*?)<\/div>/gs;

const blocks = htmlFiles(publicRoot).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(NAV_LINKS_BLOCK)].map((match) => ({
    file: relative(repoRoot, file),
    // Comments are stripped first: the canonical "intentionally empty" comment
    // on 57 pages contains the literal text "<a>", which counts as a pill to a
    // naive scan and would make this test fail everywhere it had already been
    // fixed.
    body: match[1].replace(/<!--.*?-->/gs, ""),
  }));
});

test("the scan found the nav rows it is meant to check", () => {
  // Guard the guard: a regex that matches nothing passes every assertion below.
  assert.ok(blocks.length >= 50, `only found ${blocks.length} .navLinks rows`);
});

describe("no page hand-writes nav pills", () => {
  test("every .navLinks row is empty of anchors", () => {
    const offenders = blocks
      .map(({ file, body }) => ({ file, pills: [...body.matchAll(/<a\b[^>]*>/g)].length }))
      .filter(({ pills }) => pills > 0);

    assert.deepEqual(
      offenders,
      [],
      `these pages hand-write nav pills that nav.js discards:\n${offenders
        .map(({ file, pills }) => `  ${file} (${pills})`)
        .join("\n")}`,
    );
  });
});
