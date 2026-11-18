// The circulating-supply calculation behind /transparency/.
//
// This is the number a listing reviewer at CoinMarketCap or CoinGecko will act
// on, so the failure that matters most is not "wrong by a bit" — it is a
// silently INFLATED figure produced when one lock fails to load. A dropped
// exclusion does not look like an error; it looks like a normal page reporting
// a larger circulating supply.
//
// Balances below are the real on-chain values read from Solana mainnet on
// 2026-08-13. They are fixtures for the arithmetic, not assertions about
// today's chain state — the live page reads these addresses at request time.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCirculatingSupply,
  winlewToBaseUnits,
  SUPPLY_EXCLUSIONS,
  SUPPLY_NOT_EXCLUDED,
} from "../../src/mole/circulatingSupply.js";

const MINT = { address: "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump", supply: 950_000_000, decimals: 6 };

const LOCKS = [
  ["lock50m", "50M Token Lock", "E8Pu1WNFqnAPbA9HDqxwgHz6xLvwBXQpekeNLRoiKzSo", 50_000_000],
  ["lock19mDev", "19.19M Developer Lock", "AvJi2mKqeUz3oRbY8GjSBkWEk3VQdjXaZ9XFnG7S6R5m", 19_192_210.751092],
  ["lock15mTeam", "15M Team Lock", "zLHYYpKtXFnrwQ52PVxwSU7X87955i14RtgaGsE8SWA", 15_000_000],
  ["lock25mFaucet", "25M Faucet Lock", "8jr1Zov74VbbDyvuW55Hei2LgMuki9N5W2hUVnB2f986", 25_000_000],
  ["streamflow22m", "Streamflow Lock (22M)", "4XnVM4G2xLiKSTfmLeRXTcS1HBnSZPewv1aQcgtpYwv9", 22_069_652.822552],
  ["streamflow7m", "Streamflow Lock (7M)", "B4GJSLCH8F5EDXctPynP157FbbF1SbfZ2HsG3bWUYJpz", 7_013_300],
];
const KEPT = [
  ["burn", "Burn Wallet", "EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74", 50_000_000],
  ["developer", "Developer Reserve", "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ", 10_000_000],
  ["faucetReserveDiscordWeb", "Discord & Web Faucet Reserve", "FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE", 13_005_704.34],
  ["xFaucetReserve", "X (Twitter) Faucet Reserve", "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp", 6_845_194.692333],
  ["liquidityVaults", "Raydium Pool — Live Depth", "61mr6d5jAbCvy1tLZycJauESbJJDuu2DvQgqnvDuvijB", 40_548_341.315467],
];

const components = [...LOCKS, ...KEPT].map(([id, label, address, winlewBalance]) => ({
  id, label, address, winlewBalance, ok: true,
}));

const EXPECTED_LOCKED = "138275163573644";     // base units
const EXPECTED_CIRCULATING = "811724836426356";

describe("the arithmetic", () => {
  test("total − locks = circulating, to the base unit", () => {
    const r = buildCirculatingSupply(MINT, components);
    assert.equal(r.ok, true);
    assert.equal(r.totalSupplyBaseUnits, "950000000000000");
    assert.equal(r.nonCirculatingBaseUnits, EXPECTED_LOCKED);
    assert.equal(r.circulatingBaseUnits, EXPECTED_CIRCULATING);
    assert.equal(r.circulatingDisplay, "811724836.426356");
  });

  test("the parts add back to the whole", () => {
    const r = buildCirculatingSupply(MINT, components);
    assert.equal(
      (BigInt(r.circulatingBaseUnits) + BigInt(r.nonCirculatingBaseUnits)).toString(),
      r.totalSupplyBaseUnits,
    );
    assert.equal(Number((r.circulatingPct + r.nonCirculatingPct).toFixed(4)), 100);
  });

  test("summing is exact, not floating point", () => {
    // 138275163.573644 and 811724836.426356 are both unrepresentable as
    // doubles. Summed as floats the parts do not add back to 950,000,000; the
    // module works in base units precisely so that they do.
    const floatSum = LOCKS.reduce((a, [, , , v]) => a + v, 0);
    assert.notEqual(String(floatSum), "138275163.573644", "fixture no longer demonstrates float drift");
    assert.equal(winlewToBaseUnits(138275163.573644).toString(), EXPECTED_LOCKED);
  });

  test("no address is counted twice", () => {
    const r = buildCirculatingSupply(MINT, components);
    const addresses = r.excluded.map((e) => e.address);
    assert.equal(new Set(addresses).size, addresses.length, "an address appears in two exclusions");
    const keptAddresses = r.notExcluded.map((n) => n.address).filter(Boolean);
    for (const a of keptAddresses) {
      assert.ok(!addresses.includes(a), `${a} is both excluded and counted as circulating`);
    }
  });
});

