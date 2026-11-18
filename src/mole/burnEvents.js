// Burn Program — verified, structured burn-event records. This is the
// single source of truth the /burn/ page and /api/burn/status read from.
// See docs/burn-program.md for what "verified" means, the exact
// verification method used for each event, and the process for adding a
// future event once it happens.
//
// SAFETY: this file is pure data + pure read functions. It contains no
// signing capability, no private key material, and no ability to execute a
// transaction. Nothing in this module — or anything that imports it — can
// send tokens or sign anything. See docs/burn-program.md's security section.
//
// All amounts are base-unit STRINGS (WinLEW has 6 decimals), never numbers —
// this file must never do floating-point arithmetic on token amounts. Use
// BigInt here, or src/faucet/amount.js's baseUnitsToDecimalString for
// display formatting.

export const WINLEW_MINT = "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";
export const WINLEW_DECIMALS = 6;
export const BURN_WALLET_ADDRESS = "EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74";

// Long-term burn goal from the original roadmap: 100,000,000 WinLEW, in base units.
export const BURN_TARGET_BASE_UNITS = "100000000000000";

// The August 1 date has been publicly described as an annual project
// benchmark, not a contractually scheduled transaction — see
// docs/burn-program.md for why this is intentionally not modeled as a
// "scheduled" burn event with a guaranteed amount.
export const BURN_BENCHMARK = Object.freeze({
  label: "August 1 — Annual Project Benchmark",
  description: "A recurring annual point of reference the project has publicly used to talk about burn progress. It is not a guaranteed scheduled transaction with a committed amount — see the burn events below for what has actually been executed on-chain.",
});

export const BURN_EVENT_STATUSES = Object.freeze({
  CONFIRMED_BURN: "confirmed-burn",
  TRANSFERRED_TO_BURN_WALLET: "transferred-to-burn-wallet",
  QUEUED: "queued",
  PENDING_VERIFICATION: "pending-verification",
  DISPUTED: "disputed",
  UNKNOWN: "unknown",
});

// Only "confirmed-burn" counts toward verified progress — see
// computeBurnProgress() below. Every other status represents tokens that
// have moved but have not (yet, or provably) been permanently destroyed.
const PROGRESS_COUNTED_STATUSES = new Set([BURN_EVENT_STATUSES.CONFIRMED_BURN]);
const STAGED_STATUSES = new Set([BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET, BURN_EVENT_STATUSES.QUEUED]);

/**
 * Verified burn events. Every entry here was independently confirmed by
 * fetching the transaction from Solana mainnet and inspecting its parsed
 * instructions directly — not transcribed from a narrative claim. Both
 * entries below are a real `spl-token` `burn` instruction (not a transfer),
 * authorized by the burn wallet itself, on the WinLEW mint — i.e. tokens
 * provably destroyed from total supply, not just relocated to an address.
 *
 * The burn wallet's ENTIRE transaction history (all 27 signatures it has
 * ever had, as of the verification date below) was fetched and checked for
 * burn instructions — these two are the only ones found. That doesn't rule
 * out a burn executed through some other mechanism entirely, but there is
 * no unaccounted-for burn transaction on this wallet.
 */
