// WinLEW Modules Registry — the single canonical source of truth for
// public module/roadmap status, replacing scattered, manually-duplicated
// status text across the homepage, /modules/, and individual feature
// pages. See docs/modules-system.md for the full update workflow.
//
// Static data only (no live RPC/API dependency, no executable functions
// serialized into records) — mirrors the established pattern of
// partnersData.js/eventsData.js/burnEvents.js/governanceData.js. Status is
// a human/editorial judgment updated here, in one place, then validated by
// validateModulesRegistry() below (see also src/scripts/validate-modules.js
// / `npm run modules:validate`).

export const MODULE_STATUSES = Object.freeze({
  LIVE: "live",
  BETA: "beta",
  PARTIAL: "partial",
  ONGOING: "ongoing",
  PLANNED: "planned",
  DEFERRED: "deferred",
  BLOCKED: "blocked",
  RETIRED: "retired",
  HISTORICAL: "historical",
  INTERNAL: "internal",
});

// Public-facing label for each status — deliberately literal, never a vague
// word like "warming"/"soon"/"almost"/"in build". See docs/modules-system.md.
export const STATUS_LABELS = Object.freeze({
  live: "LIVE",
  beta: "BETA",
  partial: "PARTIAL",
  ongoing: "ONGOING",
  planned: "PLANNED",
  deferred: "DEFERRED",
  blocked: "BLOCKED",
  retired: "RETIRED",
  historical: "HISTORICAL",
  internal: "INTERNAL",
});

export const MODULE_CATEGORIES = Object.freeze({
  FOUNDATION_TRANSPARENCY: "foundation-transparency",
  COMMUNITY_PARTICIPATION: "community-participation",
  PLATFORM_INFRASTRUCTURE: "platform-infrastructure",
  GOVERNANCE: "governance",
  DEFERRED_FUTURE: "deferred-future",
  HISTORICAL: "historical",
});

const C = MODULE_CATEGORIES;
const S = MODULE_STATUSES;

// A single "last verified" pass date for every record touched during this
// milestone's inventory audit — update per-record when a module's real
// status changes, not on every unrelated commit.
const VERIFIED_2026_07_12 = "2026-07-12";
// Entries re-checked against the code on 2026-08-03. Deliberately NOT applied
// to every module: lastVerifiedIso means "someone confirmed this is still
// true", and blanket-stamping today's date across 24 entries would assert 24
// checks that never happened. Only the modules whose facts actually changed
// were re-read and re-dated; the rest still carry 2026-07-12 and are due a
// pass.
const VERIFIED_2026_08_03 = "2026-08-03";
// The six modules added 2026-08-12. Every one was already live (or, for Merch
// and the Forge, already partly live) and in the nav, with no record here at
// all — so /modules/ and /roadmap/ were both under-reporting what exists. Found
// by diffing module routes against src/public/*/ rather than by reading the
// page, which is why they had gone unnoticed: nothing on the page is wrong, it
// is simply absent. Launch dates are each surface's first commit, not a guess.
const VERIFIED_2026_08_12 = "2026-08-12";
// Merch only. The shop moved from its staged /merch/shop.html home onto
// /merch/ and opened for browsing, so that one record was re-read against the
// code and the live /api/merch/config response. Nothing else was re-checked,
// so nothing else is re-dated.
const VERIFIED_2026_08_30 = "2026-08-30";

// ── Optional roadmap fields ─────────────────────────────────────────────
// Read only by src/scripts/build-roadmap.mjs, which generates the
// registry-backed cards on /roadmap/ (content-audit register #22). All three
// are optional and every one defaults to the plain record:
//
//   roadmapVisible  false to keep a module off /roadmap/ while leaving it on
//                   /modules/. Default true. Use it when a card would restate
//                   a neighbouring card, never to hide something awkward — the
//                   whole point of #22 is that omissions are invisible.
//   roadmapTitle    overrides `title` for the card heading. Supports {live}
//                   and {total}, filled from the registry at build time.
//   roadmapBlurb    overrides `shortDescription` for the card body. Only worth
//                   it when the description is written for /modules/ and reads
//                   wrong elsewhere.
//
// A module is excluded outright when its status is internal or historical —
// neither belongs on a forward-looking public page.

