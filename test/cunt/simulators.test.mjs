// §11 liquidity simulator and §45 release-controller simulator.
//
// A simulator that is never checked against reality is a spreadsheet with
// opinions. The liquidity tests below validate the AMM maths against WinLEW's
// ACTUAL Raydium pool — decoded from the PoolState account on 2026-08-08 and
// cross-checked against GeckoTerminal — so the numbers this produces for $CUNT
// come from arithmetic already shown to reproduce an observed market.
//
// The release tests do the job §8 asks for: demonstrate that a volume-based
// trigger is gameable, rather than asserting it.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  spotPriceInSol, spotPriceUsd, fdvUsd, simulateBuy, simulateSell, modelOpening,
} from "../../src/cunt/liquiditySim.js";
import {
  simulateRelease, naiveVolumeTrigger, objectiveTrigger, firstFiring, stageFor,
} from "../../src/cunt/releaseSim.js";

// Real, observed values from WinLEW's Raydium CPMM pool 5nTz6Cq7…92Lx.
const REAL = { cunt: 35_504_420.350782, sol: 4.779927428, solUsd: 74.67, geckoPriceUsd: 0.000009794 };

const near = (a, b, tolPct, label) =>
  assert.ok(
    Math.abs(a - b) / b * 100 <= tolPct,
    `${label}: ${a} vs ${b} — ${(Math.abs(a - b) / b * 100).toFixed(2)}% apart, tolerance ${tolPct}%`
  );

// ── §11 validated against a real pool ───────────────────────────────────────
test("the AMM maths reproduces WinLEW's real pool price", () => {
  const priceSol = spotPriceInSol({ tokenAmount: REAL.cunt, solAmount: REAL.sol });
  const priceUsd = spotPriceUsd({ tokenAmount: REAL.cunt, solAmount: REAL.sol, solUsd: REAL.solUsd });
  assert.ok(priceSol > 0);
  // GeckoTerminal reported $0.000009794 for this pool. Anything within a few
  // percent means the model and the market agree.
  near(priceUsd, REAL.geckoPriceUsd, 5, "spot price vs GeckoTerminal");
});

test("pool value derived two ways agrees", () => {
  // tvl/2 per side (how Raydium reports) vs sol × price × 2 (what the model does).
  const poolValue = REAL.sol * REAL.solUsd * 2;
  near(poolValue, 713.88, 2, "pool value vs Raydium's reported TVL");
});

test("constant product is preserved across a trade", () => {
  const k = REAL.cunt * REAL.sol;
  const r = simulateBuy({ tokenAmount: REAL.cunt, solAmount: REAL.sol, solIn: 1, feeRate: 0 });
  const kAfter = r.poolAfter.tokenAmount * r.poolAfter.solAmount;
  near(kAfter, k, 0.0001, "k before vs after (zero fee)");
});

test("fees make k grow — that is where LP earnings come from", () => {
  const k = REAL.cunt * REAL.sol;
  const r = simulateBuy({ tokenAmount: REAL.cunt, solAmount: REAL.sol, solIn: 1, feeRate: 0.0025 });
  const kAfter = r.poolAfter.tokenAmount * r.poolAfter.solAmount;
  assert.ok(kAfter > k, "with a fee, k must increase");
});

test("a buy raises the price and a sell lowers it", () => {
  const buy = simulateBuy({ tokenAmount: REAL.cunt, solAmount: REAL.sol, solIn: 1 });
  assert.ok(buy.priceImpactPct > 0, "buying must push price up");
  assert.ok(buy.slippagePct > 0, "the buyer must pay above spot");

  const sell = simulateSell({ tokenAmount: REAL.cunt, solAmount: REAL.sol, tokensIn: 1_000_000 });
  assert.ok(sell.priceImpactPct < 0, "selling must push price down");
});

test("a thin pool has brutal slippage, and the model shows it", () => {
  // This is the number that should decide how much SOL goes in. WinLEW's real
  // pool holds ~4.8 SOL; a 5 SOL buy is larger than the entire SOL side.
  const r = simulateBuy({ tokenAmount: REAL.cunt, solAmount: REAL.sol, solIn: 5 });
  assert.ok(r.slippagePct > 30, `a 5 SOL buy into a 4.8 SOL pool should slip hard, got ${r.slippagePct.toFixed(1)}%`);

  const deep = simulateBuy({ tokenAmount: REAL.cunt * 100, solAmount: REAL.sol * 100, solIn: 5 });
  assert.ok(deep.slippagePct < r.slippagePct / 10, "a 100x deeper pool must slip far less on the same trade");
});

