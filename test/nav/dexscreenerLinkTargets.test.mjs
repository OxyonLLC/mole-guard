// Which DexScreener pool each page links, and why they are not all the same.
//
// DexScreener drops a pair from its index once volume reaches zero, and every
// WinLEW pool has been at $0/24h — verified 2026-08-12 against three of its
// endpoints, all returning zero pairs for the mint. So its page for the primary
// PumpSwap pool renders "no pair found" while the older Raydium pool still
// draws. The owner confirmed both from a real browser; this machine cannot,
// because dexscreener.com returns Cloudflare 403 from here.
//
// Two rules follow, and they pull in opposite directions, which is exactly why
// this file exists rather than a single "always use X" check:
//
//   • A GENERIC "see the chart" link must point at the Raydium pool, because a
//     chart link that renders beats one that does not.
//   • A MARKET-SPECIFIC link — one sitting beside a printed pair address — must
//     keep pointing at its own pool, because sending it elsewhere would show a
//     different market's data under that address. Those pages pair every
//     DexScreener link with a GeckoTerminal link for the same pool, so the
//     visitor always has a working route to the right market.
//
// navExternalLinks.test.mjs covers the nav and /links/. This covers the pages.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RAYDIUM = "5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx";
const PUMPSWAP = "Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL";

function read(rel) {
  // Comments are stripped: these files carry long explanatory comments that
  // legitimately name the pool NOT being linked, and matching those would make
  // this test fail against correct markup.
  return readFileSync(resolve(repoRoot, rel), "utf8").replace(/<!--[\s\S]*?-->/g, " ");
}

const dsLinks = (src) => [...src.matchAll(/dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]+)/g)].map((m) => m[1]);
const gtLinks = (src) => [...src.matchAll(/geckoterminal\.com\/solana\/pools\/([1-9A-HJ-NP-Za-km-z]+)/g)].map((m) => m[1]);

// Pages offering a general-purpose chart link and no pair address beside it.
const GENERIC = [
  "src/public/index.html",
  "src/public/who-we-are/index.html",
  "src/public/whitepaper/index.html",
  "src/public/whitepaper/whitepaper.md",
];

// Pages that print pool addresses and link each one's own market.
const PER_POOL = ["src/public/transparency/index.html", "src/public/home/index.html"];

describe("generic chart links use the pool that renders", () => {
  for (const rel of GENERIC) {
    test(`${rel} links only the Raydium pool`, () => {
      const found = dsLinks(read(rel));
      assert.ok(found.length > 0, `${rel} has no DexScreener link at all — did it get dropped?`);
      const wrong = found.filter((pool) => pool !== RAYDIUM);
      assert.deepEqual(
        wrong,
        [],
        `${rel} links DexScreener pool(s) other than Raydium. The PumpSwap page renders ` +
          `"no pair found" while volume is zero, so a generic chart link must not use it.`,
      );
    });
  }
});

describe("per-pool pages keep their own market, paired with GeckoTerminal", () => {
  for (const rel of PER_POOL) {
    test(`${rel} still links the primary PumpSwap market`, () => {
      const src = read(rel);
      assert.ok(
        dsLinks(src).includes(PUMPSWAP),
        `${rel} stopped linking the primary market's own DexScreener page. These pages print ` +
          `the pair address, so the link beside it must be that pair.`,
      );
      // The pairing is what makes the non-rendering DexScreener page acceptable
      // here: a working route to the same market sits next to it.
      assert.ok(
        gtLinks(src).includes(PUMPSWAP),
        `${rel} links the primary pool on DexScreener with no GeckoTerminal link for the same ` +
          `pool beside it — at zero volume that leaves the visitor with nothing that renders.`,
      );
    });
  }
});
