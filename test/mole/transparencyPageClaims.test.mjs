// /transparency/ is the page whose entire value is that its numbers are true.
// Most of it is rendered from /api/transparency/status and so cannot drift —
// but the page also carries hand-written prose and a hand-maintained markets
// table alongside the live data, and those CAN drift from the backend registry
// they summarise.
//
// That is exactly what happened: the 7M Streamflow lock was added as a live
// component on 2026-07-17 (it had been missing from the page entirely), but the
// tokenomics paragraph one section below was never updated and went on
// describing a single Streamflow contract — summarising 94.08M of locked
// supply as 87.07M. Verified on-chain 2026-08-05.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(repoRoot, "src/public/transparency/index.html"), "utf8");
const webSource = readFileSync(resolve(repoRoot, "src/mole/web.js"), "utf8");

// Prose only: strip comments (they quote the old wrong wording deliberately),
// plus <style>/<script> bodies, which are not visible text.
const prose = html
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

function componentBlock() {
  const start = webSource.indexOf("const TRANSPARENCY_COMPONENTS = [");
  assert.notEqual(start, -1, "TRANSPARENCY_COMPONENTS not found in web.js");
  const end = webSource.indexOf("\n  ];", start);
  assert.notEqual(end, -1, "end of TRANSPARENCY_COMPONENTS not found");
  return webSource.slice(start, end);
}

test("component registry parsed sanely", () => {
  // Guard the guard: a broken parse would make the assertions below vacuous.
  const ids = [...componentBlock().matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8, `only parsed ${ids.length} transparency components`);
  assert.ok(ids.includes("streamflow22m") && ids.includes("streamflow7m"));
});

test("the tokenomics summary accounts for BOTH Streamflow contracts", () => {
  const ids = [...componentBlock().matchAll(/id: "(streamflow[^"]*)"/g)].map((m) => m[1]);
  assert.equal(
    ids.length,
    2,
    `Registry now has ${ids.length} Streamflow components (${ids.join(", ")}). The tokenomics ` +
      `paragraph in /transparency/ describes two — update the prose to match before changing this.`
  );
  assert.match(
    prose,
    /two\s+separate\s+Streamflow vesting contracts/i,
    "The tokenomics paragraph must say there are two separate Streamflow contracts. It once " +
      "said 'a Streamflow vesting contract' (singular) while the page listed both, under-reporting " +
      "locked supply by ~7M."
    );
});

