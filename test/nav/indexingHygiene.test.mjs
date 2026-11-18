// How winlew.co tells search engines what it is — canonical tags, sitemap.xml,
// robots.txt — pinned so it cannot rot.
//
// Two content-audit register items (6 and 9) were parked for a single
// repo-wide pass: only a handful of the 60-odd real pages carried
// rel="canonical", and neither sitemap.xml nor robots.txt existed at all. That
// mattered more than usual here because the audit had already found duplicate
// game routes (/game-hub/, /gamehub/, /gaming-hub/ all pointing at /mole-hub/)
// and 39 redirect stubs — without canonicals, a search engine picks which
// duplicate to index for you.
//
// The failure this file mainly exists to prevent is not a missing canonical.
// It is a WRONG one. A missing canonical costs a little ranking; a canonical
// copied from another page hands that page's ranking away entirely, silently,
// and looks fine in a browser. Hence the self-referential assertion below.
//
// Companion to redirectStubHygiene.test.mjs (which governs the thin
// "redirecting…" pages) and cuntPageUnlisted.test.mjs (which fails if
// robots.txt ever advertises the unlisted teaser path).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORIGIN,
  PUBLIC_ROOT,
  SITEMAP_EXCLUSIONS,
  SITEMAP_PATH,
  buildSitemapXml,
  collectPages,
  sitemapUrls,
  urlPathFor,
} from "../../src/scripts/build-sitemap.mjs";

const pages = collectPages();
const indexable = pages.filter((p) => p.indexable);

test("the page walk found the site", () => {
  // Guard the guard. A collector that silently returns nothing would make
  // every assertion below pass while checking exactly zero pages.
  assert.ok(pages.length >= 100, `only walked ${pages.length} html files — collector is broken`);
  assert.ok(indexable.length >= 50, `only ${indexable.length} indexable pages — classifier is broken`);
  assert.ok(
    pages.some((p) => p.stub) && pages.some((p) => p.noindex),
    "expected to classify at least one redirect stub and one noindex page"
  );
  // Anchor on pages whose status is not in doubt, so a classifier that
  // inverted itself cannot satisfy the counts above.
  const byPath = new Map(pages.map((p) => [p.urlPath, p]));
  assert.equal(byPath.get("/")?.indexable, true, "the storefront should be indexable");
  assert.equal(byPath.get("/quiz/")?.indexable, true, "/quiz/ should be indexable");
  assert.equal(byPath.get("/cunt/future/")?.indexable, false, "the teaser page must not be indexable");
});

