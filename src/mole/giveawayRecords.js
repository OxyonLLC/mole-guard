/**
 * WinLEW giveaway records — what was promised, and what actually moved.
 *
 * EVIDENCE OVER ASSUMPTIONS. This file deliberately keeps two different kinds
 * of fact apart, because collapsing them would launder a guess into proof:
 *
 *   GIVEAWAY_ANNOUNCEMENTS — what was publicly promised. Evidence is a post.
 *   GIVEAWAY_PAYOUTS       — what left the wallet. Evidence is a signature.
 *
 * A payout is a fact. Its ASSOCIATION with an announcement usually is not: for
 * most of these the only thing tying a transfer to a promise is that they
 * happened near each other. So every payout carries a `linkBasis`:
 *
 *   "verified"       the amount, the timing and a named winner all agree, or
 *                    the recipient published the address themselves.
 *   "inferred-timing" it lands in a cluster right after a deadline, and the
 *                    amount matches the prize. Probably right. Not proven.
 *   "none"           a real transfer with no announcement to attach it to.
 *
 * Eighteen of thirty payouts are "none". That is not a failure of the record —
 * it is the record. The project gave tokens away for two years without keeping
 * notes; the chain kept them, but the chain does not store reasons.
 *
 * PROVENANCE. Every payout below was read from getTransaction token-balance
 * deltas on 2026-08-18 by walking the X Faucet Reserve's complete history — all
 * 82 signatures of it, back to 2024-12-09 — not transcribed from screenshots.
 * The raw walk is committed at docs/giveaway-records/. Recipients that are
 * program-owned (a token lock, a bonding curve) are excluded here: an earlier
 * pass counted them as people and overstated giving by 25,040,000.
 *
 * PRIVACY. Wallets are public on-chain, so listing them reveals nothing new.
 * Handles are different: a winner is named ONLY where they published the link
 * between themselves and their wallet. Nothing here outs anyone.
 *
 * ADDING A RECORD: append it, run `node --test test/mole/giveawayRecords.test.mjs`.
 * Never retype a signature — copy it from the ledger.
 */

export const GIVEAWAY_STATUSES = Object.freeze({
  PAID: "paid",
  PARTIALLY_PAID: "partially-paid",
  NEVER_TRIGGERED: "never-triggered",
  OPEN: "open",
});

export const LINK_BASIS = Object.freeze({
  VERIFIED: "verified",
  INFERRED: "inferred-timing",
  NONE: "none",
});

/**
 * What a transfer WAS, which is a different question from what it was for.
 *
 * A GIVEAWAY is given: nothing comes back. An EXCHANGE is consideration — the
 * project received something of value for it, and counting it as generosity
 * would inflate this ledger by the exact amount it was paid.
 *
 * Added 2026-08-21 for the 3,500,000 of 2025-04-01, which sat unmatched for
 * months because no announcement explained it. It was never a giveaway: it is
 * the WinLEW side of a token swap with 2BRZ, and the chain shows both legs 55
 * minutes apart. See that payout for the evidence.
 */
export const PAYOUT_KINDS = Object.freeze({
  GIVEAWAY: "giveaway",
  EXCHANGE: "exchange",
  // A faucet claim the owner paid BY HAND from winlew.sol because the faucet's
  // own wallet had run dry. The person had already earned it by claiming; this
  // ledger is about giveaways, and counting a faucet claim as one would inflate
  // it with rewards that are tracked, and paid, somewhere else entirely.
  // Owner-confirmed 2026-08-21: "some that show 1500 was because the faucet ran
  // out and i sent from winlew.sol".
  //
  // THE AMOUNTS ARE THE DRIP RATE, WHICH CHANGED. The faucet paid 1,000 per
  // claim originally and 1,500 later — raised, in the owner's words, "a long
  // time ago as solana has tanked in price", i.e. more tokens for the same
  // real value. DRIP_AMOUNT is 1500 today.
  //
  // ONE OF THE THREE DOES NOT FIT THAT ORDER, and it is left visible rather
  // than filed quietly: 1,500 was paid on 2025-08-15 and 1,000 again on
  // 2026-06-14. A single raise from 1,000 to 1,500 cannot produce that
  // sequence. The exact change date cannot be checked here — DRIP_AMOUNT lives
  // in .env, which is gitignored — so either the rate moved more than once, or
  // the 2026 payment was not a drip. All three are still classified as faucet
  // activity on the owner's account of them; the discrepancy is recorded
  // because "almost certainly" was the reason these were miscounted the first
  // time.
  FAUCET_TOPUP: "faucet-topup",
});

/** The wallet every payout below came from — the X (Twitter) Faucet Reserve. */
/**
 * A SECOND PAYING WALLET EXISTS, and this ledger does not cover it.
 *
 * Owner-confirmed 2026-08-21: "yes, i paid some from my personal wallet". That
 * is the reason two announcements do not reconcile against the transfers here —
 * seven stakers were announced as paid at 200,000 and six left this reserve;
 * four people publicly confirmed a 500,000 prize and two left this reserve.
 *
 * The address has not been supplied, so nothing is inferred about it and no
 * transfer is credited to it. The gap is stated instead. Everything below is
 * complete FOR THE X FAUCET RESERVE — which is a narrower claim than "every
 * giveaway WinLEW ever paid", and the difference is written here rather than
 * left for a reader to discover by adding the numbers up themselves.
 */
export const KNOWN_UNCOVERED_SOURCE = Object.freeze({
  exists: true,
  description: "The project owner's personal wallet, used for some giveaway payouts.",
  addressKnown: false,
  confirmedIso: "2026-08-21",
  affects: ["liquidity-airdrop-2025", "meme-contest-2025"],
});

export const GIVEAWAY_SOURCE_WALLET = "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp";