export const BURN_EVENTS = [
  {
    // Seeded 2026-08-01 from a full reconstruction of the burn wallet's
    // token-account history. Together with the 1,529,373.21 below it feeds
    // burn-2025-02-22 exactly — see docs/burn-program.md §7a.
    id: "transfer-2025-02-16-dev-reserve-to-burn-wallet",
    dateIso: "2025-02-16T04:49:54.000Z",
    amountBaseUnits: "300000000000",
    signature: "5ZTegcbe6FxMXhqxdjXqnCSWMngUrL8nWrQhreDXnE1G1yPBvZc7RaLc57UdidNBkTcpyvtEW4Lwn5BfzRC9Q9GF",
    sourceWallet: "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2025-02-22",
    supersededNote: "Fully destroyed by burn-2025-02-22 six days later; the staged balance went to zero.",
    eventType: "project-reserve-transfer",
    notes: "300,000.000000 WinLEW moved from the Developer Reserve (D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ) into the burn wallet on 2025-02-16 — a single spl-token `transferChecked`, signed by the Developer Reserve itself. A project-internal reserve-to-burn-wallet move, not an outside donation. Fully consumed six days later by burn-2025-02-22.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data and fee-payer inspection, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5ZTegcbe6FxMXhqxdjXqnCSWMngUrL8nWrQhreDXnE1G1yPBvZc7RaLc57UdidNBkTcpyvtEW4Lwn5BfzRC9Q9GF",
  },
  {
    id: "transfer-2025-02-22-winlew-sol-to-burn-wallet",
    dateIso: "2025-02-22T03:54:45.000Z",
    amountBaseUnits: "1529373210000",
    signature: "2FDR7x8PZaZ4wTwJnSUFPBRmsxjKy1xjNGAqoDe6ohcPLhEr4kEZYEBCUnN46H9vVBVBf7B5vqtuzcRXJoXYLgT6",
    sourceWallet: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2025-02-22",
    supersededNote: "Fully destroyed by burn-2025-02-22 four minutes later; the staged balance went to zero.",
    eventType: "project-reserve-transfer",
    notes: "1,529,373.210000 WinLEW moved from the project wallet (Winlew.sol, GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp) into the burn wallet on 2025-02-22, four minutes before that day's burn. A single spl-token `transferChecked`, signed by Winlew.sol itself — project-internal, not an outside donation. This plus the 300,000 of 2025-02-16 equals 1,829,373.210000, which is EXACTLY what burn-2025-02-22 destroyed minutes later; the staged balance went to zero.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data and fee-payer inspection, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2FDR7x8PZaZ4wTwJnSUFPBRmsxjKy1xjNGAqoDe6ohcPLhEr4kEZYEBCUnN46H9vVBVBf7B5vqtuzcRXJoXYLgT6",
  },
  {
    id: "burn-2025-02-22",
    dateIso: "2025-02-22T03:59:00.000Z",
    amountBaseUnits: "1829373210000",
    signature: "3NTpyg1haByfK74zJp8dNnYtRRUZqNHHydaFgDHZkB1hYFCRTSNnKqVHKEmXTSsbgZSMqTs6vFPKBoYePMjTa5Br",
    sourceWallet: BURN_WALLET_ADDRESS,
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "spl-token-burn-instruction",
    notes: "Publicly referenced historically as part of an approximate \"2M burned\" community statement. The independently verified on-chain amount is ~1.83M, not exactly 2M — the earlier figure was a narrative approximation, not a correction to this transaction.",
    evidenceSource: "Solana mainnet (api.mainnet-beta.solana.com), getTransaction jsonParsed instruction data, independently verified 2026-07-16",
    verifiedAtIso: "2026-07-16T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/3NTpyg1haByfK74zJp8dNnYtRRUZqNHHydaFgDHZkB1hYFCRTSNnKqVHKEmXTSsbgZSMqTs6vFPKBoYePMjTa5Br",
  },
  {
    // The EARLIER of the project's two buy-and-burn purchases (the other is
    // buy-and-burn-2026-01-06-market-buy). Same signature pattern: the burn
    // wallet itself signs, tokens come from the pump.fun bonding curve.
    // Buying is not burning — see docs/burn-program.md §7a.
    id: "buy-and-burn-2025-02-22-market-buy",
    dateIso: "2025-02-22T04:31:00.000Z",
    amountBaseUnits: "77932510911",
    signature: "2VfMHaRomvUTpBWPE6XDscSJZjoDnAbQjrR5EFYBkbvPLFSKynKT4dGN7M3QFxpfyqBtzzqUvdyrU3xFy1dCcdrv",
    sourceWallet: "H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2025-08-02",
    supersededNote: "Fully destroyed by burn-2025-08-02, completing this buy-and-burn.",
    eventType: "buy-and-burn-market-buy",
    notes: "BUY-AND-BURN — the acquisition half, and the first of two such purchases. Thirty-two minutes after burn-2025-02-22 emptied the wallet, the project bought 77,932.510911 WinLEW off the open market straight back into it. Verified as a self-executed buy rather than a donation: the burn wallet (EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74) is the fee payer and signer, the transaction runs against pump.fun's bonding-curve program (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P), and the transfer's authority is the bonding-curve account H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg rather than any holder wallet. Purchased supply is NOT destroyed supply — it sat staged until burn-2025-08-02 destroyed it along with the 10,000,000 that followed. Recorded TRANSFERRED_TO_BURN_WALLET so a purchase can never be mistaken for a destruction.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data and fee-payer inspection, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2VfMHaRomvUTpBWPE6XDscSJZjoDnAbQjrR5EFYBkbvPLFSKynKT4dGN7M3QFxpfyqBtzzqUvdyrU3xFy1dCcdrv",
  },
  {
    id: "transfer-2025-04-03-dev-reserve-to-burn-wallet",
    dateIso: "2025-04-03T03:48:32.000Z",
    amountBaseUnits: "10000000000000",
    signature: "oMVJzBDMZctbaVc2nkiW1q67vxQCZGA8RApdnVk5RAfxCVLWAxweNmk3k3R92E1MynxbXhpHNeLkArJTwgpTszy",
    sourceWallet: "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2025-08-02",
    supersededNote: "Fully destroyed by burn-2025-08-02 four months later; the staged balance went to zero.",
    eventType: "project-reserve-transfer",
    notes: "10,000,000.000000 WinLEW moved from the Developer Reserve (D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ) into the burn wallet on 2025-04-03 — a single spl-token `transferChecked` signed by the Developer Reserve itself. Project-internal, not an outside donation. This plus the 77,932.510911 buy-and-burn purchase of 2025-02-22 equals 10,077,932.510911, EXACTLY what burn-2025-08-02 destroyed four months later; the staged balance again went to zero.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data and fee-payer inspection, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/oMVJzBDMZctbaVc2nkiW1q67vxQCZGA8RApdnVk5RAfxCVLWAxweNmk3k3R92E1MynxbXhpHNeLkArJTwgpTszy",
  },
  {
    id: "burn-2025-08-02",
    dateIso: "2025-08-02T01:07:53.000Z",
    amountBaseUnits: "10077932510911",
    signature: "2KmuXS7CWQskiU6MxyuwfhYfjvyfckQ47u9obQeLpLRWUz4t2eXZwMeU24gNoFp4P4KZDH43FGikhwdWfGspkoNY",
    sourceWallet: BURN_WALLET_ADDRESS,
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "spl-token-burn-instruction",
    notes: "Executed the day after the August 1 project benchmark date (2025-08-01) — consistent with the \"~10M sent to the burn address\" community statement (independently verified on-chain amount: ~10.08M).",
    evidenceSource: "Solana mainnet (api.mainnet-beta.solana.com), getTransaction jsonParsed instruction data, independently verified 2026-07-16",
    verifiedAtIso: "2026-07-16T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2KmuXS7CWQskiU6MxyuwfhYfjvyfckQ47u9obQeLpLRWUz4t2eXZwMeU24gNoFp4P4KZDH43FGikhwdWfGspkoNY",
  },
  {
    // A BUY-AND-BURN action, not a donation: the project bought these off
    // the open market specifically to remove them from circulation. The buy
    // is this event; the destruction came later, via a separate burn
    // instruction, and only a real burn ever counts as destroyed.
    id: "buy-and-burn-2026-01-06-market-buy",
    dateIso: "2026-01-06T04:01:04.000Z",
    amountBaseUnits: "2624510334951",
    signature: "2Ziq7etjuG1SeMo7FWZ4kns1FckqXVU4Ru4srb99xT3jUJiwqR99AcuTaEShyarmq9kN8UWEcRmtLuTUGroNrUkE",
    sourceWallet: "H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2026-08-01",
    supersededNote: "Consumed on 2026-08-01: the wallet was emptied, part destroyed by burn-2026-08-01 and the remainder moved out. Tokens are fungible, so no split between the two is claimable per-event.",
    eventType: "buy-and-burn-market-buy",
    notes: "BUY-AND-BURN — the acquisition half. On 2026-01-06 the project bought 2,624,510.334951 WinLEW off the open market directly into the burn wallet, for the express purpose of removing it from circulation. Verified as a self-executed buy rather than a donation: the burn wallet itself (EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74) is the fee payer and signer, and the transaction runs against pump.fun's bonding-curve program (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P, plus the pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ fee program), so the tokens arrive FROM the bonding-curve account H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg and not from any holder's wallet. CRITICAL: buying tokens is not destroying them. Purchased supply sits in the burn wallet exactly like a donation does — still part of total supply, still moveable — until a real spl-token burn instruction executes against it. That is why this is TRANSFERRED_TO_BURN_WALLET and not CONFIRMED_BURN, and why the buy-and-burn is only half-complete at this event; the destruction came later and is counted only through its own burn transaction (the 2026-08-01 benchmark burn consumed part of this balance). Recording the buy separately from the burn is deliberate — collapsing them would let a purchase masquerade as a destruction. Seeded 2026-08-01 while reconciling the wallet's full pre-2026-07-16 history; together with FreeCryptoA's 4,000,000 (2026-05-30) it exactly accounts for the 6,624,510.334951 balance read on 2026-07-16, which earlier drafts of the docs wrongly described as having no recorded origin.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data and fee-payer inspection, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2Ziq7etjuG1SeMo7FWZ4kns1FckqXVU4Ru4srb99xT3jUJiwqR99AcuTaEShyarmq9kN8UWEcRmtLuTUGroNrUkE",
  },
  {
    // A genuine unprompted third-party donation, like millerknoll's later
    // 50M — attribution confirmed by the project owner 2026-08-01.
    //
    // STANDING ATTRIBUTION RULE (owner-supplied, 2026-08-01): ANY transfer
    // into burn.winlew.sol from 64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp
    // is FreeCryptoA. Credit future ones to them without re-asking. As of
    // 2026-08-01 a full scan of the burn wallet's token-account history found
    // exactly one such transfer — this entry.
    id: "transfer-2026-05-30-freecryptoa-donation",
    dateIso: "2026-05-30T14:31:09.000Z",
    amountBaseUnits: "4000000000000",
    signature: "2xrrhuvRHaUqeEevgHiREAEmmhxFFZQiXYHP8kbHueBMtBWG5h5QGSNqru1cmyYuVXhGG3YKEK9MALEzhJXi62ec",
    sourceWallet: "64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2026-08-01",
    supersededNote: "Consumed on 2026-08-01: the wallet was emptied, part destroyed by burn-2026-08-01 and the remainder moved out. The project then restocked a matching 50,000,000 (see transfer-2026-08-01-restock-burn-wallet).",
    eventType: "holder-voluntary-transfer",
    notes: "FreeCryptoA (known on X) sent 4,000,000.000000 WinLEW to the burn wallet on 2026-05-30 from 64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp — a single clean spl-token transfer, signed by that wallet itself, with no swap or program interaction involved beyond ComputeBudget. This is the only genuine outside donation among the inflows making up the 6,624,510.334951 pre-2026-07-16 balance; the other component (2,624,510.334951 on 2026-01-06) was the project's own market buy, not a gift. Attribution to FreeCryptoA was supplied by the project owner and confirmed against this specific transfer on 2026-08-01 before being recorded — the chain proves the amount, wallet, and timing, not the human identity behind the address, and this ledger does not claim otherwise. STAGED, NOT DESTROYED: it does not move Verified Progress until a real burn instruction is executed. Chronologically the second-largest voluntary contribution to the burn wallet, after millerknoll's 50,000,000 (see transfer-2026-07-25-holder-to-burn-wallet).",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-08-01; donor identity attributed by the project owner, not derived from chain data",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2xrrhuvRHaUqeEevgHiREAEmmhxFFZQiXYHP8kbHueBMtBWG5h5QGSNqru1cmyYuVXhGG3YKEK9MALEzhJXi62ec",
  },
  {
    id: "burn-2026-07-22-boost-01",
    dateIso: "2026-07-22T15:59:27Z",
    amountBaseUnits: "974976809770",
    signature: "nGY6JVU2jMZtYNvfZQtEnpJnGWH4HqTaXxRaLToz5qPvtgoutaVHDoVEjJgYjnCW9NjBGuFyq1xcC6R21docp5n",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "1 of 29 spl-token burn instructions that make up pump.fun's BOOST post-graduation buyback-and-burn for $WinLEW, executed 2026-07-22T15:59:27Z\u2013T16:04:42Z (~5m15s after graduation, matching BOOST's documented 'first five minutes, TWAP-spread' mechanism, funded by ~17.58 SOL). Every one of these 29 burns shares the same authority \u2014 the WinLEW/SOL PumpSwap pool itself (Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL) \u2014 executing a real spl-token burn against its own WinLEW reserve token account (9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci, created at graduation), not any separate external vault \u2014 which is exactly why the bonding-curve reserve account and the burn wallet (both checked earlier) never showed it. Sum of all 29: 22,921,540.25632 WinLEW \u2014 within 96.54 WinLEW (0.0004%) of the originally-reconstructed supply-delta gap (22,921,636.800396); that tiny residual is presumed to be one or two further BOOST burn instructions in the same window that this session's RPC scan could not fetch (rate-limited), and is left as a documented open sliver rather than rounded away. Independently found and verified via a full transaction scan of the WinLEW mint's signature history restricted to this 5-minute window (Solana mainnet, Alchemy RPC, jsonParsed getTransaction on each), cross-checked against a second independent search (2026-07-25).",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/nGY6JVU2jMZtYNvfZQtEnpJnGWH4HqTaXxRaLToz5qPvtgoutaVHDoVEjJgYjnCW9NjBGuFyq1xcC6R21docp5n",
  },
  {
    id: "burn-2026-07-22-boost-02",
    dateIso: "2026-07-22T15:59:39Z",
    amountBaseUnits: "652995566531",
    signature: "4LDfVqkBWN6XsST8J7DHAbgpdVG3DfopDhP8pxim7794enWdCyiRCA6n4bJtkfQLxr2h9Mrr9urKsQLWqJJ4c5kw",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "2 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4LDfVqkBWN6XsST8J7DHAbgpdVG3DfopDhP8pxim7794enWdCyiRCA6n4bJtkfQLxr2h9Mrr9urKsQLWqJJ4c5kw",
  },
  {
    id: "burn-2026-07-22-boost-03",
    dateIso: "2026-07-22T15:59:49Z",
    amountBaseUnits: "944570433457",
    signature: "4jhde8t32c7kvRmSe49fLT6rYFMn4pfVmDALEJ8pXffjXSmNiLjHA6v2uBEg8M3gU6K6eoxdK1Ja8iPH9mVsuUeM",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "3 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4jhde8t32c7kvRmSe49fLT6rYFMn4pfVmDALEJ8pXffjXSmNiLjHA6v2uBEg8M3gU6K6eoxdK1Ja8iPH9mVsuUeM",
  },
  {
    id: "burn-2026-07-22-boost-04",
    dateIso: "2026-07-22T16:00:00Z",
    amountBaseUnits: "467601464934",
    signature: "4B6QpwRT9WS8LL8s3EPz3YrxkNeCiFySmqpjPdKUSrCfp6apRMJ1Fxz8uf3bGoiiRzSZYfDKzDr7eS7cp7H9aUGq",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "4 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4B6QpwRT9WS8LL8s3EPz3YrxkNeCiFySmqpjPdKUSrCfp6apRMJ1Fxz8uf3bGoiiRzSZYfDKzDr7eS7cp7H9aUGq",
  },
  {
    id: "burn-2026-07-22-boost-05",
    dateIso: "2026-07-22T16:00:11Z",
    amountBaseUnits: "511616430153",
    signature: "273dCCqrZph1x4KaMB2gKCnxGSZ4MvArpPpL3tU6sjJVo3oKfqbaP3YaELnnSiPpxqnpV1kUzkQzq7JwBXCDsLwh",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "5 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/273dCCqrZph1x4KaMB2gKCnxGSZ4MvArpPpL3tU6sjJVo3oKfqbaP3YaELnnSiPpxqnpV1kUzkQzq7JwBXCDsLwh",
  },
  {
    id: "burn-2026-07-22-boost-06",
    dateIso: "2026-07-22T16:00:24Z",
    amountBaseUnits: "680262710683",
    signature: "4hhsmQWfaye1SAGsMNJ4dhGZdb6eVW8LRxH6wGDfUFdLXL93YrdocX2ExXGQshycPoVVjGXCrbyAzmJLJfsF5fNm",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "6 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4hhsmQWfaye1SAGsMNJ4dhGZdb6eVW8LRxH6wGDfUFdLXL93YrdocX2ExXGQshycPoVVjGXCrbyAzmJLJfsF5fNm",
  },
  {
    id: "burn-2026-07-22-boost-07",
    dateIso: "2026-07-22T16:00:35Z",
    amountBaseUnits: "1065457442313",
    signature: "2zN7STJsdvhbL8pooKtffmXJMzkwAdDhhESHQ7hg6egfGQ6sKRYwrE22X2TuvDPmYund5LV7sFdLtj2dLfC44QB3",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "7 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2zN7STJsdvhbL8pooKtffmXJMzkwAdDhhESHQ7hg6egfGQ6sKRYwrE22X2TuvDPmYund5LV7sFdLtj2dLfC44QB3",
  },
  {
    id: "burn-2026-07-22-boost-08",
    dateIso: "2026-07-22T16:00:46Z",
    amountBaseUnits: "716566265219",
    signature: "5gAyLnrmoHQBKhUC6YnQ13qHLamj59XyahEVcuUXsJFWZ5ACkozdfmzNT1dwujQArytjKocGTQhPZ4ZyjjhQ7JN9",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "8 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5gAyLnrmoHQBKhUC6YnQ13qHLamj59XyahEVcuUXsJFWZ5ACkozdfmzNT1dwujQArytjKocGTQhPZ4ZyjjhQ7JN9",
  },
  {
    id: "burn-2026-07-22-boost-09",
    dateIso: "2026-07-22T16:00:57Z",
    amountBaseUnits: "610503366563",
    signature: "4K5S47rS7eZQM6PAitpK8nhyHzT4i1Qkp1ssG81HPReSDpYmpgbwPUnHuEWH7ziY3B6mEHKpSac9jBQUNRTRRBRm",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "9 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4K5S47rS7eZQM6PAitpK8nhyHzT4i1Qkp1ssG81HPReSDpYmpgbwPUnHuEWH7ziY3B6mEHKpSac9jBQUNRTRRBRm",
  },
  {
    id: "burn-2026-07-22-boost-10",
    dateIso: "2026-07-22T16:01:09Z",
    amountBaseUnits: "482253547704",
    signature: "5VwXcuWAijs4DQUr8JE2dQuoqVcWQ4Fm5KCRqybNHNCEomhownP6jHa5Zf5qPKhsB4m74bRN7aLqdNWa5tMMzD5E",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "10 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5VwXcuWAijs4DQUr8JE2dQuoqVcWQ4Fm5KCRqybNHNCEomhownP6jHa5Zf5qPKhsB4m74bRN7aLqdNWa5tMMzD5E",
  },
  {
    id: "burn-2026-07-22-boost-11",
    dateIso: "2026-07-22T16:01:20Z",
    amountBaseUnits: "1036318796638",
    signature: "28i1w2fzm6zhoBgoPt9jnKtrUmrpKPupCfvL9NXsYNCthbWUyk5G2VKAuucddkDYEyYLKXPGZHmD3vSS9cTZdhWq",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "11 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/28i1w2fzm6zhoBgoPt9jnKtrUmrpKPupCfvL9NXsYNCthbWUyk5G2VKAuucddkDYEyYLKXPGZHmD3vSS9cTZdhWq",
  },
  {
    id: "burn-2026-07-22-boost-12",
    dateIso: "2026-07-22T16:01:31Z",
    amountBaseUnits: "625151761267",
    signature: "59dThYBUohesPCoXNn93Zgmhc7QmQufXChWDgRvaSwuW13PH6vQY6zpDvR8aV26RpWCcNXjEzm5wZcjDZ1H4YuS8",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "12 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/59dThYBUohesPCoXNn93Zgmhc7QmQufXChWDgRvaSwuW13PH6vQY6zpDvR8aV26RpWCcNXjEzm5wZcjDZ1H4YuS8",
  },
  {
    id: "burn-2026-07-22-boost-13",
    dateIso: "2026-07-22T16:01:44Z",
    amountBaseUnits: "497192935107",
    signature: "2iXzCzfzt1cab1MemBYzNp7DHFSuzjTUBLYfdVXSEqw3S5vkw8YAqo8EWxL5eu8ab37PSYkJASfvdhN5NE3nUpeA",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "13 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2iXzCzfzt1cab1MemBYzNp7DHFSuzjTUBLYfdVXSEqw3S5vkw8YAqo8EWxL5eu8ab37PSYkJASfvdhN5NE3nUpeA",
  },
  {
    id: "burn-2026-07-22-boost-14",
    dateIso: "2026-07-22T16:01:55Z",
    amountBaseUnits: "884809057154",
    signature: "2CiG9VLuFRDVgCvjNQStTzijrz7RyspTGK2VWXsED6gjBr2jUKFGoP1Arz5xJzGhc5sdanVvHYohPygQUKZAyzWT",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "14 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2CiG9VLuFRDVgCvjNQStTzijrz7RyspTGK2VWXsED6gjBr2jUKFGoP1Arz5xJzGhc5sdanVvHYohPygQUKZAyzWT",
  },
  {
    id: "burn-2026-07-22-boost-15",
    dateIso: "2026-07-22T16:02:06Z",
    amountBaseUnits: "966493871265",
    signature: "2zCjFH6vy3FKzWCqnAciGd2PPqSqXDxUuvHMn1CxkdexbBfo1goCi2PofJ872u7ydrFWgwVCFNQHBJyPD9rS7Q3z",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "15 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2zCjFH6vy3FKzWCqnAciGd2PPqSqXDxUuvHMn1CxkdexbBfo1goCi2PofJ872u7ydrFWgwVCFNQHBJyPD9rS7Q3z",
  },
  {
    id: "burn-2026-07-22-boost-16",
    dateIso: "2026-07-22T16:02:18Z",
    amountBaseUnits: "556918088133",
    signature: "4AeUHXkRVjVZVSJ1mgVU87tKo2z7tgtXckf1MquJfaBmgNH27qUJJRmaN4Zkk8TRCPMBDYEB6WsbiMfyXcy4i97v",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "16 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4AeUHXkRVjVZVSJ1mgVU87tKo2z7tgtXckf1MquJfaBmgNH27qUJJRmaN4Zkk8TRCPMBDYEB6WsbiMfyXcy4i97v",
  },
  {
    id: "burn-2026-07-22-boost-17",
    dateIso: "2026-07-22T16:02:29Z",
    amountBaseUnits: "914482656209",
    signature: "MnnvncaBQcHM5RjaQPZ1hNKC53QQpxqnpQmR4cPASFQ5ej8Sw9LkwRWfPbt5DUHPbbo5rdUJeXVnJFhX92VEUXA",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "17 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/MnnvncaBQcHM5RjaQPZ1hNKC53QQpxqnpQmR4cPASFQ5ej8Sw9LkwRWfPbt5DUHPbbo5rdUJeXVnJFhX92VEUXA",
  },
  {
    id: "burn-2026-07-22-boost-18",
    dateIso: "2026-07-22T16:02:40Z",
    amountBaseUnits: "1106043940301",
    signature: "3W4A9zF9yryAsoGRimhjBcbJH34o1NgGMZJr1fjZZg9Fev5q3DA9ZZLTb4sKoGh8muEGQXLxeh6k5GLFS4WCDb6g",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "18 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/3W4A9zF9yryAsoGRimhjBcbJH34o1NgGMZJr1fjZZg9Fev5q3DA9ZZLTb4sKoGh8muEGQXLxeh6k5GLFS4WCDb6g",
  },
  {
    id: "burn-2026-07-22-boost-19",
    dateIso: "2026-07-22T16:02:51Z",
    amountBaseUnits: "781918146573",
    signature: "5nBoyUu7GrvRYw9iDW6hTw1ASpMkzukKz9XmWBHaLnC1d1jr1GYohptvE2xdqsyJXWpgHYGWAkGNbPzgToWAwGnS",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "19 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5nBoyUu7GrvRYw9iDW6hTw1ASpMkzukKz9XmWBHaLnC1d1jr1GYohptvE2xdqsyJXWpgHYGWAkGNbPzgToWAwGnS",
  },
  {
    id: "burn-2026-07-22-boost-20",
    dateIso: "2026-07-22T16:03:02Z",
    amountBaseUnits: "751215213837",
    signature: "5FxsfXDu9GY9KtwifEArdPH3PWgAykEWafExbU5anx2rX3zt9Ygi9JMU9ymfGmcikfMsvB6jJzmJgZjPH2Kc3cPf",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "20 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5FxsfXDu9GY9KtwifEArdPH3PWgAykEWafExbU5anx2rX3zt9Ygi9JMU9ymfGmcikfMsvB6jJzmJgZjPH2Kc3cPf",
  },
  {
    id: "burn-2026-07-22-boost-21",
    dateIso: "2026-07-22T16:03:13Z",
    amountBaseUnits: "473305577233",
    signature: "UHHhmWZPo8DTdeXimVYPoWXiMidnncKEvSrrqoCdcqXsPr9D1hWCF5vQb1WFhkpaTMyTrWwbvVsmhmY784iHg9B",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "21 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/UHHhmWZPo8DTdeXimVYPoWXiMidnncKEvSrrqoCdcqXsPr9D1hWCF5vQb1WFhkpaTMyTrWwbvVsmhmY784iHg9B",
  },
  {
    id: "burn-2026-07-22-boost-22",
    dateIso: "2026-07-22T16:03:24Z",
    amountBaseUnits: "526812186726",
    signature: "535jgX1dPLpuBJ45EH11onqkWeQDdeGTdxRbesjcfY4ukunR4pSzLfcFqPtaVxRapCUdrXH6WQMN8t7Uo9SrHgUx",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "22 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/535jgX1dPLpuBJ45EH11onqkWeQDdeGTdxRbesjcfY4ukunR4pSzLfcFqPtaVxRapCUdrXH6WQMN8t7Uo9SrHgUx",
  },
  {
    id: "burn-2026-07-22-boost-23",
    dateIso: "2026-07-22T16:03:35Z",
    amountBaseUnits: "1078816005860",
    signature: "4eX83AJsggAAUYCwRLKgizLyNAw4CYgpuFGjAeJzbEgUHKD86he5vHRpG4PLUas3xmvqN2UXQ7qw9APxqwC1sqmd",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "23 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4eX83AJsggAAUYCwRLKgizLyNAw4CYgpuFGjAeJzbEgUHKD86he5vHRpG4PLUas3xmvqN2UXQ7qw9APxqwC1sqmd",
  },
  {
    id: "burn-2026-07-22-boost-24",
    dateIso: "2026-07-22T16:03:47Z",
    amountBaseUnits: "547550246888",
    signature: "5Ka4f4cPHV96sNwjJ7seekuxzgbAkieAbJHhrp9qtzHzxSu3YeZzqjTWr92cTGwzQM1quczTmu7m6GzrpztcbCFp",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "24 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5Ka4f4cPHV96sNwjJ7seekuxzgbAkieAbJHhrp9qtzHzxSu3YeZzqjTWr92cTGwzQM1quczTmu7m6GzrpztcbCFp",
  },
  {
    id: "burn-2026-07-22-boost-25",
    dateIso: "2026-07-22T16:03:58Z",
    amountBaseUnits: "538338196113",
    signature: "5sVkbiNvgo2EdrgpRDVPKDeFZwYaEAXDPrwkQ54EBybwrRKnpYx4CZ8Ryf53SBBCPe9jvfFsp7wF6PeSESMaR15B",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "25 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5sVkbiNvgo2EdrgpRDVPKDeFZwYaEAXDPrwkQ54EBybwrRKnpYx4CZ8Ryf53SBBCPe9jvfFsp7wF6PeSESMaR15B",
  },
  {
    id: "burn-2026-07-22-boost-26",
    dateIso: "2026-07-22T16:04:09Z",
    amountBaseUnits: "1196759864953",
    signature: "16WXUW9vqapWA6S3EBx46acwTK1UST1KDYR7gmGDWBbgxWvg7oGYrU31pWrm9jmpgUgtLvgwXVy3B56ffy7iVkC",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "26 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/16WXUW9vqapWA6S3EBx46acwTK1UST1KDYR7gmGDWBbgxWvg7oGYrU31pWrm9jmpgUgtLvgwXVy3B56ffy7iVkC",
  },
  {
    id: "burn-2026-07-22-boost-27",
    dateIso: "2026-07-22T16:04:20Z",
    amountBaseUnits: "535713693864",
    signature: "5s759LnvPM3dXBDtiHihV6vjg4uTZJoQJaExQothxVvL37RzGwckjLThAN3yH6YsRCAbFAuWh9Qox1TVMgnGcJBM",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "27 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5s759LnvPM3dXBDtiHihV6vjg4uTZJoQJaExQothxVvL37RzGwckjLThAN3yH6YsRCAbFAuWh9Qox1TVMgnGcJBM",
  },
  {
    id: "burn-2026-07-22-boost-28",
    dateIso: "2026-07-22T16:04:31Z",
    amountBaseUnits: "799791269015",
    signature: "5t7b45J6rQH7YEwwyki85RHRSx2vwymCrC2kmQkEMmndtxPvTJg2iTuS8q7ZUon8o1gvCaC1utuimEaJKQKorgcK",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "28 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/5t7b45J6rQH7YEwwyki85RHRSx2vwymCrC2kmQkEMmndtxPvTJg2iTuS8q7ZUon8o1gvCaC1utuimEaJKQKorgcK",
  },
  {
    id: "burn-2026-07-22-boost-29",
    dateIso: "2026-07-22T16:04:42Z",
    amountBaseUnits: "1997104711857",
    signature: "2oATPnGf1xLk7wRKCqkt6nFVnkWzfg7vCLmHDsTQUn5WZH4CYiLrcSRLRJJ9PAbEhGo7DNstwrsT67ACmKijHztu",
    sourceWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    destinationWallet: "9H9m3BMSmTjod9WeU7ZqDDSnrkxcBYEZPomJirzBceci",
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "pumpfun-boost-buyback-burn",
    notes: "29 of 29 \u2014 part of the same pump.fun BOOST TWAP buyback-and-burn sequence; see burn-2026-07-22-boost-01 for full methodology and the aggregate total.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2oATPnGf1xLk7wRKCqkt6nFVnkWzfg7vCLmHDsTQUn5WZH4CYiLrcSRLRJJ9PAbEhGo7DNstwrsT67ACmKijHztu",
  },
  {
    // Recorded for completeness rather than because it is a milestone: this
    // is a routine Contribute-flow transfer, seeded so the staged ledger
    // stops silently omitting a known inflow. It is NOT a burn.
    id: "transfer-2026-07-25-contribute-flow-test",
    dateIso: "2026-07-25T05:57:28.000Z",
    amountBaseUnits: "800000000000",
    signature: "KSuN7BPB5iarpH3yDPjRn4HD2UrfYFdVv1amDqVATT1tzJVf1HB3HCWw2VjTcTGx98e9FsGUF4Fr1fU7K3kShJt",
    sourceWallet: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2026-08-01",
    supersededNote: "Consumed on 2026-08-01 when the wallet was emptied for the benchmark burn.",
    eventType: "contribution-flow-transfer",
    notes: "800,000.000000 WinLEW sent from the project wallet (Winlew.sol, GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp) into the burn wallet at 2026-07-25T05:57:28Z — seven and a half minutes before millerknoll's 50,000,000 donation the same morning. A single spl-token `transfer` instruction for exactly 800000000000 base units. Origin: the project owner exercising the website's Contribute flow through Phantom against the `burn` cause (see CONTRIBUTION_CAUSES in src/mole/contributions.js), so it is also recorded in the contributions store — this entry is the burn-ledger counterpart, not a duplicate contribution. Seeded here because the staged total previously omitted it, which made stagedInflowBaseUnits quietly incomplete; recording it is preferred over documenting an exception. STAGED, NOT DESTROYED: it does not count toward Verified Progress. Note this is one of only two known unrecorded inflows found when reconciling the wallet — the other, the ~6.62M present before 2026-07-16, predates any ledger and is addressed in docs/burn-program.md §7 rather than invented as an event.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, found via a full signature scan of the burn wallet's token account and independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/KSuN7BPB5iarpH3yDPjRn4HD2UrfYFdVv1amDqVATT1tzJVf1HB3HCWw2VjTcTGx98e9FsGUF4Fr1fU7K3kShJt",
  },
  {
    // A genuine on-chain transfer INTO the burn wallet, independently
    // verified — but a transfer is not a burn (see docs/burn-program.md
    // §4's transfer-vs-destruction distinction). status is deliberately
    // TRANSFERRED_TO_BURN_WALLET so it counts as "staged", never as
    // confirmed progress, until a real burn instruction destroys it.
    id: "transfer-2026-07-25-holder-to-burn-wallet",
    dateIso: "2026-07-25T06:05:02.000Z",
    amountBaseUnits: "50000000000000",
    signature: "4iBFXv2NJvy6ejznafRngZgyz3L5ZbY1kpnqHUVTY28JkeHKoKidM4og36jsLmEMdietLsnzfmkUA9EPk2nCSfw4",
    sourceWallet: "D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    supersededBy: "burn-2026-08-01",
    supersededNote: "Consumed on 2026-08-01: the wallet was emptied, part destroyed by burn-2026-08-01 and the remainder moved out. The project immediately restocked a matching 50,000,000 to keep this donation whole (see transfer-2026-08-01-restock-burn-wallet).",
    eventType: "holder-voluntary-transfer",
    notes: "millerknoll, WinLEW's #1 holder, sent 50,000,000 WinLEW directly to the burn wallet (burn.winlew.sol) on their own initiative — not prompted or requested by the project, and not previously announced or queued anywhere. A single clean spl-token transferChecked instruction for exactly 50,000,000.000000 WinLEW, landing in the burn wallet's own WinLEW token account (3caeRiCfwEhwqR9AZsMpD9x3syMknqM5U5R3DB2xeEyP). This is staged, not yet destroyed — it raises the burn wallet's live \"awaiting burn\" balance (already sourced live from the wallet, see docs/burn-program.md §4) but does not move the Verified Progress bar until an actual burn instruction is executed on it, same as the ~6.62M that was already sitting there before this transfer.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data, independently verified 2026-07-25",
    verifiedAtIso: "2026-07-25T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/4iBFXv2NJvy6ejznafRngZgyz3L5ZbY1kpnqHUVTY28JkeHKoKidM4og36jsLmEMdietLsnzfmkUA9EPk2nCSfw4",
  },
  {
    // The first burn executed ON the August 1 benchmark date itself (the
    // 2025 one landed 2025-08-02, the day after). Amount was chosen to
    // land total supply on a round 950,000,000 — verified below, not
    // assumed.
    id: "burn-2026-08-01",
    dateIso: "2026-08-01T06:53:15.000Z",
    amountBaseUnits: "14878231210253",
    signature: "2ixvHEKgdq71C41QKy6Fr4JNCeuh8Borsq2YLLUdLEG3VYg9Y5NTCa824oa7KiSu7EikQsfCk1wvU2q7AnoPHcD1",
    sourceWallet: BURN_WALLET_ADDRESS,
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.CONFIRMED_BURN,
    eventType: "spl-token-burn-instruction",
    notes: "August 1, 2026 benchmark burn — the first burn executed on the benchmark date itself rather than the day after. A single spl-token `burn` instruction for exactly 14,878,231.210253 WinLEW, authorized by the burn wallet against its own WinLEW token account. The amount was selected to bring the mint's total supply to a round 950,000,000: pre-burn supply read 964,878,231.210253, and a post-burn getTokenSupply returned exactly 950000000000000 base units, confirming the intended landing point rather than inferring it. WHY THE TOKENS WERE SHUFFLED FIRST: the burn was executed with Sol Incinerator, which burns a token account's ENTIRE balance — there is no 'burn only this amount' option — so the project first moved out the portion that was not intended for this burn, leaving exactly the target amount isolated in the account to be destroyed. That is an artifact of the tool, not of what was being burned. RELATIONSHIP TO THE #1-HOLDER DONATION: per the project, this burn was already planned BEFORE millerknoll's 2026-07-25 50,000,000 transfer arrived; the donation did not prompt it and was not its source. To keep that donation's intent and provenance intact, a full 50,000,000 was transferred back into the burn wallet immediately afterward (see transfer-2026-08-01-restock-burn-wallet), which also re-created the wallet's token account at the same deterministic ATA address after the burn had emptied and closed it.",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data plus a post-burn getTokenSupply cross-check, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/2ixvHEKgdq71C41QKy6Fr4JNCeuh8Borsq2YLLUdLEG3VYg9Y5NTCa824oa7KiSu7EikQsfCk1wvU2q7AnoPHcD1",
  },
  {
    // Staged, NOT destroyed — same treatment as the millerknoll transfer
    // above. This is the balance the project intends to decide on at the
    // one-year anniversary; it moves the Verified Progress bar only if
    // and when a real burn instruction is executed against it.
    id: "transfer-2026-08-01-restock-burn-wallet",
    dateIso: "2026-08-01T07:00:17.000Z",
    amountBaseUnits: "50000000000000",
    signature: "RumMGACZzogcAsMhP4qwHzocC4qj6Puf2mmMP7zXNhiW2cnCsiR7XfdwNwf9Ce3ZUNQq2SXDnmpaNyAFZzK1G1o",
    sourceWallet: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp",
    destinationWallet: BURN_WALLET_ADDRESS,
    status: BURN_EVENT_STATUSES.TRANSFERRED_TO_BURN_WALLET,
    eventType: "project-restock-transfer",
    notes: "Seven minutes after the August 1, 2026 burn, the project wallet (Winlew.sol, GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp) sent exactly 50,000,000.000000 WinLEW back into the burn wallet. A single spl-token `transferChecked` instruction, which also re-created the burn wallet's WinLEW associated token account (3caeRiCfwEhwqR9AZsMpD9x3syMknqM5U5R3DB2xeEyP) since the burn had closed it. PURPOSE — this is not an arbitrary top-up: the amount deliberately matches millerknoll's 2026-07-25 donation of exactly 50,000,000, so that the burn wallet visibly still holds a full 50,000,000 attributable to that contribution. Per the project, the August 1 burn had been planned before that donation arrived and was not drawn from it in intent; because Sol Incinerator burns a token account's entire balance, tokens had to be moved out and back regardless, and restoring exactly 50,000,000 keeps the donation's purpose and provenance whole. Note this is a statement about intent and about the wallet's restored balance — SPL tokens are fungible, so no on-chain evidence can single out which individual units were or were not destroyed, and this ledger does not claim otherwise. This is STAGED, NOT DESTROYED: it puts the burn wallet's live \"awaiting burn\" balance at 50,000,000 but does not count toward Verified Progress. The project's stated intent is to decide the next burn at the one-year anniversary. NOTE ON AGGREGATION: summarizeBurnEvents()'s stagedBaseUnits now sums this 50M together with the 2026-07-25 millerknoll 50M, giving 100M — but the burn wallet actually holds 50,000,000, because part of the earlier staged balance was destroyed by burn-2026-08-01 and the remainder was moved out. Staged tokens are a live balance, not a running total of every transfer ever made; this is exactly why both the Burn Center and the governance proposal page read wallet.winlewBalance rather than summary.stagedDisplay (see docs/burn-program.md §4).",
    evidenceSource: "Solana mainnet (Alchemy RPC), getTransaction jsonParsed instruction data plus a getTokenAccountsByOwner balance cross-check, independently verified 2026-08-01",
    verifiedAtIso: "2026-08-01T00:00:00.000Z",
    explorerUrl: "https://solscan.io/tx/RumMGACZzogcAsMhP4qwHzocC4qj6Puf2mmMP7zXNhiW2cnCsiR7XfdwNwf9Ce3ZUNQq2SXDnmpaNyAFZzK1G1o",
  },
];

