// A product that is not open to the public must not be described anywhere on
// the site as though it is.
//
// Found 2026-08-11 by the second audit. /ecosystem/geohackers/ and
// /ecosystem/geoagora/ both say "Coming Soon · Not public yet" on their own
// pages — but the project grid on /xyo/ described them in flat present tense
// with a definite article: "The ecosystem's XL1 companion — verification,
// on-chain game integrations, and XL1 asset interactions." Every other card in
// that grid already hedged correctly ("being built", "an effort"), so these two
// were the outliers, and a reader arriving at /xyo/ first was told a product
// exists that they cannot use.
//
// The numeric cross-page matrix could not catch this: nothing disagreed about a
// NUMBER, two pages disagreed about a product's STATUS in different words. This
// test encodes that check so it does not depend on someone re-reading the grid.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

/** Visible text: script/style BODIES dropped, comments dropped. */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

// Products whose own /ecosystem/ page declares them pre-launch.
const PRELAUNCH = ["geohackers", "geoagora"];

// Pages that mention products in passing and must carry the same status.
const MENTIONING_PAGES = ["src/public/xyo/index.html"];

describe("pre-launch products are labelled consistently", () => {
  for (const slug of PRELAUNCH) {
    test(`/ecosystem/${slug}/ still declares itself pre-launch`, () => {
      // If this ever fails because the product LAUNCHED, that is the signal to
      // remove it from PRELAUNCH above — not to weaken the assertion.
      const page = `src/public/ecosystem/${slug}/index.html`;
      assert.ok(existsSync(resolve(repoRoot, page)), `${page} is missing`);
      assert.match(
        visible(read(page)),
        /not public yet|coming soon/i,
        `${page} no longer says it is pre-launch. If ${slug} has launched, drop it from ` +
          `PRELAUNCH in this test and re-check every page that mentions it.`
      );
    });
  }

  for (const page of MENTIONING_PAGES) {
    test(`${page.replace("src/public", "")} qualifies every pre-launch product it names`, () => {
      // Parsed CARD BY CARD, not by a character window around the name.
      //
      // Two earlier drafts of this were vacuous and both passed while checking
      // nothing. The first searched the whole page, so it matched a nav link
      // rather than the card. The second used a 200-character window from the
      // product name, which ran past the end of the GeoHackers card and picked
      // up the words "Not public yet" belonging to the GeoAgora card next to
      // it — so deleting GeoHackers' own qualifier still passed. A card is a
      // bounded thing; measure the bounded thing.
      const html = read(page);
      const cards = [...html.matchAll(/<div class="projCard">([\s\S]*?)<\/div>/g)].map((m) => visible(m[1]));
      assert.ok(cards.length >= 5, `only parsed ${cards.length} project cards — the grid changed shape`);

      const missing = [];
      for (const slug of PRELAUNCH) {
        const name = slug === "geohackers" ? "GeoHackers" : "GeoAgora";
        const own = cards.filter((c) => c.includes(name));
        if (!own.length) continue;
        if (!own.some((c) => /not public yet|coming soon|in development|being built/i.test(c))) missing.push(name);
      }
      assert.deepEqual(
        missing,
        [],
        `These products have a project card with no status qualifier while their own pages say ` +
          `"Not public yet": ${missing.join(", ")}. A reader who lands here first is told a ` +
          `product exists that they cannot use.`
      );
    });
  }

});

test("XL1 anchoring is never claimed on mainnet", () => {
  // GeoHackers' own KNOWN_GAPS.md records co-witnessing anchoring on BETA.
  //
  // The first draft of this test began `if (!/anchoring against XL1/i.test(text)) return;`
  // — an early return, so DELETING the phrase disabled the check instead of
  // failing it. A guard that switches itself off when its subject disappears is
  // worse than no guard. It now asserts the absence of the wrong claim, which
  // cannot be satisfied by removal.
  const text = visible(read("src/public/xyo/index.html"));
  const mainnetish = text.match(/\b(anchored|anchors|anchoring)\s+(?:on|to|against)\s+(?:the\s+)?XL1(?!\s+beta)/gi) || [];
  assert.deepEqual(
    mainnetish,
    [],
    `Found an XL1 anchoring claim that does not say "beta": ${mainnetish.join("; ")}. ` +
      `GeoHackers anchors against XL1 beta; dropping the qualifier claims mainnet.`
  );
});