export const GIVEAWAY_ANNOUNCEMENTS = Object.freeze([
  {
    // NOT the 100-HOLDER milestone giveaway, which never triggered and is
    // recorded separately in eventsData.js. This is 100 FOLLOWERS, it did
    // happen, and it was paid — a distinction worth keeping, because the two
    // are one word apart and one of them is still an open promise.
    id: "hundred-followers-2025",
    title: "100 followers reached — thank-you payouts",
    announcedIso: "2025-03-17T01:18:00Z",
    url: "https://x.com/WinLewToken/status/1901442960061034861",
    condition: "Participation in the follower push; no draw mechanics were published.",
    prize: "No fixed amount was stated in the announcement.",
    status: GIVEAWAY_STATUSES.PAID,
    // THE RECEIPT IS IN THE REPLIES, not the announcement: @DavidRindfleis1
    // answered two and a half hours later with "I got mine ty so much!!".
    // That is what ties the transfers to this post — the owner's instruction
    // was exactly this: "if you read the comments it should tell you".
    // Captured in docs/giveaway-records/x-reply-windows.json.
    note: "Announced on reaching 100 followers. A recipient confirmed receipt publicly in the replies the same night, which is what ties the transfers to it.",
  },
  {
    // Found 2026-08-21 by walking @WinLewToken's timeline to its first day.
    // This giveaway was never in this ledger: two 50,000 payouts sat unmatched
    // because the announcement lived on X and nothing here could read it.
    id: "friday-13th-2024",
    title: "Friday the 13th — 50,000 WinLEW each to two users",
    announcedIso: "2024-12-13T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1867497621374738438",
    condition: "Named directly in the post — not a draw.",
    prize: "50,000 WinLEW to each of two named users",
    status: GIVEAWAY_STATUSES.PAID,
    // "On Friday The 13th I'll be Sending both these users 50k $WinLEW for an
    // Early Scare.. Congrats to @Thekidd0595 and @LarssonKeith"
    //
    // Both were paid, six days apart. @LarssonKeith is millerknoll — owner
    // confirmed 2026-08-21 that D8oJSdqo…A5ZEz is that wallet — which also
    // makes this the first recorded payment to the holder who would later send
    // 50,000,000 to the burn wallet unprompted.
    note: "Announced and paid to two named users, 50,000 each. The second payment landed six days after the first.",
  },
  {
    id: "team-hodl-or-faucet-2024",
    title: "Team HODL or Team Faucet — 100,000 WinLEW",
    announcedIso: "2024-12-25T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1871934579019616730",
    condition: "Repost and comment which team you are on. Winner picked on New Year's Day.",
    prize: "100,000 WinLEW to one winner",
    status: GIVEAWAY_STATUSES.PAID,
    // PAID TWICE, and the reason is the most instructive thing in this file.
    //
    // The prize first went to @JosephRarnos956 — an impersonator of the real
    // winner @JosephRamos956, differing by a single character (r-n against m).
    // The project's own post on 2025-01-04 records it: "The Phisher ...Burnt
    // his 100k, So I Sent the 100k To the Real Winner @JosephRamos956".
    //
    // That also explains a burn recorded elsewhere in this repo. The wallet
    // that received the first 100,000 on 2025-01-01 destroyed exactly 100,000
    // on 2025-01-03 — logged in COMMUNITY_BURNS as an account sweep, which is
    // what it looked like from the chain alone and is not what it was.
    note: "Paid twice. The first 100,000 went to an impersonator of the winner, who then burned it; the real winner was paid three days later.",
  },
  {
    id: "engagement-giveaway-2025-02",
    title: "Engagement giveaway — 100,000 WinLEW",
    announcedIso: "2025-02-08T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1888184799118696941",
    condition: "Engage with the post.",
    prize: "100,000 WinLEW to one winner",
    status: GIVEAWAY_STATUSES.PAID,
    note: "Winner named publicly as @DWirsing on the day the payout left the reserve.",
  },
  {
    id: "launch-day-2024",
    title: "Launch-day giveaway — 100,000 WinLEW",
    announcedIso: "2024-12-07T00:00:00Z",
    url: null,
    condition: "Follow and repost. Winner to be selected December 25, 2024.",
    prize: "100,000 WinLEW to one winner",
    status: GIVEAWAY_STATUSES.PAID,
    // The first thing this project ever did. Announced on launch day itself,
    // drawn on Christmas, paid the day after — 100,000 exactly, which is why
    // the link is treated as verified despite no post URL being kept.
    note: "Announced the day the token went live. Paid 2024-12-26, one day after the stated draw date, for exactly the announced amount.",
  },
  {
    id: "five-sol-milestone-2025",
    title: "5 SOL milestone giveaway — 1,000,000 + two 500,000",
    announcedIso: "2025-02-09T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1888484957871280310",
    condition: "Triggered when the WinLEW contract reached 5 SOL. Follow @LetEveryOneWin, like and repost.",
    prize: "1,000,000 to one winner; 500,000 to each of two runners-up",
    status: GIVEAWAY_STATUSES.PARTIALLY_PAID,
    // The draw ids published with the results are unix milliseconds, so the
    // draw times up: 01:26:21Z, 01:29:21Z and 01:30:37Z on 2025-02-21. The
    // grand prize was paid 95 minutes later, the first runner-up 77 minutes.
    //
    // The THIRD prize was never paid, and that is the correct outcome rather
    // than a debt: the project owner's own name came out of the draw as second
    // runner-up, and he did not pay himself. Recorded because a record that
    // omits it would be flattering the wrong way round.
    note: "Two of three prizes paid. The third was drawn in the owner's own name and deliberately not paid.",
  },
  {
    id: "meme-contest-2025",
    title: "Meme contest — 500,000 each to the best three",
    announcedIso: "2025-03-29T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1906130750077813211",
    condition: "Post a WinLEW meme. Three winners picked on April 1, 2025.",
    prize: "500,000 WinLEW to each of three winners",
    status: GIVEAWAY_STATUSES.PARTIALLY_PAID,
    // The replies name the participants: on 2025-04-02 the project posted
    // "With 4 Participants, I'll give you All 500k $WinLEW" and then "Paid ..!!",
    // and four accounts answered in that thread — @jim_xyo ("Received!!!"),
    // @DavidRindfleis1 ("Whoo-hooo! I Won thanks!"), @jessechacon3 ("Boom!")
    // and @FreecryptoA. Two 500,000 transfers left the X Faucet Reserve.
    //
    // FOUR CONFIRMED RECEIPTS, TWO TRANSFERS FROM THIS WALLET. The others were
    // paid from somewhere this ledger does not cover, or in another amount. The
    // discrepancy is recorded rather than resolved by assumption.
    note: "Two 500,000 transfers left the reserve within nine minutes of each other just after the April 1 deadline. Four participants publicly confirmed receiving a prize in the same thread, so at least two were paid from a wallet this ledger does not cover.",
  },
  {
    id: "liquidity-airdrop-2025",
    title: "Add-liquidity snapshot airdrop",
    announcedIso: "2025-03-13T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1900378128234799501",
    condition: "Add liquidity to the WinLEW/SOL pool or farm before April 1, 2025. A snapshot would decide the airdrop.",
    prize: "Unspecified WinLEW airdrop to qualifying liquidity providers",
    status: GIVEAWAY_STATUSES.PAID,
    // Six 200,000 transfers inside six minutes, immediately after the stated
    // deadline. The pattern is exactly what an airdrop to a snapshot list looks
    // like — but the announcement named no amount and published no list, so
    // "these six are that airdrop" remains inference.
    // CONFIRMED 2026-08-21, and it exposes a gap. The project posted at
    // 2025-04-02T01:54Z: "1.4 Mill, 7 #WinLEW Participants 200,000 $WinLEW To
    // Each Staker..!! 🔥 Paid 🔥", and @LarssonKeith replied eight minutes
    // later, "Got Mine! Thank you so much!".
    //
    // So the payout is no longer inferred — it is stated and receipted. But
    // the arithmetic does not close: the post says SEVEN participants at
    // 200,000 each, which is 1,400,000, and the X Faucet Reserve sent SIX.
    // Either the seventh was paid from a different wallet, or it was never
    // paid. The ledger records the gap rather than rounding it away, exactly
    // as it does for the third meme-contest prize.
    note: "Six equal 200,000 transfers within six minutes on 2025-04-02, right after the deadline. The project announced SEVEN participants paid at 200,000 each (1.4M); only six left the X Faucet Reserve. The seventh is unaccounted for in this ledger.",
  },
  {
    id: "brz-partnership-2025",
    title: "2BRZ partnership giveaway — 500,000 WinLEW",
    announcedIso: "2025-04-01T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1907256355477500314",
    condition: "Show support for both the WinLEW and 2BRZ communities. Winner picked April 10, 2025.",
    prize: "500,000 WinLEW to one winner",
    status: GIVEAWAY_STATUSES.PAID,
    note: "Paid in full. The winner published their own wallet address when entering, which is the only reason it can be named.",
  },
  {
    id: "follower-500-2025",
    title: "500-follower giveaway — 1,000,000 WinLEW",
    announcedIso: "2025-03-29T00:00:00Z",
    url: "https://x.com/LetEveryOneWin/status/1906124922298196250",
    condition: "Triggers when @LetEveryOneWin reaches 500 followers. One follower receives 1,000,000 WinLEW.",
    prize: "1,000,000 WinLEW to one follower",
    status: GIVEAWAY_STATUSES.NEVER_TRIGGERED,
    // 66 followers when last counted (2026-07-17, checked against the account's
    // own profile rather than asked for). The condition was never met, so the
    // giveaway never started. It is listed rather than deleted: a promise that
    // went unmet is part of the record, and removing it would be the dishonest
    // option. Nothing is owed — a milestone that did not happen is not a debt.
    note: "Never triggered. The account stood at 66 followers when last counted on 2026-07-17. Nothing is owed: a giveaway conditioned on a milestone that was not reached is not a debt.",
  },
  {
    id: "holder-milestone-2025",
    title: "Holder milestone giveaways — at 100 holders, then 500",
    announcedIso: "2025-05-03T00:00:00Z",
    url: "https://x.com/WinLewToken/status/1918847633944158308",
    condition: "Triggers when the token reaches 100 holders, and again at 500.",
    prize: "Unspecified — no amount was ever named",
    status: GIVEAWAY_STATUSES.NEVER_TRIGGERED,
    note: "Never triggered. Counted on-chain on 2026-08-18 the token had 79 holders, of which 60 are people rather than pools, locks or reserves. Neither milestone has been reached.",
  },
]);