describe("what is excluded, and what is not", () => {
  test("only program-held locks are deducted", () => {
    const r = buildCirculatingSupply(MINT, components);
    assert.deepEqual(
      r.excluded.map((e) => e.id).sort(),
      ["lock15mTeam", "lock19mDev", "lock25mFaucet", "lock50m", "streamflow22m", "streamflow7m"],
    );
    for (const e of r.excluded) {
      assert.ok(["Jupiter Lock", "Streamflow"].includes(e.provider), `${e.id} has provider ${e.provider}`);
      assert.equal(e.projectControls, false, `${e.id} is deducted but marked project-controlled`);
      assert.ok(e.reason && e.reason.length > 20, `${e.id} has no stated reason`);
    }
  });

  test("the burn wallet stays in circulating supply", () => {
    // The project's own rule, and the honest direction: staged for burn is not
    // burned. These tokens still exist and the mint still counts them.
    assert.ok(!("burn" in SUPPLY_EXCLUSIONS), "the burn wallet must never be deducted from circulating supply");
    const r = buildCirculatingSupply(MINT, components);
    const burn = r.notExcluded.find((n) => n.componentId === "burn");
    assert.ok(burn, "the burn wallet must be listed among balances that are NOT excluded");
    assert.equal(burn.amountDisplay, "50000000");
  });

  test("reserves and liquidity stay in circulating supply", () => {
    for (const id of ["developer", "faucetReserveDiscordWeb", "xFaucetReserve", "liquidityVaults"]) {
      assert.ok(!(id in SUPPLY_EXCLUSIONS), `${id} must not be deducted — it is unlocked or tradeable`);
      assert.ok(
        SUPPLY_NOT_EXCLUDED.some((n) => n.componentId === id),
        `${id} must be listed with a reason for staying in circulating supply`,
      );
    }
  });

  test("every exclusion carries verifiable provenance", () => {
    const r = buildCirculatingSupply(MINT, components);
    for (const e of r.excluded) {
      assert.match(e.solscanUrl, /^https:\/\/solscan\.io\/account\//);
      assert.ok(["on-chain-decoded", "project-reported"].includes(e.scheduleSource), `${e.id}: ${e.scheduleSource}`);
      assert.ok(e.earlyWithdrawal, `${e.id} does not say whether early withdrawal is possible`);
    }
  });
});

describe("it refuses to publish a number it cannot stand behind", () => {
  for (const id of ["lock50m", "streamflow22m", "lock19mDev"]) {
    test(`a failed read of ${id} produces no figure at all`, () => {
      const broken = components.map((c) => (c.id === id ? { ...c, ok: false } : c));
      const r = buildCirculatingSupply(MINT, broken);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "incomplete_source_data");
      assert.ok(r.problems.some((p) => p.startsWith(id)));
      // The whole point: no partial answer leaks out.
      assert.equal(r.circulatingDisplay, undefined);
      assert.equal(r.circulatingBaseUnits, undefined);
    });
  }

  test("a missing component is not silently treated as zero", () => {
    const r = buildCirculatingSupply(MINT, components.filter((c) => c.id !== "lock50m"));
    assert.equal(r.ok, false, "an absent lock must fail the calculation, not shrink the deduction by 50M");
  });

  test("an unreadable mint supply produces no figure", () => {
    const r = buildCirculatingSupply({ ...MINT, supply: null }, components);
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes("mint total supply unavailable"));
  });

  test("a balance of NaN is refused rather than counted", () => {
    const broken = components.map((c) => (c.id === "lock15mTeam" ? { ...c, winlewBalance: NaN } : c));
    const r = buildCirculatingSupply(MINT, broken);
    assert.equal(r.ok, false);
  });
});

// ── The external listing contract (2026-08-20) ────────────────────────────
//
// Jupiter's token review (verified.jup.ag) states its requirement exactly:
//
//     Must return JSON: {"circulatingSupply": number}
//
// /api/transparency/status was submitted for that and REJECTED with
// "Circulating supply is 0 or less". The reason is a type trap worth pinning,
// because that payload DOES have a top-level `circulatingSupply` key — whose
// value is this object, not a number. Jupiter reads the key, gets an object
// where it expects a number, coerces it to NaN, and reports zero.
//
// /api/supply/circulating exists to serve the number itself. These tests guard
// the two halves that matter: the figure must survive Number() as a positive
// finite value, and the reason the dedicated route exists must stay documented
// so nobody "simplifies" it away by pointing Jupiter back at the big payload.
describe("supply figures are consumable by an external listing service", () => {
  test("circulatingDisplay converts to a positive finite number", () => {
    const r = buildCirculatingSupply(MINT, components);
    const n = Number(r.circulatingDisplay);
    assert.ok(Number.isFinite(n), `Number("${r.circulatingDisplay}") must be finite`);
    assert.ok(n > 0, 'a listing service treats "0 or less" as a rejection');
    assert.equal(n, 811724836.426356);
  });

  test("totalSupplyDisplay converts the same way", () => {
    const r = buildCirculatingSupply(MINT, components);
    const n = Number(r.totalSupplyDisplay);
    assert.ok(Number.isFinite(n) && n > 0);
    assert.equal(n, 950000000);
  });

  test("THE TRAP: the whole result is an object, so it must never be sent as the value", () => {
    const r = buildCirculatingSupply(MINT, components);
    assert.equal(typeof r, 'object');
    assert.ok(Number.isNaN(Number(r)),
      'Number(result) is NaN — this is exactly what produced "Circulating supply is 0 or less"');
  });

  test("a failed computation reports it instead of producing a number", () => {
    // The endpoint answers 503 on this rather than 0. A listing service that
    // receives an error keeps its last value; one that receives 0 publishes a
    // zero supply, which is the worst available outcome.
    const broken = components.map((c) => (c.id === 'lock50m' ? { ...c, ok: false, winlewBalance: null } : c));
    const r = buildCirculatingSupply(MINT, broken);
    assert.equal(r.ok, false);
    assert.equal(r.circulatingDisplay, undefined, 'no figure may be emitted from incomplete source data');
  });
});