/**
 * COMMUNITY BURNS — supply destroyed by holders, not by this project.
 *
 * docs/burn-program.md §7a predicted these and said they could not be found:
 * "some of them burned their own tokens independently — real `burn`
 * instructions, authorized by their own wallets ... There is no list of who did
 * this and no way to build one after the fact: the search space is every wallet
 * that ever held the token, not one address."
 *
 * That was right about the search space and wrong about there being no thread.
 * The Giveaway Records (src/mole/giveawayRecords.js, 2026-08-18) reconstructed
 * every wallet the X Faucet Reserve ever paid — 21 of them. Those are wallets
 * this project put tokens INTO, which makes them exactly the population §7a
 * described, and a list that short can simply be walked. On 2026-08-19 every
 * one of their WinLEW token accounts was scanned for `burn` instructions.
 *
 * THIS LIST IS NOT COMPLETE AND MUST NEVER BE PRESENTED AS COMPLETE. It covers
 * giveaway recipients plus two wallets the owner supplied directly. Any holder
 * who bought on the open market and burned is still invisible, and §7a's
 * argument about the search space still holds for them.
 *
 * THEY DO NOT COUNT TOWARD THE 100,000,000 TARGET. That target measures what
 * this project destroys; counting a stranger's account cleanup toward it would
 * flatter the number with tokens nobody here burned. They are tracked because
 * they explain part of the supply residual, not because they are progress.
 *
 * WHAT THESE ACTUALLY ARE, stated because the alternative reads better than the
 * truth: every one is a "burn all and close account" sweep through an
 * incinerator tool, which destroys a leftover balance to reclaim the ~0.002 SOL
 * of account rent. The 100,000 in the first row burned two other tokens in the
 * same transaction. These are people clearing out wallets, not tributes to the
 * project, and calling them community support would be inventing a motive the
 * chain cannot show.
 */
