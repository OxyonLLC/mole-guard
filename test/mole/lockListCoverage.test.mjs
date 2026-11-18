// Every page that ENUMERATES the token locks must list all of them.
//
// This failure has now happened twice, both times the same shape: a lock is
// added as a component in TRANSPARENCY_COMPONENTS, and prose elsewhere that
// spells the locks out by name is not updated — so the site lists supply it
// then under-reports.
//
//   2026-08-08  a third Jupiter lock (25M faucet runway) was created and
//               /transparency/'s tokenomics paragraph still said "a 50M lock
//               and a 15M team lock". Caught then, and guarded by
//               transparencyPageClaims.test.mjs.
//   2026-08-11  a fourth (19.19M Developer Reserve) was created, and
//               /who-we-are/ still said "50M Jupiter Lock, 15M Team Lock, two
//               Streamflow vesting contracts" — omitting BOTH the 25M and the
//               19.19M, understating locked supply by 44.19M. That page was
//               outside the 2026-08-08 guard's reach.
//
// So this generalises the check to every page that enumerates locks, rather
// than adding a third page-specific test after the next one drifts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

/** Lock components registered on the server, by headline size. */
function registeredLockSizes() {
  const web = read("src/mole/web.js");
  const start = web.indexOf("const TRANSPARENCY_COMPONENTS");
  const block = web.slice(start, web.indexOf("\n];", start));
  const ids = [...block.matchAll(/id: "(lock[^"]*)"/g)].map((m) => m[1]);
  return ids
    .map((id) => (id.match(/lock(\d+)m/i) || [])[1])
    .filter(Boolean);
}

// Pages whose prose names the locks individually. A page that merely links to
// /transparency/ without listing them is fine and is not listed here.
const ENUMERATING_PAGES = [
  "src/public/who-we-are/index.html",
  "src/public/transparency/index.html",
];

const sizes = registeredLockSizes();

test("lock components were found", () => {
  // Guard the guard — an empty list would make every assertion below vacuous.
  assert.ok(sizes.length >= 4, `only found ${sizes.length} lock components; parser is broken`);
});

for (const page of ENUMERATING_PAGES) {
  test(`${page.replace("src/public", "")} names every registered lock`, () => {
    // Comments legitimately quote the old, wrong list as the record of the fix.
    const prose = read(page).replace(/<!--[\s\S]*?-->/g, " ");
    const missing = sizes.filter((size) => !new RegExp(`\\b${size}(\\.\\d+)?M`, "i").test(prose));
    assert.deepEqual(
      missing,
      [],
      `This page lists the locks by name but omits ${missing.map((s) => s + "M").join(", ")}. ` +
        `A page that enumerates locks and misses one under-reports locked supply — which is the ` +
        `single most consequential kind of understatement a transparency page can make.`
    );
  });
}
