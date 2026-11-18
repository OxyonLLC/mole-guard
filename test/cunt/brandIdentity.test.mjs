// Brand rules (§32, §33, §52) that are checkable, checked.
//
// Most of a brand document is taste and cannot be tested. Three parts are not:
// the name hierarchy, the approved slogan list, and the prohibition on
// investment language. All three are the kind of thing that erodes one
// well-meant edit at a time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

const page = read("src/public/cunt/future/index.html");

// Markdown hard-wraps prose, so a phrase can be split across lines and a
// literal match fails on formatting rather than content. This has now bitten
// three doc-matching tests in this sprint, so normalise once: strip emphasis
// markers and collapse all whitespace before matching ANY document prose.
const prose = (t) => t.replace(/[*`_]/g, "").replace(/\s+/g, " ");
const doc = prose(read("docs/cunt/CUNT-BRAND-IDENTITY.md"));
const visible = page.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");

test("§32 — the page leads with TUESDAY, not the ticker", () => {
  const tuesdays = (page.match(/TUESDAY/gi) || []).length;
  const tickers = (page.match(/CUNT/gi) || []).length;
  assert.ok(tuesdays >= 8, `expected TUESDAY-forward branding, found ${tuesdays} mentions`);
  assert.ok(
    tickers < tuesdays,
    `the ticker appears ${tickers} times vs TUESDAY ${tuesdays} — §32 makes TUESDAY the primary visual brand`
  );
});

test("§52 — no investment language anywhere on the page", () => {
  // These are not stylistic preferences. Each is a claim the project must not
  // make, and the page is where one would slip in first.
  const banned = [
    /guaranteed (return|profit|income)/i,
    /\bROI\b/i,
    /passive income/i,
    /earn it back/i,
    /price will/i,
    // Bare "moon" is NOT a violation. The page asks "WHEN MOON? ...you know the
    // answer 😉" — a refusal to promise, which is the anti-hype joke doing its
    // job. Only an affirmative price claim counts.
    /to the moon|moon soon|going to moon/i,
    // Likewise "not financial advice" is the disclaimer, not the offence. The
    // first version's negative lookahead sat AFTER the phrase while the
    // negation sits before it, so it flagged the disclaimer as a violation.
    /(?<!not )(?<!no )financial advice/i,
    /(?<!not )a promise of value/i,
  ];
  const hits = banned.filter((re) => re.test(visible)).map(String);
  assert.deepEqual(hits, [], `investment language found on the page: ${hits.join(", ")}`);
});

test("§33 — only the approved slogans are documented", () => {
  // "Do not invent dozens of slogans during engineering work." The doc must
  // carry the approved three and say the list is closed.
  for (const slogan of [
    "GOD'S JOKE. OUR TOKEN.",
    "ODD BY DESIGN. LEGEND BY DEFAULT.",
    "NO ROADMAP. JUST TUESDAYS.",
  ]) {
    assert.ok(doc.includes(slogan), `approved slogan missing from the brand doc: ${slogan}`);
  }
  assert.match(doc, /full approved list/i, "the doc must state that the list is closed");
});

test("§1 — the Base original is documented, not hidden", () => {
  const BASE = "0x555cc44a50f228da3a48ea8b8ab0d4831bff0804";
  assert.ok(page.includes(BASE), "the page must name the retired Base contract");
  assert.ok(doc.includes(BASE), "the brand doc must name it too");
  // And it must never be presented as the Solana token.
  assert.match(visible, /not \$WinLEW|retired|not coming back/i);
});

test("the page does not claim a mint that does not exist", () => {
  const manifest = JSON.parse(read("cunt-project.json"));
  if (manifest.vanity_targets.mint.address === null) {
    assert.match(visible, /[Nn]ot minted yet/, "while there is no mint, the page must say so");
    // A base58 mint-shaped string on the page before one exists would be a
    // placeholder — §2A forbids publishing those.
    const mintish = visible.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || [];
    assert.deepEqual(mintish, [], `mint-shaped strings on the page before a mint exists: ${mintish.join(", ")}`);
  }
});

test("the brand doc keeps restraint from costing verifiability", () => {
  // The page currently prints no ticker at all, which is stronger than §32
  // requires. That is fine now and would be a problem once a mint exists —
  // buyers must be able to check what they are buying.
  assert.match(
    doc,
    /the ticker and the mint address must appear/i,
    "the doc must record that the ticker and mint address become mandatory once a mint exists"
  );
});