// ── Canonical module records ────────────────────────────────────────────
// Grouped into understandable public modules, not one card per internal
// technical component (e.g. Governance's snapshot/submission-queue/RPC-
// hardening subsystems are evidence/limitations on ONE Governance record,
// not four separate cards — see docs/governance-v1.1-hardening.md for
// those specifics).
export const MODULES = [
  // ── Foundation & Transparency ──────────────────────────────────────────
  {
    id: "core-infrastructure",
    title: "Core Infrastructure",
    shortDescription: "The base layer WinLEW runs on: verified links, contract/pool references, live market stats, and consistent site-wide navigation.",
    fullDescription: "A clean public home, a verified official-link hub, contract and pool references with one-click verification (Solscan, RugCheck, DexScreener), and a synced live market snapshot. Every other module shares this same navigation and design system.",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/modules/core-infrastructure.html",
    docs: [{ label: "Homepage", url: "/" }],
    roadmapPhase: 1,
    roadmapItem: "Website",
    launchDate: "2026-01-01",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["unified-authentication", "shared-navigation"],
    evidence: ["src/public/index.html", "src/public/assets/nav.css", "src/public/assets/nav.js"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 10,
    icon: "⚙️",
  },
  {
    id: "whitepaper",
    title: "Whitepaper",
    shortDescription: "The project's founding document: tokenomics, mechanics, and the original roadmap this registry reconciles against.",
    fullDescription: "Published, versioned whitepaper covering tokenomics, mechanics, and the phase-by-phase roadmap. The single reference point for what WinLEW originally promised, kept separate from what has since actually shipped (see the Roadmap Reconciliation section of /modules/).",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/whitepaper/",
    docs: [],
    roadmapPhase: 1,
    roadmapItem: "Whitepaper",
    launchDate: "2026-01-01",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: [],
    evidence: ["src/public/whitepaper/"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 20,
    icon: "📄",
  },
  {
    id: "transparency-center",
    title: "Transparency Center",
    shortDescription: "Public, verifiable source-of-truth for holdings, wallet activity, and platform financial transparency.",
    fullDescription: "A first-party page presenting verified wallet/contract data and transparency records, so claims about the project's finances can be checked directly rather than taken on faith.",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/transparency/",
    docs: [],
    roadmapPhase: 4,
    roadmapItem: "Partnerships",
    launchDate: "2026-06-01",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["burn-center"],
    evidence: ["src/public/transparency/"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 30,
    icon: "🔍",
  },
  {
    id: "burn-center",
    title: "Burn Center",
    shortDescription: "Verified, on-chain-evidenced record of every confirmed WinLEW burn — software is live, future burns are ongoing.",
    fullDescription: "Publishes confirmed burn events with on-chain transaction evidence via BURN_EVENTS (src/mole/burnEvents.js), progress toward the public burn target, and staged/pending amounts. No burn executes automatically from this system or from a Governance vote — every burn is a manually authorized, separately verified transaction added here only after the fact. See docs/burn-program.md.",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/burn/",
    docs: [{ label: "docs/burn-program.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/burn-program.md" }],
    roadmapPhase: 4,
    roadmapItem: "Burn Program",
    launchDate: "2026-06-15",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["transparency-center", "governance"],
    evidence: ["src/mole/burnEvents.js", "docs/burn-program.md"],
    limitations: "No automated/scheduled recurring burns — each burn remains a manually authorized, individually verified event.",
    ongoingOperation: true,
    sortOrder: 40,
    icon: "🔥",
  },
  {
    id: "sponsors-partners",
    title: "Sponsors & Partners",
    shortDescription: "Structured, evidence-backed record of community partners, sponsors, and ecosystem collaborators.",
    fullDescription: "Public partner directory (src/mole/partnersData.js) with defined partner types and status rules, cross-linked to related Community Events, so partnership claims are backed by the same evidence standard as everything else in this registry.",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/partners/",
    docs: [{ label: "docs/sponsors-and-partners.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/sponsors-and-partners.md" }],
    roadmapPhase: 4,
    roadmapItem: "Partnerships",
    launchDate: "2026-06-20",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["community-events"],
    evidence: ["src/mole/partnersData.js"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 50,
    icon: "🤝",
  },
  {
    id: "community-events",
    title: "Community Events",
    shortDescription: "The events platform is live; individual community events are an ongoing recurring program, not a one-time deliverable.",
    fullDescription: "Publishes upcoming, live, and completed community events with real-time bucketing (src/mole/eventsData.js). The software that runs this page is fully shipped; specific events themselves are scheduled and hosted on an ongoing basis, not something that is ever \"100% done.\"",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/events/",
    docs: [{ label: "docs/community-events.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/community-events.md" }],
    roadmapPhase: 4,
    roadmapItem: "Community events",
    launchDate: "2026-06-25",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["sponsors-partners", "governance"],
    evidence: ["src/mole/eventsData.js"],
    limitations: null,
    ongoingOperation: true,
    sortOrder: 60,
    icon: "🎪",
  },
  {
    id: "bug-bounties",
    title: "Bug Bounties",
    shortDescription: "A public ledger of bounties earned for finding real bugs — what is owed, what has been paid, and the on-chain proof of each payment.",
    fullDescription: "Publishes every bug bounty the project has agreed to pay, in both states: still owed, and paid with a verifiable transaction. It sits under Foundation & Transparency rather than Community because its purpose is the same as /burn/ and /transparency/ — a claim about money that a reader can check instead of trust.",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/bounties/",
    docs: [],
    roadmapPhase: 5,
    // No roadmapItem: this was never on the original whitepaper roadmap. Left
    // null deliberately rather than attached to "Platform v2 enhancements" —
    // that item is NOT-STARTED, and pointing shipped work at it is the same
    // drift this registry exists to catch. "Phase 5" alone renders fine
    // (src/public/modules/js/app.js treats roadmapItem as optional).
    roadmapItem: null,
    launchDate: "2026-07-24",
    lastVerifiedIso: VERIFIED_2026_08_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["transparency-center"],
    evidence: ["src/public/bounties/"],
    limitations: "The ledger is hand-maintained — a bounty agreed in Discord appears here only once someone adds it.",
    ongoingOperation: true,
    sortOrder: 70,
    icon: "🐛",
  },
  {
    id: "policies-legal",
    title: "Policies & Legal",
    shortDescription: "Every Terms of Service and Privacy Policy for the website and all five Discord bots, collected in one place.",
    fullDescription: "A hub covering twelve policy documents across six products, plus /policies/abuse/ — the enforcement policy describing what gets a wallet or account refused from the faucet. Each bot's policy states what that bot actually stores, written in plain language against its real behaviour rather than boilerplate.",
    category: C.FOUNDATION_TRANSPARENCY,
    status: S.LIVE,
    progress: 100,
    route: "/policies/",
    docs: [],
    roadmapPhase: 5,
    roadmapItem: null,
    launchDate: "2026-07-19",
    lastVerifiedIso: VERIFIED_2026_08_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: [],
    evidence: ["src/public/policies/", "src/public/discord-bots/"],
    limitations: "Policy text is reviewed by the project, not by a lawyer.",
    ongoingOperation: false,
    sortOrder: 80,
    icon: "📜",
  },

  // ── Community Participation ────────────────────────────────────────────
  {
    id: "quiz",
    title: "Quiz",
    shortDescription: "Discord-played trivia with a live web leaderboard and web-based point redemption, subject to a holder requirement and a minimum payout.",
    fullDescription: "Runs in Discord (answer questions, bank points) with a live web scoreboard, cycle tracking, and web-vs-Discord platform comparison. Web Quiz Redemption lets banked points be redeemed directly from the web dashboard using the same settlement path Discord's /redeem command uses — one shared service, not two implementations.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/quiz/",
    docs: [{ label: "How to play", url: "/modules/games-trivia.html" }],
    roadmapPhase: 3,
    roadmapItem: "Trivia",
    launchDate: "2026-02-01",
    lastVerifiedIso: VERIFIED_2026_08_03,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: "/quiz Discord commands",
    relatedModules: ["mole-hub", "proof-of-value", "dashboard"],
    evidence: ["src/quiz/", "src/mole/rewardHistory.js"],
    limitations: "Redemption is holder-only — the same WinLEW balance requirement the faucet applies — and nothing settles below QUIZ_MIN_REDEMPTION_WINLEW (1500, matched to one faucet drip); points below that carry forward at cycle close rather than paying out as dust. Cycle length is configurable and is currently 91 days.",
    ongoingOperation: false,
    sortOrder: 100,
    icon: "🧠",
  },
  {
    id: "faucet",
    title: "Faucet",
    shortDescription: "WinLEW token faucet on web and Discord, with a shared cooldown, claim history, and verification required after 10 claims.",
    fullDescription: "Distributes WinLEW to participants with a shared payout worker and claim history visible on the Dashboard. Web and Discord are two entry points into the same claim system, not separate implementations. Anti-abuse, as of v3.3.5: a wallet must be verified once it passes 10 lifetime claims (no grandfathering); `!drip` only pays a wallet already registered to the account; bans follow on-chain funding edges so a fresh wallet funded by a banned one is refused too; and moderators can review accounts that repeatedly claim together across separate days. How all of it is detected and decided is published at /policies/abuse/.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/faucet/",
    docs: [],
    roadmapPhase: 2,
    roadmapItem: "Liquidity pool",
    launchDate: "2026-01-15",
    lastVerifiedIso: VERIFIED_2026_08_03,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: "/faucet Discord commands (src/faucet/bot.js)",
    relatedModules: ["dashboard", "wallet-verification"],
    evidence: ["src/faucet/", "src/public/policies/abuse/"],
    limitations: "Verification is required after 10 lifetime claims, counted as the higher of per-wallet and per-Discord-account. Ban propagation follows wallet CREATION edges only and cannot see a wallet funded from an exchange withdrawal; the funding-cluster and co-timing tools flag accounts for human review and are not proof of identity.",
    ongoingOperation: false,
    sortOrder: 110,
    icon: "🚰",
  },
  {
    id: "mole-hub",
    title: "Mole Hub",
    shortDescription: "Multi-game arcade gateway with desktop and mobile-optimized play lanes.",
    fullDescription: "A premium arcade catalog (Burrow Blaster, DigLEW, Grub Drop, Pac-Mole, Root Glide, Tunnel Tap) with device-aware routing, local leaderboards, and wallet-linked rewards for connected players, guest play for everyone else.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/mole-hub/",
    docs: [{ label: "How to play", url: "/modules/games-trivia.html" }],
    roadmapPhase: 3,
    roadmapItem: "Trivia",
    launchDate: "2026-03-01",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["quiz", "proof-of-value"],
    evidence: ["src/public/mole-hub/"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 120,
    icon: "🎮",
  },
  {
    id: "wallet-verification",
    title: "Wallet Verification",
    shortDescription: "Mobile-first wallet linking and signature verification, with Discord role sync.",
    fullDescription: "Links and verifies a Solana wallet (Oxyon Wallet, Phantom, Solflare, Jupiter) via a signed, one-time challenge — never a transaction. Syncs Discord role-connection metadata once verified.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/verify/",
    docs: [],
    roadmapPhase: 3,
    roadmapItem: "Authentication",
    launchDate: "2026-02-15",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["dashboard", "unified-authentication"],
    evidence: ["src/mole/walletLink.js"],
    limitations: "Signature only — no transaction capability exists in this flow.",
    ongoingOperation: false,
    sortOrder: 130,
    icon: "🔗",
  },
  {
    id: "dashboard",
    title: "Dashboard",
    shortDescription: "The unified profile: wallets, rewards, quiz stats, milestones, and a Governance summary in one place.",
    fullDescription: "Evolved from the original Profile page into the single home for a signed-in participant: linked wallets, faucet/quiz reward history, Proof of Value score, milestones, and a concise Governance summary — never the full Governance page's worth of detail (that stays at /governance/).",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/verify/profile.html",
    docs: [{ label: "docs/unified-dashboard.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/unified-dashboard.md" }],
    roadmapPhase: 3,
    roadmapItem: "Dashboard",
    launchDate: "2026-03-15",
    lastVerifiedIso: VERIFIED_2026_08_03,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["wallet-verification", "proof-of-value", "governance"],
    evidence: ["docs/unified-dashboard.md", "src/mole/milestones.js", "test/mole/milestones.test.mjs", "src/mole/proofOfValue.js"],
    limitations: "Shows a participant their own record only — there is no cross-user or moderator view here, and lifetime reward totals across faucet, quiz and games are a moderator command rather than a page.",
    ongoingOperation: false,
    sortOrder: 140,
    icon: "📊",
  },
  {
    id: "proof-of-value",
    title: "Proof of Value",
    shortDescription: "Unified contribution score across Quiz, Faucet, Games, and verification — with anti-farm guardrails.",
    fullDescription: "Combines contribution signals from every participation surface into one score with a streak multiplier, tier progression, and documented anti-abuse guardrails — visible on the Dashboard, explained in full at its dedicated module page.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/modules/proof-of-value-engine.html",
    docs: [{ label: "Live on the Dashboard", url: "/verify/profile.html" }],
    roadmapPhase: 4,
    roadmapItem: "Proof of Value full integration",
    launchDate: "2026-05-01",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["dashboard", "quiz", "faucet", "mole-hub"],
    evidence: ["src/mole/proofOfValue.js", "test/mole/proofOfValue.test.mjs"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 150,
    icon: "🧠",
  },
  {
    id: "leaderboards",
    title: "Leaderboards",
    shortDescription: "Cross-system rankings for Quiz, Faucet and the Gaming Hub, ranked by real earnings rather than raw score.",
    fullDescription: "Aggregates ranking data that already existed inside reward history and faucet claims but had never been surfaced: per-game standings from src/mole/rewardHistory.js and per-user faucet totals from src/faucet/claimStore.js, split Web and Discord. Games rank on earnings and furthest level reached, not raw score, so a leaderboard cannot be flooded by replaying an easy level. Player names use the same masked-display model as Quiz.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/leaderboards/",
    docs: [{ label: "Leaderboards", url: "/leaderboards/" }],
    // This one DOES map to an original roadmap promise. Phase 3's
    // "Leaderboards" item pointed at the Quiz module because Quiz's internal
    // standings were the closest thing that existed; the item now points here,
    // at the real implementation.
    roadmapPhase: 3,
    roadmapItem: "Leaderboards",
    launchDate: "2026-07-18",
    lastVerifiedIso: VERIFIED_2026_08_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: "Quiz and faucet standings are visible in Discord; a Discord games leaderboard is not built.",
    relatedModules: ["quiz", "faucet", "mole-hub"],
    evidence: ["src/public/leaderboards/", "src/mole/rewardHistory.js", "src/faucet/claimStore.js"],
    limitations: "The Gaming Hub's Discord leaderboard is not built — the page says so rather than showing an empty table.",
    ongoingOperation: false,
    sortOrder: 160,
    icon: "🏆",
  },
  {
    id: "quests-progression",
    title: "Quests & Progression",
    shortDescription: "Streaks and milestone badges are live; seasonal ladders, skill brackets, and access tiers are not yet built.",
    fullDescription: "The original \"game loop\" module concept. Streak-based rewards (feeding Proof of Value's streak multiplier) and milestone badges are real and shipped. Seasonal leagues/ladders, skill brackets, and dedicated access-tier gates described in the original module concept do not exist yet.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.PARTIAL,
    progress: 40,
    route: "/modules/quests-progression.html",
    docs: [],
    roadmapPhase: 3,
    roadmapItem: "Leaderboards",
    launchDate: null,
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["proof-of-value", "dashboard"],
    evidence: ["src/mole/proofOfValue.js (streak multiplier)", "src/mole/milestones.js"],
    limitations: "Sub-items: streaks (done), milestone badges (done), seasonal leagues/ladders (not started), skill brackets (not started), dedicated access tiers (not started) — 2 of 5 documented sub-items complete.",
    ongoingOperation: false,
    sortOrder: 170,
    icon: "🎯",
  },
  {
    id: "contribution-system",
    title: "Contribution System",
    shortDescription: "Send WinLEW to the Dev, Faucet, X Faucet or Burn reserve as a wallet-signed, on-chain-verified contribution.",
    fullDescription: "A real transfer, not a self-reported one. The server builds an unsigned SPL transfer, the contributor's wallet signs and sends it, and the server then independently re-reads the confirmed transaction on-chain — signer, destination, mint and actual amount — before recording anything. The client-claimed amount is never trusted. Each cause card shows its destination's .sol name, address and who holds it, and a manual-send path accepts a pasted signature through the same verification, so no dApp request is required.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.LIVE,
    progress: 100,
    route: "/contribute/",
    docs: [{ label: "Transparency", url: "/transparency/" }],
    roadmapPhase: 5,
    roadmapItem: null,
    launchDate: "2026-07-19",
    lastVerifiedIso: VERIFIED_2026_08_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["transparency-center", "burn-center", "dashboard"],
    evidence: ["src/public/contribute/", "src/mole/contributions.js"],
    limitations: "Phantom's own scanner has flagged the in-app send on this domain; the manual-send path exists so a contribution can still be made and verified while that is outstanding.",
    ongoingOperation: false,
    sortOrder: 180,
    icon: "🤝",
  },
  {
    id: "merch-store",
    title: "Merch",
    shortDescription: "Official WinLEW merch with a holder discount. The catalogue is open at /merch/; XYO gear checks out today, WinLEW drops are browse-only until payment is switched on.",
    fullDescription: "PARTIAL on purpose. The shop opened at /merch/ on 2026-08-30 — five $WinLEW tees in S-2XL and the official XYO gear shelf, all rendering from src/public/merch/products.json. The XYO half is fully usable: those items link out to shop.xyo.network, which fulfils them. The WinLEW half is browse-only, because the serving machine holds no PAYPAL_CLIENT_SECRET and /api/merch/config therefore reports checkoutReady:false, so the page shows its 'checkout coming online' state instead of buttons. The checkout behind that flag is real and server-priced: the basket is priced in src/mole/merchOrders.js from products.json plus the session's own verified holdings, and the capture step checks what PayPal actually took against the recorded expected amount. The client names the product and never the price.",
    category: C.COMMUNITY_PARTICIPATION,
    status: S.PARTIAL,
    progress: 65,
    route: "/merch/",
    docs: [],
    roadmapPhase: 5,
    roadmapItem: null,
    launchDate: "2026-07-30",
    lastVerifiedIso: VERIFIED_2026_08_30,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["wallet-verification"],
    evidence: ["src/public/merch/", "src/mole/merchOrders.js"],
    limitations: "You cannot buy a $WinLEW drop yet. The catalogue is public and the stock exists, but no PayPal secret is configured on the serving machine, so checkout stays disabled rather than rendering buttons a half-configured deploy could take money through. Crypto payment is not implemented at all — the hosted-checkout links in products.json are still TODO placeholders and render as disabled buttons. Two of the five tees have no product photo yet. XYO gear is unaffected: it checks out on the official XYO store.",
    ongoingOperation: false,
    sortOrder: 190,
    icon: "👕",
  },

  // ── Platform Infrastructure ─────────────────────────────────────────────
  {
    id: "unified-authentication",
    title: "Unified Authentication",
    shortDescription: "One shared WinLEW session powers Dashboard, Quiz, Faucet, Mole Hub, and Governance — no second login flow.",
    fullDescription: "A single Discord-OAuth-backed session, issued once, reused by every web surface. No feature on the site maintains its own separate identity/session system. Internal architecture, not a separately visitable page — see Wallet Verification (/verify/) for the actual user-facing entry point.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.INTERNAL,
    progress: null,
    route: null,
    docs: [],
    roadmapPhase: 3,
    roadmapItem: "Authentication",
    launchDate: "2026-02-15",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["wallet-verification", "dashboard"],
    evidence: ["src/mole/sessions.js"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 200,
    icon: "🔐",
  },
  {
    id: "shared-navigation",
    title: "Shared Navigation",
    // Excluded from /roadmap/ (see the roadmap* field notes above the registry).
    // It is live and public, but on a roadmap it would sit beside Core
    // Infrastructure saying the same thing twice — "shared navigation" is
    // literally part of that module's own description. /modules/ still lists it,
    // because there the finer breakdown is the point. Marked rather than
    // omitted so the exclusion is reviewable instead of looking like the gap
    // that this whole pass just finished closing.
    roadmapVisible: false,
    shortDescription: "One nav.css/nav.js pattern (hamburger collapse + persistent Dashboard chip) used site-wide.",
    fullDescription: "Every page shares the same responsive nav bar: a mobile hamburger collapse, an always-visible Dashboard chip, and active-link highlighting — defined once (src/public/assets/nav.css, nav.js) rather than duplicated per page.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.LIVE,
    progress: 100,
    route: "/",
    docs: [],
    roadmapPhase: 4,
    roadmapItem: "Platform v2 enhancements",
    launchDate: "2026-07-09",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["core-infrastructure"],
    evidence: ["src/public/assets/nav.css", "src/public/assets/nav.js"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 210,
    icon: "🧭",
  },
  {
    id: "discord-web-parity",
    title: "Discord ↔ Web Parity",
    shortDescription: "Discord bots and web surfaces share the same underlying data and settlement logic.",
    fullDescription: "Quiz, Faucet, and reward redemption use one shared service layer regardless of whether the request came from Discord or the web — a Discord-only feature and its web equivalent are never two separate, potentially-diverging implementations.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.LIVE,
    progress: 100,
    route: "/discord-bots/",
    docs: [],
    roadmapPhase: 4,
    roadmapItem: "Automated reward/redemption flow",
    launchDate: "2026-05-15",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: "Discord bot commands",
    relatedModules: ["quiz", "faucet"],
    evidence: ["src/quiz/payout-worker.js", "src/faucet/bot.js"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 220,
    icon: "🤖",
  },
  {
    id: "mobile-app-beta",
    title: "Mobile App Beta",
    shortDescription: "Android has a signed release build targeting API 35, with its own app home; iOS remains structurally complete but has never been compiled.",
    fullDescription: "A Capacitor wrapper around the real web pages (no second frontend to keep in sync), so a fix on winlew.co reaches the app without a new build. As of 2026-08-03 Android has a SIGNED release build (not the shared Android debug key) targeting API 35 — Google Play's current floor — and handles Android 15's forced edge-to-edge itself, since a WebView never reports the system bars as a safe area. The app opens on its own home screen (/app/) rather than the full website: one tap to claim, plus quiz, games, leaderboard and the contract address. Signing in from the app hands the session back from the wallet app's browser through a one-time code exchange rather than putting a session token in a return URL. iOS is structurally scaffolded — a real Xcode project with store-readiness fixes applied — but has still never been compiled, because no macOS machine has been available.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.BETA,
    progress: null,
    route: null,
    docs: [{ label: "docs/mobile-beta.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/mobile-beta.md" }],
    roadmapPhase: 4,
    roadmapItem: "Mobile App Beta",
    launchDate: "2026-07-01",
    lastVerifiedIso: VERIFIED_2026_08_03,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["shared-navigation", "wallet-verification", "faucet"],
    evidence: ["docs/mobile-beta.md", "mobile/android/", "mobile/ios/", "src/public/app/"],
    limitations: "Android: signed release build, distributed by direct download rather than a store listing. The wallet sign-in hand-off is implemented and its server half is covered by tests, but the on-device round trip has not yet been confirmed working end to end. iOS: structurally complete and store-readiness fixes applied, but never compiled — BLOCKED on a macOS machine.",
    ongoingOperation: false,
    sortOrder: 230,
    icon: "📱",
    meta: { androidStatus: "beta-signed-release", iosStatus: "blocked-unverified" },
  },
  {
    id: "health-status",
    title: "Health & Status",
    shortDescription: "First-party destination for service health and routing status, replacing brittle subdomain references.",
    fullDescription: "A clean, first-party page for current public routes and routing-migration status — no dependency on subdomain SSL or DNS state that the rest of the platform doesn't already control.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.LIVE,
    progress: 100,
    route: "/health/",
    docs: [],
    roadmapPhase: 4,
    roadmapItem: "Platform v2 enhancements",
    launchDate: "2026-06-01",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: [],
    evidence: ["src/public/health/"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 240,
    icon: "💚",
  },
  {
    id: "modules-registry",
    title: "Modules & Roadmap Status",
    // The only card whose title carries a number. {live}/{total} are filled by
    // the generator from the registry itself, which is why the count on
    // /roadmap/ cannot go stale the way "17 of 23" did — there is no longer a
    // number for anyone to hand-type. shortDescription starts "This page —",
    // true on /modules/ and false anywhere else, so the roadmap needs its own.
    roadmapTitle: "{live} of {total} Platform Modules Live",
    roadmapBlurb: "The module registry tracks every platform capability — most are already shipped, and the rest are listed with their real status.",
    shortDescription: "This page — the canonical, registry-driven public status center replacing scattered/stale status text.",
    fullDescription: "A single validated registry (src/mole/modulesData.js) drives this page, the homepage's roadmap section, and every other place module status is shown — so status can't silently drift out of sync across the site again.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.LIVE,
    progress: 100,
    route: "/modules/",
    docs: [{ label: "docs/modules-system.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/modules-system.md" }],
    roadmapPhase: 4,
    roadmapItem: "Platform v2 enhancements",
    launchDate: "2026-07-12",
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: [],
    evidence: ["src/mole/modulesData.js", "docs/modules-system.md"],
    limitations: null,
    ongoingOperation: false,
    sortOrder: 250,
    icon: "🧩",
  },
  {
    id: "winlew-forge",
    title: "WinLEW Forge",
    shortDescription: "A maintainer-only workbench for building WinLEW content with AI. One of its three modules is real; the other two are placeholders.",
    fullDescription: "PARTIAL, and the page says so itself. The working part is the brain runner: POST /api/forge/ai, gated to WinLEW maintainers by Discord ID through the existing isGovernanceMaintainer() check and rate-limited. That gate is the whole design — ungated, it would be an open proxy spending the owner's own API keys, which is why this is not a public feature and is not planned to become one in its current shape.",
    category: C.PLATFORM_INFRASTRUCTURE,
    status: S.PARTIAL,
    progress: 30,
    route: "/winlew-forge/",
    docs: [],
    roadmapPhase: 5,
    roadmapItem: null,
    launchDate: "2026-06-22",
    lastVerifiedIso: VERIFIED_2026_08_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["governance"],
    evidence: ["src/public/winlew-forge/", "src/winlew-forge/ai-router.js"],
    limitations: "Maintainer-only: a connected wallet that is not a maintainer gets a 403, by design. Asset Forge (image generation) and the Web3 Module cards are placeholders with no backend behind them. The OpenAI brain is optional and reports 'not configured' when no key is set.",
    ongoingOperation: false,
    sortOrder: 260,
    icon: "🔨",
  },

  // ── Governance ───────────────────────────────────────────────────────────
  {
    id: "governance",
    title: "Governance",
    shortDescription: "Live, server-verified community voting with a point-in-time eligibility snapshot and a proposal-submission review queue. Governance proposals themselves are an ongoing program.",
    fullDescription: "Verified $WinLEW holders vote on community/feature/reward/burn-program proposals — one verified wallet, one vote, private individual choice, public aggregate results. v1.1 hardening added: a per-proposal eligibility snapshot (locks in a wallet's eligibility at first check after a proposal's snapshot boundary — not a full chain-wide historical snapshot), and a community proposal-submission review queue (drafts only; a maintainer must explicitly publish anything into a real, votable proposal — submitting never auto-activates a vote). No signing, treasury access, or burn-execution capability exists anywhere in this module.",
    category: C.GOVERNANCE,
    status: S.LIVE,
    progress: 100,
    route: "/governance/",
    docs: [
      { label: "docs/governance-v1.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/governance-v1.md" },
      { label: "docs/governance-v1.1-hardening.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/governance-v1.1-hardening.md" },
      { label: "docs/governance-submission-review-workflow.md", url: "https://github.com/LewSales/mole-gaurd/blob/main/docs/governance-submission-review-workflow.md" },
    ],
    roadmapPhase: 5,
    roadmapItem: "Governance Module v1",
    launchDate: "2026-07-09",
    lastVerifiedIso: VERIFIED_2026_08_03,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: "/mole proposals, /mole vote, /mole myvote, /mole votes, /mole propose — the full voting flow, not only discussion",
    relatedModules: ["dashboard", "burn-center", "community-events"],
    evidence: [
      "src/mole/governanceData.js", "src/mole/governanceStore.js", "src/mole/governanceSnapshot.js",
      "src/mole/governanceSubmissions.js", "test/mole/governanceSnapshot.test.mjs",
      "test/mole/governanceSubmissions.test.mjs", "test/mole/governanceSubmissionsRoutes.test.mjs",
      "test/mole/governanceRpcFailure.test.mjs",
    ],
    limitations: "No full chain-wide historical holder snapshot (only a per-proposal first-check lock-in). Submission review is a server-side function with no web UI for maintainers. No on-chain execution automation, by design. Individual vote choices are private — the Discord webhook announces that a vote was cast, never which way, and the results board stays sealed below five voters.",
    ongoingOperation: true,
    sortOrder: 300,
    icon: "🗳️",
    meta: {
      eligibilitySnapshots: "live",
      proposalSubmissionQueue: "live",
      v11Hardening: "complete",
    },
  },

  // ── Deferred / Future Work ──────────────────────────────────────────────
  {
    id: "cross-chain-bridge",
    title: "Cross-Chain Bridge",
    // 2026-07-12 product decision: RETAINED on the original roadmap, not
    // removed/abandoned — deliberately postponed while WinLEW completes and
    // operates its current community, governance, reward, and transparency
    // systems. Never mark this "removed"/"retired"/"complete"/"live"
    // without a later, separate, explicit decision record — see
    // validateModulesRegistry()'s dedicated retention check below and
    // docs/modules-system.md.
    shortDescription: "Deferred, not removed — created with future interoperability with XL1 in mind. No official public XL1 bridging mechanism exists yet, so implementation has not started.",
    fullDescription: "Named in the original Phase 5 roadmap alongside Governance. This roadmap commitment was created with future WinLEW interoperability with XL1 in mind. No official public XL1 bridging mechanism is currently available, so implementation remains deferred until supported infrastructure and technical specifications are released.",
    category: C.DEFERRED_FUTURE,
    status: S.DEFERRED,
    implementationState: "not-started",
    retainedOnRoadmap: true,
    nextReviewIso: null,
    progress: null,
    route: null,
    docs: [],
    roadmapPhase: 5,
    roadmapItem: "Cross-Chain Bridge",
    launchDate: null,
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: false,
    discordEquivalent: null,
    relatedModules: [],
    evidence: [],
    limitations: "No implementation has started.",
    ongoingOperation: false,
    sortOrder: 400,
    icon: "🌉",
  },
  {
    id: "platform-v2-enhancements",
    title: "Platform v2 Enhancements",
    shortDescription: "Advanced analytics and multi-language support — not started. No repository evidence of implementation.",
    fullDescription: "Grouped placeholder for post-v1 platform enhancements named in the original roadmap, specifically advanced analytics/heatmaps and multi-language support. Neither has any implementation in this repository as of the last verification date.",
    category: C.DEFERRED_FUTURE,
    status: S.PLANNED,
    progress: null,
    route: null,
    docs: [],
    roadmapPhase: 5,
    roadmapItem: "Platform v2 enhancements",
    launchDate: null,
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: false,
    discordEquivalent: null,
    relatedModules: [],
    evidence: [],
    limitations: "Advanced analytics/heatmaps: not started. Multi-language support: not started.",
    ongoingOperation: false,
    sortOrder: 410,
    icon: "📈",
  },

  // ── Historical (superseded original module concepts) ───────────────────
  {
    id: "utility-expansion-legacy",
    title: "Utility Expansion (original concept)",
    shortDescription: "Superseded — the real utility tools this envisioned now ship as Transparency Center, Burn Center, Events, and Partners.",
    fullDescription: "An early, abstract \"module\" concept from before the platform's real feature set existed. What it described — dashboards, transparency tooling, integrations — has since shipped as concrete, individually-registered modules. Kept as a historical record, not an active roadmap item.",
    category: C.HISTORICAL,
    status: S.HISTORICAL,
    progress: null,
    route: "/modules/utility-expansion.html",
    docs: [],
    roadmapPhase: 4,
    roadmapItem: "Platform v2 enhancements",
    launchDate: null,
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["transparency-center", "burn-center", "community-events", "sponsors-partners"],
    evidence: [],
    limitations: "Superseded — see relatedModules for the real, shipped equivalents.",
    ongoingOperation: false,
    sortOrder: 500,
    icon: "🧰",
  },
  {
    id: "community-ops-legacy",
    title: "Community Ops (original concept)",
    shortDescription: "Superseded — the real coordination layer this envisioned now ships as Governance and Community Events.",
    fullDescription: "An early, abstract \"module\" concept covering roles, verification, and community coordination. Its scope has since shipped concretely as Governance (structured decision-making) and Community Events (organized, scheduled activity). Kept as a historical record, not an active roadmap item.",
    category: C.HISTORICAL,
    status: S.HISTORICAL,
    progress: null,
    route: "/modules/community-ops.html",
    docs: [],
    roadmapPhase: 4,
    roadmapItem: "Platform v2 enhancements",
    launchDate: null,
    lastVerifiedIso: VERIFIED_2026_07_12,
    publicVisibility: true,
    mobileSupport: true,
    discordEquivalent: null,
    relatedModules: ["governance", "community-events"],
    evidence: [],
    limitations: "Superseded — see relatedModules for the real, shipped equivalents.",
    ongoingOperation: false,
    sortOrder: 510,
    icon: "🧩",
  },
];

// ── Original roadmap reconciliation ─────────────────────────────────────
// Every phase from the original #LewCrew roadmap, mapped item-by-item to
// its real disposition. Deliberately NOT flattened into "100% complete" —
// see docs/modules-system.md's "roadmap mapping" section.
export const ROADMAP_ITEM_STATES = Object.freeze({
  COMPLETE: "complete",
  LIVE: "live",
  ONGOING: "ongoing",
  DEFERRED: "deferred",
  REMOVED_FROM_SCOPE: "removed-from-scope",
  NOT_STARTED: "not-started",
});

const R = ROADMAP_ITEM_STATES;

export const ROADMAP_PHASES = [
  {
    phase: 1,
    title: "Foundation & Tokenomics",
    state: R.COMPLETE,
    items: [
      { label: "Whitepaper", state: R.COMPLETE, moduleId: "whitepaper" },
      { label: "Community channels", state: R.COMPLETE, moduleId: null },
      { label: "Token launch", state: R.COMPLETE, moduleId: null },
      { label: "Initial listings", state: R.COMPLETE, moduleId: null },
    ],
  },
  {
    phase: 2,
    title: "Core Infrastructure",
    state: R.COMPLETE,
    items: [
      { label: "Liquidity pool", state: R.COMPLETE, moduleId: "faucet" },
      { label: "Liquidity farm", state: R.COMPLETE, moduleId: null },
      { label: "Locked supply", state: R.COMPLETE, moduleId: null },
      { label: "Website", state: R.COMPLETE, moduleId: "core-infrastructure" },
    ],
  },
  {
    phase: 3,
    title: "Platform Launch",
    state: R.COMPLETE,
    items: [
      { label: "Full web platform", state: R.COMPLETE, moduleId: "core-infrastructure" },
      { label: "Authentication", state: R.COMPLETE, moduleId: "unified-authentication" },
      { label: "Trivia", state: R.COMPLETE, moduleId: "quiz" },
      // Repointed from "quiz" to "leaderboards" on 2026-08-12. Quiz's internal
      // standings were the closest thing that existed when this mapping was
      // written; /leaderboards/ has been the real implementation since
      // 2026-07-18 and now has a registry record of its own.
      { label: "Leaderboards", state: R.COMPLETE, moduleId: "leaderboards" },
      { label: "Dashboard", state: R.COMPLETE, moduleId: "dashboard" },
      { label: "Quiz scores", state: R.COMPLETE, moduleId: "quiz" },
      { label: "Token balances", state: R.COMPLETE, moduleId: "dashboard" },
      { label: "Proof of Value visibility", state: R.COMPLETE, moduleId: "proof-of-value" },
      { label: "Goal/progress tracking", state: R.COMPLETE, moduleId: "dashboard" },
    ],
  },
  {
    phase: 4,
    title: "Engagement & Mechanism Roll-out",
    state: R.COMPLETE,
    items: [
      { label: "Proof of Value full integration", state: R.COMPLETE, moduleId: "proof-of-value" },
      { label: "Automated reward/redemption flow", state: R.COMPLETE, moduleId: "discord-web-parity" },
      { label: "Mobile App Beta", state: R.LIVE, moduleId: "mobile-app-beta" },
      { label: "Burn Program", state: R.LIVE, moduleId: "burn-center" },
      { label: "Community events", state: R.LIVE, moduleId: "community-events" },
      { label: "Partnerships", state: R.LIVE, moduleId: "sponsors-partners" },
    ],
  },
  {
    phase: 5,
    title: "Governance & Beyond",
    // Deliberately NOT "complete" — see items below. This is the phase the
    // closeout spec explicitly warns against flattening.
    state: R.ONGOING,
    items: [
      { label: "Governance Module v1", state: R.COMPLETE, moduleId: "governance" },
      { label: "Cross-Chain Bridge", state: R.DEFERRED, moduleId: "cross-chain-bridge" },
      { label: "Platform v2 enhancements", state: R.NOT_STARTED, moduleId: "platform-v2-enhancements" },
      { label: "Ongoing PoV cycles and burns", state: R.ONGOING, moduleId: "burn-center" },
    ],
  },
];

// ── Pure validation (no storage, no network) ────────────────────────────
export function validateModulesRegistry(modules = MODULES, roadmapPhases = ROADMAP_PHASES) {
  const errors = [];

  const seenIds = new Map();
  const seenRoutes = new Map();

  for (const m of modules) {
    if (!m.id) { errors.push(`Module missing id: ${JSON.stringify(m.title)}`); continue; }
    if (seenIds.has(m.id)) errors.push(`Duplicate module id: ${m.id}`);
    seenIds.set(m.id, (seenIds.get(m.id) || 0) + 1);

    if (m.route) {
      if (seenRoutes.has(m.route)) {
        errors.push(`Duplicate route "${m.route}" used by both ${seenRoutes.get(m.route)} and ${m.id}`);
      } else {
        seenRoutes.set(m.route, m.id);
      }
    }

    if (!Object.values(MODULE_STATUSES).includes(m.status)) {
      errors.push(`${m.id}: unsupported status "${m.status}"`);
    }

    if (m.progress != null) {
      if (typeof m.progress !== "number" || m.progress < 0 || m.progress > 100) {
        errors.push(`${m.id}: progress out of 0-100 range: ${m.progress}`);
      }
    }

    if (m.status === MODULE_STATUSES.LIVE && !m.route) {
      errors.push(`${m.id}: status is live but has no route`);
    }

    if (m.roadmapPhase == null) {
      errors.push(`${m.id}: missing roadmapPhase`);
    }

    if (typeof m.title !== "string" || !m.title.trim()) {
      errors.push(`${m.id}: missing title`);
    }
  }

  // relatedModules must reference real, existing ids — a dangling reference
  // usually means a module was renamed/removed and its cross-links weren't
  // updated (exactly the kind of drift this registry exists to prevent).
  for (const m of modules) {
    for (const relatedId of m.relatedModules || []) {
      if (!seenIds.has(relatedId)) {
        errors.push(`${m.id}: relatedModules references unknown id "${relatedId}"`);
      }
    }
  }

  // Every module referenced from roadmapPhases.items must exist.
  for (const phase of roadmapPhases) {
    for (const item of phase.items) {
      if (item.moduleId && !seenIds.has(item.moduleId)) {
        errors.push(`Roadmap phase ${phase.phase} item "${item.label}" references unknown moduleId "${item.moduleId}"`);
      }
      if (!Object.values(ROADMAP_ITEM_STATES).includes(item.state)) {
        errors.push(`Roadmap phase ${phase.phase} item "${item.label}": unsupported state "${item.state}"`);
      }
    }

    // A phase can never be reported "complete" while any of its own items
    // are deferred, not-started, or blocked — the exact "flatten Phase 5 to
    // 100%" mistake this registry exists to prevent.
    const hasUnfinishedItem = phase.items.some((item) =>
      [ROADMAP_ITEM_STATES.DEFERRED, ROADMAP_ITEM_STATES.NOT_STARTED, ROADMAP_ITEM_STATES.BLOCKED].includes(item.state)
    );
    if (hasUnfinishedItem && phase.state === ROADMAP_ITEM_STATES.COMPLETE) {
      errors.push(`Roadmap phase ${phase.phase} ("${phase.title}") is marked complete but contains a deferred/not-started/blocked item`);
    }
  }

  // 2026-07-12 product decision: Cross-Chain Bridge is RETAINED on the
  // original roadmap — deferred, not removed/abandoned. This block fails
  // the registry loudly if that decision is ever silently reversed in code
  // without a new, explicit product decision being recorded (which would
  // mean rewriting this check itself, not just the data). Only runs when
  // the roadmap being validated actually claims to include Phase 5 (the
  // real ROADMAP_PHASES always does) — a synthetic/partial test registry
  // with no Phase 5 at all is legitimately out of scope for this check,
  // exactly like the other roadmap-phase checks above.
  const validatingPhase5 = roadmapPhases.some((phase) => phase.phase === 5);
  if (validatingPhase5) {
    const bridge = modules.find((m) => m.id === "cross-chain-bridge");
    if (!bridge) {
      errors.push('Cross-Chain Bridge module ("cross-chain-bridge") is missing from the registry entirely — it must remain present and retained');
    } else {
      if (bridge.status === MODULE_STATUSES.LIVE) {
        errors.push("Cross-Chain Bridge must never be marked live — implementation has not started");
      }
      if (bridge.status === MODULE_STATUSES.RETIRED) {
        errors.push("Cross-Chain Bridge must never be marked retired — it is retained on the roadmap, not removed");
      }
      if (bridge.status !== MODULE_STATUSES.DEFERRED) {
        errors.push(`Cross-Chain Bridge status must be "deferred" (got "${bridge.status}")`);
      }
      if (bridge.retainedOnRoadmap !== true) {
        errors.push("Cross-Chain Bridge must have retainedOnRoadmap: true");
      }
      if (bridge.implementationState !== "not-started") {
        errors.push(`Cross-Chain Bridge implementationState must be "not-started" (got "${bridge.implementationState}")`);
      }
      if (bridge.roadmapPhase !== 5) {
        errors.push(`Cross-Chain Bridge roadmapPhase must be 5 (got ${bridge.roadmapPhase})`);
      }
    }
  }
  const bridgeRoadmapEntries = roadmapPhases.flatMap((phase) => phase.items.filter((item) => item.moduleId === "cross-chain-bridge"));
  if (validatingPhase5 && bridgeRoadmapEntries.length === 0) {
    errors.push("Cross-Chain Bridge is missing from the Phase 5 roadmap item mapping — it must remain listed as retained/deferred");
  }
  for (const item of bridgeRoadmapEntries) {
    if (item.state === ROADMAP_ITEM_STATES.COMPLETE) {
      errors.push('Cross-Chain Bridge roadmap-item state must never be "complete"');
    }
    if (item.state === ROADMAP_ITEM_STATES.REMOVED_FROM_SCOPE) {
      errors.push('Cross-Chain Bridge roadmap-item state must never be "removed-from-scope" without a later, separate, explicit decision record');
    }
  }

  // Platform v2 enhancements must never be falsely reported as shipped.
  const platformV2 = modules.find((m) => m.id === "platform-v2-enhancements");
  if (platformV2 && platformV2.status === MODULE_STATUSES.LIVE) {
    errors.push("Platform v2 enhancements must never be marked live — no implementation exists");
  }
  const platformV2RoadmapEntries = roadmapPhases.flatMap((phase) => phase.items.filter((item) => item.moduleId === "platform-v2-enhancements"));
  for (const item of platformV2RoadmapEntries) {
    if (item.state === ROADMAP_ITEM_STATES.COMPLETE) {
      errors.push('Platform v2 enhancements roadmap-item state must never be "complete"');
    }
  }

  // Ongoing recurring activity (PoV cycles, burns) must never be reported
  // as finished, one-time software — its roadmap-item state must stay
  // "ongoing", distinct from the live/complete software that supports it.
  const ongoingRoadmapEntries = roadmapPhases.flatMap((phase) => phase.items.filter((item) => /ongoing/i.test(item.label)));
  for (const item of ongoingRoadmapEntries) {
    if (item.state !== ROADMAP_ITEM_STATES.ONGOING) {
      errors.push(`Roadmap item "${item.label}" describes ongoing activity but its state is "${item.state}", not "ongoing"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function getModuleById(id, modules = MODULES) {
  return modules.find((m) => m.id === id) || null;
}

export function countsByStatus(modules = MODULES) {
  const counts = {};
  for (const status of Object.values(MODULE_STATUSES)) counts[status] = 0;
  for (const m of modules) counts[m.status] = (counts[m.status] || 0) + 1;
  return counts;
}

export function getModulesStatusPayload(modules = MODULES, roadmapPhases = ROADMAP_PHASES) {
  return {
    registryVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    modules: [...modules].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    roadmapPhases,
    countsByStatus: countsByStatus(modules),
  };
}
