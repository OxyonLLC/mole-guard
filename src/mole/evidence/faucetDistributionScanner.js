// Lifetime on-chain distribution scanner for the Faucet Reserve wallet.
//
// WHY THIS EXISTS, and how it differs from claimStore's stats.
//
// `/api/faucet/global-stats` reports what the PLATFORM RECORDED: rows in the
// claim store, i.e. claims this codebase processed and confirmed. That is the
// right number for "how many claims have people made here."
//
// It is NOT the same as what the reserve wallet has actually paid out, and it
// is structurally smaller:
//   - Discord bot payouts predating the current claim store aren't rows.
//   - The same wallet also signs quiz-cycle and game-batch rewards, which are
//     not faucet claims at all (see docs/whitepaper.md §3, "Reward payouts").
//
// This scanner answers the other question — "what has this wallet actually
// sent, ever" — by reading the chain, exactly like burnScanner.js does for
// burns. Both numbers are true; they measure different things, and this module
// never lets one be presented as the other.
//
// SAFETY: read-only. getSignaturesForAddress / getTransaction /
// getTokenAccountBalance only. No keypair, no signing, no ability to send.
//
// All amounts are base-unit STRINGS or BigInt — never floats.
import { getSignaturesForAddressRpc, getTransactionRpc, rpcCall } from "./solanaRpcClient.js";

// Deterministic ATA of the faucet reserve for the WinLEW mint. Hardcoded
// rather than derived so a bad env can never silently point this at some
// other account and produce a plausible-looking total.
export const FAUCET_OWNER = "FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE";
export const FAUCET_ATA = "Hghcb294nXPWmXtGtV7MAXx4M4NxXF26zDahFFSyUUqG";

const TRANSFER_TYPES = new Set(["transfer", "transferChecked"]);
const BURN_TYPES = new Set(["burn", "burnChecked"]);

function flattenInstructions(tx) {
  const top = tx?.transaction?.message?.instructions || [];
  const inner = (tx?.meta?.innerInstructions || []).flatMap((x) => x.instructions || []);
  return [...top, ...inner];
}

function amountOf(info) {
  return BigInt(info?.amount || info?.tokenAmount?.amount || "0");
}

/**
 * Pure — folds one parsed transaction into a running tally. Exported so the
 * accounting can be unit-tested without any network access.
 */
export function foldTransaction(tally, tx) {
  if (!tx || tx.meta?.err) return tally;
  const blockTimeMs = (tx.blockTime || 0) * 1000;

  for (const ix of flattenInstructions(tx)) {
    const parsed = ix?.parsed;
    if (!parsed || typeof parsed !== "object") continue;
    const info = parsed.info || {};
    const amount = amountOf(info);

    if (TRANSFER_TYPES.has(parsed.type)) {
      if (info.source === FAUCET_ATA) {
        tally.outBaseUnits += amount;
        tally.payoutCount += 1;
        if (info.destination) tally.recipients.add(info.destination);
        if (!tally.firstPayoutAtMs || blockTimeMs < tally.firstPayoutAtMs) tally.firstPayoutAtMs = blockTimeMs;
        if (!tally.lastPayoutAtMs || blockTimeMs > tally.lastPayoutAtMs) tally.lastPayoutAtMs = blockTimeMs;
      } else if (info.destination === FAUCET_ATA) {
        tally.inBaseUnits += amount;
      }
    } else if (BURN_TYPES.has(parsed.type) && info.account === FAUCET_ATA) {
      tally.burnedBaseUnits += amount;
    }
  }
  return tally;
}

export function emptyTally() {
  return {
    outBaseUnits: 0n,
    inBaseUnits: 0n,
    burnedBaseUnits: 0n,
    payoutCount: 0,
    recipients: new Set(),
    firstPayoutAtMs: null,
    lastPayoutAtMs: null,
  };
}

/**
 * Scans signatures newer than `untilSignature` (omit for a full history walk)
 * and folds them into a tally.
 *
 * Every signature must resolve to a real result. A transaction that can't be
 * fetched after retries makes the whole scan `complete: false` — a partial
 * walk silently under-reports, which is exactly how a first attempt at this
 * produced a figure 60% short of the truth.
 */
export async function scanFaucetDistribution({
  untilSignature = null,
  rpcMode,
  getSignatures = getSignaturesForAddressRpc,
  getTransaction = getTransactionRpc,
  onProgress = null,
  maxAttemptsPerTx = 5,
} = {}) {
  const signatures = [];
  let before;
  for (;;) {
    const { result } = await getSignatures(FAUCET_ATA, {
      limit: 1000,
      ...(before ? { before } : {}),
      ...(untilSignature ? { until: untilSignature } : {}),
      rpcMode,
    });
    const page = result || [];
    if (!page.length) break;
    signatures.push(...page);
    before = page[page.length - 1].signature;
    onProgress?.({ phase: "signatures", count: signatures.length });
    if (page.length < 1000) break;
  }

  const usable = signatures.filter((s) => !s.err);
  const tally = emptyTally();
  const unresolved = [];

  for (let i = 0; i < usable.length; i += 1) {
    const sig = usable[i].signature;
    let tx = null;
    for (let attempt = 0; attempt < maxAttemptsPerTx && !tx; attempt += 1) {
      try {
        const { result } = await getTransaction(sig, { rpcMode });
        tx = result || null;
        if (!tx) break; // a genuine null (pruned/not found) — retrying won't help
      } catch {
        // transient; fall through to retry
      }
    }
    if (!tx) unresolved.push(sig);
    else foldTransaction(tally, tx);
    if (onProgress && i % 25 === 0) onProgress?.({ phase: "transactions", count: i + 1, total: usable.length });
  }

  return {
    ata: FAUCET_ATA,
    owner: FAUCET_OWNER,
    signaturesScanned: signatures.length,
    newestSignature: signatures[0]?.signature || untilSignature || null,
    tally,
    unresolvedSignatures: unresolved,
    complete: unresolved.length === 0,
  };
}

/**
 * The integrity gate. inflow - outflow - burned MUST equal the account's live
 * balance; if it doesn't, the tally is missing transactions and must not be
 * published. Callers should treat `reconciles: false` as "do not display."
 */
export async function reconcileAgainstChain(tally, { rpcMode, getBalance = null } = {}) {
  // rpcCall resolves to { result, rpcLabel } — NOT the bare RPC result. Reading
  // `.value.amount` straight off it yields undefined, which silently becomes a
  // 0 balance and fails every reconciliation. Cost an hour the first time.
  const fetchBalance =
    getBalance ||
    (async () => {
      const { result } = await rpcCall("getTokenAccountBalance", [FAUCET_ATA], { rpcMode });
      const amount = result?.value?.amount;
      if (typeof amount !== "string") {
        throw new Error("balance_lookup_returned_no_amount"); // never silently treat as zero
      }
      return amount;
    });
  const liveRaw = await fetchBalance();
  const live = BigInt(liveRaw);
  const implied = tally.inBaseUnits - tally.outBaseUnits - tally.burnedBaseUnits;
  return {
    liveBalanceBaseUnits: live.toString(),
    impliedBalanceBaseUnits: implied.toString(),
    differenceBaseUnits: (implied - live).toString(),
    reconciles: implied === live,
  };
}