export const COMMUNITY_BURNS = [
  {
    id: "community-2025-01-03",
    dateIso: "2025-01-03T14:40:59.000Z",
    slot: 311631149,
    amountBaseUnits: "100000000000",
    authority: "6Y4MJPHpG66bRizdy99mEZnaaiwvEx9Q1aD6wh8PQB5v",
    signature: "TVegUSjUPK7tkNu9gLCQANpeEWyTwacgDuaWXiJt4Zm6vCzYhVRB7SUqKR1fTit4DZ2GQiuQeEd9bV7Nu4PYGKy",
    explorerUrl: "https://solscan.io/tx/TVegUSjUPK7tkNu9gLCQANpeEWyTwacgDuaWXiJt4Zm6vCzYhVRB7SUqKR1fTit4DZ2GQiuQeEd9bV7Nu4PYGKy",
    // WHO THIS WAS — resolved 2026-08-21, and it is not what this record said.
    //
    // Originally logged as an anonymous holder sweeping an account, because
    // that is exactly what it looks like on-chain: burn-all-and-close through
    // an incinerator, three tokens destroyed in one transaction.
    //
    // The project's own X post of 2025-01-04 names it. This wallet belonged to
    // @JosephRarnos956 — an impersonator of the giveaway winner
    // @JosephRamos956, differing by one character (r-n against m) — who
    // collected the prize by phishing and then destroyed it: "The Phisher
    // ...Burnt his 100k, So I Sent the 100k To the Real Winner". The project
    // paid the real winner again three days later and absorbed the loss.
    //
    // The supply reduction is unchanged and still real. What changed is the
    // story: this was not a holder tidying up a wallet, and reading motive off
    // the chain alone had it wrong. Found by walking the X timeline back to
    // the account's first day — docs/giveaway-records/x-timeline-archive.json.
    notes: "The largest known community burn, and the only one above dust. Paid as a giveaway prize on 2025-01-01 to an impersonator of the real winner, who destroyed all 100,000 on 2025-01-03 alongside two unrelated tokens in the same incinerator sweep. The real winner was re-paid on 2025-01-04; see team-hodl-or-faucet-2024 in giveawayRecords.js.",
  },
  {
    id: "community-2025-11-22",
    dateIso: "2025-11-22T01:24:38.000Z",
    slot: 381662511,
    amountBaseUnits: "6",
    authority: "2yupCJfQKvDzUKoD2nXC5nYGGWG8aibjL5jpQZteJqSA",
    signature: "4uG5snzfrt5E7B9aEvQ7PkWZqfVc1f2wmXhtEE6bFLFBqpN2w3DfgHzSjC74xwTuhbxqJzVTxWun2Aw64Nzj8HS9",
    explorerUrl: "https://solscan.io/tx/4uG5snzfrt5E7B9aEvQ7PkWZqfVc1f2wmXhtEE6bFLFBqpN2w3DfgHzSjC74xwTuhbxqJzVTxWun2Aw64Nzj8HS9",
    // Six base units — 0.000006 WinLEW. Recorded because a ledger that drops
    // rows for being small stops being a ledger; an earlier pass reported this
    // one as "0" purely because the display divided it away, which is exactly
    // the failure mode this row now guards against.
    notes: "Six base units (0.000006 WinLEW). Kept for completeness, not significance.",
  },
  {
    id: "community-2026-04-30",
    dateIso: "2026-04-30T22:05:57.000Z",
    slot: 416744762,
    amountBaseUnits: "78367222",
    authority: "2yupCJfQKvDzUKoD2nXC5nYGGWG8aibjL5jpQZteJqSA",
    signature: "4VLPy9BNqhr7nxEaSupi7Z5FBgELUTxV6FtySJQu4VjSSkLcbFrLHvyneQi8caY8w7jeGHxMJvNjd3MA4G41nWkN",
    explorerUrl: "https://solscan.io/tx/4VLPy9BNqhr7nxEaSupi7Z5FBgELUTxV6FtySJQu4VjSSkLcbFrLHvyneQi8caY8w7jeGHxMJvNjd3MA4G41nWkN",
    notes: "78.367222 WinLEW, same wallet as the 2025-11-22 and 2026-07-03 sweeps.",
  },
  {
    id: "community-2026-07-03",
    dateIso: "2026-07-03T18:24:43.000Z",
    slot: 430573846,
    amountBaseUnits: "712720770",
    authority: "2yupCJfQKvDzUKoD2nXC5nYGGWG8aibjL5jpQZteJqSA",
    signature: "hbe3r3RvusqCzn4CGjoT86WFuEKsETVst33xuVkqY5KUwDqaZLCtpoz35KjcpEN9gXkZZMnqaaty5wuRNkte38R",
    explorerUrl: "https://solscan.io/tx/hbe3r3RvusqCzn4CGjoT86WFuEKsETVst33xuVkqY5KUwDqaZLCtpoz35KjcpEN9gXkZZMnqaaty5wuRNkte38R",
    notes: "712.720770 WinLEW. BurnAllTokensAndCloseAccount — the account was emptied and closed in the same transaction.",
  },
  {
    id: "community-2026-08-18a",
    dateIso: "2026-08-18T04:11:36.000Z",
    slot: 439985761,
    amountBaseUnits: "27904172",
    authority: "Dspk6ZxbcCWLHxLPFAV9RJaa4ZFziRcAvxjwkxthpFrz",
    signature: "2NJvFgeYR5a4YeHi5XQPoC9VqZfaaZjqzgW7Mtrj1hVGPzKjxyuKMycWztXnuTpRixSobnXsNP62KRCc8nnpBDgg",
    explorerUrl: "https://solscan.io/tx/2NJvFgeYR5a4YeHi5XQPoC9VqZfaaZjqzgW7Mtrj1hVGPzKjxyuKMycWztXnuTpRixSobnXsNP62KRCc8nnpBDgg",
    // Context that stops this being misread as goodwill: 37 seconds earlier the
    // same wallet sent 5,000 WinLEW to the wallet in the next row, which then
    // swapped 18,100 out and burned ITS remainder. Both wallets were already on
    // the 2026-08-16 sybil ban list, and their WinLEW came from this project's
    // own reward payouts on 2026-08-14. This is an exit, and the 27.904172 is
    // the dust left behind by it.
    notes: "27.904172 WinLEW — the dust remaining after 5,000 was moved out 37 seconds earlier. The wallet was already on the sybil ban list.",
  },
  {
    id: "community-2026-08-18b",
    dateIso: "2026-08-18T04:13:05.000Z",
    slot: 439985976,
    amountBaseUnits: "11480000",
    authority: "5Ss77nYwc7eQytYvH7vDqBRnZFue1ZTp1No2XJnCGrBw",
    signature: "5mZ2V8fCx1eTwx54EHEUwPDjaFeGZh1wq3Kk7ESHruv94wv7pjNVpySjnyZu3j6G1JZA25HJqFJipxiPTxPrwDrx",
    explorerUrl: "https://solscan.io/tx/5mZ2V8fCx1eTwx54EHEUwPDjaFeGZh1wq3Kk7ESHruv94wv7pjNVpySjnyZu3j6G1JZA25HJqFJipxiPTxPrwDrx",
    notes: "11.480000 WinLEW — the dust remaining after 18,100 was swapped out twelve seconds earlier. Same cluster as the row above.",
  },
];

