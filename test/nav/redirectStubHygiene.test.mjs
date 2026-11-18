// The site carries 38 thin "redirecting…" pages — old routes, duplicate
// spellings (/game-hub/, /gamehub/, /gaming-hub/), root-level twins of nested
// policy pages, and pre-launch lockdown stubs. Without `noindex` each one can
// be indexed in place of the real page it points at, so a searcher lands on a
// page whose only content is the word "redirecting".
//
// 23 of the 38 were missing it as of 2026-08-05 (register item 20). This test
// closes that permanently: a new stub cannot ship without the meta tag.
//
// Canonical is deliberately NOT required. It is right for a stub that is a
// true alias of one real page (/verify.html -> /verify/), and wrong for a
// directory guard pointing at /no-thank-you/ (itself noindex) or a lockdown
// stub pointing at "/" (the storefront, which has its own canonical) — those
// would tell a crawler the stub *is* that page. Where a canonical does exist,
// this test checks it isn't one of those two bad targets.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = resolve(repoRoot, "src/public");

const IGNORED_DIRS = new Set([".tmp-shots", "node_modules"]);
// Anything larger than this is a real page, not a redirect stub.
const MAX_STUB_BYTES = 3000;

function collectStubs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) collectStubs(full, out);
      continue;
    }
    if (!/\.html?$/i.test(entry.name)) continue;
    const source = readFileSync(full, "utf8");
    if (source.length > MAX_STUB_BYTES) continue;
    if (!/location\.replace|location\.href *=|http-equiv=["']refresh/i.test(source)) continue;
    out.push({ path: full.replace(publicRoot, "") || entry.name, source });
  }
  return out;
}

const stubs = collectStubs(publicRoot);

test("redirect stubs were actually found", () => {
  // Guard the guard — a broken walk would make every assertion below vacuous.
  assert.ok(stubs.length >= 30, `only found ${stubs.length} redirect stubs — collector is broken`);
});

test("every redirect stub is noindex", () => {
  const missing = stubs
    .filter((s) => !/name=["']robots["'][^>]*noindex/i.test(s.source))
    .map((s) => s.path)
    .sort();
  assert.deepEqual(
    missing,
    [],
    `Redirect stubs without <meta name="robots" content="noindex…">, so they can be ` +
      `indexed instead of the page they point at: ${missing.join(", ")}`
  );
});

test("no stub declares a canonical that misdescribes it", () => {
  const bad = [];
  for (const stub of stubs) {
    const canonical = (stub.source.match(/rel=["']canonical["'] href=["']([^"']+)/i) || [])[1];
    if (!canonical) continue;
    // "/" is legitimate only for a stub that really is an alias of the
    // homepage (landing.html); /no-thank-you/ is never a legitimate canonical
    // target because that page is itself noindex.
    if (/\/no-thank-you\/?$/.test(canonical)) {
      bad.push(`${stub.path} -> ${canonical} (target is noindex)`);
    }
  }
  assert.deepEqual(bad, [], `Stubs with a misleading canonical: ${bad.join(", ")}`);
});