test("the tokenomics summary accounts for every Jupiter Lock too", () => {
  // Generalised 2026-08-08 after a THIRD Jupiter lock (25M faucet runway) was
  // created and the prose still said "a 50M lock and a 15M team lock". Exactly
  // the same drift the Streamflow check above exists for — a lock is added as a
  // component, and the paragraph one section below is not updated, so the page
  // lists supply it then under-reports.
  const ids = [...componentBlock().matchAll(/id: "(lock[^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 3, `expected at least 3 Jupiter lock components, found ${ids.length}`);
  for (const id of ids) {
    // Each lock's headline size must appear in the prose. lock50m -> "50M".
    const size = (id.match(/lock(\d+)m/i) || [])[1];
    if (!size) continue;
    assert.ok(
      new RegExp(`${size}M`, "i").test(prose),
      `Component "${id}" exists but the tokenomics paragraph never mentions ${size}M. ` +
        `The page would list the lock and then under-report locked supply.`
    );
  }
});

test("the Raydium pool vaults are never described as locked supply", () => {
  // Added 2026-08-08 with the vault components themselves. The pool holds
  // 35.5M WinLEW — bigger than any single Jupiter lock — so there is a real
  // pull toward listing it next to them as supply "taken out of circulation".
  // It is not. Pool inventory is withdrawable by whoever holds the LP tokens,
  // with no cliff, and at the time of writing 53.66% of that LP was held by
  // the Developer Reserve. Describing it as locked would be the single most
  // consequential false claim this page could make.
  const block = componentBlock();
  const vaultIds = [...block.matchAll(/id: "(liquidityVault[^"]*)"/g)].map((m) => m[1]);
  // Was 2 (a WinLEW-side card and a SOL-side card). Merged into one on 2026-08-11
  // at the owner's request — same pool, same contract, double the space, and a
  // meaningless "$WinLEW: 0" on the SOL card. The COUNT is not what this test
  // protects; the WORDING is. One card must deny being locked supply just as
  // loudly as two did.
  assert.equal(vaultIds.length, 1, `expected 1 merged liquidity vault component, found ${vaultIds.length}`);

  for (const id of vaultIds) {
    const start = block.indexOf(`id: "${id}"`);
    const purpose = (block.slice(start).match(/purpose: "([^"]*)"/) || [])[1] || "";
    assert.ok(purpose, `no purpose string parsed for ${id}`);
    assert.match(
      purpose,
      /withdrawable/i,
      `${id} must state that the balance is withdrawable — it is pool inventory, not a lock.`
    );
    assert.match(
      purpose,
      /not locked supply|is not a lock/i,
      `${id} must explicitly deny being locked supply. It sits beside four real locks on the ` +
        `page and will be read as a fifth unless it says otherwise.`
    );
  }
});

test("pool liquidity is not counted as locked supply in the prose", () => {
  // The companion to the check above, on the other side of the page. The
  // tokenomics paragraph enumerates locked supply; the 35.5M in the pool must
  // not be folded into that total.
  const lockedSentence = (prose.match(/[^.]*locked[^.]*\./gi) || []).join(" ");
  assert.ok(
    !/35[.,]?5\s*M|35,491,700/i.test(lockedSentence),
    "The tokenomics prose appears to count the ~35.5M of Raydium pool liquidity as locked " +
      "supply. It is withdrawable by LP holders and must not be added to the lock totals."
  );
});

test("the mint shown on the page is the canonical mint", () => {
  // The page tells readers "always verify the mint — symbols and names can be
  // copied", so the address it prints must be the one every payout, holder
  // check and supply figure actually keys to.
  const canonical = (
    readFileSync(resolve(repoRoot, "src/faucet/dexscreener.js"), "utf8").match(
      /export const MINT = '([^']+)'/
    ) || []
  )[1];
  assert.ok(canonical, "could not read the canonical MINT constant");
  assert.ok(
    html.includes(canonical),
    `/transparency/ does not show the canonical mint (${canonical}).`
  );
  // And no OTHER pump.fun-style mint is printed alongside it, which would make
  // "always verify the mint" actively misleading.
  const mintish = [...new Set([...html.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,43}pump\b/g)].map((m) => m[0]))];
  assert.deepEqual(mintish, [canonical], `Unexpected mint-like addresses on the page: ${mintish.join(", ")}`);
});

test("every market/component address on the page is one the backend tracks", () => {
  // A base58 address hardcoded into the markets or history tables that the
  // backend knows nothing about is either a typo or a stale reference.
  const canonicalMint = (
    readFileSync(resolve(repoRoot, "src/faucet/dexscreener.js"), "utf8").match(
      /export const MINT = '([^']+)'/
    ) || []
  )[1];
  const inPage = [...new Set([...html.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)].map((m) => m[0]))];
  const known = new Set(
    [...webSource.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)].map((m) => m[0])
  );
  const unknown = inPage.filter((a) => a !== canonicalMint && !known.has(a));
  assert.deepEqual(
    unknown,
    [],
    `Addresses on /transparency/ that appear nowhere in src/mole/web.js: ${unknown.join(", ")}`
  );
});

test("the page still promises live data, and nothing hardcodes a supply figure", () => {
  assert.match(prose, /read live from Solana on page load/i);
  // 950,000,000 is the real supply today, but it must never be typed into the
  // page — it changes on every burn, and the page's whole claim is that it is
  // read live. (The tokenomics paragraph's lock figures are historical
  // allocations and are legitimately static.)
  assert.ok(
    !/950,000,000/.test(prose),
    "The current total supply is hardcoded in /transparency/. It must come from the API — " +
      "supply falls with every burn and the page explicitly promises it is read live."
  );
});
