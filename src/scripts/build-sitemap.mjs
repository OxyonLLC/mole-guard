#!/usr/bin/env node
// Generates src/public/sitemap.xml from the pages that actually exist.
//
// The site had no sitemap and no robots.txt (content-audit register item 9),
// and only a handful of pages carried rel="canonical" (item 6). Both were
// deliberately parked for a single repo-wide pass once the folder-by-folder
// audit finished, so that they could be applied consistently rather than
// drifting folder by folder. This is that pass.
//
// A hand-written sitemap on a 116-file site goes stale the first time someone
// adds a page. So this derives the list instead, and
// test/nav/indexingHygiene.test.mjs fails if the committed sitemap.xml differs
// from what this produces — the file is generated output that happens to be
// committed, not a document anyone should edit.
//
// Run: npm run sitemap:build
//
// SAFETY: reads src/public/ and writes exactly one file, src/public/sitemap.xml.
// No network, no credentials, nothing outside the web root.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PUBLIC_ROOT = resolve(repoRoot, "src/public");
export const SITEMAP_PATH = resolve(PUBLIC_ROOT, "sitemap.xml");
export const ORIGIN = "https://winlew.co";

const IGNORED_DIRS = new Set([".tmp-shots", ".tmp-audit", "node_modules"]);

// Same threshold and signature as test/nav/redirectStubHygiene.test.mjs, which
// already governs the ~50 thin "redirecting…" pages. Kept in step deliberately:
// if that file's definition of a stub ever changes, this must change with it or
// the two disagree about what a page is.
const MAX_STUB_BYTES = 3000;

/** Every .html/.htm file under src/public/, as absolute paths. */
export function collectHtmlFiles(dir = PUBLIC_ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) collectHtmlFiles(full, out);
      continue;
    }
    if (/\.html?$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** A thin page whose only job is to bounce the visitor somewhere else. */
export function isRedirectStub(source) {
  return (
    source.length <= MAX_STUB_BYTES &&
    /location\.replace|location\.href *=|http-equiv=["']refresh/i.test(source)
  );
}

// Match on the DIRECTIVE, not on the presence of a robots meta tag. Several
// real pages — /merch/, /wallet/*, /no-thank-you/promotions/ — carry an
// explicit `<meta name="robots" content="index, follow">`, and a naive
// "has a robots tag" check drops all of them from the sitemap. That mistake
// was made once while building this and is the reason for the narrow regex.
export function isNoIndex(source) {
  const tag = source.match(/<meta[^>]*name=["']robots["'][^>]*>/i);
  if (!tag) return false;
  const content = tag[0].match(/content=["']([^"']*)["']/i);
  return Boolean(content) && /\bnoindex\b/i.test(content[1]);
}

/**
 * The URL path a page is served at. index.html is served as its directory
 * (with the trailing slash); anything else keeps its filename. This is also
 * the value each page's rel="canonical" must carry, so the two cannot disagree.
 */
export function urlPathFor(relPath) {
  const parts = relPath.split("/");
  if (parts[parts.length - 1].toLowerCase() === "index.html") {
    parts.pop();
    return "/" + (parts.length ? parts.join("/") + "/" : "");
  }
  return "/" + relPath;
}

// Pages that are indexable and correctly carry a self-canonical, but are not
// destinations a search engine should be pointed at. Keep this list tiny and
// give every entry a reason — "it felt wrong" is not one.
export const SITEMAP_EXCLUSIONS = new Map([
  [
    "/governance/proposal/",
    "Client-rendered detail view driven by ?id=. Every id serves byte-identical " +
      "markup, so listing it would advertise one arbitrary member of a set of " +
      "duplicates. Its self-canonical is still correct and still wanted — that is " +
      "what consolidates all the ?id= variants onto a single URL.",
  ],
]);

/** Every page, classified. Sorted by URL so output is stable. */
export function collectPages() {
  return collectHtmlFiles()
    .map((file) => {
      const relPath = relative(PUBLIC_ROOT, file).split("\\").join("/");
      const source = readFileSync(file, "utf8");
      const urlPath = urlPathFor(relPath);
      const stub = isRedirectStub(source);
      const noindex = isNoIndex(source);
      return {
        file,
        relPath,
        urlPath,
        url: ORIGIN + urlPath,
        source,
        stub,
        noindex,
        indexable: !stub && !noindex,
        excluded: SITEMAP_EXCLUSIONS.has(urlPath),
      };
    })
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

export function sitemapUrls(pages = collectPages()) {
  return pages.filter((p) => p.indexable && !p.excluded).map((p) => p.url);
}

// No <lastmod>, and that is deliberate rather than lazy. The two sources
// available here are both wrong: filesystem mtime churns on any checkout, and
// the file's last git commit date is always one commit stale at build time
// (the commit carrying the edit does not exist yet when the sitemap is
// written), which would make the "committed sitemap matches the generator"
// test flap red immediately after every commit. Google ignores a lastmod it
// does not trust, so an absent one costs nothing and a wrong one costs
// credibility. <changefreq> and <priority> are omitted for the simpler reason
// that Google has stated it ignores both.
export function buildSitemapXml(urls = sitemapUrls()) {
  const body = urls.map((u) => `  <url>\n    <loc>${u}</loc>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function main() {
  const pages = collectPages();
  const urls = sitemapUrls(pages);
  writeFileSync(SITEMAP_PATH, buildSitemapXml(urls));

  const stubs = pages.filter((p) => p.stub).length;
  const noindex = pages.filter((p) => p.noindex && !p.stub).length;
  console.log(`sitemap.xml written — ${urls.length} URLs`);
  console.log(`  ${pages.length} html files scanned`);
  console.log(`  ${stubs} redirect stubs skipped`);
  console.log(`  ${noindex} noindex pages skipped`);
  for (const [path, why] of SITEMAP_EXCLUSIONS) {
    console.log(`  excluded ${path} — ${why.split(".")[0]}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