/** Pure — total community-burned supply, derived from the rows above and
 *  never declared. Deliberately separate from summarizeBurnEvents(): mixing
 *  the two would let someone else's account cleanup count as this project's
 *  burn progress. */
export function summarizeCommunityBurns(events = COMMUNITY_BURNS) {
  let total = 0n;
  for (const event of events) total += BigInt(event.amountBaseUnits);
  return {
    eventCount: events.length,
    burnedBaseUnits: total.toString(),
    // Stated in the shape callers actually need: this is a floor, not a total,
    // because only wallets this project could enumerate were ever scanned.
    complete: false,
    scannedPopulation: "X Faucet Reserve giveaway recipients (21 wallets), plus 2 wallets supplied by the owner",
  };
}

/**
 * Pure — sums verified events by status bucket. Never mixes confirmed
 * burns with staged/awaiting-burn tokens (see PROGRESS_COUNTED_STATUSES).
 *
 * IMPORTANT — what the staged figure is, and what it is NOT.
 *
 * `stagedInflowBaseUnits` is the sum of the staged transfers RECORDED IN
 * THIS FILE. It is NOT the burn wallet's current balance, and it is not a
 * complete history of everything ever sent there either. Two separate
 * reasons, both deliberate:
 *
 *  1. Tokens LEAVE the burn wallet — by being burned (2026-08-01 destroyed
 *     part of what was staged) or by being moved out — and departures are
 *     not modelled as events here at all.
 *  2. Outflows other than burns are not events either. 42,546,279.124698
 *     was moved OUT ahead of the 2026-08-01 burn (Sol Incinerator burns a
 *     whole account), and no event represents that.
 *
 * As of the 2026-08-01 reconciliation every inflow the burn wallet has ever
 * received IS now seeded, back to 2025-02-16, so the ledger closes exactly
 * against the chain:
 *
 *   recorded inflow                119,331,816.055862
 *   - burns authorized by wallet    26,785,536.931164
 *   - outflow before Aug 1 burn     42,546,279.124698
 *   = implied balance               50,000,000.000000  <- matches on-chain
 *
 * Note "burns authorized by wallet" excludes the 29 pump.fun BOOST burns:
 * those were executed by the PumpSwap pool against its own reserve, never
 * touched this wallet, and so reduce total supply without appearing here.
 * See docs/burn-program.md §7a for the full table.
 *
 * The staged figure still sits ABOVE the current balance and must never be
 * shown as "awaiting burn":
 *
 *   recorded staged inflow: 119,331,816.055862
 *   actual wallet balance:   50,000,000
 *
 * That is not a bug in either number; it is the difference between a running
 * total and a balance. Anything that wants "how much is awaiting burn right
 * now" MUST read the wallet's live on-chain balance
 * (`getOwnerTokenSnapshot()` -> `wallet.winlewBalance`), never this sum. Both
 * the Burn Center and the governance proposal page already do exactly that;
 * see docs/burn-program.md §4 and §6a.
 *
 * `stagedBaseUnits` is retained as a deprecated alias of the same value so
 * the /api/burn/status response shape does not change for any existing
 * consumer. Prefer the explicit name in new code.
 */
