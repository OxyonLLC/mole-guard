// Circulating supply for $WinLEW — the calculation behind /transparency/.
//
// A separate module rather than a closure inside web.js for one reason: this
// math has to be checkable. It is the number a listing reviewer at CoinMarketCap
// or CoinGecko will act on, so it needs unit tests that do not require booting a
// server or reaching Solana — see test/mole/circulatingSupply.test.mjs.
//
// Pure. No I/O, no RPC, no clock beyond a timestamp. It is handed the same live
// component reads that /transparency/ already renders and derives everything
// from them, so a figure in the summary cannot disagree with the card it cites.

import { WINLEW_DECIMALS } from "./burnEvents.js";
import { baseUnitsToDecimalString } from "../faucet/amount.js";

// ── Circulating supply ──────────────────────────────────────────────────
//
// Every exclusion from circulating supply lives here, keyed by the component
// whose LIVE balance supplies the number. Nothing is hardcoded: the amounts
// come from the same reads that render the cards above, so a claim on this
// page cannot disagree with the component it cites.
//
// The rule for being in this map is narrow, and deliberately so: the tokens
// must be held by a program — a Jupiter Lock escrow or a Streamflow vesting
// contract — under a schedule that prevents the project from spending them
// today. "We call it a reserve" is not a reason. See NOT_EXCLUDED below for
// the balances that are project-controlled and are therefore counted as
// circulating, which is the conservative direction and the credible one.
//
// scheduleSource matters and is surfaced to the reader:
//   on-chain-decoded  — the escrow account's own bytes were read and the
//                       schedule reconstructed to the base unit
//   project-reported  — the schedule is documented by the project; the
//                       BALANCE is on-chain, the timetable is not decoded
export const SUPPLY_EXCLUSIONS = {
  lock50m: {
    provider: "Jupiter Lock",
    lockType: "Periodic vesting — 10,000,000 per year",
    startIso: "2025-04-25",
    fullyUnlockedIso: "2030-04-24",
    scheduleSource: "project-reported",
    // Elapsed anniversaries at the time of writing. Stated because hiding it
    // would be the exact "artificially lower the circulating supply" move
    // this page exists to disprove: some of this escrow is claimable today.
    vestedNote: "One annual release (2026-04-25) has elapsed, so roughly 10,000,000 is claimable. The escrow balance still shows the full amount, which is the on-chain evidence that nothing has been claimed.",
    earlyWithdrawal: "Not publicly available — the escrow's cancel authority has not been decoded.",
    projectControls: false,
    reason: "Held by a Jupiter Lock escrow under a multi-year release schedule, not in a spendable project wallet.",
  },
  lock19mDev: {
    provider: "Jupiter Lock",
    lockType: "Cliff then periodic — 9,192,210.751092 at cliff, then 2,000,000 per year",
    startIso: "2026-08-11",
    cliffIso: "2028-08-11",
    fullyUnlockedIso: "2033-08-10",
    // The one schedule that was read from the account rather than taken on
    // report: the layout was anchored on known pubkeys and then validated by
    // reconstruction — cliff 9,192,210.751092 + 2,000,000 x 5 equals the
    // 19,192,210.751092 actually transferred, to the base unit.
    scheduleSource: "on-chain-decoded",
    vestedNote: "Nothing vests until the 2028 cliff, so none of this is claimable today.",
    earlyWithdrawal: "Requires verification — the escrow's cancel_mode byte reads 0, which most likely means it cannot be cancelled, but that enum has not been confirmed against Jupiter's program source. Not claimed as irrevocable.",
    projectControls: false,
    reason: "Developer Reserve self-lock in a Jupiter Lock escrow with a three-year cliff.",
    evidenceTx: "2c1Ltdm36wGXrQEigBq4CFoALmcfjdYL2V7Pnn15weKnxG8QPJ2Fd62MmMHyJAEtRXEdaqfoXS7fMjzdV7RJk84H",
  },
  lock15mTeam: {
    provider: "Jupiter Lock",
    lockType: "Periodic vesting — 7,500,000 per year",
    startIso: "2025-03-01",
    fullyUnlockedIso: "2027-03-01",
    scheduleSource: "project-reported",
    vestedNote: "One annual release (2026-03-01) has elapsed, so roughly 7,500,000 is claimable. The escrow balance still shows the full amount, which is the on-chain evidence that nothing has been claimed.",
    earlyWithdrawal: "Not publicly available — the escrow's cancel authority has not been decoded.",
    projectControls: false,
    reason: "Team allocation held by a Jupiter Lock escrow under a scheduled release.",
  },
  lock25mFaucet: {
    provider: "Jupiter Lock",
    lockType: "Full cliff — nothing releases before the cliff",
    startIso: "2026-08-08",
    cliffIso: "2031-09-01",
    fullyUnlockedIso: "2036-08-30",
    scheduleSource: "project-reported",
    vestedNote: "Nothing is claimable today. On unlock it returns to the X (Twitter) Faucet Reserve, not to an individual.",
    earlyWithdrawal: "Not publicly available — the escrow's cancel authority has not been decoded.",
    projectControls: false,
    reason: "Faucet runway locked in a Jupiter Lock escrow for ten years.",
    evidenceTx: "5Q2dFg4Ct9Cs8XrxLGKUpWF1FXkKpMAppBvWKJcHqpr58fbnHoyWPAfrf1m3dC3mx5oFFhWrLv3k5hWeHgn1E7ZC",
  },
  streamflow22m: {
    provider: "Streamflow",
    lockType: "Full cliff — 0% releases before the cliff",
    cliffIso: "2035-10-29",
    fullyUnlockedIso: "2035-10-29",
    scheduleSource: "project-reported",
    vestedNote: "Nothing is claimable today.",
    earlyWithdrawal: "Not publicly available.",
    projectControls: false,
    reason: "Held by a Streamflow on-chain vesting contract under a full cliff.",
  },
  streamflow7m: {
    provider: "Streamflow",
    lockType: "Full cliff — 0% releases before the cliff",
    cliffIso: "2030-10-29",
    fullyUnlockedIso: "2030-10-29",
    scheduleSource: "project-reported",
    vestedNote: "Nothing is claimable today.",
    earlyWithdrawal: "Not publicly available.",
    projectControls: false,
    reason: "Held by a second, separate Streamflow vesting contract under a full cliff.",
  },
};

