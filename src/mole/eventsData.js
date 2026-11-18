// Community Events — structured historical/upcoming event records. Single
// source of truth for the /events/ page. See docs/community-events.md for
// the event model, status lifecycle, and evidence rules every record here
// is expected to meet. Static data (no live RPC dependency) — event
// scheduling/results are editorial facts, not derivable from chain state.
//
// Real historical events only — see docs/community-events.md's inspection
// notes for what was searched and what was NOT found (no verified quiz
// tournament, AMA, or hackathon exists yet). Nothing here is invented.

export const EVENT_TYPES = Object.freeze({
  QUIZ_TOURNAMENT: "quiz-tournament",
  AMA: "ama",
  COMMUNITY_MEETUP: "community-meetup",
  GAME_COMPETITION: "game-competition",
  GIVEAWAY: "giveaway",
  SPONSORED_TRIVIA: "sponsored-trivia",
  HACKATHON: "hackathon",
  PARTNERSHIP_EVENT: "partnership-event",
  ANNOUNCEMENT: "announcement",
  // Not in the original minimum list — added because the one real completed
  // "event" this project has evidence for (the Raydium farm) is a liquidity
  // staking program, not a giveaway (giveaway implies unconditional
  // distribution; a farm requires staking LP tokens to earn). Mislabeling it
  // as a "giveaway" would misrepresent how it worked. This is the kind of
  // extension the event model explicitly allows ("may be extensible, but do
  // not over-engineer it") — one type, not a redesign.
  LIQUIDITY_PROGRAM: "liquidity-program",
});

export const EVENT_STATUSES = Object.freeze({
  UPCOMING: "upcoming",
  LIVE: "live",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  POSTPONED: "postponed",
});

/**
 * Quiz tournaments reuse the existing quiz engine's scoring/points entirely —
 * this sub-object is descriptive metadata only (what a tournament's rules
 * ARE), never a second scoring/leaderboard implementation. See
 * docs/community-events.md's "Quiz tournament integration" section for why
 * a true event-scoped leaderboard isn't built this sprint (the quiz system
 * doesn't track per-answer timestamps, only aggregate counters, so
 * date-range-filtered standings aren't derivable from existing data without
 * a real schema change).
 */
function quizTournamentShape(overrides = {}) {
  return {
    eligibleLevels: [],
    scoringRule: "Standard quiz points (no separate tournament scoring engine).",
    leaderboardScope: "cycle",
    rewardRule: "",
    participantEligibility: "",
    resultsStatus: "not-started",
    payoutStatus: "not-applicable",
    ...overrides,
  };
}

/**
 * Real event records only. Every COMPLETED event must carry at least one
 * evidence link (enforced by validateEventRecord) — the same
 * no-unsupported-claim rule partnersData.js already applies to ACTIVE
 * partner status.
 */
