// Sponsors & Partners — structured historical records. Single source of
// truth for the /partners/ page. See docs/sponsors-and-partners.md for
// inclusion criteria, status rules, and the evidence standard every record
// here is expected to meet.
//
// This is static data (no live RPC/API dependency) — partnership status is
// a human/editorial judgment, not something derivable from chain state.

export const PARTNER_TYPES = Object.freeze({
  COMMUNITY_PARTNER: "community-partner",
  ECOSYSTEM_PARTNER: "ecosystem-partner",
  SPONSOR: "sponsor",
  INFRASTRUCTURE_PROVIDER: "infrastructure-provider",
  EVENT_COLLABORATOR: "event-collaborator",
  HISTORICAL_PARTNER: "historical-partner",
  SERVICE_PROVIDER: "service-provider",
});

export const PARTNER_STATUSES = Object.freeze({
  ACTIVE: "active",
  HISTORICAL: "historical",
  COMPLETED: "completed",
  INACTIVE: "inactive",
  STATUS_UNCONFIRMED: "status-unconfirmed",
});

/**
 * Formal partnership/collaboration records. Every entry must have at least
 * one public evidence link. Do NOT mark `status: ACTIVE` without current
 * evidence — an old announcement alone only supports `HISTORICAL` or
 * `STATUS_UNCONFIRMED`.
 */
export const PARTNERS = [
  {
    id: "2brz",
    name: "2BRZ / 2 Brotherz",
    type: PARTNER_TYPES.COMMUNITY_PARTNER,
    status: PARTNER_STATUSES.STATUS_UNCONFIRMED,
    statusLabel: "Historical Community Partner",
    // CORRECTED 2026-08-16, from 2025-04-01. X snowflakes encode their own
    // timestamp: post id 1907618750523736507 decodes to 2025-04-03T02:18:46Z,
    // which is 8:18 PM on April 2 in the project's own timezone. The old date
    // was a day early in UTC and two days early locally, and the evidence
    // needed to catch it was inside the URL this record already stored. The
    // label below now carries the decoded timestamp so it cannot rot silently
    // back into a vague "April 2025" again. See src/shared/snowflake.js.
    dateAnnouncedIso: "2025-04-02",
    endDateIso: null,
    summary:
      "A community collaboration between WinLEW and 2BRZ (2 Brotherz), announced publicly on X in April 2025. Public language at the time described shared goals, mutual support, and community alignment between the two projects — promotional framing, not a documented formal legal or financial arrangement.",
    publicEvidence: [
      { label: "Partnership announcement (X, April 2, 2025 — post id 1907618750523736507 decodes to 2025-04-03T02:18:46Z UTC, i.e. 8:18 PM Mountain on April 2)", url: "https://x.com/LewSales/status/1907618750523736507" },
      { label: "2BRZ token on Pump.fun", url: "https://pump.fun/coin/3oB7hyAZXqrzzbSebt3XykCrXqAX6Vv57Qdin3bVpump" },
    ],
    officialLinks: [
      { label: "2brz.com", url: "http://2brz.com" },
    ],
    tokenMint: "3oB7hyAZXqrzzbSebt3XykCrXqAX6Vv57Qdin3bVpump",
    announcementQuote:
      "Together, we complement each other perfectly; combining creativity with execution to drive results that matter. It's a synergy built on shared goals, mutual strengths, and a passion for success. Here's to an unstoppable collaboration!",
    // A small, deliberately quiet nod to 2BRZ's own brand (mascot "Sneeky
    // Pete," tagline "Built Different. Delivered Real.," from 2brz.com) —
    // shown only as a hover tooltip on the card's monogram, not a public
    // claim about either project, so it doesn't need an evidence link.
    easterEggTooltip: "🐿️ Sneeky Pete approved this one. Built Different. Delivered Real.",
    whatItInvolved: "A public cross-promotion / community-alignment announcement between the two projects' communities.",
    whatIsNotClaimed:
      "No formal legal partnership, investment, endorsement, revenue-sharing arrangement, or contractual obligation is documented or claimed. Current (2026) activity level of the relationship has not been independently reconfirmed since the April 2025 announcement — hence \"status unconfirmed\" rather than \"active.\"",
    lastVerifiedIso: "2026-07-16",
  },
];

