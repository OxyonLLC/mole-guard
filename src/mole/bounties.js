// Bug Bounties — structured, editorial records of bounties owed/paid for
// finding real bugs in Mole Hub (or elsewhere in the WinLEW ecosystem).
// Single source of truth for the /bounties/ page. Same static-data pattern
// as src/mole/partnersData.js — a bounty's existence and amount is a
// maintainer decision, not something derivable from chain state, so this
// file has no live RPC dependency. Once a bounty is actually paid, a
// maintainer adds the payoutSignature and flips status to PAID by hand —
// mirrors src/mole/burnEvents.js's "staged vs confirmed" honesty pattern:
// never claim paid before the transaction exists.
//
// SAFETY: pure data. No signing capability, no private key material —
// nothing here (or anything that imports it) can send tokens.

export const WINLEW_MINT = "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";
export const WINLEW_DECIMALS = 6;

export const BOUNTY_STATUSES = Object.freeze({
  PENDING: "pending",
  PAID: "paid",
});

export const BOUNTY_SOURCE_WALLET = {
  label: "Developer Reserve",
  address: "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ",
};

/**
 * Individual bounty awards. amountBaseUnits is always a string (WinLEW has
 * 6 decimals) — never do floating-point arithmetic on it, use BigInt or
 * src/faucet/amount.js's baseUnitsToDecimalString for display.
 */
export const BOUNTIES = [
  {
    id: "bounty-2026-molehub-millerknoll",
    recipientHandle: "millerknoll",
    recipientWallet: "D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz",
    title: "Mole Hub bug bounty",
    description: "Reported a real bug found in the Mole Hub (gaming hub).",
    amountBaseUnits: "1000000000000",
    status: BOUNTY_STATUSES.PAID,
    announcedAtIso: "2026-07-24T00:00:00.000Z",
    scheduledPayoutDateIso: "2026-08-01",
    scheduledPayoutNote: "Paid 2026-07-26, ahead of the original Aug 1, 2026 schedule.",
    payoutSignature: "38qD36DKR13ReqQcwh51crhC1z3eBcwSNap7pFK3NbxMA9YxDM7QrTmwKajucd2H223Wp8Sh7n8tMe1iLDdp8bvq",
    paidAtIso: "2026-07-27T00:19:58.000Z",
  },
  {
    id: "bounty-2026-molehub-jimtheexplorer",
    recipientHandle: "JimTheExplorer",
    recipientWallet: "9JGvjo1bu4WAiuSCB2neW6aKniqFECGuJ3DLvSawB39k",
    title: "Mole Hub bug bounty",
    description: "Reported a real bug found in the Mole Hub (gaming hub).",
    amountBaseUnits: "1000000000000",
    status: BOUNTY_STATUSES.PAID,
    announcedAtIso: "2026-07-24T00:00:00.000Z",
    scheduledPayoutDateIso: "2026-08-01",
    scheduledPayoutNote: "Paid 2026-07-26, ahead of the original Aug 1, 2026 schedule.",
    payoutSignature: "3mzWVKa2zNSgBsN97kjXkS3yim3VXAzh4Pz2ognNJQdAWCEcf4L2MpdoCTUBawizrtKPrc79GZuq1iwFxCpZ57Dr",
    paidAtIso: "2026-07-27T00:20:42.000Z",
  },
];

/** Pure — sums bounties by status bucket, same shape as summarizeBurnEvents(). */
export function summarizeBounties(bounties = BOUNTIES) {
  let pendingBaseUnits = 0n;
  let paidBaseUnits = 0n;
  let pendingCount = 0;
  let paidCount = 0;

  for (const bounty of bounties) {
    const amount = BigInt(bounty.amountBaseUnits);
    if (bounty.status === BOUNTY_STATUSES.PAID) {
      paidBaseUnits += amount;
      paidCount += 1;
    } else {
      pendingBaseUnits += amount;
      pendingCount += 1;
    }
  }

  return {
    bountyCount: bounties.length,
    pendingCount,
    pendingBaseUnits: pendingBaseUnits.toString(),
    paidCount,
    paidBaseUnits: paidBaseUnits.toString(),
  };
}

export function getBountyById(id, bounties = BOUNTIES) {
  return bounties.find((bounty) => bounty.id === id) || null;
}