export const EVENTS = [
  {
    id: "raydium-farm-2025",
    title: "WinLEW/SOL Raydium Liquidity Farm",
    type: EVENT_TYPES.LIQUIDITY_PROGRAM,
    status: EVENT_STATUSES.COMPLETED,
    startIso: "2025-03-10T00:00:00Z",
    endIso: "2025-06-08T00:00:00Z",
    timezone: "UTC",
    host: "WinLEW",
    partnerId: null,
    description:
      "A 90-day WinLEW/SOL LP staking farm on Raydium. LP providers earned ordinary pool trading fees, and staking LP tokens in the farm additionally shared a scheduled WinLEW reward pool.",
    eligibility: "Anyone who provided WinLEW/SOL liquidity and staked the resulting LP tokens in the farm.",
    rewards: "Owner-supplied historical terms: weekly rewards 290,000 WinLEW, total rewards locked 3,737,386.66 WinLEW over the 90-day duration — not independently re-verified on-chain this sprint (matches the existing ecosystem-support record in src/mole/partnersData.js).",
    rules: "Standard Raydium farm mechanics — reward accrual proportional to staked LP share, for the program's fixed 90-day window.",
    participationUrl: null,
    evidence: [
      { label: "Raydium farm", url: "https://raydium.io/farms/?farmId=5DAWnkAg2FE8Ws9ZbRdSXunc1SupJeaxBid1hX5qXjG9" },
    ],
    results: {
      summary: "Program concluded on schedule at the end of its 90-day window.",
      standingsUrl: null,
      winners: null,
      payoutStatus: "paid",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-07-16",
  },
  {
    id: "raydium-farm-2025-2",
    title: "WinLEW/SOL Raydium Liquidity Farm #2",
    type: EVENT_TYPES.LIQUIDITY_PROGRAM,
    status: EVENT_STATUSES.COMPLETED,
    startIso: "2025-06-16T00:00:00Z",
    endIso: "2025-09-14T00:00:00Z",
    timezone: "UTC",
    host: "WinLEW",
    partnerId: null,
    description:
      "A second 90-day WinLEW/SOL LP staking farm on Raydium, run back-to-back after the first farm program ended. LP providers earned ordinary pool trading fees, and staking LP tokens in the farm additionally shared a scheduled WinLEW reward pool.",
    eligibility: "Anyone who provided WinLEW/SOL liquidity and staked the resulting LP tokens in the farm.",
    rewards: "Weekly rewards 233,333.0496 WinLEW, total rewards ~2,999,996.35 WinLEW over the 90-day duration — independently confirmed via Raydium's public API and the project owner's own wallet portfolio screenshot (matches the existing ecosystem-support record in src/mole/partnersData.js, id: raydium-farm-2).",
    rules: "Standard Raydium farm mechanics — reward accrual proportional to staked LP share, for the program's fixed 90-day window.",
    participationUrl: null,
    evidence: [
      { label: "Raydium farm", url: "https://raydium.io/farms/?farmId=3ew3rB5UTgDNxuLNGm1Bvb4krBscBMzJjptvYbA8R8d7" },
    ],
    results: {
      summary: "Program concluded on schedule at the end of its 90-day window.",
      standingsUrl: null,
      winners: null,
      payoutStatus: "not-applicable",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-07-16",
  },
  {
    // LIVE from 2026-08-18T02:31Z. The snapshot the fairness argument rests on
    // now exists, so the condition this record was held back for is met.
    //
    // HISTORY, kept rather than tidied away: the owner's mock-up announcement
    // said "THE SNAPSHOT HAS ALREADY BEEN TAKEN" on 2026-08-16 when it had not.
    // That line was cut, this record stated the absence explicitly, and the
    // snapshot was taken on 2026-08-18 before anything was published. The
    // sequence matters more than the outcome: the claim came second.
    //
    // THE BASELINE IS A PAIR, taken 12 seconds apart so both routes share one
    // start:
    //   WinLEW  slot 439971290  sha256 22391a97c1093b48ebee2533a32b88f41b02a375cce0608d18e324bf80e4f59b
    //   pool LP slot 439971320  sha256 aaba0d8f45400ba164292ad358f64b8793523b50911870a9e5e59f975c0b6c0a
    // Both under docs/holder-snapshots/, both reproducible with
    // `npm run snapshot:holders`. Two earlier snapshots exist and are kept as
    // records; they are NOT the baseline, and used a looser exclusion rule.
    //
    // Arithmetic independently checked: 300,000/week over 90 days is 12.857
    // weeks = 3,857,143 WinLEW, matching the announced "~3.86M"; the tiered
    // pool 3M + 2M + 1M = 6M also matches.
    id: "buy-hodl-or-lp-campaign-2026",
    // The cover of this campaign's own announcement article. Generated, and
    // labelled as such in newsData.js — it carries the headline, not a promise.
    image: "/images/news/generated/liquidity-and-hodl-campaign.png",
    imageAlt: "Cover art for the HODL + Liquidity Campaign announcement.",
    title: "Buy & HODL or Add Liquidity — 1,000,000 WinLEW Draw",
    type: EVENT_TYPES.GIVEAWAY,
    status: EVENT_STATUSES.LIVE,
    startIso: "2026-08-18T02:31:22Z",
    endIso: "2026-10-01T00:00:00Z",
    timezone: "UTC",
    host: "WinLEW",
    partnerId: null,
    description:
      "A participation draw with two qualifying routes: buy and hold WinLEW, or add liquidity to the WinLEW/SOL Raydium pool. Entry is not weighted by size — every qualifying wallet holds one entry. Announced to replace an earlier liquidity-only challenge, on the stated reasoning that requiring people to become liquidity providers excluded anyone without the capital or the appetite for impermanent-loss risk.",
    // The pool address deliberately does NOT appear in this prose. Two reasons:
    // the "Participate" button on the card already links straight to the pool,
    // so the 44 characters onboard nobody; and because these fields are escaped
    // free text, an unbreakable token rendered 451px wide inside a 326px card
    // on a phone and was CLIPPED, not wrapped (reported 2026-08-16). The CSS on
    // /events/ now wraps long tokens too, but the better fix is not to make
    // someone read an address they can click instead. participationUrl below is
    // the canonical place for it.
    eligibility:
      "Verified WinLEW accounts (a wallet linked to a verified identity) that, measured across all of their linked wallets, either INCREASE their WinLEW position by at least 1,500 WinLEW, or increase their WinLEW/SOL Raydium pool LP holding, between the opening and closing snapshots. Qualification is per verified ACCOUNT, not per wallet: holding many wallets does not multiply entries. Determined on-chain by comparing two snapshots — nobody submits anything, and nothing is claimed. Excluded: project-owned addresses (reserves, burn wallet, pools, locks) and any off-curve program address, none of which can win. The Burn Wallet's 40M lock of 2026-08-16 does not count as participation.",
    rewards:
      "Committed: 1,000,000 WinLEW to one randomly selected participant. Discretionary and NOT promised: the pool may be increased to three winners (3,000,000 / 2,000,000 / 1,000,000; 6,000,000 total) if participation warrants it. Separately proposed and not yet committed: a 90-day Raydium farm at 300,000 WinLEW/week, ~3,857,143 WinLEW total.",
    rules:
      "TWO ENTRIES MAXIMUM PER ACCOUNT. Increasing your position earns one entry; adding liquidity earns one entry; nobody can hold more than two however many times they buy, deposit, or split across wallets. Each is a yes/no test, not a count — buying ten times is the same one entry as buying once, and so is depositing ten times. You must STILL HOLD the increase at the closing snapshot: buy then sell, or deposit then withdraw, and that entry is not earned. Adding liquidity spends the WinLEW an increase would otherwise be measured in, so providing liquidity counts as BOTH entries — you cannot lose your position entry by using it to provide liquidity. Size-independent and time-independent: a larger position earns no more entries than a smaller one, and joining on day one earns no more than joining on the last day. Winner drawn at random from the eligible set after the closing snapshot, by a published method fixed in advance. Not a financial promotion: no return is promised, the prize is a fixed token quantity rather than a fixed value, and providing liquidity carries impermanent-loss risk.",
    participationUrl: "https://raydium.io/liquidity/increase/?mode=add&pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx",
    // The canonical, human-readable statement of these rules. This record and
    // the article are the ONLY two places the rules exist — everywhere else on
    // the site links here rather than restating them, so there is one copy to
    // keep correct rather than four that drift apart.
    articleUrl: "/news/liquidity-and-hodl-campaign/",
    evidence: [],
    results: {
      summary:
        "Running. Opening snapshots taken 2026-08-18T02:31Z — WinLEW at slot 439971290, pool LP at slot 439971320, both published under docs/holder-snapshots/ and reproducible with `npm run snapshot:holders`. The closing snapshot is due 2026-10-01T00:00Z, BEFORE Raydium Farm Round 2 reopens the same day: staking LP tokens moves them out of your wallet, so the close is deliberately sequenced ahead of it. No winner has been drawn.",
      standingsUrl: null,
      winners: null,
      payoutStatus: "not-applicable",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-08-20",
  },
  {
    // Added 2026-08-16. The launch date is EVIDENCED, not assumed: pump.fun's
    // own coin page for DnrcdQVH…pump reads "Created Dec 7, 2024, 1:55 PM"
    // (owner-supplied screenshot, 2026-08-16), which also matches the site's
    // existing claim in /who-we-are/ that the token "has been live on Solana
    // mainnet since December 2024". Two independent sources agreeing on the
    // month, one of them giving the day.
    //
    // Deriving it from chain was attempted first and abandoned as impractical:
    // getSignaturesForAddress on the mint returned >7,000 signatures across 7
    // pages and only reached 2026-07-22, so walking back to Dec 2024 would take
    // on the order of a hundred more calls.
    //
    // Dec 7 2026 is therefore exactly two years on. The airdrop itself has no
    // published mechanics yet, so this record says so rather than inventing
    // eligibility rules — see `rules` below.
    id: "two-year-anniversary-airdrop-2026",
    image: "/images/news/generated/two-year-anniversary-airdrop.png",
    imageAlt: "Cover art for the Two-Year Anniversary Airdrop announcement.",
    title: "Two-Year Anniversary Airdrop",
    type: EVENT_TYPES.GIVEAWAY,
    status: EVENT_STATUSES.UPCOMING,
    startIso: "2026-12-07T00:00:00Z",
    endIso: null,
    timezone: "UTC",
    host: "WinLEW",
    partnerId: null,
    description:
      "An airdrop marking two years since $WinLEW was created on Solana. The token's pump.fun page records its creation as December 7, 2024, so December 7, 2026 is the second anniversary. Announced ahead of time so the date is on the record before the event rather than after it.",
    // Mechanics published 2026-11-14 (owner decisions; see newsData.js slug two-year-anniversary-airdrop).
    eligibility:
      "Wallets registered with !register in the WinLEW Discord. The 156 wallets registered as of November 14, 2026 count once each (frozen list; sorted, one per line, SHA-256 dfb9a484e71ba1dca699f3ebb3e4197b9d059e69c42d8e297a9bcbfea0a13733). Registrations after that count once per Discord account: the wallet the account has saved when registration closes. Registration closes December 6, 2026 at 00:00 UTC. Project-owned addresses and wallets banned from the faucet are left out. Holding $WinLEW is not required.",
    rewards:
      "10,000 $WinLEW per registration, the same for everyone, sent December 7, 2026 from the WinLEW treasury (diglew.sol).",
    rules:
      "The final list is committed to the XL1 blockchain and shown on the Oxyon Evidence Explorer before any token is sent. After the airdrop, each payout's Solana transaction is published and checked against that list, wallet by wallet, and can be opened on Solscan.",
    participationUrl: "/news/two-year-anniversary-airdrop/",
    evidence: [
      { label: "Token creation date — pump.fun coin page (Created Dec 7, 2024)", url: "https://pump.fun/coin/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
      { label: "$WinLEW mint on Solscan", url: "https://solscan.io/token/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump" },
    ],
    results: {
      summary: "Scheduled for December 7, 2026: 10,000 $WinLEW per registration. Registration closes December 6, 2026 at 00:00 UTC.",
      standingsUrl: null,
      winners: null,
      payoutStatus: "not-applicable",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-11-14",
  },
  {
    // Added 2026-07-17. Milestone-conditional, not date-scheduled — no
    // startIso, so classifyEventBucket() correctly buckets this as
    // "upcoming" ("announced but no date set yet") rather than forcing a
    // fake date. Follower count independently cross-checked this session
    // (WebFetch of the account's live profile page returned 66, matching
    // the owner's own supplied figure exactly) — a stronger evidence tier
    // than most entries here, worth noting rather than flattening to the
    // same "owner-supplied" label used below for the holder-count entry.
    //
    // REFRESH ATTEMPTED AND FAILED 2026-08-13, recorded so the next
    // session does not repeat it: x.com and twitter.com both answer 200
    // with ~640 KB of JavaScript shell containing no follower figure, and
    // syndication.twitter.com rate-limits (429). The 2026-07-17 method no
    // longer works. This number is now owner-refreshable only — unlike the
    // holder count below, which moved the other way and is counted
    // on-chain.
    id: "leweveryonewin-500-follower-giveaway",
    title: "500-Follower Giveaway — 1,000,000 WinLEW",
    type: EVENT_TYPES.GIVEAWAY,
    status: EVENT_STATUSES.UPCOMING,
    startIso: null,
    endIso: null,
    timezone: "UTC",
    host: "WinLEW",
    partnerId: null,
    description:
      "Announced via the official @LetEveryOneWin X account: when the account reaches 500 followers, one randomly selected follower will receive 1,000,000 WinLEW. As of this writing (2026-07-17), the account has 66 followers — independently confirmed by fetching the account's live profile page, matching the owner's own supplied figure. This giveaway has not yet triggered.",
    eligibility: "Followers of @LetEveryOneWin at the time the account reaches 500 followers — the exact selection method was not specified in the original announcement.",
    rewards: "1,000,000 WinLEW to one randomly selected follower, per the original announcement.",
    rules: "Triggers when @LetEveryOneWin reaches 500 followers — a follower-count milestone, not a scheduled date. No fixed start/end time exists to record.",
    participationUrl: "https://x.com/LetEveryOneWin",
    evidence: [
      { label: "Giveaway announcement (X, March 29, 2025)", url: "https://x.com/LetEveryOneWin/status/1906124922298196250" },
    ],
    results: {
      summary:
        "Not triggered. The account has not reached 500 followers (66 as of 2026-07-17), and as of 2026-08-16 the project does not expect to reach that milestone before the dated Two-Year Anniversary Airdrop on December 7, 2026 (see two-year-anniversary-airdrop-2026). Kept on the record because it was publicly announced and was never withdrawn — if 500 followers is reached first, it still stands. It is listed here so two giveaways are not mistaken for two separate promises of tokens.",
      standingsUrl: null,
      winners: null,
      payoutStatus: "not-applicable",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-07-17",
  },
  {
    // Added 2026-07-17. Same milestone-conditional shape as the entry
    // above. @WinLewToken is also the wallet behind the X/Twitter faucet —
    // see the "X (Twitter) Faucet Reserve" component on /transparency/
    // (relabeled this session) — same account, two different roles
    // (giveaway host here, faucet reserve there), not duplicated data.
    // Holder count was owner-supplied only until 2026-08-13 (Solscan's page
    // 403s automated fetches and RugCheck doesn't expose the figure), and is
    // now COUNTED ON-CHAIN instead of asked for. getProgramAccounts over the
    // SPL Token program, filtered to 165-byte accounts whose mint field
    // (offset 0) is the WinLEW mint, then counting those with a non-zero
    // balance. 226 token accounts exist for the mint; 151 are empty, leaving
    // 75. Those 75 resolve to 75 distinct owner wallets — one token account
    // each, no wallet holding through several.
    //
    // The result carries its own integrity check: the balances sum to exactly
    // 950,000,000, which equals getTokenSupply. A partial enumeration could not
    // land on the supply exactly, so nothing was missed.
    //
    // 2026-08-19: supply is no longer 950,000,000 — two holders burned 39.384172
    // of dust on 2026-08-18, putting it at 949,999,960.615828. The check above
    // still works, it just no longer lands on a round number; compare against
    // whatever getTokenSupply returns on the day, never against this figure.
    // See docs/burn-program.md §7d.
    //
    // Refresh with the same method rather than by asking, and expect it to need
    // retries — getProgramAccounts is heavy enough that the primary RPC
    // rejected it on compute-units five times before the fallback answered.
    id: "winlewtoken-holder-milestone-giveaways",
    title: "Holder-Milestone Giveaways — 100 Holders, Then 500 Holders",
    type: EVENT_TYPES.GIVEAWAY,
    status: EVENT_STATUSES.UPCOMING,
    startIso: null,
    endIso: null,
    timezone: "UTC",
    host: "WinLEW",
    partnerId: null,
    description:
      "Announced via the @WinLewToken X account: a #WinLewGiveaway is planned when the WinLEW token reaches 100 holders, with a further giveaway planned at 500 holders. Counted directly on-chain on 2026-08-13, the token has 75 holders — 75 wallets with a non-zero balance, out of 226 token accounts in total. That figure includes the liquidity pool, the burn wallet and the locked reserves, which are addresses rather than people. Neither milestone has triggered yet.",
    eligibility: "Not fully specified in the original announcement beyond following @WinLewToken and @LetEveryOneWin.",
    rewards: "Not specified in the original announcement — amount to be determined when each milestone is reached.",
    rules: "Two-stage: triggers first at 100 holders, then again at 500 holders — a holder-count milestone, not a scheduled date. No fixed start/end time exists to record.",
    participationUrl: "https://x.com/WinLewToken",
    evidence: [
      { label: "Giveaway announcement (X, May 3, 2025)", url: "https://x.com/WinLewToken/status/1918847633944158308" },
    ],
    results: {
      summary: "Not yet triggered — the token has not reached 100 holders (75 on 2026-08-13, counted on-chain).",
      standingsUrl: null,
      winners: null,
      payoutStatus: "not-applicable",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-08-13",
  },
  {
    id: "2brz-partnership-announcement-2025",
    // REAL historical artwork — the announcement graphic itself, already in the
    // repo and already used as the news article's hero. Not a decorative
    // stand-in: this is the image the partnership was announced with.
    image: "/images/2brz-partnership.jpg",
    imageAlt: "The original 2BRZ × WinLEW partnership announcement graphic.",
    title: "2BRZ / 2 Brotherz Community Partnership Announcement",
    type: EVENT_TYPES.PARTNERSHIP_EVENT,
    status: EVENT_STATUSES.COMPLETED,
    // CORRECTED 2026-08-16, from 2025-04-01T00:00:00Z. Derived from the X post
    // id this record already cites (see partnersData.js id: 2brz for the full
    // note). Stored as the real posting instant rather than a midnight
    // placeholder, so the value carries its own precision.
    startIso: "2025-04-03T02:18:46.624Z",
    endIso: null,
    timezone: "UTC",
    host: "WinLEW",
    partnerId: "2brz",
    description:
      "Public announcement of a community collaboration between WinLEW and 2BRZ (2 Brotherz) — see the linked partner record for the full evidence/claims boundary.",
    eligibility: "N/A — announcement, not a participation event.",
    rewards: "N/A",
    rules: "N/A",
    participationUrl: null,
    evidence: [
      { label: "Partnership announcement (X, April 2, 2025 — post id 1907618750523736507 decodes to 2025-04-03T02:18:46Z UTC, i.e. 8:18 PM Mountain on April 2)", url: "https://x.com/LewSales/status/1907618750523736507" },
      { label: "The 500,000 WinLEW giveaway announcement (@WinLewToken, draw set for April 10, 2025)", url: "https://x.com/WinLewToken/status/1907256355477500314" },
      // VERIFIED ON-CHAIN 2026-08-18, not transcribed: exactly 500,000.000000
      // WinLEW left the X Faucet Reserve (GFxz42bi…C7EhAp) for the winner's
      // wallet in one transfer, at 2025-04-11T02:38:33Z — the evening of April
      // 10 Mountain, matching the "Paid ..!!" post to the day. Read from
      // getTransaction token-balance deltas.
      { label: "Payout transaction — exactly 500,000 WinLEW from the X Faucet Reserve (2025-04-11T02:38:33Z)", url: "https://solscan.io/tx/57yz552QCvVDNqfg5d5YXqgeqMF8TCLEb39toEmgRN7SDYHUM3PLXPLCT9A4tQzxezSjzAkc5je88oQ2CYFDjr4Y" },
    ],
    results: {
      summary:
        "Announcement published, and the accompanying 500,000 WinLEW giveaway was drawn and PAID — verified on-chain, not asserted. See the linked partner record (src/mole/partnersData.js, id: 2brz) for current partnership status.",
      standingsUrl: null,
      // Named only because the winner published their own wallet address when
      // they entered. Nothing here was disclosed on anyone's behalf.
      winners: "@_zrago — 500,000 WinLEW, paid 2025-04-11T02:38:33Z",
      payoutStatus: "paid",
    },
    quizTournament: null,
    lastUpdatedIso: "2026-07-16",
  },
];

function toMs(iso) {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Pure — required fields, valid enum values, sane date ordering, and the
 * core anti-unsupported-claim rule: a COMPLETED event must have at least
 * one evidence link (an event can't be "confirmed to have happened" on
 * this site with zero public evidence, the same standard partnersData.js
 * already applies to ACTIVE partner status).
 */
export function validateEventRecord(event) {
  const errors = [];
  if (!event?.id) errors.push("missing_id");
  if (!event?.title) errors.push("missing_title");
  if (!Object.values(EVENT_TYPES).includes(event?.type)) errors.push("invalid_type");
  if (!Object.values(EVENT_STATUSES).includes(event?.status)) errors.push("invalid_status");
  if (event?.startIso && event?.endIso && toMs(event.endIso) < toMs(event.startIso)) {
    errors.push("end_before_start");
  }
  const evidenceCount = (event?.evidence || []).length;
  if (event?.status === EVENT_STATUSES.COMPLETED && evidenceCount === 0) {
    errors.push("completed_status_requires_evidence");
  }
  return { ok: errors.length === 0, errors };
}

/** Pure — returns any event ids that appear more than once. */
export function findDuplicateEventIds(events = EVENTS) {
  const seen = new Set();
  const duplicates = new Set();
  for (const event of events) {
    if (seen.has(event.id)) duplicates.add(event.id);
    seen.add(event.id);
  }
  return Array.from(duplicates);
}

export function getEventById(id, events = EVENTS) {
  return events.find((event) => event.id === id) || null;
}

/**
 * Pure — buckets an event into one of the four page sections. An explicit
 * CANCELLED/POSTPONED/COMPLETED status always wins (an organizer's own
 * record of what happened is authoritative). Otherwise the bucket is
 * derived from real time against startIso/endIso, so an event that was
 * marked UPCOMING doesn't keep showing as upcoming forever after its own
 * end date has quietly passed.
 */
export function classifyEventBucket(event, nowMs = Date.now()) {
  if (event?.status === EVENT_STATUSES.CANCELLED) return "cancelled";
  if (event?.status === EVENT_STATUSES.POSTPONED) return "postponed";
  if (event?.status === EVENT_STATUSES.COMPLETED) return "completed";

  const start = toMs(event?.startIso);
  const end = toMs(event?.endIso) || start;
  if (!start) return "upcoming"; // announced but no date set yet — still "coming"
  if (nowMs < start) return "upcoming";
  if (nowMs <= end) return "live";
  return "completed";
}

/** Pure — groups a list of events into the four display buckets. */
export function groupEventsByBucket(events = EVENTS, nowMs = Date.now()) {
  const groups = { upcoming: [], live: [], completed: [], cancelledOrPostponed: [] };
  for (const event of events) {
    const bucket = classifyEventBucket(event, nowMs);
    if (bucket === "cancelled" || bucket === "postponed") groups.cancelledOrPostponed.push(event);
    else groups[bucket].push(event);
  }
  return groups;
}

/** Pure — events referencing a given partner id (for cross-linking, never duplicating partner data). */
export function getEventsForPartner(partnerId, events = EVENTS) {
  return events.filter((event) => event.partnerId === partnerId);
}

export { quizTournamentShape };