// Balances a reader might expect to see deducted, and the reason each one is
// NOT. Every entry names the component whose live balance it refers to, so
// the figures shown here are the same reads as the cards above.
export const SUPPLY_NOT_EXCLUDED = [
  {
    componentId: "burn",
    label: "Burn wallet",
    reason: "Staged for burn is not burned. These tokens still exist and the mint's total supply still counts them, so this page counts them too. They leave supply only when a Solana burn instruction destroys them — see the Burn Center for burns that have actually executed.",
  },
  {
    componentId: "developer",
    label: "Developer Reserve",
    reason: "Project-controlled but unlocked and freely transferable. Calling a wallet a reserve is not a reason to remove it from circulating supply.",
  },
  {
    componentId: "faucetReserveDiscordWeb",
    label: "Discord & Web Faucet Reserve",
    reason: "Unlocked, and actively paid out to users — these tokens are entering circulation, not withheld from it.",
  },
  {
    componentId: "xFaucetReserve",
    label: "X (Twitter) Faucet Reserve",
    reason: "Unlocked and freely transferable. Only the 25M locked out of this wallet into a Jupiter Lock escrow is excluded, and it is listed above under its own escrow address.",
  },
  {
    componentId: "liquidityVaults",
    label: "Raydium pool liquidity",
    reason: "Tradeable inventory. Anyone holding the pool's LP tokens can withdraw it with no lock or cliff, and it is what the market trades against — liquidity is circulating by definition.",
  },
];