// ── The §11 headline warning ────────────────────────────────────────────────
test("§11 — the LP RATIO sets the opening price, not the supply", () => {
  // Identical token supply, identical tokens in the pool, 100x the SOL.
  // If supply set the price these would match. They differ by exactly 100x.
  const thin = modelOpening({ cuntInPool: 100_000_000, solInPool: 10, solUsd: 150 });
  const deep = modelOpening({ cuntInPool: 100_000_000, solInPool: 1000, solUsd: 150 });

  assert.equal(thin.pctOfSupplyInPool, deep.pctOfSupplyInPool, "same share of supply in the pool");
  near(deep.priceUsd / thin.priceUsd, 100, 0.001, "100x the SOL is 100x the price");
  near(deep.fdvUsd / thin.fdvUsd, 100, 0.001, "and 100x the FDV");
});

test("depthRatio depends ONLY on the share of supply in the pool", () => {
  // Written first as "depth ratio should be under 1%" for a pool holding 10% of
  // supply, which failed at 20% — because the assertion was wrong, not the
  // model. depthRatio = 2 x (tokens in pool / total supply); the price cancels.
  // Adding SOL raises price and FDV in the same proportion and does not improve
  // depth at all. That is worth pinning, because it is counter-intuitive and it
  // is the actual lever on how fictional the FDV is.
  for (const [inPool, expected] of [[100_000_000, 0.20], [10_000_000, 0.02], [1_000_000, 0.002]]) {
    const m = modelOpening({ cuntInPool: inPool, solInPool: 10, solUsd: 150 });
    near(m.depthRatio, expected, 0.001, `${inPool} in pool`);
  }
  // Same supply share, 100x the SOL — depth ratio must not budge.
  const thin = modelOpening({ cuntInPool: 10_000_000, solInPool: 10, solUsd: 150 });
  const deep = modelOpening({ cuntInPool: 10_000_000, solInPool: 1000, solUsd: 150 });
  near(deep.depthRatio, thin.depthRatio, 0.001, "SOL does not change depth ratio");
  assert.ok(deep.fdvUsd > deep.poolValueUsd * 40, "FDV still vastly exceeds anything sellable");
});

test("modelOpening probes give monotonically worse slippage for bigger buys", () => {
  const m = modelOpening({ cuntInPool: 100_000_000, solInPool: 100, solUsd: 150 });
  for (let i = 1; i < m.impacts.length; i++) {
    assert.ok(
      m.impacts[i].slippagePct > m.impacts[i - 1].slippagePct,
      "a larger buy must always slip more"
    );
  }
});

test("the simulator refuses nonsense rather than returning it", () => {
  assert.throws(() => spotPriceInSol({ tokenAmount: 0, solAmount: 1 }), RangeError);
  assert.throws(() => spotPriceInSol({ tokenAmount: 1, solAmount: -5 }), RangeError);
  assert.throws(() => simulateBuy({ tokenAmount: 1, solAmount: 1, solIn: 1, feeRate: 1 }), RangeError);
  assert.throws(() => modelOpening({ cuntInPool: NaN, solInPool: 1, solUsd: 1 }), RangeError);
});

// ── §45 release controller ──────────────────────────────────────────────────
test("§8 DEMONSTRATED — a volume trigger fires for an attacker with no community", () => {
  // Two sybil identities, zero genuine participants, and manufactured volume.
  // The naive trigger fires almost immediately; nothing real has happened.
  const { timeline } = simulateRelease({
    weeks: 52, genuineParticipants: 0, sybilOperators: 2,
    washTradeVolumePerWeek: 300_000_000, seed: 7,
  });

  const naive = firstFiring(timeline, naiveVolumeTrigger);
  assert.ok(naive, "the naive trigger should fire — that is the problem");
  assert.equal(naive.week, 1, "wash trading fires it in the very first week");
  assert.ok(naive.uniqueClaimers <= 2, "with at most 2 participants in the whole system");

  const objective = firstFiring(timeline, objectiveTrigger);
  assert.equal(objective, null, "the objective trigger must never fire for this population");
});

test("FINDING — at 1,000 CUNT per claim the schedule takes ~47 years", () => {
  // Not a simulator bug. 600 participants claiming 55% of the time move
  // 330,000 CUNT a week; 800M at that rate is 2,424 weeks. If the release
  // stages are meant to be reachable, reward_per_claim has to be roughly 17,500
  // to clear BELLY's 300M in a year — seventeen times larger. This is exactly
  // the kind of thing §45 exists to surface before a number is written into a
  // program.
  const { final } = simulateRelease({
    weeks: 104, genuineParticipants: 600, claimRate: 0.55, rewardPerClaim: 1000, seed: 3,
  });
  assert.ok(final.pctDistributed < 5, `two years in, only ${final.pctDistributed.toFixed(1)}% is distributed`);
  assert.equal(firstFiring(final ? [final] : [], objectiveTrigger), null, "the distribution floor is nowhere near met");
});

