// Links that are known dead must not come back, and privacy-policy contact
// points must resolve to something real.
//
// Found 2026-08-11 by the second audit. Three pages under /wallet/ sent users
// to https://github.com/LewSales/GeoWallet/issues, which 404s — that repo is
// private or nonexistent to the public. Two of the three are PRIVACY POLICY
// contact points, so the policy promised a way to reach the project and there
// wasn't one.
//
// Confirmed real rather than assumed: github.com/LewSales/Discord-Bot returns
// 200 to the same client, so GitHub answers honestly here and the 404 is not a
// bot block. That control mattered — most other "failures" in the same link
// sweep (Solscan, DexScreener, Coinbase, gmgn) were Cloudflare blocking
// automated clients, and DexScreener loaded fine in a real browser.
//
// Offline by design: this asserts the dead URLs are absent from source rather
// than re-fetching them, so it cannot flake on a network hiccup.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = resolve(repoRoot, "src/public");
const SKIP = new Set(["geoagora", "geohackers", "node_modules", ".tmp-shots"]);

function pages(dir = publicRoot, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) pages(p, out); continue; }
    if (/\.html?$/i.test(e.name) && statSync(p).size < 400000) out.push(p);
  }
  return out;
}

/** Source with comments removed — they legitimately quote the dead URL as the
 *  record of the fix, and must not themselves trip the check. */
const withoutComments = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

// URLs verified dead on 2026-08-11. Add to this list, never remove one without
// re-checking it.
const KNOWN_DEAD = [
  "github.com/LewSales/GeoWallet/issues",
  "github.com/LewSales/GeoWallet",
  // Subdomains that no longer resolve (SSL/DNS failure).
  "discord.winlew.co",
  "health.winlew.co",
  "verify.winlew.co",
];

const files = pages();

test("the page walk found the site", () => {
  assert.ok(files.length >= 50, `only walked ${files.length} pages — collector is broken`);
});

describe("known-dead links stay gone", () => {
  for (const dead of KNOWN_DEAD) {
    test(`no live link to ${dead}`, () => {
      const offenders = files
        .filter((f) => withoutComments(readFileSync(f, "utf8")).includes(dead))
        // Normalise to URL-style "/" separators: on Windows the walked paths use
        // "\", so the archive exemption below never matched and this failed there.
        .map((f) => f.replace(publicRoot, "").replace(/\\/g, "/"))
        // The legacy artifact at /images/old-index.htm is a preserved historical
        // copy, noindex and unlinked; it is tracked in the QA report rather than
        // edited, because rewriting an archived page falsifies the archive.
        .filter((f) => f !== "/images/old-index.htm")
        .sort();
      assert.deepEqual(
        offenders,
        [],
        `These pages link to ${dead}, which was verified dead on 2026-08-11.`
      );
    });
  }
});

test("every /wallet/ privacy + support page offers a reachable contact", () => {
  // A privacy policy that names no working contact is worse than one with no
  // contact section at all — it implies a channel that does not exist.
  for (const rel of ["/wallet/privacy/index.html", "/wallet/support/privacy.html", "/wallet/support/index.html"]) {
    const src = withoutComments(readFileSync(join(publicRoot, rel), "utf8"));
    assert.match(
      src,
      /https:\/\/discord\.(gg|com\/invite)\/[A-Za-z0-9]+/,
      `${rel} has no reachable contact link. It previously pointed at a 404.`
    );
  }
});
