// Liquidity / opening-price simulator (§11).
//
// PURE ARITHMETIC. No network, no keys, no transactions, no price feeds. Every
// input is supplied by a human, including the SOL/USD reference — §11 forbids
// fetching, and a simulator that quietly reaches for live data is one whose
// output you cannot reproduce tomorrow.
//
// THE POINT OF THIS FILE:
//
//   THE LP RATIO ESTABLISHES THE OPENING PRICE.
//   TOKEN SUPPLY ALONE DOES NOT.
//
// A billion tokens is not a price. Putting 100,000,000 CUNT against 10 SOL and
// putting 100,000,000 CUNT against 1,000 SOL create the same supply and a
// hundredfold difference in opening price. This exists so a human can see the
// consequence before the pool is created, not after.
//
// Model: constant product (x·y=k), which is what Raydium's CPMM does. Validated
// against WinLEW's real pool in the tests — same maths, observed numbers.

/** Spot price of one token, denominated in the paired asset. */
export function spotPriceInSol({ tokenAmount, solAmount }) {
  assertPositive(tokenAmount, "tokenAmount");
  assertPositive(solAmount, "solAmount");
  return solAmount / tokenAmount;
}

/** Spot price in USD, using a manually supplied SOL/USD reference. */
export function spotPriceUsd({ tokenAmount, solAmount, solUsd }) {
  assertPositive(solUsd, "solUsd");
  return spotPriceInSol({ tokenAmount, solAmount }) * solUsd;
}

/**
 * Fully diluted valuation — total supply × price.
 *
 * FDV is the number that gets quoted and the number that misleads. It values
 * every token as if it could be sold at the current price, which is false for
 * any pool of finite depth: selling even a small fraction of supply into this
 * pool moves the price a long way. Reported here because people will compute it
 * anyway; `depthRatio` below is the honest companion figure.
 */
export function fdvUsd({ totalSupply, priceUsd }) {
  assertPositive(totalSupply, "totalSupply");
  return totalSupply * priceUsd;
}

/**
 * Result of buying with `solIn`, under constant product with a trading fee.
 *
 * Returns the tokens received, the effective (average) price paid, the spot
 * price after the trade, and the slippage against the pre-trade spot.
 */
export function simulateBuy({ tokenAmount, solAmount, solIn, feeRate = 0.0025 }) {
  assertPositive(tokenAmount, "tokenAmount");
  assertPositive(solAmount, "solAmount");
  assertPositive(solIn, "solIn");
  if (feeRate < 0 || feeRate >= 1) throw new RangeError("feeRate must be in [0, 1)");

  const k = tokenAmount * solAmount;
  const solInAfterFee = solIn * (1 - feeRate);
  // Output is priced on the AFTER-FEE amount, but the pool keeps the WHOLE
  // input — the fee stays behind as LP earnings, which is why k grows on every
  // trade. An earlier version deducted the fee and never credited it anywhere,
  // which silently made fees vanish and left k constant.
  const newTokens = k / (solAmount + solInAfterFee);
  const tokensOut = tokenAmount - newTokens;
  const poolSolAfter = solAmount + solIn;

  const spotBefore = solAmount / tokenAmount;
  const spotAfter = poolSolAfter / newTokens;
  const effective = solIn / tokensOut;

  return {
    tokensOut,
    effectivePriceSol: effective,
    spotBeforeSol: spotBefore,
    spotAfterSol: spotAfter,
    // What the buyer actually loses to curve + fee, against the quoted spot.
    slippagePct: (effective / spotBefore - 1) * 100,
    // What the trade does to the visible price.
    priceImpactPct: (spotAfter / spotBefore - 1) * 100,
    poolAfter: { tokenAmount: newTokens, solAmount: poolSolAfter },
  };
}

/** The mirror of simulateBuy: selling tokens back into the pool. */
export function simulateSell({ tokenAmount, solAmount, tokensIn, feeRate = 0.0025 }) {
  assertPositive(tokensIn, "tokensIn");
  const k = tokenAmount * solAmount;
  const tokensInAfterFee = tokensIn * (1 - feeRate);
  const newSol = k / (tokenAmount + tokensInAfterFee);
  const solOut = solAmount - newSol;
  const poolTokensAfter = tokenAmount + tokensIn; // fee retained, as above

  const spotBefore = solAmount / tokenAmount;
  const spotAfter = newSol / poolTokensAfter;

  return {
    solOut,
    effectivePriceSol: solOut / tokensIn,
    spotBeforeSol: spotBefore,
    spotAfterSol: spotAfter,
    slippagePct: (solOut / tokensIn / spotBefore - 1) * 100,
    priceImpactPct: (spotAfter / spotBefore - 1) * 100,
    poolAfter: { tokenAmount: poolTokensAfter, solAmount: newSol },
  };
}

/**
 * A full opening-position scenario. This is the function a human should run
 * before deciding what goes into the pool.
 *
 * `depthRatio` is the figure worth staring at: pool value as a fraction of FDV.
 * A 0.2% depth ratio means 99.8% of the notional "market cap" is not backed by
 * anything anyone could sell into.
 *
 * It reduces to something simple and slightly startling:
 *
 *     depthRatio = 2 x (tokens in pool / total supply)
 *
 * The price cancels out entirely. So depth relative to FDV is decided ONLY by
 * what fraction of supply you put in the pool — adding SOL raises the price and
 * the FDV in exactly the same proportion and does not improve it at all. The
 * only way to make FDV less fictional is to put more of the supply in the pool.
 */
export function modelOpening({
  cuntInPool,
  solInPool,
  solUsd,
  totalSupply = 1_000_000_000,
  feeRate = 0.0025,
  probeBuysSol = [0.1, 1, 5, 10, 50],
}) {
  const priceSol = spotPriceInSol({ tokenAmount: cuntInPool, solAmount: solInPool });
  const priceUsd = priceSol * solUsd;
  const poolValueUsd = solInPool * solUsd * 2; // both sides, equal value at spot
  const fdv = fdvUsd({ totalSupply, priceUsd });

  const impacts = probeBuysSol.map((solIn) => {
    const r = simulateBuy({ tokenAmount: cuntInPool, solAmount: solInPool, solIn, feeRate });
    return {
      solIn,
      usdIn: solIn * solUsd,
      tokensOut: r.tokensOut,
      slippagePct: r.slippagePct,
      priceImpactPct: r.priceImpactPct,
    };
  });

  return {
    priceSol,
    priceUsd,
    poolValueUsd,
    fdvUsd: fdv,
    // Pool depth as a share of FDV. Small numbers here mean the FDV is fiction.
    depthRatio: poolValueUsd / fdv,
    pctOfSupplyInPool: (cuntInPool / totalSupply) * 100,
    impacts,
  };
}

function assertPositive(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${String(v)}`);
  }
}
