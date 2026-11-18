// The whitepaper exists twice: src/public/whitepaper/index.html is what the
// site serves, and whitepaper.md is the "Download Markdown" copy. The page does
// NOT render the markdown — the two are independently hand-maintained, so any
// content fix has to be made in both or they drift silently. That risk has been
// on record since the 2026-07-16 polish pass.
//
// Audited 2026-08-05: they were in sync on every section heading and every
// substantive figure, which is a real credit to whoever kept them that way by
// hand. The one thing that had drifted was the "Last updated" line — present on
// the served page, absent from the downloadable copy, so a reader who took the
// markdown had no idea how current a self-described "living document" was.
//
// These tests compare the two on the things that actually matter (structure and
// numbers) rather than word-for-word: the HTML legitimately carries nav chrome,
// a contents grid, and link markup the markdown does not.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(repoRoot, "src/public/whitepaper/index.html"), "utf8");
const md = readFileSync(resolve(repoRoot, "src/public/whitepaper/whitepaper.md"), "utf8");

/** Rendered prose, with markup, styles, scripts and comments removed. */
function prose(source) {
  return source
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links -> their text
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

// Figures a reader would act on: thousands-separated amounts, precise decimals,
// and percentages. Deliberately not bare small integers, which appear in prose
// ("two holders", "32 verified transactions") and in CSS.
const FIGURE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d{2,}\b|\b\d{1,3}(?:\.\d+)?%/g;

test("both whitepaper copies exist and parsed sanely", () => {
  assert.ok(html.length > 20000 && md.length > 15000, "a whitepaper copy looks truncated");
  const headings = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(headings.length >= 14, `only found ${headings.length} sections in whitepaper.md`);
});

test("every section in the markdown is on the served page", () => {
  const htmlProse = prose(html);
  const missing = [...md.matchAll(/^##\s+(.+)$/gm)]
    .map((m) => m[1].replace(/^\d+\.\s*/, "").trim())
    .filter((h) => !htmlProse.includes(h));
  assert.deepEqual(missing, [], `Sections in whitepaper.md missing from index.html: ${missing.join(", ")}`);
});

test("the two copies quote the same figures", () => {
  const inHtml = new Set(prose(html).match(FIGURE) || []);
  const inMd = new Set(prose(md).match(FIGURE) || []);
  const onlyHtml = [...inHtml].filter((f) => !inMd.has(f)).sort();
  const onlyMd = [...inMd].filter((f) => !inHtml.has(f)).sort();
  assert.deepEqual(onlyHtml, [], `Figures on the served page but not in the downloadable copy: ${onlyHtml.join(", ")}`);
  assert.deepEqual(onlyMd, [], `Figures in the downloadable copy but not on the served page: ${onlyMd.join(", ")}`);
});

test("both copies tell the reader when they were last updated", () => {
  for (const [name, source] of [["index.html", html], ["whitepaper.md", md]]) {
    assert.match(
      prose(source),
      /Last updated:\s*\d{4}-\d{2}-\d{2}/,
      `${name} has no "Last updated" date. It calls itself a living document; a reader who ` +
        `downloads or opens it must be able to see how current it is.`
    );
  }
  const date = (s) => (prose(s).match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/) || [])[1];
  assert.equal(date(html), date(md), "The two copies claim different last-updated dates.");
});

test("current total supply is not contradicted between the copies", () => {
  // 950,000,000 is the live figure; if a burn changes it, both copies must move
  // together rather than one going stale.
  for (const [name, source] of [["index.html", html], ["whitepaper.md", md]]) {
    assert.ok(prose(source).includes("950,000,000"), `${name} no longer states the current total supply`);
  }
});