export const GIVEAWAY_PAYOUTS = Object.freeze([
  {
    dateIso: "2024-12-13T16:35:47.000Z",
    amountBaseUnits: "50000000000",
    recipientWallet: "Gg9Cng6EF9aU3X798mUHRW9kGLG61Qx2uEvf9oMFFBc7",
    signature: "5RaM9g82dBSziMcb4SzpqntAZjd4YJzUoa7NJmis3QeL4RZGo7HGhgumTmFeQCFXmocv61yqBhDuUs3VwFmep1Ba",
    announcementId: "friday-13th-2024",
    // Named as one of the two, on the day the post named them, for the exact
    // amount promised. Which of the two names this wallet belongs to is
    // inferred by elimination — the OTHER wallet is owner-confirmed as
    // @LarssonKeith — so the payout is linked to the announcement but the
    // individual is not asserted.
    linkBasis: "inferred-timing",
    role: "one of two named recipients (@Thekidd0595 or @LarssonKeith)",
  },
  {
    dateIso: "2024-12-19T01:06:04.000Z",
    amountBaseUnits: "50000000000",
    recipientWallet: "D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz",
    signature: "4CrJN2qDd7w3c1PkHcVaN2bmpqJmhy9qZTSMANb2V3RRsxTAd6Q1j7b7SvTb1gBRBdpDi48RZLD8ZXLUpa8k1E75",
    announcementId: "friday-13th-2024",
    // WALLET IDENTIFIED by the project owner, 2026-08-21: D8oJSdqo…A5ZEz is
    // millerknoll, aka @LarssonKeith, WinLEW's #1 holder — the same wallet that
    // sent 50,000,000 to the burn wallet unprompted on 2026-07-25
    // (see transfer-2026-07-25-holder-to-burn-wallet in burnEvents.js).
    // The chain proves the wallet and the amount; the person is attribution.
    linkBasis: "verified",
    role: "named recipient — @LarssonKeith (millerknoll)",
  },
  {
    dateIso: "2024-12-26T02:14:43.000Z",
    amountBaseUnits: "100000000000",
    recipientWallet: "AX7cMx4GMxwNt72ZqztYh9zqkZspvdxgVAmTBYcHNVhk",
    signature: "35qzm3NBjGQDUa731PS9dY7hnHwgpE9et21qeTMLzUMk1nSazTYWwofduiytnvsUwoTUgxjNzuFRkcbz2kzDoi7R",
    announcementId: "launch-day-2024",
    linkBasis: "verified",
    role: "sole winner",
  },
  {
    dateIso: "2025-01-01T19:47:27.000Z",
    amountBaseUnits: "100000000000",
    recipientWallet: "6Y4MJPHpG66bRizdy99mEZnaaiwvEx9Q1aD6wh8PQB5v",
    signature: "3SngeUokCTScz5ewXJb7RVnhFvSiDHXD5awM2JPpNKgtZG8p8Jnjh69DidSZUeKVgwT6rtE2AHmGUwpHVsUm6FPk",
    announcementId: "team-hodl-or-faucet-2024",
    // PAID TO AN IMPERSONATOR. The project's post of 2025-01-04 names it:
    // @JosephRarnos956 — one character from the real winner @JosephRamos956 —
    // took the prize, and "Burnt his 100k". This wallet did exactly that on
    // 2025-01-03, which is the burn recorded as community-2025-01-03.
    linkBasis: "verified",
    role: "paid in error to an impersonator (@JosephRarnos956), who burned it",
    // WHAT BECAME OF IT — a separate question from what it was FOR, and one the
    // chain can answer here. This wallet destroyed exactly 100,000 two days
    // later (see COMMUNITY_BURNS in src/mole/burnEvents.js). `fate` is
    // deliberately not `linkBasis`: the burn is proven, while "the burn was of
    // these tokens" is inference from an exact amount two days apart, and the
    // same transaction swept two unrelated tokens, so this was an account
    // cleanup rather than a gesture toward the project.
    fate: {
      kind: "burned-by-recipient",
      amountBaseUnits: "100000000000",
      dateIso: "2025-01-03T14:40:59.000Z",
      signature: "TVegUSjUPK7tkNu9gLCQANpeEWyTwacgDuaWXiJt4Zm6vCzYhVRB7SUqKR1fTit4DZ2GQiuQeEd9bV7Nu4PYGKy",
      basis: "inferred-amount-and-timing",
      note: "Burned two days after receipt, for the exact amount, in a sweep that also destroyed two unrelated tokens.",
    },
  },
  {
    dateIso: "2025-01-04T03:59:22.000Z",
    amountBaseUnits: "100000000000",
    recipientWallet: "HJRHtdz94LcjoPpVgsrX257t9ku9ZjnLVB4f2gLuAhcH",
    signature: "4yQKf5PdRcevGhjwb4ShPxtBxdYWAuyg4bQx1sto9KYWdYnktbG7jxdJRyGGPgjkaQkaagWjESUhZJW3XjszaVf6",
    announcementId: "team-hodl-or-faucet-2024",
    // The real winner, paid after the impersonation was discovered. The project
    // absorbed the loss rather than leaving the actual winner unpaid.
    linkBasis: "verified",
    role: "the real winner — @JosephRamos956, re-paid after the phishing",
  },
  {
    dateIso: "2025-02-01T20:28:23.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "4u12XCpdz43i8sm4yxFWaLFk8reXqFxRFTdozoYqicx3",
    signature: "63ZwSSKKhiRbpvDFL91gpzu1b3R4YqXi3VNcSUoY3UsnUKgpRGaMWyxT6mduWxUTqWbGCPFhnz91uQfYdozCERkD",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
  {
    dateIso: "2025-02-08T00:41:43.000Z",
    amountBaseUnits: "100000000000",
    recipientWallet: "89B84My2MA3Srr2LxbhQGhEHqoBGAuT22yFxtN9d9aFD",
    signature: "3KFsbLMb4Fa1UmucZrohfsEDwT8cbH5ChRnpLMikPb48mRtqWnanHBTXJN99qc2QYMWyPaLhGb8WbRexqDbwtM3s",
    announcementId: "engagement-giveaway-2025-02",
    // Announced the same day the payout left the reserve, for the exact amount.
    linkBasis: "verified",
    role: "named winner — @DWirsing",
  },
  {
    dateIso: "2025-02-21T02:46:51.000Z",
    amountBaseUnits: "500000000000",
    recipientWallet: "FDhcxnSo1wB2X7iYjQaFaFHD3Nc5TWsASFwfhFCbeo5j",
    signature: "58KzNkNDqirFHuGZFbAhdcf5RRTs1xXUghAQkG7MRYgXY7MdZqAEqYDtnstnRgJjfBwXrtR1NGofmv6ch9m5tXmd",
    announcementId: "five-sol-milestone-2025",
    linkBasis: "verified",
    role: "runner-up",
  },
  {
    dateIso: "2025-02-21T03:01:00.000Z",
    amountBaseUnits: "1000000000000",
    recipientWallet: "9JGvjo1bu4WAiuSCB2neW6aKniqFECGuJ3DLvSawB39k",
    signature: "4usGn3oJTsjhT2pBwWiPyNUUveSkFqZja1ALQ24R5piEmLiaTs1NZfh2NpLLBJUkFqDbQwFFDCSkFycaUfQoHHmB",
    announcementId: "five-sol-milestone-2025",
    linkBasis: "verified",
    role: "grand prize",
  },
  {
    dateIso: "2025-02-21T05:26:08.000Z",
    amountBaseUnits: "100000000000",
    recipientWallet: "23nSNTRJJMqEm8X2MYpnxG4iRtkgPW4yFkwauSsLhaig",
    signature: "4PhRZ3uUpzs4e1wiv76pof1fAjbwLKpzqJtSNXhL4aTdVh6hDkPHhtgZj4GohdCowVMwXwRVX2QQSXhDfz8ztxU2",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
  {
    dateIso: "2025-03-17T01:11:21.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "9JGvjo1bu4WAiuSCB2neW6aKniqFECGuJ3DLvSawB39k",
    signature: "nYed7gCAr7taz1sEM1H8YeCR8zQRDb8iBW8LuCcD8W2eWFzVGoKfQ7mV1bunHYDugd4xTxueCzV2uPJe3grPT7W",
    announcementId: "hundred-followers-2025",
    // Timing, plus a public receipt in the replies the same night. The amount
    // was never announced, so this rests on the pair of them rather than on a
    // figure matching.
    linkBasis: "inferred-timing",
    role: "100-followers thank-you",
  },
  {
    dateIso: "2025-03-17T01:11:21.000Z",
    amountBaseUnits: "800000000000",
    recipientWallet: "2qo1zLvwbMEoCGg7KxtVCY1iMHobUf7s6jPtFHddNU9a",
    signature: "28aSvdz7MgP4gARziVhPjZ947SWe6J4dX35SQmm8mS9fmpCVf8JYYN4XM5q9Tdg78t1A8p2nDPMC3Fb9G4vQm8VA",
    announcementId: "hundred-followers-2025",
    // Timing, plus a public receipt in the replies the same night. The amount
    // was never announced, so this rests on the pair of them rather than on a
    // figure matching.
    linkBasis: "inferred-timing",
    role: "100-followers thank-you",
  },
  {
    // THE LARGEST UNMATCHED PAYOUT, investigated 2026-08-18 rather than left
    // as a question mark. What the chain settles:
    //
    //  - It was a GIFT, not a sale. The reserve itself signed, and the only
    //    SOL that moved was the reserve PAYING 0.00204 to create the
    //    recipient's token account. Nothing came back. Checked precisely
    //    because an OTC sale recorded as a giveaway would inflate this ledger.
    //  - The recipient is a real wallet (on-curve), not a program.
    //  - They then bought ~5,725,235 more WinLEW on the open market from the
    //    Pump.fun bonding curve across three purchases through 2025.
    //  - On 2026-01-18 they moved exactly 12,000,000 out in one transfer and
    //    closed the account on 2026-04-26.
    //
    // What the chain CANNOT settle is why it was sent. No announcement from
    // that date accounts for 3,500,000, so it stays unmatched.
    dateIso: "2025-04-01T20:15:30.000Z",
    amountBaseUnits: "3500000000000",
    recipientWallet: "AqwHdem1xsrLQ6vHvaz6VHvucakDVQw9sHZprPPZQemX",
    signature: "TKV4u15m8GLiBhybayBjNP9MYWaiVExShMqzKfcjGNKuUE225udnUs8cjNjEkhL2ZWq1QKvxkF3kdx465tgZr6x",
    announcementId: null,
    linkBasis: "none",
    role: null,
    // NOT A GIVEAWAY — RESOLVED 2026-08-21. The largest unmatched payout in
    // this ledger, and it was never generosity: it is the WinLEW side of a
    // token swap with 2BRZ, and the chain shows both legs.
    //
    //   19:20:07Z  1,000,000 2BRZ  ->  the X Faucet Reserve, from a wallet
    //              whose 2BRZ balance went 10,000,000 -> 9,000,000
    //   20:15:30Z  3,500,000 WinLEW ->  this recipient        (55m 23s later)
    //   2025-04-03 02:18:46Z  the partnership is announced on X
    //
    // The 2BRZ arrived FIRST and the reserve still holds that 1,000,000 today
    // (token account 7UJZ7jP4RxiQg6ZESRzh8CZZ4GKYNo2EHbUm8zH5qwzP). The
    // recipient did not sell: they held for nine months before consolidating.
    //
    // WHAT THE CHAIN DOES NOT SHOW is that this address belongs to 2BRZ — the
    // 2BRZ came from a different wallet, so the two legs are not linked
    // on-chain. That step is owner-supplied (2026-08-21): "yes i sent that to
    // one of 2brz (2brothers) 3 accounts". Recorded as attribution, the same
    // standard used for FreeCryptoA and millerknoll elsewhere in this repo.
    //
    // The amounts were not equal by design: 2BRZ's market cap was far higher,
    // so 1,000,000 2BRZ and 3,500,000 WinLEW were the two sides of roughly
    // equivalent value at the time.
    kind: "exchange",
    exchange: {
      receivedAmount: "1000000",
      receivedSymbol: "2BRZ",
      receivedMint: "3oB7hyAZXqrzzbSebt3XykCrXqAX6Vv57Qdin3bVpump",
      receivedSignature: "5oJMqgv8VzqsNv7pB1cNfgHjVX2Zdzp43iESmXGPyW7EiTzn5njNySoDZ4TTyYm1SEtQPS8DA7qvAqK6szPbmDLE",
      receivedAtIso: "2025-04-01T19:20:07.000Z",
      counterpartyAttribution: "owner-supplied 2026-08-21: one of 2BRZ's three accounts",
    },
  },
  {
    dateIso: "2025-04-02T00:27:51.000Z",
    amountBaseUnits: "500000000000",
    recipientWallet: "9JGvjo1bu4WAiuSCB2neW6aKniqFECGuJ3DLvSawB39k",
    signature: "8XRB4P3ZJxTeNkRVF4T9V6wzcbSZwVAmaAgxnk8w3pfh2cU1yPsMwJTd91XcU5itKGS9FpT1b6UbZPkAmRhvV4h",
    announcementId: "meme-contest-2025",
    linkBasis: "inferred-timing",
    role: "one of three 500k prizes",
  },
  {
    dateIso: "2025-04-02T00:36:16.000Z",
    amountBaseUnits: "500000000000",
    recipientWallet: "FDhcxnSo1wB2X7iYjQaFaFHD3Nc5TWsASFwfhFCbeo5j",
    signature: "3rUS65vJnzyi9wJKLGrKy2bbA1MqQG5Py9ZAuqxvFwQ5GzdHYAeu7YetGDZ1gr7BT67J3qkuYXZupRbYL56cvUAW",
    announcementId: "meme-contest-2025",
    linkBasis: "inferred-timing",
    role: "one of three 500k prizes",
  },
  {
    dateIso: "2025-04-02T01:44:57.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "DEFFtTTL7rLmZLh8dnj46So9yrwkvMd8WSboTD2VVNFJ",
    signature: "3W6CiomruH9c3KjZec57Q9fNtxcEYHaA7VnG3ntLdgK8ghLqNABtYoFPrDBSxfJuNdi7cnXXGNmrNg6o8mbfQVBP",
    announcementId: "liquidity-airdrop-2025",
    linkBasis: "inferred-timing",
    role: "snapshot airdrop",
  },
  {
    dateIso: "2025-04-02T01:45:45.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "FDhcxnSo1wB2X7iYjQaFaFHD3Nc5TWsASFwfhFCbeo5j",
    signature: "3vWshwKBbWAFf5uS3kFRSUSuj5SqfyNPEb5Lsu4zy7sNPPuDmUgUpJqEsDQvkMA1NoQyHUw1aLF6MM5mQoZ4TJdv",
    announcementId: "liquidity-airdrop-2025",
    linkBasis: "inferred-timing",
    role: "snapshot airdrop",
  },
  {
    dateIso: "2025-04-02T01:46:32.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "9JGvjo1bu4WAiuSCB2neW6aKniqFECGuJ3DLvSawB39k",
    signature: "4wRyRUWCo1cSTEZ6pwpTDsE64WqPrUQrqBTgRYaLjNB7X5rwnkpNaYo3abw2q9URCZFoEQyWy96SCsBQgChmPjp5",
    announcementId: "liquidity-airdrop-2025",
    linkBasis: "inferred-timing",
    role: "snapshot airdrop",
  },
  {
    dateIso: "2025-04-02T01:47:36.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "64SpqFh68V3Yn5qa43Hfc8esnQhj3LHi2kJs7umR3kTp",
    signature: "VWeD3z9k8NfFqPmHNdfeJNkDswTmaEYXZ2rgscbf6UVLJ4Ccbn1wgRaFJrB6g94YYJwnbZ22KBfD51XUkoMPvgA",
    announcementId: "liquidity-airdrop-2025",
    linkBasis: "inferred-timing",
    role: "snapshot airdrop",
  },
  {
    dateIso: "2025-04-02T01:48:27.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz",
    signature: "2AnDNGNeAvwNr89vqQ2gASDAVN68VJMkR2U8q9SwXqAmfDRMHvopf2U5M9nzxRz82BXT1vyQAeNsP5Rw2yFn4RPh",
    announcementId: "liquidity-airdrop-2025",
    linkBasis: "inferred-timing",
    role: "snapshot airdrop",
  },
  {
    dateIso: "2025-04-02T01:49:06.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "5gKXS4bT1mdWxgx192ieTsw951yJ4VikyyrKL45hQ2dg",
    signature: "4TfWkPuvi9UNFmrQFQyCS9vCP4c9Ein6FWYNbkksTuVdUafmJG2sH96fXb6nM7q4xoAjXazJBpizV1VFj5z3BALn",
    announcementId: "liquidity-airdrop-2025",
    linkBasis: "inferred-timing",
    role: "snapshot airdrop",
  },
  {
    dateIso: "2025-04-11T02:38:33.000Z",
    amountBaseUnits: "500000000000",
    recipientWallet: "5gKXS4bT1mdWxgx192ieTsw951yJ4VikyyrKL45hQ2dg",
    signature: "57yz552QCvVDNqfg5d5YXqgeqMF8TCLEb39toEmgRN7SDYHUM3PLXPLCT9A4tQzxezSjzAkc5je88oQ2CYFDjr4Y",
    announcementId: "brz-partnership-2025",
    linkBasis: "verified",
    role: "sole winner",
  },
  {
    dateIso: "2025-04-14T12:45:21.000Z",
    amountBaseUnits: "400000000000",
    recipientWallet: "FmwUvfBHmv1MacUfvP3P61fbKxDgJWtC8BHeP1x4d9K3",
    signature: "3hZWmWWMZei3FcSdepN8TjQweqJfJ1dVXw6FwyXzifXcdkvMgqi3eMmYTyXBzM8RcE4BxD4er6PuaiEKaqBUdbf",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
  {
    dateIso: "2025-05-02T23:43:20.000Z",
    amountBaseUnits: "125000000000",
    recipientWallet: "FokLS7aBXkRn7vQ5ttouVMzUZ8sL6shR54PwmGm5Wett",
    signature: "5E89WWmwhnzjqWLLxrFnEQTxLGANGJux7QGikdWqKfG5nNCnvH6vs8XzTCtM4evXBxzJ2KTz2EWJeY9k58y2id4M",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
  {
    dateIso: "2025-05-03T02:03:11.000Z",
    amountBaseUnits: "200000000000",
    recipientWallet: "FhFBZ6DbbJ8EzNhezDoBKv7YBU5cnevqypJ7njdvAQvJ",
    signature: "4N7NkxVMBUb8U7Wb44nWxktgMAHLt5CeqXXuY6hFiQ9PSo2zgYjQwzJmyv5kRtvBjMGX2qGW7ZG1Ui4kzDmgFr7h",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
  {
    dateIso: "2025-05-22T04:31:53.000Z",
    amountBaseUnits: "1000000000",
    recipientWallet: "9crcXyZaJG5rDVz7qainb4gXQp1Ntnm1CqSMAA1348AA",
    signature: "5AGcHHppo5gUwQAqe4L5QPumytpaPnw2Lq2q9VQHC9MH1o6Mt1pwFobqxRFUyXbKXGzzc4PUuf2MpryCbAMP6yAv",
    announcementId: null,
    linkBasis: "none",
    role: null,
    // NOT A GIVEAWAY — owner-confirmed 2026-08-21. A faucet claim paid by hand
    // from winlew.sol because the faucet's own wallet had run dry. The earlier
    // note here said these "match the platform's own minimum payout unit and
    // are almost certainly faucet activity", and then counted them anyway
    // because "almost certainly is not evidence". Now there is evidence.
    kind: "faucet-topup",
  },
  {
    // 1,500 is the platform's own minimum payout unit, and this is one of
    // three transfers of 1,000-1,500 from this wallet. Almost certainly faucet
    // activity rather than a prize — but "almost certainly" is not evidence,
    // so it is counted and shown like every other transfer.
    dateIso: "2025-08-15T15:25:20.000Z",
    amountBaseUnits: "1500000000",
    recipientWallet: "2yupCJfQKvDzUKoD2nXC5nYGGWG8aibjL5jpQZteJqSA",
    signature: "PHGSJLQfoHo865yehnWTUtUkrESEVuc8HeYuLXqNmHVRKNMcNvrXsHo5JkoSgR7Si28zrhKme7kmXWUm8kcCSc8",
    announcementId: null,
    linkBasis: "none",
    role: null,
    // NOT A GIVEAWAY — owner-confirmed 2026-08-21. A faucet claim paid by hand
    // from winlew.sol because the faucet's own wallet had run dry. The earlier
    // note here said these "match the platform's own minimum payout unit and
    // are almost certainly faucet activity", and then counted them anyway
    // because "almost certainly is not evidence". Now there is evidence.
    kind: "faucet-topup",
  },
  {
    dateIso: "2026-06-14T04:03:49.000Z",
    amountBaseUnits: "1000000000",
    recipientWallet: "9Wgko8Nr58B6LVrbqFGo5CHP6XeqL5mgPTovghJQ9i8W",
    signature: "3vmVEm74py6Cs5YTEQ22eftDiX57cQThDTQ1BmcmbGRYcBmGsGXEG6b6VP1prpGuxREx4YoBxzKiHxuB56xzKves",
    announcementId: null,
    linkBasis: "none",
    role: null,
    // NOT A GIVEAWAY — owner-confirmed 2026-08-21. A faucet claim paid by hand
    // from winlew.sol because the faucet's own wallet had run dry. The earlier
    // note here said these "match the platform's own minimum payout unit and
    // are almost certainly faucet activity", and then counted them anyway
    // because "almost certainly is not evidence". Now there is evidence.
    kind: "faucet-topup",
  },
  {
    dateIso: "2026-07-27T00:19:58.000Z",
    amountBaseUnits: "1000000000000",
    recipientWallet: "D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz",
    signature: "38qD36DKR13ReqQcwh51crhC1z3eBcwSNap7pFK3NbxMA9YxDM7QrTmwKajucd2H223Wp8Sh7n8tMe1iLDdp8bvq",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
  {
    // One of a PAIR of 1,000,000 transfers 44 seconds apart, both to wallets
    // that are liquidity providers in communityLiquidity.js and both still
    // large holders. They land two days after the 50,000,000 holder transfer
    // to the burn wallet of 2026-07-25. Suggestive of thanks to liquidity
    // providers; no announcement says so, so it stays unmatched.
    dateIso: "2026-07-27T00:20:42.000Z",
    amountBaseUnits: "1000000000000",
    recipientWallet: "9JGvjo1bu4WAiuSCB2neW6aKniqFECGuJ3DLvSawB39k",
    signature: "3mzWVKa2zNSgBsN97kjXkS3yim3VXAzh4Pz2ognNJQdAWCEcf4L2MpdoCTUBawizrtKPrc79GZuq1iwFxCpZ57Dr",
    announcementId: null,
    linkBasis: "none",
    role: null,
  },
]);

/** Explorer link for a payout. Built, never stored — a stored URL is one more
 *  place a signature can be retyped wrong. */
export function payoutExplorerUrl(payout) {
  return `https://solscan.io/tx/${payout.signature}`;
}

/**
 * Totals, derived rather than declared.
 *
 * Nothing in this file records a headline figure, because a headline figure
 * that is typed by hand drifts from the rows beneath it — which is exactly how
 * the first version of the ledger came to overstate giving by 25,040,000. The
 * page shows what the rows add up to, or it shows nothing.
 */
export function giveawayTotals(payouts = GIVEAWAY_PAYOUTS) {
  let total = 0n;
  let givenAway = 0n;
  let exchanged = 0n;
  let faucetPaid = 0n;
  const wallets = new Set();
  const giveawayWallets = new Set();
  const byBasis = { verified: 0, "inferred-timing": 0, none: 0 };
  for (const p of payouts) {
    const amount = BigInt(p.amountBaseUnits);
    total += amount;
    wallets.add(p.recipientWallet);
    byBasis[p.linkBasis] = (byBasis[p.linkBasis] || 0) + 1;
    // An exchange is consideration, not generosity. Counting it as a giveaway
    // inflates this ledger by the exact amount the project was paid — the one
    // failure mode a giveaway ledger must not have.
    if (p.kind === PAYOUT_KINDS.EXCHANGE) exchanged += amount;
    else if (p.kind === PAYOUT_KINDS.FAUCET_TOPUP) faucetPaid += amount;
    else { givenAway += amount; giveawayWallets.add(p.recipientWallet); }
  }
  return {
    totalBaseUnits: total.toString(),
    // The honest headline: what was GIVEN, with exchanges taken out.
    givenAwayBaseUnits: givenAway.toString(),
    exchangedBaseUnits: exchanged.toString(),
    faucetPaidBaseUnits: faucetPaid.toString(),
    payoutCount: payouts.length,
    giveawayCount: payouts.filter((p) => !p.kind || p.kind === PAYOUT_KINDS.GIVEAWAY).length,
    exchangeCount: payouts.filter((p) => p.kind === PAYOUT_KINDS.EXCHANGE).length,
    faucetTopupCount: payouts.filter((p) => p.kind === PAYOUT_KINDS.FAUCET_TOPUP).length,
    distinctWallets: wallets.size,
    distinctGiveawayWallets: giveawayWallets.size,
    byLinkBasis: byBasis,
  };
}

/** Payouts attached to one announcement, newest first. */
export function payoutsForAnnouncement(id, payouts = GIVEAWAY_PAYOUTS) {
  return payouts
    .filter((p) => p.announcementId === id)
    .sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
}

/** Payouts that belong to no announcement — deliberately surfaced, not hidden. */
export function unmatchedPayouts(payouts = GIVEAWAY_PAYOUTS) {
  return payouts.filter((p) => !p.announcementId);
}

/** What one announcement actually paid, against what it promised. */
export function announcementSummary(announcement, payouts = GIVEAWAY_PAYOUTS) {
  const matched = payoutsForAnnouncement(announcement.id, payouts);
  const paid = matched.reduce((acc, p) => acc + BigInt(p.amountBaseUnits), 0n);
  return {
    ...announcement,
    payouts: matched,
    paidBaseUnits: paid.toString(),
    // An announcement whose every link is inferred should not read as settled
    // fact on the page, so the weakest link in the chain is reported.
    weakestLinkBasis: matched.length
      ? matched.some((p) => p.linkBasis === LINK_BASIS.INFERRED)
        ? LINK_BASIS.INFERRED
        : LINK_BASIS.VERIFIED
      : LINK_BASIS.NONE,
  };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Throws on a malformed record. Called by the test, and by anything that
 *  serves this data, so a bad row fails loudly instead of rendering. */
export function validateGiveawayRecords(
  announcements = GIVEAWAY_ANNOUNCEMENTS,
  payouts = GIVEAWAY_PAYOUTS,
) {
  const ids = new Set();
  for (const a of announcements) {
    if (!a.id || ids.has(a.id)) throw new Error(`giveaway_bad_announcement_id:${a.id}`);
    ids.add(a.id);
    if (!Object.values(GIVEAWAY_STATUSES).includes(a.status)) {
      throw new Error(`giveaway_bad_status:${a.id}:${a.status}`);
    }
    if (Number.isNaN(Date.parse(a.announcedIso))) throw new Error(`giveaway_bad_date:${a.id}`);
  }
  const seenSignatures = new Set();
  for (const p of payouts) {
    if (!BASE58.test(p.signature) || p.signature.length < 60) {
      throw new Error(`giveaway_bad_signature:${p.signature}`);
    }
    if (seenSignatures.has(p.signature)) throw new Error(`giveaway_duplicate_signature:${p.signature}`);
    seenSignatures.add(p.signature);
    if (!BASE58.test(p.recipientWallet)) throw new Error(`giveaway_bad_wallet:${p.recipientWallet}`);
    if (!/^\d+$/.test(p.amountBaseUnits)) throw new Error(`giveaway_bad_amount:${p.signature}`);
    if (!Object.values(LINK_BASIS).includes(p.linkBasis)) {
      throw new Error(`giveaway_bad_link_basis:${p.signature}:${p.linkBasis}`);
    }
    // The rule the whole file exists to enforce: a payout may not claim an
    // announcement it has no basis for, and may not cite a basis with no
    // announcement to apply it to.
    if (p.announcementId && p.linkBasis === LINK_BASIS.NONE) {
      throw new Error(`giveaway_link_without_basis:${p.signature}`);
    }
    if (!p.announcementId && p.linkBasis !== LINK_BASIS.NONE) {
      throw new Error(`giveaway_basis_without_link:${p.signature}`);
    }
    if (p.announcementId && !ids.has(p.announcementId)) {
      throw new Error(`giveaway_unknown_announcement:${p.announcementId}`);
    }
  }
  return true;
}