test("every indexable page carries exactly one canonical", () => {
  const missing = [];
  const duplicated = [];
  for (const page of indexable) {
    const tags = page.source.match(/<link[^>]*rel=["']canonical["'][^>]*>/gi) || [];
    if (tags.length === 0) missing.push(page.relPath);
    else if (tags.length > 1) duplicated.push(`${page.relPath} (${tags.length})`);
  }
  assert.deepEqual(
    missing.sort(),
    [],
    "Indexable pages with no <link rel=\"canonical\">. Search engines will pick a URL for " +
      "these themselves, which on a site with duplicate routes means picking wrong."
  );
  assert.deepEqual(
    duplicated.sort(),
    [],
    "Pages with more than one canonical tag. Search engines ignore all of them when they conflict."
  );
});

test("every canonical points at the page's own URL", () => {
  // The assertion that earns this file. A canonical is a redirect for
  // crawlers: point /faucet/ at /quiz/ and /faucet/ stops existing in search
  // results. Nothing in a browser looks wrong when this happens.
  const wrong = [];
  for (const page of indexable) {
    const tag = page.source.match(/<link[^>]*rel=["']canonical["'][^>]*>/i);
    if (!tag) continue; // already reported by the test above
    const href = tag[0].match(/href=["']([^"']+)["']/i);
    if (!href) {
      wrong.push(`${page.relPath}: canonical tag has no href`);
      continue;
    }
    const expected = ORIGIN + page.urlPath;
    if (href[1] !== expected) wrong.push(`${page.relPath}: ${href[1]} (expected ${expected})`);
  }
  assert.deepEqual(wrong.sort(), [], "Canonical tags that do not point at their own page");
});

test("urlPathFor serves directories as directories", () => {
  // Pin the rule the canonical assertion above depends on, so a change to it
  // has to be deliberate rather than quietly re-baselining 60 pages.
  assert.equal(urlPathFor("index.html"), "/");
  assert.equal(urlPathFor("about/index.html"), "/about/");
  assert.equal(urlPathFor("modules/system/index.html"), "/modules/system/");
  assert.equal(urlPathFor("discord-bots/terms.html"), "/discord-bots/terms.html");
  assert.equal(urlPathFor("verify/profile.html"), "/verify/profile.html");
});

test("the committed sitemap.xml matches the generator", () => {
  assert.ok(existsSync(SITEMAP_PATH), "src/public/sitemap.xml does not exist — run npm run sitemap:build");
  assert.equal(
    readFileSync(SITEMAP_PATH, "utf8"),
    buildSitemapXml(sitemapUrls(pages)),
    "sitemap.xml is stale. It is generated output that happens to be committed — " +
      "run `npm run sitemap:build` rather than editing it by hand."
  );
});

test("the generator is deterministic", () => {
  // Two independent walks must agree, or the test above turns into a coin flip
  // that fails on unrelated commits.
  assert.equal(buildSitemapXml(sitemapUrls(collectPages())), buildSitemapXml(sitemapUrls(collectPages())));
});

test("every sitemap URL resolves to a file that exists", () => {
  const urls = sitemapUrls(pages);
  const known = new Map(pages.map((p) => [p.url, p]));
  const dangling = urls.filter((u) => !known.has(u));
  assert.deepEqual(dangling.sort(), [], "Sitemap URLs with no file behind them — these would 404");
  assert.ok(urls.length >= 50, `sitemap has only ${urls.length} URLs — generator is broken`);
});

test("no redirect stub and no noindex page is in the sitemap", () => {
  // Submitting either is worse than omitting it: a stub asks a search engine
  // to index the word "redirecting", and a noindex page in a sitemap is a
  // direct contradiction that costs crawl budget and trust.
  const listed = new Set(sitemapUrls(pages));
  const offenders = pages
    .filter((p) => (p.stub || p.noindex) && listed.has(p.url))
    .map((p) => `${p.relPath} (${p.stub ? "redirect stub" : "noindex"})`);
  assert.deepEqual(offenders.sort(), []);
});

test("pre-launch and unlisted areas stay out of the sitemap", () => {
  // Belt and braces over the noindex check. These are the paths where being
  // listed would do real damage rather than merely being untidy: the halted
  // $CUNT teaser, the two locked-down raw app roots, and /merch/shop.html.
  // That last one was the staged shop; on 2026-08-30 the shop moved to /merch/
  // and the old path became a redirect stub, so listing it would now hand the
  // real shop's ranking to a page whose only content is "redirecting".
  // Named explicitly so that removing a page's noindex cannot quietly publish
  // it here too.
  const listed = sitemapUrls(pages);
  const forbidden = [/\/cunt\//i, /^https:\/\/winlew\.co\/geoagora\//i, /^https:\/\/winlew\.co\/geohackers\//i, /merch\/shop/i, /jdid93hf8dh/i];
  for (const pattern of forbidden) {
    assert.deepEqual(
      listed.filter((u) => pattern.test(u)),
      [],
      `sitemap.xml lists a URL matching ${pattern} — this area is deliberately unlisted`
    );
  }
  // …while the public sister-project pages, which merely share a name with the
  // locked-down app roots, must still be present.
  assert.ok(listed.includes(`${ORIGIN}/ecosystem/geoagora/`), "the public /ecosystem/geoagora/ page should be listed");
  assert.ok(listed.includes(`${ORIGIN}/ecosystem/geohackers/`), "the public /ecosystem/geohackers/ page should be listed");
});

test("sitemap exclusions are documented and still real", () => {
  for (const [urlPath, reason] of SITEMAP_EXCLUSIONS) {
    assert.ok(reason.length > 40, `exclusion ${urlPath} needs a real reason, not "${reason}"`);
    const page = pages.find((p) => p.urlPath === urlPath);
    assert.ok(page, `exclusion ${urlPath} names a page that no longer exists — remove the entry`);
    assert.ok(page.indexable, `exclusion ${urlPath} is already noindex, so the entry is redundant`);
  }
});

test("robots.txt exists, allows the site, and disallows nothing", () => {
  const robotsPath = resolve(PUBLIC_ROOT, "robots.txt");
  assert.ok(existsSync(robotsPath), "src/public/robots.txt does not exist");
  const robots = readFileSync(robotsPath, "utf8");

  const directives = robots
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  assert.ok(
    directives.some((l) => /^user-agent:\s*\*$/i.test(l)),
    "robots.txt has no `User-agent: *` group"
  );
  assert.deepEqual(
    directives.filter((l) => /^disallow:/i.test(l)),
    [],
    "robots.txt contains a Disallow line. This file is world-readable, so a Disallow " +
      "advertises the path it means to hide — and a blocked page can never be crawled, " +
      "which means its noindex is never read and it stays in the index. Use noindex."
  );
  assert.ok(
    directives.some((l) => l.toLowerCase() === `sitemap: ${ORIGIN}/sitemap.xml`.toLowerCase()),
    "robots.txt does not point at the sitemap"
  );
});