export function summarizeBurnEvents(events = BURN_EVENTS) {
  let confirmedBaseUnits = 0n;
  let stagedBaseUnits = 0n;
  let confirmedEventCount = 0;
  let stagedEventCount = 0;

  for (const event of events) {
    const amount = BigInt(event.amountBaseUnits);
    if (PROGRESS_COUNTED_STATUSES.has(event.status)) {
      confirmedBaseUnits += amount;
      confirmedEventCount += 1;
    } else if (STAGED_STATUSES.has(event.status)) {
      stagedBaseUnits += amount;
      stagedEventCount += 1;
    }
  }

  return {
    eventCount: events.length,
    confirmedEventCount,
    confirmedBurnedBaseUnits: confirmedBaseUnits.toString(),
    stagedEventCount,
    // Lifetime inflow — see the warning above before displaying this anywhere.
    stagedInflowBaseUnits: stagedBaseUnits.toString(),
    // Deprecated alias of stagedInflowBaseUnits, kept for API-shape stability.
    stagedBaseUnits: stagedBaseUnits.toString(),
  };
}

/**
 * Pure — progress toward the long-term target, using ONLY confirmed-burn
 * totals (never staged/awaiting-burn tokens). percentOfTarget is computed
 * via integer BigInt arithmetic (tenths-of-a-percent), then converted to a
 * Number only for the final, already-integer display value — no
 * floating-point division of token amounts happens anywhere in this
 * function.
 */
export function computeBurnProgress(confirmedBurnedBaseUnits, targetBaseUnits = BURN_TARGET_BASE_UNITS) {
  const burned = BigInt(confirmedBurnedBaseUnits);
  const target = BigInt(targetBaseUnits);
  const remaining = target > burned ? target - burned : 0n;
  const percentTenths = target > 0n ? Number((burned * 1000n) / target) : 0;

  return {
    targetBaseUnits: target.toString(),
    confirmedBurnedBaseUnits: burned.toString(),
    remainingBaseUnits: remaining.toString(),
    percentOfTarget: Math.min(100, percentTenths / 10),
  };
}

export function getBurnEventById(id, events = BURN_EVENTS) {
  return events.find((event) => event.id === id) || null;
}