/** uiAmount float -> exact base units. Safe because every WinLEW balance is
 *  an integer number of base units well inside 2^53; Math.round removes the
 *  float representation error rather than letting it accumulate in a sum. */
export function winlewToBaseUnits(uiAmount) {
  if (!Number.isFinite(uiAmount)) return null;
  return BigInt(Math.round(uiAmount * 10 ** WINLEW_DECIMALS));
}

/**
 * Circulating supply, computed from the same live component reads the page
 * already renders.
 *
 * FAILS LOUD, NEVER QUIETLY. If the mint or ANY excluded component could not
 * be read, this returns `ok: false` with the list of what was missing and NO
 * circulating figure at all. That matters more than availability: a dropped
 * exclusion does not produce a slightly-wrong number, it produces a number
 * that is too HIGH by the size of the missing lock, and it would look
 * completely normal. A page that says "cannot compute right now" is honest;
 * one that quietly publishes 950,000,000 because six RPC calls failed is not.
 */
export function buildCirculatingSupply(mint, components) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const problems = [];

  const totalSupplyBaseUnits = Number.isFinite(mint?.supply) ? winlewToBaseUnits(mint.supply) : null;
  if (totalSupplyBaseUnits == null) problems.push("mint total supply unavailable");

  const excluded = [];
  let nonCirculating = 0n;
  for (const [id, meta] of Object.entries(SUPPLY_EXCLUSIONS)) {
    const component = byId.get(id);
    if (!component || component.ok === false) {
      problems.push(`${id}: component read failed`);
      continue;
    }
    const base = winlewToBaseUnits(component.winlewBalance);
    if (base == null) {
      problems.push(`${id}: balance unreadable`);
      continue;
    }
    nonCirculating += base;
    excluded.push({
      id,
      label: component.label,
      address: component.address,
      amountBaseUnits: base.toString(),
      amountDisplay: baseUnitsToDecimalString(base.toString(), WINLEW_DECIMALS),
      solscanUrl: `https://solscan.io/account/${component.address}`,
      ...meta,
    });
  }

  if (problems.length || totalSupplyBaseUnits == null) {
    return {
      ok: false,
      reason: "incomplete_source_data",
      problems,
      computedAtIso: new Date().toISOString(),
    };
  }

  const circulating = totalSupplyBaseUnits - nonCirculating;
  const pct = (part) => Number(((Number(part) / Number(totalSupplyBaseUnits)) * 100).toFixed(4));

  return {
    ok: true,
    computedAtIso: new Date().toISOString(),
    mint: mint.address,
    decimals: WINLEW_DECIMALS,
    totalSupplyBaseUnits: totalSupplyBaseUnits.toString(),
    totalSupplyDisplay: baseUnitsToDecimalString(totalSupplyBaseUnits.toString(), WINLEW_DECIMALS),
    nonCirculatingBaseUnits: nonCirculating.toString(),
    nonCirculatingDisplay: baseUnitsToDecimalString(nonCirculating.toString(), WINLEW_DECIMALS),
    circulatingBaseUnits: circulating.toString(),
    circulatingDisplay: baseUnitsToDecimalString(circulating.toString(), WINLEW_DECIMALS),
    circulatingPct: pct(circulating),
    nonCirculatingPct: pct(nonCirculating),
    excluded: excluded.sort((a, b) => (BigInt(b.amountBaseUnits) > BigInt(a.amountBaseUnits) ? 1 : -1)),
    notExcluded: SUPPLY_NOT_EXCLUDED.map((entry) => {
      const component = byId.get(entry.componentId);
      const base = component && component.ok !== false ? winlewToBaseUnits(component.winlewBalance) : null;
      return {
        ...entry,
        address: component?.address || null,
        amountDisplay: base == null ? null : baseUnitsToDecimalString(base.toString(), WINLEW_DECIMALS),
        solscanUrl: component?.address ? `https://solscan.io/account/${component.address}` : null,
      };
    }),
  };
}