test("the objective trigger fires for a genuine, distributed community", () => {
  const { timeline } = simulateRelease({
    weeks: 104, genuineParticipants: 600, claimRate: 0.55,
    rewardPerClaim: 17_500, seed: 3,
  });
  const fired = firstFiring(timeline, objectiveTrigger);
  assert.ok(fired, "a real community should eventually satisfy every condition");
  assert.ok(fired.week >= 12, "the elapsed-time floor must be respected");
  assert.ok(fired.uniqueClaimers >= 250);
  assert.ok(fired.top10Concentration <= 40);
});

test("the objective trigger holds back a community that is too concentrated", () => {
  // Few participants, so the top 10 own nearly everything.
  const { timeline } = simulateRelease({
    weeks: 104, genuineParticipants: 12, claimRate: 1.0, rewardPerClaim: 1000, seed: 5,
  });
  const last = timeline[timeline.length - 1];
  assert.ok(last.top10Concentration > 40, "12 participants means the top 10 hold most of it");
  assert.equal(firstFiring(timeline, objectiveTrigger), null, "concentration must block the release");
});

test("the objective trigger holds back a sybil-dominated distribution", () => {
  const { timeline } = simulateRelease({
    weeks: 104, genuineParticipants: 300, claimRate: 0.3,
    sybilOperators: 400, sybilClaimRate: 1.0, rewardPerClaim: 1000, seed: 11,
  });
  const last = timeline[timeline.length - 1];
  assert.ok(last.sybilShare > 25, `sybils should dominate this run, got ${last.sybilShare.toFixed(1)}%`);
  const fired = firstFiring(timeline, objectiveTrigger);
  assert.equal(fired, null, "sybil share must block the release");
});

test("automated sybils out-earn genuine participants per identity", () => {
  // Not a bug in the model — it is the finding. A script never misses a Tuesday;
  // people do. Any per-claim reward advantages automation, which is why the
  // sybil-share ceiling exists as a trigger condition.
  const { final } = simulateRelease({
    weeks: 52, genuineParticipants: 100, claimRate: 0.5,
    sybilOperators: 100, sybilClaimRate: 1.0, seed: 2,
  });
  assert.ok(final.sybilShare > 60, `equal identity counts should give sybils ~2x share, got ${final.sybilShare.toFixed(1)}%`);
});

test("stage boundaries match the tokenomics exactly", () => {
  assert.equal(stageFor(0), "BELLY");
  assert.equal(stageFor(299_999_999), "BELLY");
  assert.equal(stageFor(300_000_000), "CRAWL");
  assert.equal(stageFor(500_000_000), "RUN");
  assert.equal(stageFor(700_000_000), "FINAL_TUESDAY");
  assert.equal(stageFor(800_000_000), "COMPLETE");
});

test("distribution never exceeds the community budget", () => {
  const { timeline } = simulateRelease({
    weeks: 500, genuineParticipants: 5000, claimRate: 1.0, rewardPerClaim: 10_000, seed: 1,
  });
  for (const s of timeline) {
    assert.ok(s.distributed <= 800_000_000, `distributed ${s.distributed} exceeds the community bucket`);
    assert.ok(s.remaining >= 0, "remaining must never go negative");
  }
  assert.equal(timeline[timeline.length - 1].stage, "COMPLETE");
});

test("the simulation is deterministic — same seed, same result", () => {
  // A simulator whose output moves between runs cannot justify a decision.
  const a = simulateRelease({ weeks: 30, genuineParticipants: 50, seed: 42 });
  const b = simulateRelease({ weeks: 30, genuineParticipants: 50, seed: 42 });
  assert.deepEqual(a.timeline, b.timeline);
  const c = simulateRelease({ weeks: 30, genuineParticipants: 50, seed: 43 });
  assert.notDeepEqual(a.timeline, c.timeline, "a different seed must actually change the run");
});

test("no simulator touches the network or the filesystem", () => {
  // §45: "It must NOT trigger real transactions." §11: "DO NOT fetch private
  // data." Both modules must be pure arithmetic.
  // Comments are stripped first: both modules explain in prose why they do NOT
  // use Math.random or fetch, and scanning raw text flagged those explanations
  // as violations. Checking the code rather than the commentary is the point.
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const src = ["liquiditySim.js", "releaseSim.js"]
    .map((n) => stripComments(readFileSync(new URL(`../../src/cunt/${n}`, import.meta.url), "utf8")))
    .join("\n");

  for (const banned of ["fetch(", "Connection", "sendTransaction", "readFileSync", "process.env", "Math.random"]) {
    assert.ok(!src.includes(banned), `simulators must not reference ${banned} — they are pure arithmetic`);
  }
});

