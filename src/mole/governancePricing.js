// Governance vote-weight pricing (2026-07-28) — capped pay-per-vote weight,
// priced off a 3-day trailing average rather than a single moment's spot
// price. THIS AVERAGING IS THE REAL DEFENSE against the manipulation the
// project owner described directly (buy heavily, vote while the price is
// pumped, then sell) — a brief spike has limited effect on a 72-hour mean.
//
// Honest note on the market-cap/supply cross-check below: GeckoTerminal and
// DexScreener's own "market cap"/"fdv" fields are themselves computed as
// spot_price × supply (confirmed against this codebase's own price-fetch
// code, src/mole/web.js's fetchGeckoTerminalMarket/fetchDexScreenerMarket)
// — so market-cap-derived price is NOT an independent signal from spot
// price; it will not by itself catch a coordinated spot-price pump, which
// would move both together. What it DOES catch: a bad/stale/corrupted
// sample from one feed diverging sharply from the other, which the 3-day
// average alone wouldn't necessarily flag. Kept as a cheap, harmless
// consistency check, documented for what it actually protects against
// rather than oversold as independent anti-manipulation coverage.
//
// This file is deliberately pure math + storage read/write, no network
// calls of its own. The actual price/market-cap SAMPLING happens inside
// src/mole/web.js's startWeb() (where the existing GeckoTerminal/
// DexScreener/pump.fun fetch functions already live as closures — see
// buildPriceSnapshot()) via recordPriceSample() below. Keeping the pricing
// math here, separate and network-free, is what makes it directly unit-
// testable against synthetic sample sets.
import { readJson, writeJson } from "./storage.js";

const SAMPLES_FILE = "governance_price_samples.json";
const SAMPLE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export const USD_PER_VOTE = 1;
export const MAX_PURCHASED_VOTES_PER_PROPOSAL = 10;

// Divergence beyond which the market-cap/supply cross-check is treated as a
// meaningful disagreement (rather than ordinary noise between data
// sources) and the more conservative of the two prices is used instead of
// the plain 3-day average.
const DIVERGENCE_THRESHOLD = 0.15;

// Sanity bounds — if a data glitch ever produced an absurd price (near-zero
// or absurdly high), clamp rather than let it silently make votes free or
// unpurchasable. Wide enough to never bind under real market conditions;
// narrow enough to catch an obviously broken feed.
const MIN_WINLEW_PER_VOTE = 1;
const MAX_WINLEW_PER_VOTE = 1_000_000_000;

function readAllSamples() {
  return readJson(SAMPLES_FILE, []);
}

function writeAllSamples(samples) {
  writeJson(SAMPLES_FILE, samples);
}

/**
 * Records one price/market-cap observation and prunes anything older than
 * the 3-day window. Called periodically by web.js's own price-sampling
 * loop, never by pricing logic itself.
 */
export function recordPriceSample({ priceUsd, marketCapUsd, tsIso = new Date().toISOString() }) {
  const price = Number(priceUsd);
  if (!Number.isFinite(price) || price <= 0) return; // never record a broken sample
  const samples = readAllSamples();
  samples.push({ tsIso, priceUsd: price, marketCapUsd: Number.isFinite(Number(marketCapUsd)) ? Number(marketCapUsd) : null });
  const cutoffMs = Date.now() - SAMPLE_WINDOW_MS;
  writeAllSamples(samples.filter((s) => Date.parse(s.tsIso) >= cutoffMs));
}

/**
 * Pure math, no I/O — exported separately so tests can exercise it against
 * synthetic sample arrays without touching real storage. `samples` is the
 * raw array as stored (unfiltered by window; this function does the window
 * filtering itself so it's a faithful stand-in for the real read path).
 */
export function computeVotePriceFromSamples(samples, { supply, nowMs = Date.now(), divergenceThreshold = DIVERGENCE_THRESHOLD } = {}) {
  const cutoffMs = nowMs - SAMPLE_WINDOW_MS;
  const windowed = (Array.isArray(samples) ? samples : []).filter((s) => Date.parse(s?.tsIso) >= cutoffMs && Number.isFinite(Number(s?.priceUsd)) && Number(s.priceUsd) > 0);

  if (windowed.length === 0) {
    return { ok: false, error: "no_price_samples_in_window" };
  }

  const avgPriceUsd = windowed.reduce((sum, s) => sum + Number(s.priceUsd), 0) / windowed.length;

  // Cross-check from the most recent sample carrying a market cap — a
  // consistency check against a bad/stale sample from one feed, not an
  // independent anti-pump signal (market cap here is itself derived from
  // spot price, see the file header). The 3-day average above is what
  // actually resists a brief manipulated spike.
  const withMarketCap = [...windowed].reverse().find((s) => Number.isFinite(Number(s.marketCapUsd)) && Number(s.marketCapUsd) > 0);
  const safeSupply = Number(supply);
  const crossCheckPriceUsd = withMarketCap && safeSupply > 0 ? Number(withMarketCap.marketCapUsd) / safeSupply : null;

  let effectivePriceUsd = avgPriceUsd;
  let usedCrossCheck = false;
  if (crossCheckPriceUsd && crossCheckPriceUsd > 0) {
    const divergence = Math.abs(crossCheckPriceUsd - avgPriceUsd) / avgPriceUsd;
    if (divergence > divergenceThreshold) {
      // Disagreement beyond noise — use whichever price is LOWER (a lower
      // USD price means MORE WinLEW is needed per $1 vote, the conservative,
      // harder-to-game direction), not whichever is more convenient.
      effectivePriceUsd = Math.min(avgPriceUsd, crossCheckPriceUsd);
      usedCrossCheck = true;
    }
  }

  const rawWinlewPerVote = USD_PER_VOTE / effectivePriceUsd;
  const winlewPerVote = Math.min(MAX_WINLEW_PER_VOTE, Math.max(MIN_WINLEW_PER_VOTE, rawWinlewPerVote));

  return {
    ok: true,
    effectivePriceUsd,
    winlewPerVote,
    usedCrossCheck,
    avgPriceUsd,
    crossCheckPriceUsd,
    sampleCount: windowed.length,
  };
}

/**
 * Real read path — pulls stored samples and the current on-chain supply
 * (caller passes `supply`, from src/mole/solana.js's getMintSnapshot(),
 * since this module deliberately has no network calls of its own).
 */
export function getVotePriceInWinlew({ supply }) {
  return computeVotePriceFromSamples(readAllSamples(), { supply });
}
