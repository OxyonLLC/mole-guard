// The airdrop registration lists are what a distribution would actually pay.
// Paying the wrong address is unrecoverable, so the properties that make the
// list safe are asserted here rather than trusted to a one-off script run.
//
// State when this was written (2026-08-07): registrations.json had 154 entries
// and airdrops.json 153, of which only 147 were safely payable. The rest were
// the X Faucet Reserve, the Developer Reserve (three times — twice as its
// address, once as its SNS alias "lewsales.sol"), two duplicated wallets, and
// one banned wallet.
//
// That dirt is historical: it came from the legacy `!register`, which pushed
// raw args[0] with no SNS resolution and no dedupe. (It lived at
// src/faucet/_legacy/other pc/bot.js:1124; that folder was deleted 2026-08-08.)
// The current handler (src/faucet/bot.js:1161) resolves and dedupes, so this
// cannot recur — these tests exist to prove the cleanup happened and to catch a
// regression in the handler.
//
// Grew to 155 on 2026-08-08. Deleting that legacy folder turned up seven valid
// registrations that existed ONLY there and had never been carried across —
// including a holder of 11M WinLEW. They were added to both lists after being
// checked against these same rules. See
// A.i-Talks/legacy-registrations-recovered-2026-08-08.md.
//
// Note these tests deliberately assert PROPERTIES, not a count. A count would
// have to be edited every time someone registers, and an assertion people edit
// reflexively is one that stops being read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(resolve(repoRoot, p), 'utf8'));

const REGISTRATIONS = read('src/faucet/registrations.json');
const AIRDROPS = read('src/faucet/airdrops.json');

// Length-bounded on purpose. src/mole/solana.js's BASE58_RE has no bound, so it
// would accept "lewsales.sol"-length junk as valid base58 characters.
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Project-owned addresses, parsed out of the un-exportable TRANSPARENCY_COMPONENTS. */
function projectOwned() {
  const source = readFileSync(resolve(repoRoot, 'src/mole/web.js'), 'utf8');
  const start = source.indexOf('const TRANSPARENCY_COMPONENTS = [');
  const block = source.slice(start, source.indexOf('\n  ];', start));
  const map = new Map();
  for (const m of block.matchAll(/id:\s*"([^"]+)"[\s\S]{0,600}?address:\s*"([^"]+)"/g)) map.set(m[2], m[1]);
  return map;
}

const OWNED = projectOwned();

test('the component registry parsed sanely', () => {
  // Guard the guard: if this returns nothing, every exclusion test below passes
  // vacuously and the airdrop would happily pay the treasury.
  assert.ok(OWNED.size >= 8, `only parsed ${OWNED.size} project addresses from web.js`);
  assert.ok([...OWNED.values()].includes('developer'), 'expected the Developer Reserve among them');
});

for (const [label, list] of [['registrations.json', REGISTRATIONS], ['airdrops.json', AIRDROPS]]) {
  test(`${label} pays no project-owned wallet`, () => {
    const hits = list.filter((a) => OWNED.has(a)).map((a) => `${a} (${OWNED.get(a)})`);
    assert.deepEqual(hits, [], `${label} would pay the project's own wallets: ${hits.join(', ')}`);
  });

  test(`${label} has no duplicates`, () => {
    const seen = new Set();
    const dupes = list.filter((a) => (seen.has(a) ? true : (seen.add(a), false)));
    assert.deepEqual([...new Set(dupes)], [], `${label} would pay these wallets twice`);
  });

  test(`${label} contains only valid addresses`, () => {
    const bad = list.filter((a) => !BASE58_ADDRESS.test(String(a).trim()));
    assert.deepEqual(bad, [], `${label} holds non-addresses (an SNS name is not payable): ${bad.join(', ')}`);
  });
}

test('the two lists agree', () => {
  // They are meant to be the same set. They diverged historically because the
  // legacy handler wrote a raw SNS name to one and not the other.
  const a = new Set(REGISTRATIONS);
  const b = new Set(AIRDROPS);
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  assert.deepEqual(onlyA, [], `in registrations.json but not airdrops.json: ${onlyA.join(', ')}`);
  assert.deepEqual(onlyB, [], `in airdrops.json but not registrations.json: ${onlyB.join(', ')}`);
});