// ── Liquidity policy claims (§12) ───────────────────────────────────────────
test("the policy's opening table is reproducible", () => {
  // CUNT-LIQUIDITY-POLICY.md §3 publishes a table people will choose a number
  // from. Regenerate it and check the doc still says what the model says.
  const doc = readFileSync(new URL("../../docs/cunt/CUNT-LIQUIDITY-POLICY.md", import.meta.url), "utf8");
  for (const [sol, slip10] of [[10, 100.3], [50, 20.3], [250, 4.3]]) {
    const m = modelOpening({ cuntInPool: 100_000_000, solInPool: sol, solUsd: 150, probeBuysSol: [1, 10] });
    const got = m.impacts[1].slippagePct;
    assert.ok(
      Math.abs(got - slip10) < 0.15,
      `${sol} SOL: model says a 10 SOL buy slips ${got.toFixed(1)}%, the doc says ${slip10}%`
    );
    assert.ok(doc.includes(`${slip10}%`), `the doc must state ${slip10}% for the ${sol} SOL row`);
  }
});

test("splitting liquidity across two venues makes both worse", () => {
  // §6 recommends a single venue at birth. The reason is arithmetic: slippage
  // depends on the SOL side alone, so halving it into two pools roughly doubles
  // the slippage in each.
  const whole = simulateBuy({ tokenAmount: 100_000_000, solAmount: 100, solIn: 5 });
  const half = simulateBuy({ tokenAmount: 50_000_000, solAmount: 50, solIn: 5 });
  assert.ok(
    half.slippagePct > whole.slippagePct * 1.8,
    `splitting should roughly double slippage: ${whole.slippagePct.toFixed(2)}% -> ${half.slippagePct.toFixed(2)}%`
  );
});

test("LP fees are too small to fund anything, at real volume", () => {
  // §1 of the policy states $6.87/year on WinLEW's real pool. That figure is
  // load-bearing — it is the reason no plan may assume LP income.
  const LP_SHARE_OF_VOLUME = 0.0025 * 0.84; // 0.25% trade fee, LPs keep 84%
  const winlewDailyVolume = 8.96;
  const yearly = winlewDailyVolume * 365 * LP_SHARE_OF_VOLUME;
  assert.ok(yearly < 10, `LP fees should be under $10/year, computed $${yearly.toFixed(2)}`);
  const poolValue = 714;
  assert.ok((yearly / poolValue) * 100 < 2, "APR must be under 2% — not an income stream");
});

// ── §45: what the objective trigger does NOT resist ─────────────────────────
const prose = (t) => t.replace(/^[ \t]*>[ \t]?/gm, "").replace(/[*`_]/g, "").replace(/\s+/g, " ");
const simDoc = () => prose(readFileSync(new URL("../../docs/cunt/CUNT-SIMULATORS.md", import.meta.url), "utf8"));

test("sybilShare is recorded as uncomputable in production", () => {
  // The model identifies sybils by NAME. That is correct inside a simulation
  // and impossible outside one — so one of the five trigger conditions cannot
  // currently be implemented. If the doc stops saying so, a condition that
  // cannot be built starts looking like one that has been.
  const src = readFileSync(new URL("../../src/cunt/releaseSim.js", import.meta.url), "utf8");
  assert.match(src, /startsWith\("sybil-"\)/, "if the model stops labelling sybils, this finding needs rewriting");

  const doc = simDoc();
  assert.match(doc, /cannot be computed in production/i);
  assert.match(doc, /not implementable/i);
  assert.match(doc, /indistinguishable from genuine ones by construction/i);
  // The trigger's guarantee must be stated at its real strength, not more.
  assert.match(doc, /volume cannot summon a release/i);
});

test("the registration authority is named as the attacker the trigger does not stop", () => {
  // §8's attacker is an OUTSIDER manufacturing volume. register_participant is
  // held by the project, and it can manufacture the population the trigger
  // measures. Only the elapsed-weeks condition genuinely constrains it.
  const doc = simDoc();
  assert.match(doc, /OUTSIDER manufacturing a population/i);
  assert.match(doc, /Only the clock genuinely constrains it/i);

  // And the inversion: the concentration ceiling is EASIER for a manufactured
  // population than a real one, because real communities have whales.
  assert.match(doc, /concentration condition inverts/i);
  assert.match(doc, /real communities have whales/i);
  assert.match(doc, /rewards whoever can distribute most carefully/i);
});