/**
 * Verified project investments / ecosystem-support milestones — distinct
 * from PARTNERS above. These are purchases, registrations, and programs the
 * project itself ran or paid for, NOT a claim of partnership with the
 * service provider. Do not call a vendor a "sponsor."
 */
export const ECOSYSTEM_SUPPORT = [
  {
    id: "raydium-liquidity-pool",
    label: "Raydium Liquidity Pool",
    category: "Liquidity",
    summary: "Primary WinLEW/SOL liquidity pool on Raydium — see the Transparency Center for live pool status and links.",
    dateIso: null,
    evidence: [
      { label: "Transparency Center — Liquidity component", url: "/transparency/#component-liquidity" },
      { label: "Raydium pool", url: "https://raydium.io/liquidity/increase/?mode=add&pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx" },
    ],
    verification: "verified",
    notes: null,
  },
  {
    id: "raydium-farm",
    label: "Raydium Farm Program (historical)",
    category: "Liquidity Incentive",
    summary: "A 90-day WinLEW/SOL LP staking farm — LP providers earned pool trading fees, and staking LP tokens in the farm additionally shared a scheduled WinLEW reward pool. This program has ended; treat it as historical, not currently active.",
    dateIso: "2025-03-10",
    endDateIso: "2025-06-08",
    evidence: [
      { label: "Raydium farm", url: "https://raydium.io/farms/?farmId=5DAWnkAg2FE8Ws9ZbRdSXunc1SupJeaxBid1hX5qXjG9" },
    ],
    verification: "owner-supplied",
    notes: "Farm ID 5DAWnkAg2FE8Ws9ZbRdSXunc1SupJeaxBid1hX5qXjG9. Owner-supplied historical terms: weekly rewards 290,000 WinLEW, total rewards locked 3,737,386.66 WinLEW over the 90-day duration. Not independently re-verified on-chain for this sprint — labeled as owner-supplied, not live-verified.",
  },
  {
    id: "raydium-farm-2",
    label: "Raydium Farm Program #2 (historical)",
    category: "Liquidity Incentive",
    summary: "A second 90-day WinLEW/SOL LP staking farm on Raydium, run back-to-back after the first farm program ended. This program has ended; treat it as historical, not currently active.",
    dateIso: "2025-06-16",
    endDateIso: "2025-09-14",
    evidence: [
      { label: "Raydium farm", url: "https://raydium.io/farms/?farmId=3ew3rB5UTgDNxuLNGm1Bvb4krBscBMzJjptvYbA8R8d7" },
    ],
    verification: "verified",
    notes: "Farm ID 3ew3rB5UTgDNxuLNGm1Bvb4krBscBMzJjptvYbA8R8d7. Weekly rewards 233,333.0496 WinLEW, total rewards ~2,999,996.35 WinLEW over the 90-day duration — independently confirmed via Raydium's public API and the project owner's own wallet portfolio screenshot (both cross-checked against Farm 1's already-verified total using the same weekly-rate × 90/7 formula). Program concluded on schedule 2025-09-14 and is not currently active or stakeable (TVL ~$0 as of this check).",
  },
  {
    id: "dex-rugcheck-services",
    label: "DEX Listing / RugCheck Service Payments",
    category: "Listing Service",
    summary: "Payments for DEX-related listing/data services and a RugCheck safety profile for the WinLEW mint. These are routine paid listing services, not sponsorships or partnerships.",
    dateIso: null,
    evidence: [
      { label: "RugCheck report", url: "https://rugcheck.xyz/tokens/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
    ],
    verification: "conflicting-dates",
    notes:
      "Date conflict, not silently resolved: one owner-supplied statement gives a DEX payment date of April 24, 2025; a separate owner-supplied statement says DEX and RugCheck services were paid for in August (year not specified in the supplied record). Neither claim was independently verifiable from repository history or on-chain data for this sprint (these are off-chain fiat/service payments). Both dates are preserved here rather than one being silently chosen — see docs/sponsors-and-partners.md for the full conflict note.",
  },
  {
    id: "winlew-token-registration",
    label: "winlew.token Domain Registration (lapsed)",
    category: "Infrastructure",
    // Was: "Registration of the winlew.token domain as part of the project's
    // official-domain footprint alongside winlew.co" — present tense, listed
    // among current holdings. It no longer resolves. Established during the
    // /home/ content audit (2026-08-04), which removed the instruction telling
    // visitors to type winlew.token into an explorer.
    summary: "A past registration of the winlew.token name, which resolved on Solscan to the WinLEW mint. It no longer resolves and is not part of the project's current domain footprint — winlew.co is. Recorded here because the purchase was real, not because the name still works.",
    dateIso: null,
    evidence: [],
    verification: "owner-supplied",
    notes: "No independent registration-date evidence was available. Lapse confirmed two ways on 2026-08-04: the owner states the name-lookup came from a RugCheck-paid verification package that expired over a year ago, and `.token` is absent from AllDomains' current 48-TLD list, so it cannot be re-registered under that suffix today. Historical proof that it once worked is /images/solscan-domain.png, a screenshot of Solscan resolving winlew.token with Domain Owner set to the WinLEW mint.",
  },
  {
    // Community giveaways. The 18,000,000 here is the OWNER'S OWN RECOLLECTION
    // and has never been itemised. As of 2026-08-19 part of that giving is no
    // longer a recollection: the X Faucet Reserve's entire WinLEW history was
    // walked on-chain and published at /giveaways/, and that ledger carries a
    // signature for every payout. The narrative total is kept rather than
    // quietly replaced by the smaller proven one — deleting an owner statement
    // to make a ledger look complete is the wrong direction, and the two are
    // not in conflict: the ledger covers ONE wallet, the recollection covers
    // everything. Only one of them has transactions attached, and the record
    // now says which.
    id: "community-giveaways",
    label: "Community Giveaways & Liquidity Incentives",
    category: "Community Support",
    summary: "Owner-supplied historical statement: more than 18,000,000 WinLEW reportedly distributed historically through community giveaways and liquidity incentives (separate from the Raydium farm program above, faucet claims, and quiz/game payouts, which are tracked live elsewhere on this site). The portion the chain can prove is now published as the Giveaway Records at /giveaways/ — 12,228,500 WinLEW to 21 wallets across 30 payouts, every one with a transaction signature, reconstructed from the X Faucet Reserve's complete history. That ledger covers a single wallet and this figure was never itemised, so the two are not in conflict; only the smaller one is evidence.",
    dateIso: null,
    evidence: [],
    verification: "owner-supplied",
    notes: "This is a narrative total, not derived from an on-chain query or a specific transaction list. Labeled as owner-supplied and unverified rather than presented as a confirmed figure. Partially superseded on 2026-08-19 by docs/giveaway-records/x-faucet-reserve-ledger.json and the /giveaways/ page built from it, which replace guesswork with signatures for everything the X Faucet Reserve sent. Eighteen of those thirty payouts still match no announcement and are published unexplained rather than dropped. Prefer the ledger wherever the two overlap.",
  },
];

/**
 * Pure — a record is only allowed to claim ACTIVE status if it has at least
 * one public evidence link. An old announcement with no current evidence
 * can be HISTORICAL or STATUS_UNCONFIRMED, never ACTIVE — this is the rule
 * that prevents an unsupported "active partnership" claim from slipping in.
 */
export function validatePartnerRecord(partner) {
  const errors = [];
  if (!partner?.id) errors.push("missing_id");
  if (!partner?.name) errors.push("missing_name");
  if (!Object.values(PARTNER_TYPES).includes(partner?.type)) errors.push("invalid_type");
  if (!Object.values(PARTNER_STATUSES).includes(partner?.status)) errors.push("invalid_status");
  const evidenceCount = (partner?.publicEvidence || []).length;
  if (partner?.status === PARTNER_STATUSES.ACTIVE && evidenceCount === 0) {
    errors.push("active_status_requires_evidence");
  }
  return { ok: errors.length === 0, errors };
}

/** Pure — returns any partner ids that appear more than once. */
export function findDuplicatePartnerIds(partners = PARTNERS) {
  const seen = new Set();
  const duplicates = new Set();
  for (const partner of partners) {
    if (seen.has(partner.id)) duplicates.add(partner.id);
    seen.add(partner.id);
  }
  return Array.from(duplicates);
}

export function getPartnerById(id, partners = PARTNERS) {
  return partners.find((partner) => partner.id === id) || null;
}
