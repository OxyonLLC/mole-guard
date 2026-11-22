import express from "express";
import { isPublicRequestPath } from "./publicFiles.js";
import fs from "fs";
import path from "path";
import helmet from "helmet";
import morgan from "morgan";
import { installMorganRedaction } from "./logRedaction.js";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import crypto from "crypto";
import { createProxyMiddleware } from "http-proxy-middleware";
import { geoHackersApiGuard } from "./geohackersApiGuard.js";

import { getConfig } from "./config.js";
import { checkIpBan, recordIpOffence } from "../shared/ipDenylist.js";
import { recordBotHeartbeat, botHealthPayload, isKnownService } from "./botHealth.js";
import { withAppeal } from "../services/appealContact.js";
import { createSession, getSession, revokeSession } from "./sessions.js";
import { startNativeHandoff, depositNativeHandoff, claimNativeHandoff } from "./nativeHandoff.js";
import { startWebHandoff, claimWebHandoff, peekWebHandoff } from "./webHandoff.js";
import { createOrder as createMerchOrder, captureOrder as captureMerchOrder, paypalConfig, priceOrder, listOrders as listMerchOrders } from "./merchOrders.js";
import { trustedProxySetting, resolveClientKey } from "./clientIp.js";
import {
  discordMe,
  getUserTokensForApp,
  setUserTokensForApp,
  putRoleConnection,
} from "./discordApi.js";

import {
  issueChallenge,
  completeLink,
  getLinkedWallet,
  getLinkedWalletRecord,
  findLinkedProfileByWallet,
  getWalletVerificationStatus,
  WALLET_VERIFICATION_TTL_SEC,
  issueWalletActionChallenge,
  verifyWalletAction,
  issueProfileEditGrant,
  verifyProfileEditGrant,
  listVerifiedWallets,
  getPayoutWallet,
  setPayoutWallet,
} from "./walletLink.js";
import { getIdentityHoldings, meetsThreshold } from "./identityHoldings.js";
import { getSplBalance, computeLewcrewFlags, getOwnerTokenSnapshot, getTokenAccountSnapshot, getProgramAccountSnapshot, getMintSnapshot, resolveWalletSnsName } from "./solana.js";
import { syncGuildRolesForUser, fetchGuildMemberFacts } from "./guildRoles.js";
import { evaluateIdentityAge, explainIdentityRefusal, identityGateConfig, IDENTITY_REASONS } from "./identityAge.js";
import { refreshManagedFile, getStorageSyncHealth, readJson as readManagedJson, writeJson as writeManagedJson } from "./storage.js";
import { syncIdentity, listSyncedIdentities, canBePaid, unsyncIdentity, accountForIdentity, discordUserIdForAccount, IDENTITY_PROVIDERS } from "./syncedIdentities.js";
import { mergeAccountsWithRewardGuard, accountsForUser } from "./accountMerge.js";
import { resolveAccountId } from "./userAccounts.js";
import { isXOAuthConfigured, createPkcePair, buildXAuthorizeUrl, exchangeXCode, fetchXUser } from "./xOAuth.js";
import { recordRewardClaim, listRewardClaims, getRewardSummary, getGuestReconciliationTotal, getRecentClaimStats, reassignClaims, getGameLeaderboard, getGamePopularity } from "./rewardHistory.js";
import {
  CONTRIBUTION_CAUSES,
  buildContributionTransaction,
  submitSignedContributionTransaction,
  confirmContribution,
  getContributionLeaderboard,
  getUserContributionSummary,
  recordExternalSubmission,
} from "./contributions.js";
import { combineProofOfValue, quizSignalsForUser, tierProgress } from "./proofOfValue.js";
import { computeMilestones } from "./milestones.js";
import { buildRecentActivity } from "./dashboardActivity.js";
import { computeFaucetStreak, buildWeeklySummary, closestUnachievedMilestone } from "./participation.js";
import {
  BURN_EVENTS,
  BURN_WALLET_ADDRESS,
  BURN_TARGET_BASE_UNITS,
  BURN_BENCHMARK,
  WINLEW_DECIMALS,
  summarizeBurnEvents,
  computeBurnProgress,
} from "./burnEvents.js";
import { baseUnitsToDecimalString } from "../faucet/amount.js";
import { buildCirculatingSupply } from "./circulatingSupply.js";
import { logSiteEvent, SOURCES as SITE_LOG_SOURCES, isDiscordId } from "./siteLog.js";

// Refusals that are the system working as designed, not something to look into.
// Kept as a named set rather than an inline `!== "cooldown"` so the next person
// deciding whether a reason is noise has somewhere obvious to add it — and so
// the omission is a deliberate list rather than a forgotten condition.
const ROUTINE_REFUSALS = new Set(["cooldown"]);
import { collectSignals } from "./deviceSignals.js";
import { loadBurnScanCheckpoint } from "./evidence/burnCheckpoint.js";
import { loadFaucetDistributionCheckpoint } from "./evidence/faucetDistributionCheckpoint.js";
import { reconcileBurnRecords } from "./evidence/burnScanner.js";
import { COMMUNITY_LIQUIDITY_EVENTS, summarizeCommunityLiquidity, FARM_PROGRAMS } from "./communityLiquidity.js";
import { BOUNTIES, summarizeBounties } from "./bounties.js";
import { PARTNERS, ECOSYSTEM_SUPPORT } from "./partnersData.js";
import { EVENTS, groupEventsByBucket, getEventsForPartner } from "./eventsData.js";
import { getModulesStatusPayload } from "./modulesData.js";
import { PROPOSALS, GOVERNANCE_CONFIG, VOTABLE_STATUSES, getProposalById } from "./governanceData.js";
import { castVote, getWalletVote, computeResults, readAllVotes } from "./governanceStore.js";
import { getVotePriceInWinlew, recordPriceSample, USD_PER_VOTE, MAX_PURCHASED_VOTES_PER_PROPOSAL } from "./governancePricing.js";
import { allocateVoteWeight, previewPurchasedWeight } from "./governanceVoteCredits.js";
import { resolveSnapshotEligibility } from "./governanceSnapshot.js";
import {
  SUBMISSION_STATUSES,
  createSubmission,
  getSubmissionById,
  listSubmissionsByOwner,
  listAllSubmissions,
  reviewSubmission,
  withdrawSubmission,
} from "./governanceSubmissions.js";
import { validateRewardClaim, getRewardRulesConfig, resolveRewardMode } from "./rewardRules.js";
import { registerXL1ArcadeRoutes } from "../xl1-arcade/routes.js";
import { getVerifiedXl1Wallet, getDiscordIdForXl1Wallet } from "../xl1-arcade/verified-wallet.js";
import { createXl1Login, loadSdkAccount, xl1AccountId, xl1WalletOf } from "../xl1-arcade/xl1-login.js";
import { makeStartVerification } from "../xl1-arcade/verify-start.js";
import { registerXl1ConnectRoutes } from "../xl1-connect/routes.js";
import { registerXl1FaucetRoutes } from "../xl1-faucet/routes.js";
import { makeStartConnect } from "../xl1-connect/connect.js";
import { getCombinedRewardMultiplier } from "../shared/rewardMultipliers.js";
import { normalizeForgeRequest, routeForgePrompt } from "../winlew-forge/ai-router.js";
import { getProfilePrefsByUser, saveProfilePrefs } from "./profilePrefs.js";
import { createHomepageSummary, createSingleFlightReader, readFreshCachedSnapshot } from "./homepageSummary.js";

/** Robust paths (Windows-safe, cwd-agnostic) */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// web.js is in: src/mole/web.js
// public is in: src/public
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const require = createRequire(import.meta.url);
const quizDb = require("../quiz/db.js");
const quizQuestions = require("../quiz/questions.js");
const quizSponsor = require("../quiz/sponsor.js");
const quizWallets = require("../quiz/wallets.js");
const { redeemQuizPoints } = require("../quiz/redemption.js");

// Faucet: deliberately only importing eligibility.js/service.js (which never
// touch the treasury keypair) — NOT payoutExecutor.js/keypair.js/faucet.js,
// and service.js's own dynamic import of payoutExecutor.js only ever fires
// for source:'discord', which this process never passes. See
// src/faucet/service.js's file-level comment for why that matters.
import { checkEligibility, ELIGIBILITY_REASONS as FAUCET_REASONS } from "../faucet/eligibility.js";
import { getFaucetConfig } from "../faucet/config.js";
import { claimFaucet } from "../faucet/service.js";
import {
  getClaimById as getFaucetClaimById,
  getStatusForUser as getFaucetStatusForUser,
  getClaimHistoryForUser,
  getGlobalFaucetStats,
  getFaucetLeaderboard,
} from "../faucet/claimStore.js";

// Web-play question pool: every quiz question tagged with a stable id (hash of
// the prompt, for answer-once) and points by difficulty — mirrors the POINTS
// map in src/quiz/index.js (BASE_POINTS * {easy:1, medium:1.5, hard:2.25}).
const QUIZ_BASE_POINTS = Number(process.env.BASE_POINTS || 100);
const QUIZ_LEVEL_MULT = { easy: 1, medium: 1.5, hard: 2.25 };
// Sponsor questions use their own base (mirrors SPONSOR_BASE_POINTS in
// src/quiz/index.js), not the easy/medium/hard multiplier ladder.
const QUIZ_SPONSOR_BASE_POINTS = Number(process.env.SPONSOR_BASE_POINTS || 125);
function quizPointsForLevel(level) {
  if (level === "sponsor") return QUIZ_SPONSOR_BASE_POINTS;
  return Math.round(QUIZ_BASE_POINTS * (QUIZ_LEVEL_MULT[level] || 1));
}
const QUIZ_TIERS = ["easy", "medium", "hard", "sponsor"];
function quizQuestionId(q) {
  return crypto.createHash("sha1").update(String(q?.q || "")).digest("hex").slice(0, 12);
}

// Anonymous hub players identify by a persistent guest id (localStorage). Their
// winnings are recorded under `guest:<id>` and merged into a Discord account on
// connect. Validate the shape so it can't be used to forge another namespace.
function sanitizeGuestId(raw) {
  const s = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(s) ? s : null;
}

/** Where to send someone after Discord, when they asked to come back.
 *
 *  ONLY same-origin paths. An unchecked `next` is an open redirect: an attacker
 *  sends winlew.co/linked-role/mole?next=https://evil.example, the victim sees
 *  a genuine winlew.co link, approves a genuine Discord prompt, and lands
 *  somewhere else entirely — with the trust of the whole flow behind it.
 *
 *  So this refuses anything that is not a single leading slash: no "//host"
 *  (protocol-relative, which inherits the current scheme), no "http:" or any
 *  other scheme, and no backslashes, which some parsers normalise to slashes.
 *  Exported so those cases are pinned by tests rather than by reading. */
export function safeNextPath(value) {
  const next = String(value || "").trim();
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.includes("\\") || next.includes(":")) return null;
  return next.slice(0, 300);
}

/**
 * OAuth state for a SYNC, as opposed to a sign-in.
 *
 * A sign-in creates a session as the Discord user. A sync must do the opposite:
 * keep the account the person is already using — their wallet-rooted one — and
 * ATTACH the Discord identity to it. The callback cannot tell those apart from
 * the code alone, so the intent and the target account ride in the state.
 *
 * base64url of a small JSON blob rather than more colon-delimited fields: an
 * account id is literally "wallet:<hex>", so a delimiter this format already
 * uses would split it in half.
 *
 * NOT CLIENT-CONTROLLED. The state is a server-side session id; this blob is
 * stored against it here and read back there. The browser never carries the
 * account id, so it cannot nominate an account it does not hold a session for.
 */
function encodeSyncState({ appKey, accountId, next, verifier = null, mode = "sync", claimHash = null }) {
  // `v` is the PKCE code verifier for an X sync. It lives here because this
  // blob is stored against a server-side session id and never leaves the
  // server — the browser only ever holds the id.
  //
  // `m` separates the two things an X round trip can be. A SYNC attaches an
  // identity to an account that already exists and must name it. A SIGN-IN has
  // no account yet — it is how the account comes into being — so it carries no
  // id at all, and the callback resolves one from the X user it gets back.
  const payload = JSON.stringify({
    a: appKey || "mole", id: accountId || "", n: next || null, v: verifier, m: mode === "signin" ? "signin" : "sync",
    // `c` is the SHA-256 of a secret the BROWSER invented before the round trip
    // began and never sent. It is what makes the session that comes back
    // claimable by that browser and no other. See handoffRedirect().
    c: /^[a-f0-9]{64}$/.test(String(claimHash || "")) ? String(claimHash) : null,
  });
  return `sync:${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeSyncState(raw) {
  if (typeof raw !== "string" || !raw.startsWith("sync:")) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw.slice(5), "base64url").toString("utf8"));
    if (!parsed) return null;
    const mode = parsed.m === "signin" ? "signin" : "sync";
    // A sync MUST name its target account — without one there is nothing to
    // attach to, and a blank id would be a wildcard. A sign-in must NOT carry
    // one, so this check stays scoped to the sync case rather than becoming a
    // blanket requirement that would reject every sign-in.
    if (mode === "sync" && (typeof parsed.id !== "string" || !parsed.id)) return null;
    return {
      appKey: parsed.a || "mole",
      accountId: typeof parsed.id === "string" ? parsed.id : "",
      next: safeNextPath(parsed.n),
      verifier: typeof parsed.v === "string" ? parsed.v : null,
      mode,
      claimHash: /^[a-f0-9]{64}$/.test(String(parsed.c || "")) ? String(parsed.c) : null,
    };
  } catch {
    return null;
  }
}

/** The browser's claim hash, or null. Shape-checked here so a malformed one is
 *  simply "no binding" rather than something that breaks the state blob — a
 *  sign-in that fails closed on a typo is a sign-in nobody can complete. */
/** One place that builds Discord's authorize URL, so the bound and unbound
 *  paths through /linked-role cannot drift apart in scope or redirect_uri. */
function discordAuthorizeUrl(oauth, state) {
  return "https://discord.com/oauth2/authorize"
    + `?client_id=${encodeURIComponent(oauth.clientId)}`
    + `&redirect_uri=${encodeURIComponent(oauth.redirectUri)}`
    + "&response_type=code"
    + `&scope=${encodeURIComponent(oauth.scope)}`
    + `&state=${encodeURIComponent(state)}`;
}

function bodyClaimHash(req) {
  const hash = String(req?.body?.claimHash || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function walletProfileId(wallet) {
  const digest = crypto.createHash("sha256").update(String(wallet || "").trim()).digest("hex").slice(0, 32);
  return `wallet:${digest}`;
}

/** The account id for someone whose first proof was X, mirroring
 *  walletProfileId(). Hashed rather than stored raw for the same reason the
 *  wallet one is: the id appears in logs and payload records, and an X user id
 *  is a real person on another platform. The X id itself lives once, in the
 *  synced-identities store, which is the thing that enforces one-person-one-
 *  account. */
function xProfileId(xUserId) {
  const digest = crypto.createHash("sha256").update(`x:${String(xUserId || "").trim()}`).digest("hex").slice(0, 32);
  return `x:${digest}`;
}

function walletVerificationWarning(verification) {
  if (verification?.verified) return null;
  if (verification?.status === "expired") {
    return "Your wallet profile is connected, but its verification expired for the new quiz cycle. Please verify your wallet on our Discord to unlock token payouts again.";
  }
  return "Your wallet profile is connected. Please verify your wallet on our Discord to unlock your tokens; play history and rewards will stay saved in the meantime.";
}
let _quizWebPool = null;
function quizWebPool() {
  if (_quizWebPool) return _quizWebPool;
  const levels = [["easy", quizQuestions.EASY], ["medium", quizQuestions.MEDIUM], ["hard", quizQuestions.HARD]];
  const pool = [];
  for (const [level, arr] of levels) {
    for (const raw of Array.isArray(arr) ? arr : []) {
      if (!raw || !Array.isArray(raw.choices) || raw.choices.length !== 4) continue;
      if (!Number.isInteger(raw.answerIndex)) continue;
      pool.push({ id: quizQuestionId(raw), level, points: quizPointsForLevel(level), raw });
    }
  }
  // Sponsor tile: every sponsor pool (xyo, winlew, ...) combined under one
  // "sponsor" level for tile-selection purposes, but each question keeps its
  // own sponsorKey so an answer still credits the right sponsor's breakdown
  // via addSponsorPoints (parity with Discord's !sponsorquiz).
  for (const [sponsorKey, arr] of Object.entries(quizSponsor.SPONSOR_POOLS)) {
    for (const raw of Array.isArray(arr) ? arr : []) {
      if (!raw || !Array.isArray(raw.choices) || raw.choices.length !== 4) continue;
      if (!Number.isInteger(raw.answerIndex)) continue;
      pool.push({ id: quizQuestionId(raw), level: "sponsor", sponsorKey, points: quizPointsForLevel("sponsor"), raw });
    }
  }
  _quizWebPool = pool;
  return pool;
}
// Fisher-Yates over the choices, recomputing the correct index (server-only).
function quizShuffle(raw) {
  const zipped = raw.choices.map((choice, idx) => ({ choice, idx }));
  for (let i = zipped.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [zipped[i], zipped[j]] = [zipped[j], zipped[i]];
  }
  return {
    q: String(raw.q || ""),
    choices: zipped.map((x) => x.choice),
    answerIndex: zipped.findIndex((x) => x.idx === raw.answerIndex),
  };
}

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SRC_DATA_DIR = path.resolve(PROJECT_ROOT, "src", "data");
// The faucet bot owns these files in production, so the default remains its
// existing src/faucet directory. Isolated integration tests may explicitly
// redirect the read-only profile snapshot into their disposable data root.
const FAUCET_DIR = path.resolve(
  String(process.env.FAUCET_DATA_DIR || path.resolve(PROJECT_ROOT, "src", "faucet")),
);

const FAUCET_WALLET_LINKS_PATH = path.join(FAUCET_DIR, "wallet_links.json");
const FAUCET_REGISTRATIONS_PATH = path.join(FAUCET_DIR, "registrations.json");

const GEOAGORA_API_BASE_URL = String(process.env.GEOAGORA_API_LOCAL_URL || "http://127.0.0.1:3001").trim().replace(/\/+$/, "");
const GEOAGORA_PUBLIC_BASE_PATH = String(process.env.GEOAGORA_PUBLIC_BASE_PATH || "/geoagora").trim().replace(/\/+$/, "");

function buildGeoAgoraPublicProfileUrl(target, mode = "user") {
  const text = String(target || "").trim();
  if (!text) return "";
  const cleanMode = String(mode || "user").trim().toLowerCase() === "wallet" ? "wallet" : "user";
  return `${GEOAGORA_PUBLIC_BASE_PATH}/${cleanMode}/${encodeURIComponent(text)}`;
}

function buildGeoAgoraOwnerProfileUrl() {
  return `${GEOAGORA_PUBLIC_BASE_PATH}/profile`;
}

function emptyGeoAgoraSnapshot() {
  return {
    available: false,
    ownerUrl: buildGeoAgoraOwnerProfileUrl(),
    publicUrl: "",
    walletUrl: "",
    userUrl: "",
    mode: "user",
    target: "",
    xl1Wallet: "",
    primaryWallet: "",
    linkedName: "",
    firstSeen: null,
    lastSeen: null,
    lookupCount: 0,
    assetCount: 0,
    collectionCount: 0,
    walletAliases: [],
    nameAliases: [],
    wallets: { ethereum: "", base: "", polygon: "", solana: "", xl1: "" },
  };
}

async function fetchJsonWithTimeout(url, ms = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(ms || 7000)));
  try {
    const res = await fetch(url, {
      headers: { "ngrok-skip-browser-warning": "true" },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `request_failed_${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function buildGeoAgoraSnapshot(wallets = {}) {
  const rows = Array.isArray(wallets?.knownWallets) ? wallets.knownWallets : [];
  const candidates = [...new Set([
    wallets?.verifiedWallet,
    wallets?.payoutWallet,
    wallets?.primaryWallet,
    ...rows.map((row) => row?.address),
  ].map((value) => String(value || "").trim()).filter(Boolean))];

  for (const wallet of candidates) {
    try {
      const params = new URLSearchParams({ wallet, directSync: "0", forceMetadata: "0" });
      const summary = await fetchJsonWithTimeout(`${GEOAGORA_API_BASE_URL}/ownership/summary?${params.toString()}`, 2800);
      const identity = summary?.identityProfile || {};
      const summaryWallets = summary?.wallets || identity?.wallets || {};
      const resolved = summary?.resolvedAddresses || identity?.resolvedAddresses || {};
      const xl1Wallet = String(summaryWallets?.xl1 || identity?.wallets?.xl1 || "").trim();
      if (!xl1Wallet) continue;

      const walletMap = {
        ethereum: String(summaryWallets?.ethereum || resolved?.ethereum || "").trim(),
        base: String(summaryWallets?.base || resolved?.base || "").trim(),
        polygon: String(summaryWallets?.polygon || resolved?.polygon || "").trim(),
        solana: String(summaryWallets?.solana || resolved?.solana || "").trim(),
        xl1: xl1Wallet,
      };

      const nameAliases = Array.isArray(identity?.nameAliases) ? identity.nameAliases : [];
      const walletAliases = Array.isArray(identity?.walletAliases) ? identity.walletAliases : [];
      const assetWallet = String(walletMap.ethereum || walletMap.polygon || walletMap.base || identity?.primaryWallet || wallet).trim();

      let assetCount = Number(summary?.counts?.assets || 0);
      let collectionCount = Number(summary?.counts?.collections || 0);

      if (assetWallet && assetWallet !== wallet) {
        try {
          const assetParams = new URLSearchParams({ wallet: assetWallet, directSync: "0", forceMetadata: "0" });
          const assetSummary = await fetchJsonWithTimeout(`${GEOAGORA_API_BASE_URL}/ownership/summary?${assetParams.toString()}`, 2200);
          assetCount = Number(assetSummary?.counts?.assets || assetCount || 0);
          collectionCount = Number(assetSummary?.counts?.collections || collectionCount || 0);
        } catch {
          // keep first summary counts
        }
      }

      const publicTarget = String(xl1Wallet || assetWallet || wallet).trim();

      return {
        available: true,
        ownerUrl: buildGeoAgoraOwnerProfileUrl(),
        publicUrl: buildGeoAgoraPublicProfileUrl(publicTarget, "user"),
        walletUrl: buildGeoAgoraPublicProfileUrl(xl1Wallet, "user"),
        userUrl: buildGeoAgoraPublicProfileUrl(publicTarget, "user"),
        mode: "user",
        target: publicTarget,
        xl1Wallet,
        primaryWallet: String(identity?.primaryWallet || walletMap.ethereum || assetWallet || wallet).trim(),
        linkedName: String(identity?.udDomain || summary?.linkedName || nameAliases[0] || "").trim(),
        firstSeen: formatIso(identity?.createdAt || ""),
        lastSeen: formatIso(identity?.lastSeenAt || identity?.updatedAt || ""),
        lookupCount: Array.isArray(identity?.lookupKeys) ? identity.lookupKeys.length : 0,
        assetCount,
        collectionCount,
        walletAliases: walletAliases.slice(0, 6),
        nameAliases: nameAliases.slice(0, 6),
        wallets: walletMap,
      };
    } catch {
      // geoagora lookup is best-effort only
    }
  }

  return emptyGeoAgoraSnapshot();
}

async function buildGeoAgoraSnapshotFast(wallets = {}) {
  try {
    return await Promise.race([
      buildGeoAgoraSnapshot(wallets),
      new Promise((resolve) => setTimeout(() => resolve(emptyGeoAgoraSnapshot()), 2500)),
    ]);
  } catch {
    return emptyGeoAgoraSnapshot();
  }
}

function buildPublicProfilePayload(privatePayload = {}, publicIdentity = null) {
  const profile = privatePayload?.profile || {};
  const holdings = privatePayload?.holdings || {};
  const discord = privatePayload?.discord || {};
  const quiz = privatePayload?.quiz || {};
  const games = privatePayload?.games || {};
  const geoAgora = privatePayload?.geoAgora || {};
  const faucet = privatePayload?.faucet || {};
  const milestones = privatePayload?.milestones || {};

  return {
    publicView: true,
    generatedAt: privatePayload.generatedAt || new Date().toISOString(),
    // Synced accounts, and ONLY for someone who opted in. Passed in rather than
    // resolved here: this function sits outside startWeb() and cannot see
    // publicIdentityFor(), and duplicating the consent check would be a second
    // copy of the one rule that must never disagree with itself.
    identities: Array.isArray(publicIdentity?.identities) ? publicIdentity.identities : [],
    publicIdentity: publicIdentity?.publicIdentity === true,
    profile: {
      displayName: profile.displayName || profile.username || "WinLEW Member",
      username: profile.username || null,
      avatarUrl: profile.avatarUrl || "/images/mole-dirt-square.png",
      bio: profile.bio || "",
      wallet: profile.wallet || "",
      lastVerified: profile.lastVerified || null,
      editable: false,
      saveMode: "public_readonly",
    },
    wallets: {
      primaryWallet: privatePayload?.wallets?.primaryWallet || profile.wallet || "",
      verifiedWallet: privatePayload?.wallets?.verifiedWallet || "",
      knownWallets: [],
      knownWalletCount: Number(privatePayload?.wallets?.knownWallets?.length || 0),
    },
    holdings: {
      wallet: holdings.wallet || "",
      balance: holdings.balance,
      flags: holdings.flags || {},
      roles: holdings.roles || [],
      error: holdings.error || null,
    },
    discord: {
      displayRoles: discord.displayRoles || [],
    },
    // cooldownReady/nextClaimAt/etc. are deliberately NOT included here —
    // faucet cooldown status is owner-only (see docs/unified-dashboard.md's
    // owner/public boundary table). registeredForAirdrops is just an intent
    // flag, not timing/activity detail, so it's safe to keep public.
    faucet: {
      registeredForAirdrops: !!faucet.registeredForAirdrops,
    },
    quiz: {
      lifetimePoints: Number(quiz.lifetimePoints || 0),
      questionWins: Number(quiz.questionWins || 0),
      sponsorQuestionWins: Number(quiz.sponsorQuestionWins || 0),
      regularQuestionWins: Number(quiz.regularQuestionWins || 0),
      cyclesPlayed: Number(quiz.cyclesPlayed || 0),
      questionsThisCycle: Number(quiz.questionsThisCycle || 0),
      accuracy: quiz.accuracy === null || quiz.accuracy === undefined ? null : Number(quiz.accuracy),
      trackedAnswers: Number(quiz.trackedAnswers || 0),
      currentStreak: Number(quiz.currentStreak || 0),
      bestStreak: Number(quiz.bestStreak || 0),
      rank: quiz.rank ? { rank: Number(quiz.rank.rank), totalRankedPlayers: Number(quiz.rank.totalRankedPlayers) } : null,
      currentCycle: {
        id: quiz?.currentCycle?.id || null,
        startAt: quiz?.currentCycle?.startAt || null,
        endAt: quiz?.currentCycle?.endAt || null,
        points: Number(quiz?.currentCycle?.points || 0),
        unpaidPoints: Number(quiz?.currentCycle?.unpaidPoints || 0),
        estimatedPayout: Number(quiz?.currentCycle?.estimatedPayout || 0),
      },
      payouts: {
        paid: Number(quiz?.payouts?.paid || 0),
        totalWinlewSent: Number(quiz?.payouts?.totalWinlewSent || 0),
        eligibleLeaderboardPoints: Number(quiz?.payouts?.eligibleLeaderboardPoints || 0),
        estimatedLeaderboardPayout: Number(quiz?.payouts?.estimatedLeaderboardPayout || 0),
        recent: [],
      },
    },
    games: {
      history: Array.isArray(games?.history) ? games.history.slice(0, 6) : [],
      summary: games?.summary || { totalClaims: 0, totalPayout: 0, byGame: [] },
    },
    geoAgora,
    // Score + tier only — the full per-component breakdown stays owner-only,
    // same pattern as everything else on this public payload (aggregate
    // numbers are fine to share, the underlying detail is not).
    proofOfValue: privatePayload?.proofOfValue?.ok
      ? { ok: true, score: privatePayload.proofOfValue.score, tier: privatePayload.proofOfValue.tier }
      : { ok: false },
    // Milestones are derived booleans, not activity detail — safe to share
    // (that's the point of a badge). recentActivity is deliberately NOT
    // included here: it's "recent private activity" per the owner/public
    // boundary table in docs/unified-dashboard.md.
    milestones: milestones.ok ? { ok: true, items: milestones.items } : { ok: false },
  };
}

function readJsonFileSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toMsTimestamp(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num < 1e12 ? num * 1000 : num;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatIso(value) {
  const ms = toMsTimestamp(value);
  if (!ms) return null;
  try { return new Date(ms).toISOString(); } catch { return null; }
}

function knownWalletRowsFromRecord(record, prefs = {}, faucetLink = null) {
  const rows = [];
  const seen = new Set();
  // WHICH OF THESE IS STILL PROVED. A record's `wallet_history` holds every
  // address the person ever linked; `verified_wallets` holds the ones whose
  // 91-day proof has not lapsed. Only the second set counts for balances,
  // eligibility and payouts — so the list has to SAY which is which, or
  // somebody with five wallets sees five rows, is credited for one, and
  // reasonably concludes the site lost the other four.
  const liveVerified = new Set(
    Object.entries(record?.verified_wallets || {})
      .filter(([, entry]) => Number(entry?.expires_at || 0) > Math.floor(Date.now() / 1000))
      .map(([address]) => address),
  );

  function pushWallet(kind, raw) {
    if (!raw) return;
    const address = String(raw.address || raw.wallet || raw || "").trim();
    if (!address || seen.has(`${kind}:${address}`)) return;
    rows.push({
      kind,
      address,
      verified: liveVerified.has(address),
      input: String(raw.input || address),
      source: raw.source || kind,
      updatedAt: raw.updatedAt || raw.updated_at || formatIso(raw.linked_at) || null,
      linkedAt: toMsTimestamp(raw.linked_at || raw.updatedAt || raw.updated_at || 0),
    });
    seen.add(`${kind}:${address}`);
  }

  pushWallet("verified", record?.wallets?.verified || record?.last_verified_wallet || record?.wallet);
  pushWallet("faucet", faucetLink || record?.wallets?.faucet);
  pushWallet("payout", record?.wallets?.payout);
  pushWallet("profile", prefs?.wallet);

  for (const addr of Array.isArray(record?.wallet_history) ? record.wallet_history : []) {
    pushWallet("known", addr);
  }

  const uniqueByAddress = [];
  const seenAddr = new Set();
  for (const row of rows) {
    if (seenAddr.has(row.address)) continue;
    uniqueByAddress.push(row);
    seenAddr.add(row.address);
  }
  return uniqueByAddress;
}

function roleNamesFromFlags(flags = {}) {
  const names = [];
  if (flags.verified_wallet) names.push("Verified Wallet");
  if (flags.token_holder) names.push("WinLEW Holder");
  if (flags.lewcrew_1m) names.push("LewCrew 1M");
  if (flags.lewcrew_10m) names.push("LewCrew 10M");
  if (flags.lewcrew_100m) names.push("LewCrew 100M");
  return names;
}

function summarizeRedemptions(rows = []) {
  const summary = {
    total: 0,
    pending: 0,
    paid: 0,
    failed: 0,
    rejected: 0,
    totalWinlewSent: 0,
    totalPointsRedeemed: 0,
  };
  for (const row of rows) {
    summary.total += 1;
    const status = String(row.status || "pending");
    if (summary[status] === undefined) summary[status] = 0;
    summary[status] += 1;
    summary.totalWinlewSent += Number(row.winlewSent || row.winlewDue || 0);
    summary.totalPointsRedeemed += Number(row.amount || 0);
  }
  summary.totalWinlewSent = Number(summary.totalWinlewSent.toFixed(2));
  return summary;
}

const OAUTH_APPS = {
  // Linked Roles / wallet verification app (The Mole Guard)
  mole: {
    clientId: process.env.MOLE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.MOLE_DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.MOLE_DISCORD_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI,
    label: "The Mole Guard",
    scope: process.env.MOLE_OAUTH_SCOPE || "identify role_connections.write",
  },

  // Utility bot app (WinLEW Utility Bot) - optional second OAuth
  utility: {
    clientId: process.env.UTILITY_DISCORD_CLIENT_ID,
    clientSecret: process.env.UTILITY_DISCORD_CLIENT_SECRET,
    redirectUri: process.env.UTILITY_DISCORD_REDIRECT_URI,
    label: "WinLEW Utility Bot",
    scope: process.env.UTILITY_OAUTH_SCOPE || "identify role_connections.write",
  },
};

function formatWinlew(balance) {
  return Number(balance || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * The caller's session token, wherever it travelled.
 *
 * Preference order is HEADER, then body, then query string — and the query
 * string is last because it is the one we are trying to stop using. Twenty-one
 * routes read `?session=<token>`, which put the token in the address bar, in
 * browser history, in the shared host's access log, and (until it was redacted)
 * in this process's own log file. See src/mole/logRedaction.js and
 * WINLEW_PUBLIC_CONTENT_AUDIT.md #28.
 *
 * The query string is still accepted on purpose. Discord's /mole link hands out
 * `/verify/?session=…`, a page may be open in a tab from before a deploy, and
 * an old bookmark should not become a broken login. This reads all three so the
 * transport can change underneath without a flag day.
 */
function sessionFromRequest(req) {
  const header = req?.headers?.["x-winlew-session"];
  return String(header || req?.body?.session || req?.query?.session || "").trim();
}

function isDiscordActivityDocumentRequest(req) {
  const path = String(req?.path || "");
  return /^(?:\/mole-hub(?:\/(?:index\.html)?)?)$/i.test(path);
}

/**
 * What an OAuth callback says when it was reached WITHOUT an authorization code.
 *
 * WHY THIS EXISTS. Both callbacks used to answer `400 Missing code` — two words
 * on a blank page. On 2026-08-21 the owner opened the X callback URL directly to
 * test it, got exactly that, and reasonably read it as the integration being
 * broken and a credential being absent. It was neither: a callback URL is not a
 * page, and a direct visit has no `?code=` because only the provider's redirect
 * puts one there.
 *
 * Two genuinely different arrivals land here and must not read the same:
 *   - `?error=access_denied` — the person pressed Cancel on the consent screen.
 *     That is a decision, not a fault, and nothing should look alarming.
 *   - nothing at all — someone typed the URL in. Say what the URL is for and
 *     point at the control that actually starts the flow.
 *
 * Plain HTML with an inline <style>: `script-src 'self'` blocks inline script
 * (see the redirect-stub note elsewhere in this file), while `style-src` does
 * allow 'unsafe-inline', so styling is safe here and scripting is not.
 */
function oauthCallbackLanding(res, { provider, query, startedFrom = "/verify/profile.html" }) {
  const label = provider === "x" ? "X" : "Discord";
  const declined = String(query?.error || "");

  const heading = declined
    ? `${label} sign-in was cancelled`
    : `This is ${label}'s callback URL, not a page`;
  const body = declined
    ? `Nothing was changed and nothing was shared. You can start again whenever you like.`
    : `Nothing is wrong. This address is where ${label} sends you back after you approve the `
      + `connection, and it only works with the one-time code ${label} attaches to it. Opening it `
      + `directly means there is no code to read.`;
  const hint = declined
    ? ""
    : `<p class="hint">To actually start the sync: connect your wallet, then use `
      + `<strong>Sync account</strong> in the header — or the ${label} button on your profile.</p>`;

  // 400 for a bare visit (the request really is malformed); 200 for a decline,
  // which is a completed round trip whose answer happened to be "no".
  res.status(declined ? 200 : 400).type("html").send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex">`
    + `<title>${heading}</title><style>`
    + `body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;`
    + `background:#130b08;color:#f4f5f8;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}`
    + `main{max-width:520px}h1{font-size:21px;margin:0 0 12px}p{margin:0 0 12px;color:#d7dae3}`
    + `.hint{color:#c7ccd8;font-size:14.5px}`
    + `a{display:inline-block;margin-top:8px;padding:10px 16px;border-radius:10px;`
    + `background:linear-gradient(180deg,rgba(214,168,102,.34),rgba(125,88,55,.32));`
    + `border:1px solid rgba(214,168,102,.55);color:#fff;font-weight:900;text-decoration:none}`
    + `</style></head><body><main>`
    + `<h1>${heading}</h1><p>${body}</p>${hint}`
    + `<a href="${startedFrom}">Back to your profile</a>`
    + `</main></body></html>`,
  );
}

/**
 * Hand a freshly minted session back to the browser that STARTED the flow —
 * and to no other browser.
 *
 * THE PROBLEM. A session token is a bearer credential, and these callbacks used
 * to put one straight into the address bar: `/verify/?session=<token>`.
 * wallet-auth's getAuth() adopts a `?session=` from ANY url on ANY page, so
 * anyone who could get someone to open a crafted link had that person's browser
 * running as THEIR account. The victim then plays, claims, and connects a
 * wallet — all of it accruing to the attacker's account, whose payout wallet
 * the attacker controls. The URL-scrub test has said in as many words since it
 * was written that "whoever holds it inside its life can link THEIR wallet to
 * the account"; scrubbing removed it from the bar, not from the threat.
 *
 * THE FIX is the exchange this codebase already uses for the mobile wrapper
 * (nativeHandoff.js), run in the direction that closes the gap that module
 * documents as residual. There, the id is invented first and a race can deposit
 * into it. Here the browser registers the HASH of its secret before the round
 * trip starts, so by the time a handoff id exists it is already bound: an
 * attacker who mails their own `?handoff=` link to a victim gives them an id
 * they cannot redeem, because the secret never left the attacker's tab — and
 * redeeming it themselves only logs them into their own account.
 *
 * No claim hash (an older cached nav.js, or a flow Discord started itself) ->
 * the previous `?session=` behaviour, so nothing that works today stops
 * working. That fallback is the remaining exposure and is named in
 * A.i-Talks/, not hidden here.
 */
function handoffRedirect(res, { base, session, appKey = "mole", claimHash = null, extra = {} }) {
  res.setHeader("Cache-Control", "no-store");
  if (claimHash) {
    try {
      const { handoffId } = startNativeHandoff({ claimHash });
      depositNativeHandoff({ handoffId, session });
      return res.redirect(302, buildUiUrl(base, { ...extra, handoff: handoffId, app: appKey }));
    } catch (error) {
      // A handoff that cannot be created must not strand someone mid-sign-in.
      console.warn("[oauth] handoff failed, falling back to a URL session:", error?.message || error);
    }
  }
  // FALLBACK LANDS ON /verify/, NOT WHERE THEY STARTED — deliberately.
  //
  // A URL-borne session is only honoured by wallet-auth on /verify/ now (see
  // ACCEPT_URL_SESSION_PATHS there). Sending an unbound session to an arbitrary
  // return path would hand over a token the receiving page refuses to read, and
  // strand the person signed out on the page they started from. Landing on
  // /verify/ costs a stale client the return-to-where-you-were nicety and keeps
  // them signed in, which is the right trade.
  return res.redirect(302, buildUiUrl(
    cfg.VERIFY_UI_URL || `${cfg.SITE_BASE_URL}/verify/`, { ...extra, session, app: appKey },
  ));
}

function buildHelmetOptions(cfg, { activityEmbed = false } = {}) {
  return {
    // Some devtools extensions inject scripts; CSP will block them (good).
    // Keep this enabled; only loosen if you must.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: activityEmbed ? ["'self'", "https://cdn.jsdelivr.net"] : ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://api.qrserver.com", "https://cdn.discordapp.com"],
        connectSrc: [
          "'self'",
          "https://discord.com",
          "https://*.discord.com",
          "https://solana-rpc.publicnode.com",
          "https://api.mainnet-beta.solana.com",
          "https://api.devnet.solana.com",
          ...(cfg.SOLANA_RPC ? [cfg.SOLANA_RPC] : []),
        ],
        frameAncestors: activityEmbed
          ? ["'self'", "https://discord.com", "https://*.discord.com"]
          : ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: activityEmbed ? false : { action: "sameorigin" },
  };
}

function getOAuthApp(appKey) {
  const app = OAUTH_APPS[appKey];
  if (!app) throw new Error(`unknown_oauth_app:${appKey}`);
  if (!app.clientId || !app.clientSecret || !app.redirectUri) {
    throw new Error(`oauth_app_incomplete:${appKey}`);
  }
  return app;
}
async function putRoleConnectionWithRetry(accessToken, appId, payload, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await putRoleConnection(accessToken, appId, payload);
    } catch (e) {
      const msg = String(e?.message || e);

      if (msg.includes("put_role_connection_failed:429:")) {
        const jsonPart = msg.split("put_role_connection_failed:429:")[1];
        let retryAfterMs = 5000;

        try {
          const j = JSON.parse(jsonPart);
          retryAfterMs = Math.ceil((Number(j.retry_after) || 5) * 1000) + 250;
        } catch {}

        if (attempt === maxRetries) throw e;
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }

      throw e;
    }
  }
}
/**
 * OAuth token helpers that support multiple Discord apps.
 * (Avoids tying token exchange/refresh to a single DISCORD_CLIENT_ID/SECRET in discordApi.js)
 */
async function exchangeCodeForTokenWithApp(code, app, { includeRedirectUri = true } = {}) {
  const body = new URLSearchParams();
  body.set("client_id", app.clientId);
  body.set("client_secret", app.clientSecret);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  if (includeRedirectUri) body.set("redirect_uri", app.redirectUri);

  const r = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: "bad_json", raw: text }; }

  if (!r.ok) throw new Error(`oauth_token_exchange_failed:${r.status}:${json?.error || text}`);
  return json;
}

async function refreshTokenWithApp(refresh_token, app) {
  const body = new URLSearchParams();
  body.set("client_id", app.clientId);
  body.set("client_secret", app.clientSecret);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refresh_token);

  const r = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: "bad_json", raw: text }; }

  if (!r.ok) throw new Error(`oauth_refresh_failed:${r.status}:${json?.error || text}`);
  return json;
}

/** Namespace token storage by OAuth app so Mole + Utility can coexist for the same Discord user */
function tokenKey(appKey, userId) {
  return `${appKey}:${userId}`;
}


function rolesFromFlags(flags) {
  const roles = ["Verified Wallet"];
  if (flags.token_holder) roles.push("WinLEW Holder");
  if (flags.lewcrew_1m) roles.push("LewCrew 1M");
  if (flags.lewcrew_10m) roles.push("LewCrew 10M");
  if (flags.lewcrew_100m) roles.push("LewCrew 100M");
  return roles;
}
  async function postWebhook(url, payload) {
  if (!url) return { ok: true, skipped: true };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return { ok: false, error: `webhook_failed:${r.status}:${text}` };
  }
  return { ok: true };
}
function isDiscordWebhookUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.hostname === "discord.com" && u.pathname.includes("/api/webhooks/");
  } catch {
    return false;
  }
}

function buildVerificationWebhookPayload({ appKey, userId, wallet, balance, flags, roles }) {
  const safeFlags = {
    verified_wallet: true,
    token_holder: !!flags?.token_holder,
    lewcrew_1m: !!flags?.lewcrew_1m,
    lewcrew_10m: !!flags?.lewcrew_10m,
    lewcrew_100m: !!flags?.lewcrew_100m,
  };

  return {
    app: String(appKey || "mole"),
    discordUserId: String(userId || ""),
    wallet: String(wallet || ""),
    balance: Number(balance || 0),
    winlew_balance: String(Math.floor(Number(balance || 0))),
    verified_wallet: safeFlags.verified_wallet,
    token_holder: safeFlags.token_holder,
    lewcrew_1m: safeFlags.lewcrew_1m,
    lewcrew_10m: safeFlags.lewcrew_10m,
    lewcrew_100m: safeFlags.lewcrew_100m,
    roles,
    roles_csv: Array.isArray(roles) ? roles.join(", ") : "",
    flags_json: JSON.stringify(safeFlags),
    ts: Date.now(),
  };
}

async function sendVerificationMessage({ webhookUrl, userId, wallet, roles, balance }) {
  if (!webhookUrl || !isDiscordWebhookUrl(webhookUrl)) return;

  const prettyBalance = formatWinlew(balance);

  const content = `✅ **Wallet Verified**
👤 <@${userId}>
💼 Wallet: \`${wallet}\`
💰 Balance: **${prettyBalance} WinLEW**
🎖 Roles Unlocked:
${roles.map(r => `• ${r}`).join("\n")}`;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

// Governance v1 hardening (2026-07-17 security audit): submission `title`/
// `category`/`summary` are user-supplied free text, unlike every other
// interpolated value in this file's webhook messages (Discord user ids,
// wallet addresses, balances — all server-resolved, never user text). A
// submitter could otherwise embed "@everyone"/"@here"/a role mention in
// their own free text and have it actually fire the moment this posts to
// Discord. `allowed_mentions.parse: []` blocks every mention category by
// default; `users: [discordUserId]` explicitly re-allows ONLY the one
// legitimate, system-controlled credit-the-submitter mention below — never
// anything the free-text fields could inject.
// Low-level shared sender (2026-07-28) — every governance webhook message
// (submission, vote, status review) goes through this one function so the
// Discord-only guard, error handling, and allowed_mentions shape can never
// drift between call sites. sendGovernanceSubmissionMessage() below keeps
// its own pre-existing signature (webhookUrl passed in explicitly) rather
// than switching to read GOVERNANCE_WEBHOOK_URL internally, since
// test/mole/governanceSubmissionWebhook.test.mjs already exercises that
// exact contract (including a `webhookUrl: undefined` no-op case) — this is
// a pure internal refactor, not a behavior change for that function.
async function postGovernanceWebhook(webhookUrl, content, { mentionUserId } = {}) {
  if (!webhookUrl || !isDiscordWebhookUrl(webhookUrl)) return;
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: mentionUserId ? { parse: [], users: [String(mentionUserId)] } : { parse: [] },
      }),
    });
    if (!r.ok) console.warn("[governance] webhook failed:", r.status, await r.text().catch(() => ""));
  } catch (err) {
    console.warn("[governance] webhook failed:", err?.message || err);
  }
}

export async function sendGovernanceSubmissionMessage({ webhookUrl, submission }) {
  const content = `📝 **New Governance Proposal Submitted**
👤 <@${submission.discordUserId}>
🏷️ Category: **${submission.category}**
📌 ${submission.title}

${submission.summary}

_Submission only — this is a reviewable draft, not a live vote. A maintainer reviews it before anything is published to /governance/._`;

  return postGovernanceWebhook(webhookUrl, content, { mentionUserId: submission.discordUserId });
}

// New governance-webhook events (2026-07-28) — vote cast and maintainer
// status review, the two action types that previously produced no Discord
// notification at all. Both read GOVERNANCE_WEBHOOK_URL directly (unlike
// sendGovernanceSubmissionMessage, these have no pre-existing test contract
// to preserve) and prefix every message with a consistent Watchdog-branded
// lead-in — see the plan's decision to post from the mole process (which
// already has governance data, wallet-link, and webhook access) rather than
// building new cross-process plumbing into the separate Watchdog bot.
const GOVERNANCE_WEBHOOK_LEAD_IN = "🛡️ **Watchdog** —";

// `choice` is accepted but deliberately NOT posted (2026-07-31). This
// message used to include "Choice: **for**", which made every vote public
// in the governance channel and quietly contradicted governanceData.js's
// voteChoicePrivacy ("private-until-never") and the aggregate-only rule
// computeResults() enforces. Announcing that a vote happened keeps the
// activity signal; announcing how it was cast is the part that had to go.
// The parameter stays in the signature so existing call sites don't need
// touching and nothing silently starts passing it somewhere else.
export async function sendGovernanceVoteMessage({ proposal, discordUserId }) {
  const webhookUrl = getConfig().GOVERNANCE_WEBHOOK_URL;
  const content = `${GOVERNANCE_WEBHOOK_LEAD_IN} 🗳️ A vote was cast on **${proposal.title}**
👤 <@${discordUserId}>

_How each person votes is private. Only aggregate results are ever published — see /governance/._`;
  return postGovernanceWebhook(webhookUrl, content, { mentionUserId: discordUserId });
}

export async function sendGovernanceReviewMessage({ submission, toStatus, byDiscordUserId, reason }) {
  const webhookUrl = getConfig().GOVERNANCE_WEBHOOK_URL;
  const content = `${GOVERNANCE_WEBHOOK_LEAD_IN} 🔍 Submission **${submission.title}** moved to **${toStatus}**
👤 Reviewed by <@${byDiscordUserId}>${reason ? `\n📋 Reason: ${reason}` : ""}`;
  // No free-text submitter content is interpolated here (title is the only
  // submission-authored field, already broadcast unguarded in the original
  // submission message above) and `reason`/`toStatus` are maintainer-
  // authored — no mention-injection surface from an untrusted party.
  return postGovernanceWebhook(webhookUrl, content, { mentionUserId: byDiscordUserId });
}

// Contribution system logging (2026-07-19) — every discordUserId/wallet/
// cause value here is server-resolved (never raw user text), so unlike
// sendGovernanceSubmissionMessage() above this doesn't need an
// allowed_mentions restriction for injection safety; `message` (an error
// string) could in principle come from a wallet/RPC response, so it's
// still never used to build a mention. Reuses the same already-configured
// "the-logs" channel webhook the game-payout worker posts to — see
// config.js's GAME_PAYOUT_LOG_WEBHOOK_URL.
async function sendContributionLogMessage(content) {
  const webhookUrl = getConfig().GAME_PAYOUT_LOG_WEBHOOK_URL;
  if (!webhookUrl || !isDiscordWebhookUrl(webhookUrl)) return;
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
    if (!r.ok) console.warn("[contribute] log webhook failed:", r.status, await r.text().catch(() => ""));
  } catch (err) {
    console.warn("[contribute] log webhook failed:", err?.message || err);
  }
}


function normalizeUrlBase(url) {
  return String(url || "").replace(/\/+$/, "");
}

function buildUiUrl(base, query = {}) {
  const url = new URL(normalizeUrlBase(base) + "/");
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function getAllowedOrigins(cfg) {
  return String(cfg.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function htmlPage(title, body) {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b0b10;color:#eaeaf2;padding:24px}
  .card{max-width:900px;margin:0 auto;background:#141420;border:1px solid #2a2a44;border-radius:16px;padding:20px}
  a,code{color:#9aa4ff}
  input,textarea{width:100%;padding:10px;border-radius:10px;border:1px solid #2a2a44;background:#0f0f18;color:#eaeaf2}
  button{padding:10px 14px;border-radius:10px;border:0;background:#7c5cff;color:white;font-weight:700;cursor:pointer}
  button:disabled{opacity:.6;cursor:not-allowed}
  .muted{opacity:.85}
  .ok{color:#55f0a5}
  .bad{color:#ff6b8a}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:720px){.row{grid-template-columns:1fr}}
</style></head><body><div class="card">${body}</div></body></html>`;
}

// NOTE FOR ANYTHING RENDERED ON THIS ORIGIN. Discord's registered redirect_uri
// points at the BACKEND origin (the ngrok host), not winlew.co, so any HTML
// this process sends back from an OAuth callback is served from the tunnel
// domain. A relative "/" or "/images/…" therefore resolves against ngrok and
// strands the visitor on the raw backend host (found 2026-07-31).
//
// brandedBotRedirectPage() used to solve that by making every link absolute.
// It was deleted on 2026-08-15 once the callback became a straight 302 — there
// is no page to fix if no page renders. htmlPage() below is still reachable
// from the OAuth error branch and the 404/500 handlers; it carries no links,
// which is the only reason it is safe. Add one and this bites again.

function roleBool(v) {
  return v ? "1" : "0";
}

function integerString(v) {
  return String(Math.floor(Number(v || 0)));
}

function toDiscordMetadata(flags, balance) {
  return {
    verified_wallet: roleBool(true),
    token_holder: roleBool(!!flags.token_holder),
    lewcrew_1m: roleBool(!!flags.lewcrew_1m),
    lewcrew_10m: roleBool(!!flags.lewcrew_10m),
    winlew_balance: integerString(balance),
  };
}

function toUtilityMetadata(flags, balance) {
  return {
    verified_wallet: roleBool(true),
    token_holder: roleBool(!!flags.token_holder),
    lewcrew_1m: roleBool(!!flags.lewcrew_1m),
    lewcrew_10m: roleBool(!!flags.lewcrew_10m),
    winlew_balance: integerString(balance),
  };
}



/**
 * Shared secret the winlew.co PHP proxy presents to have its client-IP claim
 * believed. Unset means proxied visitors share one bucket — safe, just coarse.
 * See clientIp.js for why the header can't simply be trusted.
 */
const WEB_PROXY_SHARED_SECRET = String(process.env.WEB_PROXY_SHARED_SECRET || "").trim();

/** Tiny in-memory rate limiter (no extra deps) */
function simpleRateLimit({ windowMs = 15_000, max = 30 } = {}) {
  const hits = new Map();
  let tick = 0;

  return (req, res, next) => {
    const clientKey = resolveClientKey({
      reqIp: req.ip,
      headers: req.headers,
      secret: WEB_PROXY_SHARED_SECRET,
    });
    const key = `${clientKey}:${req.path}`;
    const now = Date.now();

    // Periodic cleanup to avoid unbounded memory growth
    tick += 1;
    if (tick % 200 === 0) {
      for (const [k, v] of hits) {
        if (now > v.reset) hits.delete(k);
      }
      // Cap size defensively (delete oldest entries)
      const MAX_KEYS = 20000;
      while (hits.size > MAX_KEYS) {
        const oldestKey = hits.keys().next().value;
        hits.delete(oldestKey);
      }
    }

    const entry = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }

    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    next();
  };
}

/**
 * Wallet-only sign-in burst detection, and the IP denylist it feeds.
 *
 * Ported from the serving machine's branch (2026-08-16), where it was written
 * against the live attack while it was happening. It REPLACED an earlier guard
 * on this machine that counted only first-time profile creations and answered
 * 429. This version is strictly better on both axes:
 *
 *   * it counts DISTINCT WALLETS as well as total events, so the 01:19 pattern
 *     (one wallet signing in ten times) and the 01:35 pattern (ten different
 *     wallets in a minute) both trip it, and
 *   * it auto-bans the client IP for 24h instead of refusing one request, so
 *     the next 18 sign-ins never reach the handler at all.
 *
 * The TTL matters: a permanent auto-ban from a heuristic would eventually
 * catch a shared NAT or a café, and nobody would ever go back and clear it.
 */
const BLOCKED_IP_LOG_THROTTLE_MS = 30_000;
const blockedIpLogTimes = new Map();
// Env-tunable, because the right threshold is a judgement call that may need
// changing without a deploy — and because it is now paired with a six-month
// ban, so the cost of tightening it too far is real.
const WALLET_ONLY_BURST_WINDOW_MS = Math.max(60_000, Number(process.env.WALLET_BURST_WINDOW_MS) || 10 * 60_000);
const WALLET_ONLY_BURST_MAX_EVENTS = Math.max(2, Number(process.env.WALLET_BURST_MAX_EVENTS) || 12);
// Lowered 6 -> 3 on 2026-08-16, at the owner's call, after the guard's first
// real catch fired at exactly 6 distinct wallets — i.e. it worked, but only
// after twice as much had already happened as needed to be sure.
//
// Read this together with the escalation: three anonymous wallets from one
// address now costs six months. Three people in a house, or a phone and a
// laptop behind one NAT, produce the same shape as one person scripting. That
// is why every refusal carries the appeal route, and why this is an env var.
const WALLET_ONLY_BURST_MAX_DISTINCT_WALLETS = Math.max(2, Number(process.env.WALLET_BURST_MAX_WALLETS) || 3);

// One account per person: a wallet with no Discord account behind it must log
// in before it can connect.
//
// DEFAULT FLIPPED TO OFF, 2026-08-20, SAME DAY IT SHIPPED. Enabled by default,
// this refused real people all day with no reachable way to comply: there is no
// "Sign in with Discord" control anywhere in the site's navigation, so the
// remedy the refusal names cannot be found by the person reading it. The owner
// reported it plainly — "I dont even SEE WHERE ONE CAN LOGIN AT" — and every
// refusal in that state is a lost user.
//
// The rule is not withdrawn, it is sequenced behind its prerequisite. Turn it
// back on with HUB_REQUIRE_LOGIN_BEFORE_CONNECT=true once a visible sign-in
// path exists. Shipping a gate before the door it points at is the mistake
// here, not the gate.
const HUB_REQUIRE_LOGIN_BEFORE_CONNECT =
  String(process.env.HUB_REQUIRE_LOGIN_BEFORE_CONNECT ?? "false").trim().toLowerCase() === "true";
// Ban DURATION is no longer decided here. It comes from the escalation policy
// in src/shared/ipDenylist.js (6 months first offence, permanent on the
// second), so a second call site cannot hand a repeat offender 24 hours.
const walletOnlyBurstTracker = new Map();

/** Throttled so a banned client hammering one path cannot flood the log. */
function logBlockedIp(clientKey, path) {
  const now = Date.now();
  const key = `${clientKey}:${path}`;
  const last = blockedIpLogTimes.get(key) || 0;
  if (now - last < BLOCKED_IP_LOG_THROTTLE_MS) return;
  blockedIpLogTimes.set(key, now);
  console.warn(`[security] blocked denied IP ${clientKey} on ${path}`);
}

function recordWalletOnlyLogin(clientKey, wallet) {
  const now = Date.now();
  const cutoff = now - WALLET_ONLY_BURST_WINDOW_MS;
  const existing = walletOnlyBurstTracker.get(clientKey) || [];
  const next = existing.filter((entry) => entry.at >= cutoff);
  next.push({ wallet, at: now });
  walletOnlyBurstTracker.set(clientKey, next);

  const distinctWallets = new Set(next.map((entry) => entry.wallet)).size;
  const totalEvents = next.length;
  const triggered = totalEvents >= WALLET_ONLY_BURST_MAX_EVENTS || distinctWallets >= WALLET_ONLY_BURST_MAX_DISTINCT_WALLETS;

  return { totalEvents, distinctWallets, triggered };
}

async function pushRoleConnection(appKey, discordUserId) {
  const cfg = getConfig();
  const wallet = getLinkedWallet(discordUserId);
  if (!wallet) return { ok: false, error: "no_linked_wallet" };

  const tokens = getUserTokensForApp(appKey, discordUserId);
  if (!tokens) return { ok: false, error: "no_oauth_tokens" };

  let access_token = tokens.access_token;
  const now = Math.floor(Date.now() / 1000);

  if (tokens.expires_at && Number(tokens.expires_at) <= now + 30) {
    if (!tokens.refresh_token) return { ok: false, error: "no_refresh_token" };

    const oauth = getOAuthApp(appKey);
    const t = await refreshTokenWithApp(tokens.refresh_token, oauth);
    const expires_at = now + Number(t.expires_in || 0);

    setUserTokensForApp(appKey, discordUserId, {
      access_token: t.access_token,
      token_type: t.token_type,
      refresh_token: t.refresh_token || tokens.refresh_token,
      expires_at,
      scope: t.scope || tokens.scope,
      app: appKey,
    });

    access_token = t.access_token;
  }
  // (keep your refresh logic here, updating access_token)

  let balance = 0;
  let flags = {};
  let metadata = {};

  if (appKey === "utility") {
    // Utility can still compute flags using balance (if you want Token Holder etc)
    balance = await getSplBalance(wallet.trim(), cfg.WINLEW_MINT);
    flags = computeLewcrewFlags(balance);

    // IMPORTANT: must match Utility app's metadata schema + requirements
    metadata = toUtilityMetadata(flags, balance);
 // <= keep to 5 keys, values "true"/"false"
  } else {
    balance = await getSplBalance(wallet.trim(), cfg.WINLEW_MINT);
    flags = computeLewcrewFlags(balance);

    // IMPORTANT: must match Mole app schema (<= 5 keys)
    metadata = toDiscordMetadata(flags, balance);
  }

const payload = {
  platform_name: "WinLEW",
  platform_username: wallet.trim(),
  metadata,
};

const oauth = getOAuthApp(appKey);

// FINAL SAFETY NET: Discord role-connection metadata must be an INTEGER
payload.metadata.winlew_balance = integerString(payload.metadata.winlew_balance);

console.log("ROLE CONNECTION PAYLOAD:", JSON.stringify(payload, null, 2));
console.log(`[role-connection] pushing app=${appKey} discordUserId=${discordUserId} wallet=${wallet.trim()} metadataKeys=${Object.keys(payload.metadata).join(',')}`);
const roleConnectionResponse = await putRoleConnectionWithRetry(access_token, oauth.clientId, payload);
console.log('[role-connection] success:', JSON.stringify({
  app: appKey,
  discordUserId: String(discordUserId),
  wallet: wallet.trim(),
  sent_metadata: payload.metadata,
  response: {
    ok: true,
    platform_name: roleConnectionResponse?.platform_name || payload.platform_name,
    platform_username: roleConnectionResponse?.platform_username || payload.platform_username,
    metadata_keys: Object.keys(roleConnectionResponse?.metadata || payload.metadata || {}),
  },
}, null, 2));

return {
  ok: true,
  wallet,
  balance,
  flags,
  roleConnectionResponse,
  last_verified: Math.floor(Date.now() / 1000),
};

}


function avatarUrlForUser(user = {}) {
  if (!user?.id || !user?.avatar) return "/images/mole-dirt-square.png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
}

async function getDiscordProfileForUser(appKey, discordUserId) {
  const tokens = getUserTokensForApp(appKey, discordUserId);
  if (!tokens?.access_token) return null;
  try {
    return await discordMe(tokens.access_token);
  } catch {
    return null;
  }
}

async function getLiveHoldingsSnapshot(wallet) {
  const cfg = getConfig();
  const walletStr = String(wallet || "").trim();
  if (!walletStr) {
    return {
      wallet: null,
      balance: null,
      flags: { verified_wallet: false, token_holder: false, lewcrew_1m: false, lewcrew_10m: false, lewcrew_100m: false },
      roles: [],
      error: null,
    };
  }

  try {
    const balance = await getSplBalance(walletStr, cfg.WINLEW_MINT);
    const live = computeLewcrewFlags(balance);
    const flags = {
      verified_wallet: true,
      token_holder: !!live.token_holder,
      lewcrew_1m: !!live.lewcrew_1m,
      lewcrew_10m: !!live.lewcrew_10m,
      lewcrew_100m: !!live.lewcrew_100m,
    };
    return {
      wallet: walletStr,
      balance: Number(balance || 0),
      flags,
      roles: roleNamesFromFlags(flags),
      error: null,
    };
  } catch (error) {
    const flags = {
      verified_wallet: !!walletStr,
      token_holder: false,
      lewcrew_1m: false,
      lewcrew_10m: false,
      lewcrew_100m: false,
    };
    return {
      wallet: walletStr,
      balance: null,
      flags,
      roles: roleNamesFromFlags(flags),
      error: error?.message || "balance_unavailable",
    };
  }
}

// Cooldown/claim-timing comes from the v3 claim store (src/faucet/claimStore.js)
// — the actual source of truth both the Discord and web faucet adapters
// write to via claimFaucet() (see src/faucet/service.js). The old
// faucet_claims.json (v2) is only read once at boot for a one-time migration
// (see migrateLegacyV2IfNeeded in claimStore.js) and is never written to again after
// that, so deriving live cooldown status from it would silently go stale
// for any claim made since the migration — a real bug found and fixed while
// building the Version 2.2 dashboard's faucet cooldown display, not a new
// feature. linkedWallet/registeredForAirdrops are unrelated to claim timing
// and still come from their existing sources.
async function buildFaucetSnapshot(discordUserId, walletRows = []) {
  const walletLinks = readJsonFileSafe(FAUCET_WALLET_LINKS_PATH, { version: 1, links: {} });
  const registrations = readJsonFileSafe(FAUCET_REGISTRATIONS_PATH, []);
  const userId = String(discordUserId || "");
  const linked = walletLinks?.links?.[userId] || null;
  const knownWallets = Array.isArray(walletRows) ? walletRows.map((row) => row.address).filter(Boolean) : [];
  const registeredWallets = Array.isArray(registrations)
    ? registrations.filter((address) => knownWallets.includes(String(address || "").trim()))
    : [];

  // On a real getStatusForUser failure (e.g. a Mongo outage), reporting
  // `blocked: false` here would silently claim the faucet is ready when we
  // genuinely don't know — worse than reporting nothing, since it could
  // lead someone to expect a claim to succeed. `cooldownStatusOk: false`
  // lets the dashboard show an honest "unavailable" state for this one
  // field instead (the actual claim endpoint re-checks eligibility
  // authoritatively regardless, so this only affects what's displayed).
  const statusResult = await getFaucetStatusForUser(userId)
    .then((data) => ({ ok: true, data }))
    .catch((err) => {
      console.warn("[dashboard] faucet cooldown status unavailable:", err?.message || err);
      return { ok: false, data: { blocked: false, nextEligibleAt: null, lastClaim: null } };
    });
  const status = statusResult.data;
  const lastClaimMs = Number(status.lastClaim?.createdAt || 0);
  const nextClaimMs = Number(status.nextEligibleAt || 0);
  const cooldownMs = Number(status.lastClaim?.cooldownMs || 24 * 60 * 60 * 1000);
  const readyInMs = status.blocked && nextClaimMs ? Math.max(0, nextClaimMs - Date.now()) : 0;

  return {
    linkedWallet: linked?.address || null,
    linkedSource: linked?.source || null,
    lastClaimAtUser: formatIso(lastClaimMs),
    lastClaimAtWallet: formatIso(lastClaimMs),
    lastClaimWallet: status.lastClaim?.wallet || null,
    nextClaimAt: nextClaimMs ? formatIso(nextClaimMs) : null,
    cooldownMs,
    readyInMs,
    cooldownReady: !status.blocked,
    cooldownStatusOk: statusResult.ok,
    registeredForAirdrops: registeredWallets.length > 0,
    registeredWallets,
  };
}

function buildQuizSnapshot(discordUserId) {
  const userId = String(discordUserId || "");
  const user = quizDb.getUser(userId);
  const currentCycle = quizDb.getCurrentCycle();
  const cycleId = currentCycle?.id || null;
  const currentCyclePoints = cycleId ? Number(quizDb.getUserCyclePoints(userId, cycleId) || 0) : 0;
  const currentCycleUnpaidPoints = cycleId ? Number(quizDb.getCycleOutstandingPoints(userId, cycleId) || 0) : 0;
  const estimatedCyclePayout = Number(quizDb.estimateWinlewForPoints(currentCycleUnpaidPoints) || 0);
  const eligibleLeaderboardPoints = Number(quizDb.getLeaderboardEligiblePoints(userId) || 0);
  const redemptions = quizDb.listRedemptions(userId) || [];
  const payoutSummary = summarizeRedemptions(redemptions);
  const questionsThisCycle = Number(user?.cycleQuestions?.[cycleId] || 0);
  const sponsorBreakdown = Object.entries(user?.sponsor || {})
    .map(([sponsor, points]) => ({ sponsor, points: Number(points || 0) }))
    .sort((a, b) => b.points - a.points);

  // Accuracy/streak come from the per-platform buckets (src/quiz/platform-stats.js),
  // which only started tracking as of that feature shipping — see the
  // "Pre-existing users..." comment in src/quiz/db.js. `trackedAnswers`
  // being 0 for a long-time player is expected, not a bug: it means
  // "nothing tracked since platform-stats shipped," not "never played."
  // accuracy is null (not 0) in that case so the dashboard can render an
  // honest "not enough tracked data" state instead of a fabricated 0%.
  const platforms = quizDb.getUserPlatformStats(userId);
  const trackedCorrect = Number(platforms?.discord?.correct || 0) + Number(platforms?.web?.correct || 0);
  const trackedAnswers = Number(platforms?.discord?.total || 0) + Number(platforms?.web?.total || 0);
  const accuracy = trackedAnswers > 0 ? trackedCorrect / trackedAnswers : null;
  const currentStreak = Math.max(Number(platforms?.discord?.currentStreak || 0), Number(platforms?.web?.currentStreak || 0));
  const bestStreak = Math.max(Number(platforms?.discord?.bestStreak || 0), Number(platforms?.web?.bestStreak || 0));
  const rank = quizDb.getUserRank(userId);

  return {
    lifetimePoints: Number(user?.lifetimePoints || 0),
    unpaidPoints: Number(user?.unpaidPoints ?? user?.points ?? 0),
    redeemedPoints: Number(user?.redeemed || 0),
    questionWins: Number(user?.questionWins || user?.questions || 0),
    sponsorQuestionWins: Number(user?.sponsorQuestionWins || 0),
    regularQuestionWins: Number(user?.regularQuestionWins || 0),
    cyclesPlayed: Number(user?.cyclesPlayed || 0),
    questionsThisCycle,
    sponsorBreakdown,
    trackedAnswers,
    trackedCorrect,
    accuracy,
    currentStreak,
    bestStreak,
    rank,
    currentCycle: {
      id: cycleId,
      startMs: Number(currentCycle?.startMs || 0),
      endMs: Number(currentCycle?.endMs || 0),
      startAt: formatIso(currentCycle?.startMs || 0),
      endAt: formatIso(currentCycle?.endMs || 0),
      points: currentCyclePoints,
      unpaidPoints: currentCycleUnpaidPoints,
      estimatedPayout: estimatedCyclePayout,
    },
    payouts: {
      ...payoutSummary,
      eligibleLeaderboardPoints,
      estimatedLeaderboardPayout: Number(quizDb.estimateWinlewForPoints(eligibleLeaderboardPoints) || 0),
      recent: redemptions.slice(0, 10),
    },
  };
}

function buildWalletSnapshot(linked, prefs = {}, faucetSnapshot = null) {
  const walletRows = knownWalletRowsFromRecord(linked, prefs, faucetSnapshot?.linkedWallet ? {
    address: faucetSnapshot.linkedWallet,
    source: faucetSnapshot.linkedSource || "faucet",
  } : null);

  const primaryVerified = walletRows.find((row) => row.kind === "verified")?.address || linked?.wallets?.verified?.address || linked?.last_verified_wallet || null;
  const primaryPayout = walletRows.find((row) => row.kind === "payout")?.address || linked?.wallets?.payout?.address || null;
  const primaryFaucet = walletRows.find((row) => row.kind === "faucet")?.address || linked?.wallets?.faucet?.address || faucetSnapshot?.linkedWallet || null;
  const fallback = primaryVerified || primaryPayout || primaryFaucet || prefs.wallet || null;

  return {
    primaryWallet: fallback,
    verifiedWallet: primaryVerified,
    faucetWallet: primaryFaucet,
    payoutWallet: primaryPayout,
    lastVerifiedWallet: linked?.last_verified_wallet || primaryVerified || null,
    knownWallets: walletRows,
  };
}

// ── Governance Module v1/v1.1 eligibility ─────────────────────────────────
// Top-level (not route-scoped) so both the /api/governance/* routes and
// buildProfilePayload()'s Dashboard governance section share this exact
// function — one eligibility implementation, not two. Mirrors the pattern
// already established for the Dashboard/Burn Center: a session resolves a
// Discord user id, which resolves a verified-linked-wallet record (never a
// client-supplied wallet), whose live balance is checked via the same
// getOwnerTokenSnapshot() every other live-balance feature already uses. A
// 60s per-wallet cache avoids hammering RPC on every proposal-list /
// eligibility / vote / dashboard-load request, matching the Burn Center's
// own _burnCache pattern.
//
// v1.1: `getBalance` is accepted as an injectable override (defaulting to
// the real getOwnerTokenSnapshot import) purely so tests and the
// fault-injection walkthrough can force a deterministic RPC failure without
// touching real Solana RPC or pointing production at a fake endpoint — see
// test/mole/governanceRpcFailure.test.mjs. It is never overridden outside
// tests; every real request uses the default.
const _governanceEligibilityCache = new Map(); // wallet -> { expiresAt, result }
const GOVERNANCE_ELIGIBILITY_CACHE_MS = 60_000;

export async function checkLiveWinlewEligibility(walletAddress, { getBalance = getOwnerTokenSnapshot } = {}) {
  const cached = _governanceEligibilityCache.get(walletAddress);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let result;
  try {
    const snapshot = await getBalance(walletAddress, { signatureLimit: 1 });
    const balance = Number(snapshot.winlewBalance || 0);
    const eligible = balance >= GOVERNANCE_CONFIG.minWinlewToVote;
    result = { eligible, reason: eligible ? "eligible" : "below_minimum_balance", wallet: walletAddress, balance, balanceCheckOk: true };
  } catch (error) {
    // A failed RPC lookup must never collapse into "not eligible" — that
    // would be a false negative indistinguishable from a real holder being
    // excluded. Surface it as "temporarily unavailable" instead. The raw
    // error is logged server-side only — never sent to the client (no
    // stack trace, no RPC URL, no secret).
    console.warn("[governance] eligibility balance check failed:", error?.message || error);
    // v1.1: never cache a failure. Caching it alongside successes for the
    // full TTL would mean a retry shortly after a real outage clears still
    // returns the stale "unavailable" result instead of a fresh check —
    // undermining the "retry succeeds once the fault clears" guarantee.
    return { eligible: null, reason: "balance_check_unavailable", wallet: walletAddress, balance: null, balanceCheckOk: false };
  }
  _governanceEligibilityCache.set(walletAddress, { expiresAt: Date.now() + GOVERNANCE_ELIGIBILITY_CACHE_MS, result });
  return result;
}

// `proposal` is optional — omitted (e.g. the Dashboard's generic summary,
// which isn't tied to one specific vote) this always returns a live,
// non-binding preview. Provided, eligibility is resolved against that
// proposal's snapshot boundary via governanceSnapshot.js — see
// docs/governance-v1.1-hardening.md for exactly what that does and does
// not guarantee.
export async function resolveGovernanceEligibility(discordUserId, proposal = null, { getBalance } = {}) {
  const linked = getLinkedWalletRecord(discordUserId);
  const verification = getWalletVerificationStatus(linked);
  if (!verification.verified || !verification.wallet) {
    return { eligible: false, reason: "wallet_not_verified", wallet: verification.wallet || null, balance: null, balanceCheckOk: true, preview: true, snapshot: null };
  }

  const wallet = verification.wallet;

  // ELIGIBILITY IS THE PERSON'S, THE KEY IS STILL ONE WALLET (2026-08-20).
  //
  // The threshold is measured against everything this identity has verified —
  // someone holding 1,200,000 across three wallets holds 1,200,000. The
  // snapshot and the vote stay keyed by the nominated wallet, because
  // governanceSnapshot.js locks a balance per key and castVote() now enforces
  // one vote per person, so one identity produces exactly one key.
  //
  // The extra reads only happen when the nominated wallet falls short AND
  // there is somewhere else to look, so the ordinary case costs nothing new.
  const checkLiveEligibility = async (w) => {
    const single = await checkLiveWinlewEligibility(w, { getBalance });
    if (single.eligible === true) return single;

    const others = listVerifiedWallets(linked).filter((entry) => entry.wallet !== w);
    if (!others.length) return single;

    const readBalance = getBalance
      ? async (address) => Number((await getBalance(address, { signatureLimit: 1 }))?.winlewBalance || 0)
      : undefined;
    const holdings = await getIdentityHoldings(linked, { getBalance: readBalance });
    const clears = meetsThreshold(holdings, GOVERNANCE_CONFIG.minWinlewToVote);

    if (clears === true) {
      return {
        eligible: true,
        reason: "eligible",
        wallet: w,
        balance: holdings.total,
        balanceCheckOk: true,
        countedWallets: holdings.counted,
      };
    }
    // `null` means the total fell short but part of it could not be read. That
    // is not a refusal — it is the same false-negative this function already
    // refuses to produce for a failed RPC call.
    if (clears === null) {
      return { eligible: null, reason: "balance_check_unavailable", wallet: w, balance: null, balanceCheckOk: false };
    }
    return { ...single, balance: holdings.total, countedWallets: holdings.counted };
  };

  if (!proposal) {
    const live = await checkLiveEligibility(wallet);
    return { ...live, preview: true, snapshot: null };
  }

  return resolveSnapshotEligibility({ proposal, walletAddress: wallet, checkLiveEligibility });
}

// Capped pay-per-vote weight (2026-07-28) — shared by the eligibility/
// my-vote read routes (preview only, never writes) and the vote-casting
// route (allocate=true, locks the allocation in). Fails soft: if pricing
// isn't available yet (e.g. no price samples recorded in the last 3 days —
// possible right after a fresh deploy) or the mint supply can't be read,
// purchased weight is just 0 rather than blocking the free vote entirely.
// Exported (2026-07-31) so the Discord /mole vote command reuses this exact
// implementation — one allocate:true call site per surface, never a fork.
export async function resolveVoteWeightInfo(discordUserId, proposalId, { allocate = false, balance = null } = {}) {
  const fallback = { purchasedWeight: 0, maxWeight: MAX_PURCHASED_VOTES_PER_PROPOSAL, usdPerVote: USD_PER_VOTE, pricingAvailable: false, winlewPerVote: null };
  // 2026-08-06 split gate: the free vote needs only a verified wallet with a
  // real balance, but BUYING weight on top needs minWinlewToPurchaseVotes.
  //
  // `balance` is passed in from the eligibility result the caller already
  // resolved rather than re-read here. Two reasons: it avoids a second RPC on
  // every vote, and — more importantly — eligibility is snapshot-locked per
  // proposal (governanceSnapshot.js), so re-reading live would let someone
  // whose snapshot says one thing buy weight against a different, later
  // balance. Weight must be decided on the same number eligibility was.
  //
  // Fails CLOSED: a caller that supplies no balance gets no purchased weight.
  // The free vote is unaffected either way, so the failure mode is "your vote
  // still counts once", never "your vote is refused".
  const purchaseFloor = Number(GOVERNANCE_CONFIG.minWinlewToPurchaseVotes) || 0;
  const heldBalance = Number(balance);
  const mayPurchase = Number.isFinite(heldBalance) && heldBalance >= purchaseFloor;
  if (!mayPurchase) {
    return { ...fallback, purchaseFloor, mayPurchase: false };
  }
  try {
    const [contributionSummary, mint] = await Promise.all([
      getUserContributionSummary(discordUserId),
      getMintSnapshot().catch(() => null),
    ]);
    const totalContributedWinlew = Number(contributionSummary?.byCause?.governance || 0);
    const supply = Number(mint?.supply);
    if (!(supply > 0)) return fallback;

    const pricing = getVotePriceInWinlew({ supply });
    if (!pricing.ok) return fallback;

    const fn = allocate ? allocateVoteWeight : previewPurchasedWeight;
    const result = fn(discordUserId, proposalId, { totalContributedWinlew, winlewPerVote: pricing.winlewPerVote });
    return {
      purchasedWeight: result.purchasedWeight,
      maxWeight: MAX_PURCHASED_VOTES_PER_PROPOSAL,
      usdPerVote: USD_PER_VOTE,
      pricingAvailable: true,
      winlewPerVote: pricing.winlewPerVote,
      totalContributedWinlew,
      purchaseFloor,
      mayPurchase: true,
    };
  } catch (err) {
    console.warn("[governance] resolveVoteWeightInfo failed, defaulting to 0 purchased weight:", err?.message || err);
    return { ...fallback, purchaseFloor, mayPurchase };
  }
}

// v1.1 — maintainer auth for the proposal-submission review queue. Reuses
// MOD_IDS (.env), the exact same Discord-id allowlist src/faucet/bot.js's
// MOD_ID_LIST already gates its own moderator-only commands with, rather
// than inventing a second admin mechanism. This is Discord-identity-based,
// not wallet-based — a maintainer reviews as themselves, not as a holder.
function isGovernanceMaintainer(discordUserId) {
  const ids = String(process.env.MOD_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  return ids.includes(String(discordUserId || ""));
}

function buildGovernanceSnapshot(votesByProposal) {
  const now = Date.now();
  const active = PROPOSALS.filter((p) => VOTABLE_STATUSES.includes(p.status));
  const closingSoon = active
    .filter((p) => p.votingEndIso)
    .filter((p) => Date.parse(p.votingEndIso) - now < 3 * 24 * 60 * 60 * 1000)
    .sort((a, b) => Date.parse(a.votingEndIso) - Date.parse(b.votingEndIso));
  const recentlyCompleted = PROPOSALS
    .filter((p) => !VOTABLE_STATUSES.includes(p.status))
    .sort((a, b) => Date.parse(b.lastUpdatedIso || 0) - Date.parse(a.lastUpdatedIso || 0))
    .slice(0, 5);

  const myVotes = [];
  for (const proposal of PROPOSALS) {
    const vote = votesByProposal?.[proposal.id];
    if (vote) myVotes.push({ proposalId: proposal.id, title: proposal.title, choice: vote.choice, updatedAtIso: vote.updatedAtIso });
  }

  return {
    activeCount: active.length,
    votableProposals: active.map((p) => ({ id: p.id, title: p.title, category: p.category, votingEndIso: p.votingEndIso })),
    closingSoon: closingSoon.map((p) => ({ id: p.id, title: p.title, votingEndIso: p.votingEndIso })),
    recentlyCompleted: recentlyCompleted.map((p) => ({ id: p.id, title: p.title, status: p.status, lastUpdatedIso: p.lastUpdatedIso })),
    myVotes,
  };
}

// Version 2.2 Unified Dashboard: buildProfilePayload() IS the dashboard
// payload — /verify/profile.html was evolved into the dashboard rather than
// building a second route/payload (see docs/unified-dashboard.md for why).
//
// The independent subsystem reads below run concurrently via Promise.all
// instead of one-at-a-time. This used to be five sequential awaits (Discord
// profile, game history, game summary, then a Proof of Value call that
// internally re-fetched faucet+game data all over again) — exactly the
// latency problem the dashboard's performance requirements call out.
// getDiscordProfileForUser/getLiveHoldingsSnapshot/listRewardClaims/
// getRewardSummary already degrade safely on their own (never throw, never
// fake a zero on failure — see their own definitions). getClaimHistoryForUser
// is the one call here that can genuinely reject (a real Mongo failure), so
// it's the only one wrapped in a .catch(), converting a rejection into an
// honest {ok:false} instead of letting it take down every other section of
// the dashboard with it.
async function buildProfilePayload(appKey, discordUserId) {
  const linked = getLinkedWalletRecord(discordUserId);
  const prefs = getProfilePrefsByUser(discordUserId) || {};
  const provisionalWallets = buildWalletSnapshot(linked, prefs, null);

  // SNS (.sol domain) resolution for every wallet address this payload might
  // show (primary + Known Wallets list) — best-effort, cosmetic, so it runs
  // CONCURRENTLY with the main Promise.all below rather than after it (never
  // adds sequential latency to a dashboard load). Uses provisionalWallets'
  // addresses since faucet data essentially never changes which wallets are
  // known, only enriches their metadata — see buildWalletSnapshot(). Each
  // lookup is independently timeout-bounded (src/mole/solana.js's
  // resolveWalletSnsName, 3s) and never throws.
  const addressesToResolveSns = [...new Set(
    [provisionalWallets.primaryWallet, ...provisionalWallets.knownWallets.map((w) => w.address)].filter(Boolean)
  )];
  const snsLookup = Promise.all(
    addressesToResolveSns.map(async (addr) => [addr, await resolveWalletSnsName(addr)])
  ).then((pairs) => Object.fromEntries(pairs.filter(([, name]) => name)));

  const [discord, faucet, gameHistory, gameSummary, faucetHistoryResult, snsByAddress] = await Promise.all([
    getDiscordProfileForUser(appKey, discordUserId),
    buildFaucetSnapshot(discordUserId, provisionalWallets.knownWallets),
    listRewardClaims(discordUserId, 50),
    getRewardSummary(discordUserId),
    getClaimHistoryForUser(discordUserId)
      .then((data) => ({ ok: true, data }))
      .catch((err) => {
        console.warn("[dashboard] faucet claim history unavailable:", err?.message || err);
        return { ok: false, error: err?.message || String(err) };
      }),
    snsLookup,
  ]);

  const wallets = buildWalletSnapshot(linked, prefs, faucet);
  wallets.primaryWalletSnsName = snsByAddress[wallets.primaryWallet] || null;
  wallets.knownWallets = wallets.knownWallets.map((w) => ({ ...w, snsName: snsByAddress[w.address] || null }));
  const verification = getWalletVerificationStatus(linked);
  if (!verification.wallet && wallets.primaryWallet) verification.wallet = wallets.primaryWallet;
  const holdings = await getLiveHoldingsSnapshot(wallets.verifiedWallet || wallets.primaryWallet);

  // WHAT THE PERSON HOLDS, not what the connected wallet holds (2026-08-20).
  //
  // `holdings.balance` stays exactly what it was — the nominated wallet — so
  // nothing reading it changes meaning. `holdings.identity` is the sum across
  // every wallet this account has verified, which is the number the dashboard
  // shows and the one the LewCrew tiers are computed from.
  //
  // Flags are only ever RAISED here. A partial read (one wallet's RPC call
  // failed) understates the total, so upgrading on it is safe while
  // downgrading on it is not — see meetsThreshold() in identityHoldings.js.
  try {
    const identity = await getIdentityHoldings(linked);
    const identityTotal = Number(identity.total || 0);
    holdings.identity = {
      total: identityTotal,
      partial: identity.partial,
      counted: identity.counted,
      unreadable: identity.unreadable,
      wallets: identity.wallets,
    };
    if (identityTotal > Number(holdings.balance || 0)) {
      const wider = computeLewcrewFlags(identityTotal);
      holdings.flags = {
        ...holdings.flags,
        token_holder: holdings.flags.token_holder || !!wider.token_holder,
        lewcrew_1m: holdings.flags.lewcrew_1m || !!wider.lewcrew_1m,
        lewcrew_10m: holdings.flags.lewcrew_10m || !!wider.lewcrew_10m,
        lewcrew_100m: holdings.flags.lewcrew_100m || !!wider.lewcrew_100m,
      };
      holdings.roles = roleNamesFromFlags(holdings.flags);
    }
  } catch (error) {
    // Best-effort, like every other panel on this page: the single-wallet
    // figure above is still correct and still renders.
    console.warn("[dashboard] identity holdings unavailable:", error?.message || error);
    holdings.identity = { total: null, partial: true, error: error?.message || "identity_holdings_unavailable", wallets: [] };
  }
  const quiz = buildQuizSnapshot(discordUserId);
  const geoAgora = emptyGeoAgoraSnapshot();

  // Governance v1 — concise Dashboard summary only (never the full
  // Governance page's worth of detail — see docs/governance-v1.md /
  // Deliverable 12). Reuses the exact eligibility function the
  // /api/governance/* routes use; never re-implements it.
  let governance;
  try {
    const govEligibility = await resolveGovernanceEligibility(discordUserId);
    const votesByProposal = {};
    if (govEligibility.wallet) {
      for (const proposal of PROPOSALS) {
        const vote = getWalletVote(proposal.id, govEligibility.wallet);
        if (vote) votesByProposal[proposal.id] = vote;
      }
    }
    governance = {
      ok: true,
      eligible: govEligibility.eligible,
      eligibilityReason: govEligibility.reason,
      ...buildGovernanceSnapshot(votesByProposal),
    };
  } catch (err) {
    console.warn("[dashboard] governance snapshot failed:", err?.message || err);
    governance = { ok: false, error: err?.message || String(err) };
  }

  // Version 2.1 Proof of Value — informational only, never touches any
  // payout-eligible field. Computed here via combineProofOfValue() directly
  // (the same pure scoring function 2.1 shipped, untouched) instead of the
  // getProofOfValueScore() convenience wrapper, so it can reuse the
  // faucetHistory/gameSummary already fetched above rather than fetching
  // them a second time. Best-effort: a failure degrades to `ok:false`
  // instead of throwing (same honest pattern as the Transparency Center).
  // If the faucet fetch failed, PoV and milestones report unavailable
  // rather than silently scoring the faucet component as zero.
  let proofOfValue;
  let milestones;
  if (!faucetHistoryResult.ok) {
    proofOfValue = { ok: false, error: faucetHistoryResult.error };
    milestones = { ok: false, error: faucetHistoryResult.error };
  } else {
    try {
      const quizSignals = quizSignalsForUser(discordUserId);
      const faucetSignals = {
        confirmedClaims: faucetHistoryResult.data.confirmedCount,
        totalClaims: faucetHistoryResult.data.count,
        lastClaimAt: faucetHistoryResult.data.lastConfirmedAt,
        totalConfirmedAmount: faucetHistoryResult.data.totalConfirmedAmount,
      };
      const verificationSignals = {
        verified: verification.verified,
        wallet: verification.wallet,
        verifiedAt: verification.verified_at,
        expiresAt: verification.expires_at,
      };
      const povResult = combineProofOfValue({
        quiz: quizSignals,
        faucet: faucetSignals,
        games: { totalClaims: gameSummary.totalClaims, totalPayout: gameSummary.totalPayout },
        verification: verificationSignals,
      });
      proofOfValue = { ok: true, ...povResult };
      const contributionSummary = await getUserContributionSummary(discordUserId).catch((err) => {
        console.warn("[dashboard] contribution summary failed:", err?.message || err);
        return { total: 0 };
      });
      milestones = {
        ok: true,
        items: computeMilestones({
          verified: verification.verified,
          questionWins: quiz.questionWins,
          quizLifetimePoints: quiz.lifetimePoints,
          faucetConfirmedClaims: faucetSignals.confirmedClaims,
          gameTotalClaims: gameSummary.totalClaims,
          povTier: povResult.tier,
          povScore: povResult.score,
          hasContributed: Number(contributionSummary.total || 0) > 0,
        }),
      };
    } catch (err) {
      console.warn("[dashboard] proof-of-value/milestones computation failed:", err?.message || err);
      proofOfValue = { ok: false, error: err?.message || String(err) };
      milestones = { ok: false, error: err?.message || String(err) };
    }
  }

  // Version 2.3 — "why come back tomorrow?" signals, entirely derived from
  // data already fetched above (faucet claim history, game history, the
  // just-computed PoV score/milestones). No new queries, no new scoring.
  // Quiz has no per-answer timestamp log, so there is no honest "quiz
  // points this week" figure to compute — see participation.js's own
  // comment on why that's deliberately left out rather than estimated.
  let participation;
  try {
    const faucetClaims = faucetHistoryResult.ok ? faucetHistoryResult.data.claims : [];
    participation = {
      ok: true,
      // faucetDataOk mirrors faucetHistoryResult.ok: if that fetch failed,
      // a 0-day streak / 0-claim week here would be a false answer, not a
      // real one, so the dashboard must show "unavailable" for these two
      // fields specifically rather than a fabricated zero.
      faucetDataOk: faucetHistoryResult.ok,
      faucetStreak: computeFaucetStreak(faucetClaims),
      weeklySummary: buildWeeklySummary({ faucetClaims, gameHistory }),
      quizCurrentStreak: quiz.currentStreak,
      povTierProgress: proofOfValue.ok ? tierProgress(proofOfValue.score) : null,
      nextMilestone: milestones.ok ? closestUnachievedMilestone(milestones.items) : null,
    };
  } catch (err) {
    console.warn("[dashboard] participation signals failed:", err?.message || err);
    participation = { ok: false, error: err?.message || String(err) };
  }

  // Recent activity is a best-effort merge of existing records (faucet
  // claims, game rewards, quiz redemptions) — see docs/unified-dashboard.md
  // for why this isn't a true unified event log. It degrades independently
  // of PoV/milestones: a faucet outage just means faucet items are missing
  // from the feed, not that the whole feed disappears.
  let recentActivity;
  try {
    recentActivity = {
      ok: true,
      ...buildRecentActivity({
        faucetClaims: faucetHistoryResult.ok ? faucetHistoryResult.data.claims : [],
        gameHistory,
        quizRedemptions: quiz.payouts.recent,
      }),
    };
  } catch (err) {
    console.warn("[dashboard] recent-activity build failed:", err?.message || err);
    recentActivity = { ok: false, error: err?.message || String(err) };
  }

  const profile = {
    discordUserId: String(discordUserId),
    app: appKey,
    displayName: prefs.displayName || discord?.global_name || discord?.username || `User ${discordUserId}`,
    username: discord?.username || null,
    globalName: discord?.global_name || null,
    avatarUrl: prefs.avatarUrl || avatarUrlForUser(discord || {}) || "/images/mole-dirt-square.png",
    bio: prefs.bio || "",
    wallet: wallets.primaryWallet,
    lastVerified: linked?.updatedAt || linked?.updated_at || formatIso(linked?.linked_at || 0) || null,
    editable: true,
    saveMode: "signed_wallet_update",
  };

  return {
    generatedAt: new Date().toISOString(),
    profile,
    verification,
    wallets,
    holdings,
    discord: {
      username: discord?.username || null,
      globalName: discord?.global_name || null,
      linkedRoleFlags: holdings.flags,
      displayRoles: holdings.roles,
    },
    // confirmedClaims/totalConfirmedAmount come from the same claim-history
    // fetch used for Proof of Value above — surfaced here too so the
    // dashboard's faucet card can show "how many"/"how much" without a
    // second fetch. historyOk is false only if that fetch itself failed
    // (never silently shown as 0 in that case — see faucetHistoryResult).
    faucet: {
      ...faucet,
      confirmedClaims: faucetHistoryResult.ok ? faucetHistoryResult.data.confirmedCount : null,
      totalConfirmedAmount: faucetHistoryResult.ok ? faucetHistoryResult.data.totalConfirmedAmount : null,
      historyOk: faucetHistoryResult.ok,
    },
    quiz,
    games: {
      history: gameHistory,
      summary: gameSummary,
    },
    geoAgora,
    proofOfValue,
    milestones,
    recentActivity,
    participation,
    governance,
  };
}

function normalizeProfileInput(input = {}) {
  return {
    displayName: String(input.displayName || "").trim().slice(0, 60),
    bio: String(input.bio || "").trim().slice(0, 280),
    avatarUrl: String(input.avatarUrl || "").trim().slice(0, 500),
  };
}


export async function startWeb() {
  const cfg = getConfig();
  const app = express();

  // Reward-validation safety guard (2026-07-19 audit). `shadow` mode makes the
  // anti-cheat caps log-only, so a forged baseReward is banked and paid in
  // full — it must never be running unnoticed in production. resolveRewardMode
  // already downgrades an unacknowledged shadow to clamp; this makes whatever
  // happened impossible to miss in the boot log (and pings the-logs channel).
  const rewardMode = resolveRewardMode();
  if (rewardMode.requested === "shadow" && !rewardMode.acknowledged) {
    const msg =
      "REWARD_VALIDATION_MODE=shadow was requested but is UNSAFE (caps are log-only, forged " +
      "payouts bank in full). It has been OVERRIDDEN to `clamp`. To deliberately run shadow " +
      "for a monitored rollout, also set REWARD_ALLOW_SHADOW=true.";
    console.error(`\n${"=".repeat(72)}\n⛔ SECURITY: ${msg}\n${"=".repeat(72)}\n`);
    void sendContributionLogMessage(`⛔ **Reward mode guard** — ${msg}`);
  } else if (rewardMode.effective === "shadow") {
    const msg =
      "REWARD_VALIDATION_MODE=shadow is ACTIVE (acknowledged via REWARD_ALLOW_SHADOW). " +
      "Reward caps are LOG-ONLY — forged/oversized game payouts will bank and be PAID. " +
      "Only run this during a deliberate, monitored rollout window, then switch back to `clamp`.";
    console.error(`\n${"=".repeat(72)}\n🚨 SECURITY: ${msg}\n${"=".repeat(72)}\n`);
    void sendContributionLogMessage(`🚨 **Reward mode = SHADOW (payouts UNPROTECTED)** — ${msg}`);
  } else {
    console.log(`[rewards] validation mode: ${rewardMode.effective} (safe)`);
  }

  app.disable("x-powered-by");
  // NOT `true`. `true` trusts the leftmost X-Forwarded-For entry, and since the
  // ngrok origin is publicly reachable anyone could set that header and mint a
  // fresh rate-limit budget per request. This trusts only the hop that opened
  // the socket (the local ngrok agent), so req.ip is the address the tunnel
  // itself observed. See clientIp.js.
  const trustProxy = trustedProxySetting(process.env.WEB_TRUSTED_PROXY_IPS);
  app.set("trust proxy", trustProxy);
  if (!WEB_PROXY_SHARED_SECRET) {
    console.warn(
      "[security] WEB_PROXY_SHARED_SECRET is unset — requests arriving through " +
        "winlew.co/verify/api-proxy.php all share one rate-limit bucket (the shared " +
        "host's IP). Set the same value here and on the proxy for per-visitor limits."
    );
  }

  const allowedOrigins = getAllowedOrigins(cfg);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
  
});
  // IP denylist. Sits ahead of helmet and every route so a banned client is
  // refused before it can touch a handler, a rate-limit bucket, or the RPC.
  //
  // Fails OPEN on a lookup error: this is a heuristic ban list, and taking the
  // whole site down because a JSON read hiccuped would be a far worse outcome
  // than briefly missing one blocked IP. That is the opposite of the PAYOUT
  // gate's stance (payoutGate.js fails closed) and the difference is money:
  // letting a banned IP browse costs nothing, paying a banned wallet is
  // irreversible.
  app.use((req, res, next) => {
    const clientKey = resolveClientKey({
      reqIp: req.ip,
      headers: req.headers,
      secret: WEB_PROXY_SHARED_SECRET,
    });

    checkIpBan(clientKey)
      .then(({ blocked, ban }) => {
        if (!blocked) {
          next();
          return;
        }
        logBlockedIp(clientKey, req.path);
        res.status(403).json({
          error: "ip_blocked",
          until: ban?.expiresAt || null,
        });
      })
      .catch((error) => {
        console.warn("[security] IP denylist check failed:", error?.message || error);
        next();
      });
  });

  /** Helmet, with a Discord-embeddable variant for the Activity document only. */
  const defaultSecurityHeaders = helmet(buildHelmetOptions(cfg));
  const activitySecurityHeaders = helmet(buildHelmetOptions(cfg, { activityEmbed: true }));
  app.use((req, res, next) => {
    const useActivityHeaders = cfg.DISCORD_ACTIVITY_ENABLED && isDiscordActivityDocumentRequest(req);
    return (useActivityHeaders ? activitySecurityHeaders : defaultSecurityHeaders)(req, res, next);
  });

  // Redact credentials from the logged URL before morgan sees it. Twenty-plus
  // authenticated GET routes take ?session=<token>, and pm2 writes stdout to
  // logs/*.out.log — so this was writing live session tokens to disk on every
  // authenticated GET. See src/mole/logRedaction.js.
  installMorganRedaction(morgan);
  app.use(morgan("dev"));

  /** Static: MUST be cwd-agnostic */
  /**
   * REDIRECT STUBS, SERVER-SIDE, so the query survives.
   *
   * ESTABLISHED BY MEASUREMENT, not by reading. Each of these paths is a static
   * HTML stub whose inline script builds `<target> + location.search`. Those
   * scripts are correct and have NEVER RUN: the site sends `script-src 'self'`,
   * so the browser refuses them —
   *
   *   "Executing inline script violates the following Content Security Policy
   *    directive 'script-src 'self''."
   *
   * — and the `<meta http-equiv="refresh">` beneath each one has been doing
   * every redirect. A meta refresh carries a fixed URL and cannot forward a
   * query, so any link with one has always arrived stripped.
   *
   * The tell was timing: the browser navigated ~1s after load, matching the
   * meta delay, not instantly as a script would. Two earlier attempts at this —
   * reordering the tags, then delaying the meta — changed nothing and were
   * reverted, because the script was never executing at all.
   *
   * SCOPE IS DELIBERATE. Only the stubs that actually TRY to preserve a query
   * are listed: 11 of the 31 under src/public. The other 20 redirect to a fixed
   * destination with nothing to carry, and their meta refresh does that
   * correctly — including /geoagora/ and /geohackers/, whose stubs exist as a
   * deliberate lockdown of raw app paths and are not worth disturbing to fix a
   * bug they do not have.
   *
   * The static files stay in place. They still carry their noindex/canonical
   * tags if this route is ever removed, and nothing here deletes a fallback.
   *
   * MOUNTED BEFORE express.static — verified, because it is invisible in review
   * and fatal: registered after it, the stub FILE answers first (200, not 302)
   * and the route never runs at all.
   */
  const STUB_REDIRECTS = {
    "/profile": "/verify/profile.html",
    "/profile/": "/verify/profile.html",
    "/profile.html": "/verify/profile.html",
    "/discord-index.html": "/discord-bots/",
    "/privacy.html": "/discord-bots/privacy.html",
    "/privacy-mole.html": "/discord-bots/privacy-mole.html",
    "/privacy-utility.html": "/discord-bots/privacy-utility.html",
    "/privacy-watchdog.html": "/discord-bots/privacy-watchdog.html",
    "/terms.html": "/discord-bots/terms.html",
    "/terms-mole.html": "/discord-bots/terms-mole.html",
    "/terms-utility.html": "/discord-bots/terms-utility.html",
    "/terms-watchdog.html": "/discord-bots/terms-watchdog.html",
  };

  for (const [stub, target] of Object.entries(STUB_REDIRECTS)) {
    app.get(stub, (req, res) => {
      // The WHOLE query is forwarded rather than an allowlist. Dropping unknown
      // params is exactly how this bug started, and every target here is one of
      // our own pages.
      const qs = new URLSearchParams(req.query).toString();
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, `${target}${qs ? `?${qs}` : ""}`);
    });
  }

  app.use((req, res, next) => {
    if (!isPublicRequestPath(req.path)) return res.status(404).end();
    return next();
  });
  // Keep API liveness ahead of the static health/ directory. Match only the
  // slashless URL so /health/ continues to serve the public status page.
  app.get(/^\/health$/, (_req, res) => res.json({ ok: true }));
  app.use(
    express.static(PUBLIC_DIR, {
      // link.js changes a lot during dev
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("link.js")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    })
  );

  // GeoHackers runs as its own stack on the same PC. WinLEW remains the only
  // ngrok owner and publishes narrow routes to GeoHackers' distinct local ports.
  // These proxies must run before express.json so POST bodies remain streamable.
  const geoHackersApiTarget = String(process.env.GEOHACKERS_API_LOCAL_URL || 'http://127.0.0.1:8791').trim();
  const geoHackersVerifyTarget = String(process.env.GEOHACKERS_VERIFY_LOCAL_URL || 'http://127.0.0.1:8793').trim();
  // GeoHackers may not live on this PC. When either target is remote the Host
  // header must be rewritten to the upstream, or a name-routed backend (a
  // Tailscale funnel, say) is handed WinLEW's ngrok hostname and refuses it.
  const isLoopback = (u) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(u);
  // Only an allowlist of the API reaches the internet; see geohackersApiGuard.js.
  app.use(geoHackersApiGuard());
  app.use(
    '/geohackers-api',
    createProxyMiddleware({
      target: geoHackersApiTarget,
      changeOrigin: !isLoopback(geoHackersApiTarget),
      pathRewrite: { '^/geohackers-api': '' },
      ws: true,
      logLevel: 'warn',
    }),
  );
  app.use(
    '/geohackers-verify',
    createProxyMiddleware({
      target: geoHackersVerifyTarget,
      changeOrigin: !isLoopback(geoHackersVerifyTarget),
      pathRewrite: { '^/geohackers-verify': '' },
      ws: true,
      logLevel: 'warn',
    }),
  );

  app.use(express.json({ limit: "250kb" }));
  // "Sign in with XL1 wallet" (owner 2026-11-21: anyone with a website and an XL1 wallet can play and cash out).
  // Off unless XL1_WALLET_LOGIN_ENABLED=true. One fee-free wallet signature (xl1-login.js) is the login and the proof
  // of the payout wallet. A wallet already verified to Discord through GeoHackers signs into that Discord account;
  // any other wallet gets a wallet-only account "xl1:<address>" (lower daily cap, minimum balance to cash out).
  const xl1Login = createXl1Login({
    audience: process.env.XL1_LOGIN_AUDIENCE || "https://winlew.co/xl1/login",
    loadAccount: loadSdkAccount(process.env.XL1_ACCOUNT_SDK_MODULE),
  });
  const xl1LoginOn = () => process.env.XL1_WALLET_LOGIN_ENABLED === "true";
  const xl1LoginLimit = simpleRateLimit({ windowMs: 60_000, max: 20 });
  app.post("/api/xl1-login/start", xl1LoginLimit, (req, res) => {
    if (!xl1LoginOn()) return res.status(404).json({ error: "not_found" });
    res.setHeader("cache-control", "no-store");
    try { return res.json(xl1Login.start(req.body?.address)); }
    catch (error) { return res.status(400).json({ error: String(error?.message || "xl1_login_failed") }); }
  });
  app.post("/api/xl1-login/complete", xl1LoginLimit, async (req, res) => {
    if (!xl1LoginOn()) return res.status(404).json({ error: "not_found" });
    res.setHeader("cache-control", "no-store");
    try {
      const { address } = await xl1Login.complete({ challengeId: req.body?.challengeId, token: req.body?.token });
      const discordId = await getDiscordIdForXl1Wallet(address);
      const accountId = discordId || xl1AccountId(address);
      const session = createSession(accountId, cfg.DISCORD_ACTIVITY_SESSION_TTL_SEC);
      void logSiteEvent({
        type: "xl1_wallet_signin", icon: "🔑", source: SITE_LOG_SOURCES.WALLET,
        title: discordId ? "Signed in with XL1 wallet (Discord-verified)" : "Signed in with XL1 wallet (wallet-only)",
        fields: { Wallet: `${address.slice(0, 6)}…${address.slice(-4)}`, Tier: discordId ? "full" : "wallet" },
      });
      return res.json({ session, address, tier: discordId ? "full" : "wallet" });
    } catch (error) {
      const code = String(error?.message || "");
      return res.status(code === "xl1_login_unavailable" ? 503 : 401).json({ error: /^xl1_/.test(code) ? code : "xl1_login_failed" });
    }
  });
  registerXL1ArcadeRoutes(app, {
    getIdentity: async (req) => {
      const session = getSession(sessionFromRequest(req));
      return session ? { id: String(session.discordUserId) } : null;
    },
    // A wallet-only account IS its wallet (proven by the sign-in signature); others use the GeoHackers record.
    getVerifiedWallet: async (id) => xl1WalletOf(id) ?? getVerifiedXl1Wallet(id),
    startVerification: makeStartVerification({ base: geoHackersVerifyTarget }),
    rateLimit: simpleRateLimit({ windowMs: 10_000, max: 30 }),
  });
  // Connect XL1 wallet (P2/P3): every route answers 404 unless XL1_CONNECT_ENABLED=true and the
  // account is on the trial allowlist. It grants nothing and the arcade does not read it.
  registerXl1ConnectRoutes(app, {
    getAccountId: (token) => getSession(token)?.discordUserId ?? null,
    getLegacyVerifiedWallet: (id) => getVerifiedXl1Wallet(id).catch(() => null),
    hasXIdentity: (id) => listSyncedIdentities(id).some((s) => s.provider === IDENTITY_PROVIDERS.X),
    startConnect: makeStartConnect({ base: geoHackersVerifyTarget }),
    readJson: readManagedJson,
    writeJson: writeManagedJson,
  });

  // "Claim XL1" on winlew.co/app: GeoHackers' XL1 faucet for a signed-in, verified member. Every route
  // answers 404 unless XL1_FAUCET_WEB_ENABLED=true and GEOHACKERS_FAUCET_CLAIM_TOKEN is set. The wallet
  // is the member's verified XL1 wallet; the amount, cooldown and caps are GeoHackers' /claim.
  registerXl1FaucetRoutes(app, {
    getAccountId: (token) => getSession(token)?.discordUserId ?? null,
    getVerifiedWallet: getVerifiedXl1Wallet,
    rateLimit: simpleRateLimit({ windowMs: 15_000, max: 6 }),
  });

  const geoAgoraApiTarget = String(process.env.GEOAGORA_API_LOCAL_URL || 'http://127.0.0.1:3001').trim();
  app.use(
    '/geoagora-api',
    createProxyMiddleware({
      target: geoAgoraApiTarget,
      changeOrigin: false,
      pathRewrite: { '^/geoagora-api': '' },
      ws: true,
      logLevel: 'warn',
      onProxyReq(proxyReq) {
        proxyReq.setHeader('ngrok-skip-browser-warning', 'true');
      },
    })
  );

  // Keep one ngrok owner. Remote services (including the GeoAgora Discord bot)
  // reach Watchdog through the existing public web tunnel instead of launching
  // a competing ngrok session for port 8790.
  const watchdogLocalUrl = String(process.env.WATCHDOG_LOCAL_URL || 'http://127.0.0.1:8790')
    .trim()
    .replace(/\/+$/, '');

  async function relayWatchdogRequest(req, res, pathname) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const upstream = await fetch(`${watchdogLocalUrl}${pathname}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: String(req.headers.authorization || ''),
        },
        body: JSON.stringify(req.body || {}),
        signal: controller.signal,
      });
      const body = await upstream.text();
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      return res.status(upstream.status).send(body);
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'watchdog_timeout' : 'watchdog_unavailable';
      return res.status(502).json({ error: reason });
    } finally {
      clearTimeout(timeout);
    }
  }

  app.post(
    '/watchdog/heartbeat',
    simpleRateLimit({ windowMs: 10_000, max: 120 }),
    (req, res) => relayWatchdogRequest(req, res, '/heartbeat'),
  );
  app.post(
    '/watchdog/event',
    simpleRateLimit({ windowMs: 10_000, max: 60 }),
    (req, res) => relayWatchdogRequest(req, res, '/event'),
  );


  // Bot-only role sync (no web session required)
  // Body: { secret, userId, app }
  app.post(
    "/api/roles/sync-bot",
    simpleRateLimit({ windowMs: 10_000, max: 20 }),
    async (req, res) => {
      try {
        const { secret, userId, app: appParam } = req.body || {};
        const appKey = String(appParam || "mole");

        // Require secret (prevents random people from syncing others)
        if (!cfg.BOT_SYNC_SECRET) {
          return res.status(500).json({ error: "bot_sync_not_configured" });
        }
        if (!safeEqual(secret, cfg.BOT_SYNC_SECRET)) {
          return res.status(403).json({ error: "forbidden" });
        }

        if (!userId) return res.status(400).json({ error: "missing_userId" });

        const pushed = await pushRoleConnection(appKey, String(userId));
        if (!pushed.ok) return res.status(400).json({ error: pushed.error });

        const guildRoleSync = await syncGuildRolesForUser({
          discordUserId: String(userId),
          wallet: pushed.wallet,
          balance: pushed.balance,
          flags: pushed.flags,
          source: `sync-bot:${appKey}`,
        }).catch((err) => ({ ok: false, error: err?.message || String(err) }));

        return res.json({ ok: true, ...pushed, guild_roles: guildRoleSync });
      } catch (e) {
        console.error("sync-bot error:", e);
        return res.status(500).json({ error: "sync_failed" });
      }
    }
  );


  app.get("/api/discord/activity/config", simpleRateLimit({ windowMs: 10_000, max: 60 }), (_req, res) => {
    if (!cfg.DISCORD_ACTIVITY_ENABLED) {
      return res.json({ ok: true, enabled: false });
    }
    try {
      const oauth = getOAuthApp("mole");
      return res.json({
        ok: true,
        enabled: true,
        app: "mole",
        clientId: oauth.clientId,
        scopes: ["identify"],
      });
    } catch (error) {
      return res.json({
        ok: true,
        enabled: false,
        error: error?.message || "activity_oauth_unavailable",
      });
    }
  });

  app.post("/api/discord/activity/auth", simpleRateLimit({ windowMs: 15_000, max: 40 }), async (req, res) => {
    if (!cfg.DISCORD_ACTIVITY_ENABLED) {
      return res.status(503).json({ error: "discord_activity_disabled" });
    }

    const code = String(req.body?.code || "").trim();
    const appKey = String(req.body?.app || "mole").trim() || "mole";
    if (!code) return res.status(400).json({ error: "missing_code" });

    try {
      const oauth = getOAuthApp(appKey);
      const t = await exchangeCodeForTokenWithApp(code, oauth, { includeRedirectUri: false });
      const now = Math.floor(Date.now() / 1000);
      const expires_at = now + Number(t.expires_in || 0);
      const me = await discordMe(t.access_token);

      setUserTokensForApp(appKey, me.id, {
        access_token: t.access_token,
        token_type: t.token_type,
        refresh_token: t.refresh_token,
        expires_at,
        scope: t.scope,
        app: appKey,
      });

      const verification = getWalletVerificationStatus(getLinkedWalletRecord(me.id));
      const session = createSession(me.id, cfg.DISCORD_ACTIVITY_SESSION_TTL_SEC);

      return res.json({
        ok: true,
        session,
        app: appKey,
        discordUserId: me.id,
        verification,
        warning: walletVerificationWarning(verification),
        access_token: t.access_token,
        expires_at,
        scope: t.scope,
      });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /oauth_token_exchange_failed|discord_me_failed|unknown_oauth_app|oauth_app_incomplete/.test(message) ? 400 : 500;
      return res.status(status).json({ error: message || "discord_activity_auth_failed" });
    }
  });

  /** Linked Roles Verification URL entrypoint: starts OAuth */
  // Linked Roles "Connect account" entrypoint.
  // Supports BOTH:
  //  - /linked-role?app=mole|utility  (backwards compatible)
  //  - /linked-role/mole   /linked-role/utility (Discord Dev Portal Verification URL friendly)
  app.get("/linked-role", (req, res) => {
    const appKey = String(req.query.app || "mole");
    return res.redirect(302, `/linked-role/${encodeURIComponent(appKey)}`);
  });

  app.get("/linked-role/:appKey", (req, res) => {
  const appKey = String(req.params.appKey || "mole");
  const oauth = getOAuthApp(appKey);

  // The return path rides in the OAuth state, which is already a server-side
  // session id — so the client never gets to choose where the callback goes,
  // and the value is validated on the way in AND on the way out.
  const next = safeNextPath(req.query.next);
  // A claim hash turns this into a browser-bound flow (see handoffRedirect).
  // The JSON state form is used only when there is one to carry: the legacy
  // `state:<app>:<next>` string is colon-delimited and a 64-char hash appended
  // to it would be eaten by the `next` parser.
  const claimHash = String(req.query.claimHash || "").trim().toLowerCase();

  // NO CLAIM HASH MEANS DISCORD STARTED THIS, not a page of ours — the "Connect
  // account" button in the Linked Roles panel opens this URL cold. Nothing has
  // run on winlew.co, so no tab holds a secret, and the session would have to
  // come home in the address bar. That one exception is what would keep
  // `?session=` alive site-wide.
  //
  // Bounce to our own origin first and let it mint a claim (see
  // startBoundLinkedRole in wallet-auth.js). It comes straight back here with a
  // hash and proceeds bound. One extra redirect; the exception closes.
  // `b=1` means the browser has already been sent to mint a claim once and has
  // come back without one. A LOOP GUARD, not a nicety: this route and that page
  // point at each other, so if a hash is ever lost in between — a proxy that
  // drops the parameter, an origin with no crypto.subtle — the two would bounce
  // a visitor between them forever. One attempt, then proceed the old way.
  const alreadyBounced = String(req.query.b || "") === "1";
  if (!/^[a-f0-9]{64}$/.test(claimHash) && !alreadyBounced) {
    const base = cfg.VERIFY_UI_URL || `${cfg.SITE_BASE_URL}/verify/`;
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, buildUiUrl(base, { connect: appKey, ...(next ? { next } : {}) }));
  }

  if (!/^[a-f0-9]{64}$/.test(claimHash)) {
    // Unbound, and we have already tried once. The session will come home in
    // the URL to /verify/, which is the one place that still reads one.
    const state = createSession(next ? `state:${appKey}:${next}` : `state:${appKey}`);
    return res.redirect(302, discordAuthorizeUrl(getOAuthApp(appKey), state));
  }

  const state = createSession(encodeSyncState({ appKey, accountId: "", next, mode: "signin", claimHash }));
  return res.redirect(302, discordAuthorizeUrl(oauth, state));
});

/** OAuth callback: store tokens, then link wallet */
  app.get("/discord-oauth-callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code) return oauthCallbackLanding(res, { provider: "discord", query: req.query });

  let appKey = "mole";
  let returnTo = null;
  let syncTarget = null;
  let claimHash = null;
  try {
    const st = getSession(state);
    const raw = st?.discordUserId || "";
    const sync = decodeSyncState(raw);
    if (sync) {
      appKey = sync.appKey;
      returnTo = sync.next;
      // A sign-in state carries no account; only a SYNC names one to attach to.
      syncTarget = sync.mode === "signin" ? null : sync.accountId;
      claimHash = sync.claimHash;
    }
    if (typeof raw === "string" && raw.startsWith("state:")) {
      const parts = raw.split(":");
      appKey = parts[1] || "mole";
      // Re-validated rather than trusted: the value was checked when it was
      // stored, and it is checked again here, because this is the line that
      // actually performs the redirect.
      if (parts.length > 2) returnTo = safeNextPath(parts.slice(2).join(":"));
    }
  } catch {}

  // Allow explicit override as a backup
  if (req.query.app) appKey = String(req.query.app);

  try {
    const oauth = getOAuthApp(appKey);
    const t = await exchangeCodeForTokenWithApp(code, oauth);

    const now = Math.floor(Date.now() / 1000);
    const expires_at = now + Number(t.expires_in || 0);
    const me = await discordMe(t.access_token);

 setUserTokensForApp(appKey, me.id, {
  access_token: t.access_token,
  token_type: t.token_type,
  refresh_token: t.refresh_token,
  expires_at,
  scope: t.scope,
  app: appKey,
});

    // Same TTL as the Discord bot's own /mole verify command (commands.js) —
    // this route is now ALSO reachable directly from a "Verify with Discord"
    // button on /verify/ itself (see link.js), not just Discord's Linked
    // Roles "Verification URL" callback, so both paths into this page should
    // give the user the same session lifetime rather than this one quietly
    // defaulting to createSession()'s much shorter 15-minute fallback.
    // ── SYNC: attach this Discord identity to the account they already have ──
    //
    // Deliberately NOT createSession(me.id). That is what a sign-in does, and
    // doing it here would swap the person out of the wallet-rooted account they
    // were using — losing the session, and with it the very account they were
    // trying to attach an identity to.
    if (syncTarget) {
      const back = returnTo || "/verify/profile.html";
      try {
        const result = syncIdentity({
          accountId: syncTarget,
          provider: IDENTITY_PROVIDERS.DISCORD,
          providerUserId: me.id,
        });
        void logSiteEvent({
          type: "identity_synced", icon: "🔗", source: SITE_LOG_SOURCES.WALLET,
          title: result.changed ? "Discord synced to an account" : "Discord re-synced (no change)",
          discordUserId: me.id,
          fields: { Account: syncTarget, Provider: "discord" },
        });
        res.setHeader("Cache-Control", "no-store");
        return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}${back}`, { synced: "discord" }));
      } catch (error) {
        // ── ALREADY LINKED IS A MERGE, NOT A WALL (2026-08-22) ──────────────
        //
        // This used to be a dead end: "that Discord account is already synced
        // somewhere else", and nothing the person could do about it. But look
        // at what has just been proved in this request — a live session for
        // `syncTarget`, AND a completed Discord OAuth round trip for an
        // identity that roots the other account. One person, two doors. The
        // honest answer is to make them one user, which REMOVES a claim slot
        // rather than creating one.
        //
        // Anything else still refuses, and still names where the identity
        // lives, so a genuine collision keeps the recovery hint it had.
        if (error?.code === "identity_already_synced" && error.linkedTo) {
          try {
            const merged = await mergeAccountsWithRewardGuard({ a: syncTarget, b: error.linkedTo, reason: "discord-oauth" });
            void logSiteEvent({
              type: "accounts_merged", icon: "🧩", source: SITE_LOG_SOURCES.WALLET,
              title: merged.changed ? "Accounts merged (Discord proved both)" : "Discord sync — already one account",
              discordUserId: me.id, wallet: merged.wallets?.payoutWallet || null,
              fields: {
                User: merged.userId,
                Absorbed: merged.absorbed || "—",
                Wallets: String(merged.wallets?.verifiedCount ?? 0),
                Payout: merged.wallets?.payoutWallet || "—",
                Proof: "session + discord oauth",
              },
            });
            res.setHeader("Cache-Control", "no-store");
            return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}${back}`, {
              synced: "discord",
              merged: merged.changed ? "1" : "0",
            }));
          } catch (mergeError) {
            console.warn("[identity] discord merge failed:", mergeError?.message || mergeError);
          }
        }
        const code = error?.code === "identity_already_synced" ? "already_linked" : "sync_failed";
        void logSiteEvent({
          type: "identity_sync_refused", icon: "🚫", source: SITE_LOG_SOURCES.WALLET,
          title: "Discord sync refused",
          discordUserId: me.id,
          fields: { Account: syncTarget, Reason: code, "Already linked to": error?.linkedTo || "—" },
        });
        res.setHeader("Cache-Control", "no-store");
        return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}${back}`, { syncError: code }));
      }
    }

    const session = createSession(me.id, cfg.DISCORD_ACTIVITY_SESSION_TTL_SEC);
    // Back where they started, when they came from somewhere. Someone who hits
    // "Sign in" on /events/ should land on /events/ signed in — bouncing them
    // to /verify/ instead is how a two-click flow starts feeling like a maze.
    const base = returnTo
      ? `${cfg.SITE_BASE_URL}${returnTo}`
      : (cfg.VERIFY_UI_URL || `${cfg.SITE_BASE_URL}/verify/`);

    // This callback used to render a standalone transitional page on the
    // backend origin before sending the user to /verify/. That page is what
    // the user actually sees immediately after approving Discord, so if its
    // styling or copy drifts it feels like the flow is landing on an old site.
    // A direct redirect keeps the whole visible experience on winlew.co.
    return handoffRedirect(res, { base, session, appKey, claimHash });
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .send(htmlPage("Error", `<h2 class="bad">OAuth failed</h2><pre>${String(e)}</pre>`));
  }
});


  // /link was the original wallet-link UI, entirely superseded by /verify/
  // (+ /verify/link.js) once that became the canonical flow — nothing in
  // the codebase links to /link anymore (confirmed by search), and its
  // <script src="/link.js"> dependency was itself deleted as dead code in
  // the Version 1 Unified Authentication cleanup, leaving this route
  // broken. Kept as a redirect rather than removed outright in case an old
  // bookmark or shared link still points here — session/app query params
  // are preserved so it lands in the same working state /verify/ already
  // expects from every other entry point.
  app.get("/link", (req, res) => {
    // Already points at /verify/, which is the one place a URL-borne session is
    // still honoured — so this old bookmark keeps working without widening
    // anything. See handoffRedirect().
    res.redirect(302, buildUiUrl(cfg.VERIFY_UI_URL || `${cfg.SITE_BASE_URL}/verify/`, {
      session: sessionFromRequest(req),
      app: req.query.app,
    }));
  });

  /** Challenge endpoint: support BOTH GET and POST so your frontend can do either */
  const challengeHandler = (req, res) => {
    const sessionToken = sessionFromRequest(req);
    const s = getSession(sessionToken);
    if (!s) return res.status(401).json({ error: "session_expired" });

    const c = issueChallenge(s.discordUserId);
    res.json({ message: c.message, expires_at: c.expires_at });
  };

  // Ends a wallet session for real. The page's idle auto-disconnect calls
  // this before clearing localStorage — dropping the token client-side only
  // hides it from the UI, it stays valid here until TTL, so a token already
  // copied off the machine would keep working. Deliberately unauthenticated
  // beyond presenting the token itself: holding the token IS the credential,
  // and letting someone destroy a session they hold is the safe direction.
  // Always answers ok:true so it can't be used to enumerate valid tokens.
  app.post("/api/session/logout", simpleRateLimit({ windowMs: 10_000, max: 30 }), (req, res) => {
    try {
      revokeSession(sessionFromRequest(req));
    } catch (error) {
      console.warn("[session] logout failed:", error?.message || error);
    }
    return res.json({ ok: true });
  });

  app.get("/api/wallet/challenge", simpleRateLimit({ windowMs: 10_000, max: 25 }), challengeHandler);
  app.post("/api/wallet/challenge", simpleRateLimit({ windowMs: 10_000, max: 25 }), challengeHandler);

  // Lightweight live WinLEW balance for the shared nav's account-area chip
  // (2026-07-18 design-system unification — every non-arcade page now shows
  // a "Points or wallet balance" chip, not just Mole Hub/Quiz). Reuses
  // resolveGovernanceEligibility() with no proposal (a live, non-binding
  // balance lookup for the session's verified wallet) purely for its
  // already-existing 60s-per-wallet cache (checkLiveWinlewEligibility) —
  // no new RPC-calling code, no new cache. Returns balance:null (not 0)
  // when the wallet isn't verified or the RPC check is temporarily down,
  // so the client never shows a fabricated "0.00".
  app.get("/api/wallet/balance", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const result = await resolveGovernanceEligibility(s.discordUserId);
      return res.json({ ok: true, balance: result.balanceCheckOk ? result.balance : null, wallet: result.wallet });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "wallet_balance_failed" });
    }
  });

  // ── Merch shop (/merch/) ─────────────────────────────────────────────────
  // Public config for the merch page: only the PayPal *client id* (safe to
  // expose by design — it's baked into the SDK script URL on every PayPal
  // integration). The PayPal secret must never appear here or anywhere in
  // the frontend; v1 checkout is client-side Smart Buttons only.
  app.get("/api/merch/config", simpleRateLimit({ windowMs: 10_000, max: 40 }), (_req, res) => {
    // `checkoutReady` is deliberately gated on the SECRET, not just the client
    // id. With a client id alone the page could still render PayPal buttons —
    // which is exactly the old client-priced flow this replaced. Better for
    // checkout to say it is unavailable than to be available and insecure.
    const paypal = paypalConfig();
    res.json({
      ok: true,
      paypalClientId: paypal.clientId,
      checkoutReady: paypal.configured,
      paypalEnv: paypal.env,
    });
  });

  // Holder discount: 1% per 1M $WinLEW held, capped at 15% (env-tunable).
  // Server-computed from the session's *verified* wallet via the same cached
  // live-balance lookup the nav chip uses (resolveGovernanceEligibility with
  // no proposal — 60s per-wallet cache, no new RPC path). Applies to the
  // WinLEW-drops section only: XYO items check out on shop.xyo.network,
  // whose prices we don't control. Note v1 PayPal checkout is client-side,
  // so the discounted amount is ultimately client-constructed — this
  // endpoint exists so honest clients all compute the same number and the
  // rule lives in one place; verify order totals in the PayPal dashboard
  // before shipping (documented in MERCH_README.md).
  app.get("/api/merch/discount", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const pctPerMillion = Number(process.env.MERCH_DISCOUNT_PCT_PER_MILLION || 1);
    const capPct = Number(process.env.MERCH_DISCOUNT_CAP_PCT || 15);
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired", discountPct: 0, capPct });
    try {
      const result = await resolveGovernanceEligibility(s.discordUserId);
      const balance = result.balanceCheckOk ? result.balance : null;
      const discountPct = balance == null
        ? 0
        : Math.min(capPct, Math.floor(balance / 1_000_000) * pctPerMillion);
      return res.json({ ok: true, balance, wallet: result.wallet, discountPct, capPct });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "merch_discount_failed", discountPct: 0, capPct });
    }
  });

  // ── Merch checkout (server-priced) ───────────────────────────────────────
  //
  // Register #18. Checkout used to be PayPal Smart Buttons in client-side mode:
  // the BROWSER called actions.order.create() with an amount it computed itself
  // and then captured it itself, so a modified client could pay a cent for a
  // $40 tee and the server never even learned a sale had happened. The
  // documented control was checking every order by hand before shipping.
  //
  // The client now names the PRODUCT and never the PRICE. Everything monetary
  // is derived in src/mole/merchOrders.js from products.json plus the session's
  // own verified holdings, written down before the money moves, and checked
  // against what PayPal actually took.

  /** Resolves the holder discount the same way /api/merch/discount does. */
  async function resolveMerchDiscount(session) {
    const s = getSession(String(session || ""));
    if (!s) return { discountPct: 0, discordUserId: "", wallet: "" };
    try {
      const result = await resolveGovernanceEligibility(s.discordUserId);
      const balance = result.balanceCheckOk ? result.balance : null;
      const pctPerMillion = Number(process.env.MERCH_DISCOUNT_PCT_PER_MILLION || 1);
      const capPct = Number(process.env.MERCH_DISCOUNT_CAP_PCT || 15);
      const discountPct = balance == null
        ? 0
        : Math.min(capPct, Math.floor(balance / 1_000_000) * pctPerMillion);
      return { discountPct, discordUserId: s.discordUserId, wallet: result.wallet || "" };
    } catch {
      // A failed balance lookup means NO discount, never a default one. Failing
      // open here would let an RPC outage become a site-wide sale.
      return { discountPct: 0, discordUserId: s.discordUserId, wallet: "" };
    }
  }

  app.post("/api/merch/order", simpleRateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
    if (!paypalConfig().configured) {
      return res.status(503).json({ ok: false, error: "checkout_not_configured" });
    }
    try {
      const { productId, size, qty, session } = req.body || {};
      const { discountPct, discordUserId, wallet } = await resolveMerchDiscount(session);
      const order = await createMerchOrder({ productId, size, qty, discountPct, discordUserId, wallet });
      // Returns the id and the amount PayPal will show; never accepts either.
      return res.json({ ok: true, id: order.id, amount: (order.totalCents / 100).toFixed(2), currency: order.currency });
    } catch (error) {
      const message = error?.message || "merch_order_failed";
      const clientFault = /unknown_product|product_not_sold_here|product_not_available|invalid_quantity|invalid_size/.test(message);
      return res.status(clientFault ? 400 : 502).json({ ok: false, error: message });
    }
  });

  // Merch capture is the moment money actually moves; the order above only
  // prices a basket. Both are logged, and the capture line carries the
  // mismatch flag so a payment that does not match what we priced is visible
  // in the channel rather than only in a maintainer-only API.
  app.post("/api/merch/capture", simpleRateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
    if (!paypalConfig().configured) {
      return res.status(503).json({ ok: false, error: "checkout_not_configured" });
    }
    try {
      // The moment money actually moves; /api/merch/order above only prices a
      // basket. The mismatch flag is included so a payment that differs from
      // what we priced shows up in the channel, not only in a maintainer API.
      const captured = await captureMerchOrder({ paypalOrderId: req.body?.orderId });
      void logSiteEvent({
        type: "merch_capture", icon: "🛒", source: SITE_LOG_SOURCES.MERCH,
        title: "Merch order captured (payment taken)",
        fields: {
          Order: captured?.orderId || captured?.id,
          Mismatch: captured?.mismatch ? "⚠️ **payment did not match the price we set**" : undefined,
        },
      });
      return res.json(captured);
    } catch (error) {
      const message = error?.message || "merch_capture_failed";
      if (message === "amount_mismatch") {
        // The order is already recorded with mismatch:true, so this is visible
        // to a human even though the buyer only sees a generic failure.
        console.error(`[merch] AMOUNT MISMATCH on order ${req.body?.orderId}: expected ${error.expected}, paid ${error.paid}`);
        return res.status(409).json({ ok: false, error: "amount_mismatch" });
      }
      return res.status(/unknown_order|invalid_order_id/.test(message) ? 400 : 502).json({ ok: false, error: message });
    }
  });

  // ── Which wallet gets paid ───────────────────────────────────────────────
  //
  // An identity can hold several verified wallets (2026-08-20), but money goes
  // to exactly one. Without this route the choice is implicit — the last wallet
  // they verified with — which is fine as a default and poor as the only
  // option, since re-verifying an old wallet would silently move their payouts.
  //
  // setPayoutWallet() refuses any address this account has not verified, so
  // this cannot redirect rewards to a wallet nobody proved they control. The
  // session is the authorisation: the same proof that linked the wallets.
  app.get("/api/wallet/payout", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const record = getLinkedWalletRecord(s.discordUserId);
    return res.json({
      ok: true,
      payoutWallet: getPayoutWallet(record),
      wallets: listVerifiedWallets(record),
    });
  });

  app.post("/api/wallet/payout", simpleRateLimit({ windowMs: 10_000, max: 20 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const wallet = setPayoutWallet({ discordUserId: s.discordUserId, wallet: req.body?.wallet });
      void logSiteEvent({
        type: "payout_wallet_selected", icon: "🎯", source: SITE_LOG_SOURCES.WALLET,
        title: "Payout wallet changed",
        discordUserId: s.discordUserId, wallet,
        fields: { Rule: "must already be verified by this account" },
      });
      return res.json({ ok: true, payoutWallet: wallet });
    } catch (error) {
      const message = error?.message || "payout_wallet_failed";
      // `wallet_not_verified_for_user` is a 403 rather than a 400: the request
      // was well formed and was refused on authority, and saying so plainly
      // beats a vague "bad request" for someone who mistyped an address.
      const status = message === "wallet_not_verified_for_user" ? 403 : 400;
      return res.status(status).json({ ok: false, error: message });
    }
  });

  // Owner-only order list, so fulfilment doesn't mean logging into PayPal and
  // eyeballing totals — the mismatch flag is computed, not spotted.
  app.get("/api/merch/orders", simpleRateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    if (!isGovernanceMaintainer(s.discordUserId)) return res.status(403).json({ ok: false, error: "maintainer_required" });
    return res.json({ ok: true, orders: listMerchOrders({ limit: Number(req.query.limit) || 100 }) });
  });

  // ── WinLEW Forge (internal, owner-only AI router) ────────────────────────
  // Proxies a prompt to OpenAI/Anthropic using the SERVER's API keys, so it is
  // gated to WinLEW maintainers (MOD_IDS, same check governance uses) — an open
  // proxy here would let anyone burn the owner's paid API credits. Rate-limited
  // on top. Never returns the raw provider payload, only provider/model/content.
  app.post("/api/forge/ai", simpleRateLimit({ windowMs: 15_000, max: 10 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    if (!isGovernanceMaintainer(s.discordUserId)) {
      return res.status(403).json({ ok: false, error: "maintainer_required" });
    }
    try {
      const input = normalizeForgeRequest(req.body || {});
      const result = await routeForgePrompt(input);
      return res.json({ ok: true, result: { provider: result.provider, model: result.model, content: result.content } });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error?.message || "forge_failed" });
    }
  });

  // ── Contribution system ─────────────────────────────────────────────────
  // Real, verified on-chain contributions to Dev/Faucet/Burn — never a
  // self-reported number. build/confirm follow the same "server constructs
  // the exact transaction, client signs it, server independently re-verifies
  // the confirmed result before recording anything" pattern documented in
  // src/mole/contributions.js.
  app.post("/api/contribute/build", simpleRateLimit({ windowMs: 15_000, max: 20 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const linked = getLinkedWalletRecord(s.discordUserId);
    const verification = getWalletVerificationStatus(linked);
    if (!verification.verified || !verification.wallet) {
      return res.status(400).json({ ok: false, error: "wallet_not_verified" });
    }
    try {
      const result = await buildContributionTransaction({
        wallet: verification.wallet,
        cause: req.body?.cause,
        amountWinlew: req.body?.amountWinlew,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contribute_build_failed" });
    }
  });

  // Fallback submit path for wallets whose own send pipeline fails after the
  // user approves (Phantom desktop's opaque "Unexpected error") — the client
  // signs with provider.signTransaction() and this relays the raw bytes via
  // our RPC. submitSignedContributionTransaction() rejects anything that
  // isn't the exact single-transfer shape /api/contribute/build produced,
  // signed by this session's own verified wallet, so this is not usable as
  // a generic transaction relay.
  app.post("/api/contribute/submit", simpleRateLimit({ windowMs: 15_000, max: 10 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const linked = getLinkedWalletRecord(s.discordUserId);
    const verification = getWalletVerificationStatus(linked);
    if (!verification.verified || !verification.wallet) {
      return res.status(400).json({ ok: false, error: "wallet_not_verified" });
    }
    try {
      const result = await submitSignedContributionTransaction({
        wallet: verification.wallet,
        cause: req.body?.cause,
        signedTransactionBase64: req.body?.signedTransactionBase64,
      });
      if (!result.ok) {
        void sendContributionLogMessage(
          `⚠️ **Contribution fallback submit failed** — cause: \`${req.body?.cause}\`, wallet: \`${verification.wallet}\`, reason: \`${result.error}\`${result.message ? ` (\`${result.message}\`)` : ""}`
        );
        return res.status(400).json(result);
      }
      void sendContributionLogMessage(
        `📡 **Contribution sent via fallback relay** — cause: \`${req.body?.cause}\`, wallet: \`${verification.wallet}\`, signature: \`${result.signature}\` <https://solscan.io/tx/${result.signature}> — the wallet's own send path failed, tx submitted through our RPC instead.`
      );
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contribute_submit_failed" });
    }
  });

  app.post("/api/contribute/confirm", simpleRateLimit({ windowMs: 15_000, max: 20 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const linked = getLinkedWalletRecord(s.discordUserId);
    const verification = getWalletVerificationStatus(linked);
    if (!verification.verified || !verification.wallet) {
      return res.status(400).json({ ok: false, error: "wallet_not_verified" });
    }
    // A bare signature in a Discord log is just text a maintainer has to
    // copy-paste into an explorer by hand — this turns it into a one-click
    // Solscan link instead, same explorer used across /burn/ and
    // /transparency/. Empty on a signature-less failure (e.g.
    // signature_required), so the sentence just omits the link cleanly.
    const sigLink = (() => {
      const sig = String(req.body?.signature || "").trim();
      return sig ? ` <https://solscan.io/tx/${sig}>` : "";
    })();
    try {
      const result = await confirmContribution({
        discordUserId: s.discordUserId,
        wallet: verification.wallet,
        cause: req.body?.cause,
        signature: req.body?.signature,
      });
      if (!result.ok) {
        void sendContributionLogMessage(
          `⚠️ **Contribution confirm failed** — cause: \`${req.body?.cause}\`, wallet: \`${verification.wallet}\`, signature: \`${req.body?.signature}\`${sigLink}, reason: \`${result.error}\``
        );
        return res.status(400).json(result);
      }
      void sendContributionLogMessage(
        `💜 **Contribution confirmed** — ${result.amount?.toLocaleString?.() ?? result.amount} WinLEW to **${result.cause || req.body?.cause}**, wallet: \`${verification.wallet}\`, signature: \`${req.body?.signature}\`${sigLink}`
      );
      // Contributor / Governance Voter Discord roles (2026-07-29) — fire and
      // forget, never blocks the response or the recorded contribution on a
      // Discord hiccup. syncGuildRolesForUser() looks up the contribution
      // ledger itself (never trusts a caller-passed flag for these two), so
      // passing balance-based flags here is only for token_holder/
      // verified_wallet staying correctly in sync at the same time.
      void (async () => {
        try {
          const balance = await getSplBalance(verification.wallet.trim(), cfg.WINLEW_MINT);
          const flags = computeLewcrewFlags(balance);
          await syncGuildRolesForUser({
            discordUserId: s.discordUserId,
            wallet: verification.wallet,
            balance,
            flags,
            source: `contribute:${result.cause || req.body?.cause}`,
          });
        } catch (err) {
          console.warn("[contribute] guild role sync failed:", err?.message || err);
        }
      })();
      return res.json(result);
    } catch (error) {
      void sendContributionLogMessage(
        `🚨 **Contribution confirm error** — cause: \`${req.body?.cause}\`, wallet: \`${verification.wallet}\`, signature: \`${req.body?.signature}\`${sigLink}, error: \`${error?.message || error}\``
      );
      return res.status(500).json({ ok: false, error: error?.message || "contribute_confirm_failed" });
    }
  });

  // Client-side failures (e.g. the wallet itself blocking or rejecting the
  // signing request) never reach /confirm at all, so this gives the same
  // Discord visibility for those — never trusts the reported error beyond
  // logging it verbatim (truncated), and only ever logs, never acts on it.
  app.post("/api/contribute/log-client-error", simpleRateLimit({ windowMs: 15_000, max: 20 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    const cause = typeof req.body?.cause === "string" ? req.body.cause.slice(0, 40) : "unknown";
    const stage = typeof req.body?.stage === "string" ? req.body.stage.slice(0, 60) : "unknown";
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 500) : "unknown error";
    void sendContributionLogMessage(
      `🧯 **Contribution client error** — cause: \`${cause}\`, stage: \`${stage}\`, discordUserId: \`${s?.discordUserId || "unauthenticated"}\`, message: \`${message}\``
    );
    return res.json({ ok: true });
  });

  let _contributionLeaderboardCache = { at: 0, data: null };
  app.get("/api/contribute/leaderboard", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    const cause = req.query.cause ? String(req.query.cause) : null;
    if (cause && !CONTRIBUTION_CAUSES[cause]) return res.status(400).json({ ok: false, error: "unknown_cause" });
    try {
      const now = Date.now();
      const cacheKey = cause || "overall";
      if (!_contributionLeaderboardCache.data || _contributionLeaderboardCache.key !== cacheKey || now - _contributionLeaderboardCache.at > 60_000) {
        const rows = await getContributionLeaderboard({ cause, limit: 50 });

        // "Votes" column (2026-07-30): each contributor's Governance Vote
        // Fund total and the vote weight it currently buys. Same overview
        // math as /mole votes — theoretical, capped, NOT allocation-aware
        // (per-proposal allocations can be lower; see governanceVoteCredits.js).
        // External rows have no discordUserId, so no vote fund.
        const governanceRows = cause === "governance"
          ? rows
          : await getContributionLeaderboard({ cause: "governance", limit: 100000 }).catch(() => []);
        const governanceByUser = new Map(
          governanceRows.filter((r) => !r.externalVerified).map((r) => [r.discordUserId, Number(r.total || 0)])
        );
        let winlewPerVote = null;
        try {
          const mint = await getMintSnapshot();
          const supply = Number(mint?.supply);
          const pricing = supply > 0 ? getVotePriceInWinlew({ supply }) : { ok: false };
          if (pricing.ok) winlewPerVote = pricing.winlewPerVote;
        } catch {
          // pricing unavailable (e.g. no recent price samples) — the column
          // just shows the fund total without a vote estimate
        }

        // externalVerified rows (see contributions.js's
        // EXTERNAL_VERIFIED_CONTRIBUTIONS) already carry their own display
        // name — they have no discordUserId to resolve via quizDisplayName().
        // Every row (external or not) carries evidenceUrls — one Solscan
        // link per underlying on-chain transaction that rolled into the total.
        const entries = rows.map((r) => {
          const governanceTotal = r.externalVerified ? 0 : Number(governanceByUser.get(r.discordUserId) || 0);
          const votes = governanceTotal > 0 && winlewPerVote
            ? Math.min(MAX_PURCHASED_VOTES_PER_PROPOSAL, Math.floor(governanceTotal / winlewPerVote))
            : null;
          const base = r.externalVerified
            ? { name: r.name, masked: false, externalVerified: true, evidenceUrls: r.evidenceUrls, total: r.total, contributions: r.contributions }
            : { ...quizDisplayName(r.discordUserId), evidenceUrls: r.evidenceUrls, total: r.total, contributions: r.contributions };
          return { ...base, governanceTotal, votes };
        });
        _contributionLeaderboardCache = { at: now, key: cacheKey, data: entries };
      }
      return res.json({ ok: true, cause: cause || "overall", entries: _contributionLeaderboardCache.data });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contribute_leaderboard_failed" });
    }
  });

  app.get("/api/contribute/mine", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const summary = await getUserContributionSummary(s.discordUserId);
      return res.json({ ok: true, ...summary });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contribute_mine_failed" });
    }
  });

  // External growth actions (Jupiter/Streamflow locks & vesting & staking,
  // Raydium liquidity) happen on third-party programs — there's no reserve
  // wallet of ours to independently verify a transfer against, so this is a
  // review-queue submission only (mirrors the governance proposal
  // submission queue's shape), never an auto-verified/auto-recorded
  // contribution. A maintainer checks the address on-chain by hand before
  // ever adding it to /transparency/.
  app.post("/api/contribute/external-submit", simpleRateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const linked = getLinkedWalletRecord(s.discordUserId);
    const verification = getWalletVerificationStatus(linked);
    if (!verification.verified || !verification.wallet) {
      return res.status(400).json({ ok: false, error: "wallet_not_verified" });
    }
    try {
      const result = await recordExternalSubmission({
        discordUserId: s.discordUserId,
        wallet: verification.wallet,
        linkId: req.body?.linkId,
        address: req.body?.address,
        note: req.body?.note,
      });
      if (!result.ok) return res.status(400).json(result);
      // directTransfer submissions report a tx signature for a send straight
      // to one of OUR reserve wallets (missed by /api/contribute/confirm's
      // automatic check, e.g. no session at send time) — route those to
      // Clout, not /transparency/, and link the signature directly so a
      // maintainer can one-click verify (same pattern as the confirm-flow
      // Discord log above).
      const isDirectTransfer = result.submission.linkId === "directTransfer";
      void sendContributionLogMessage(
        isDirectTransfer
          ? `📥 **Direct-transfer contribution submitted for review** — signature: \`${result.submission.address}\` <https://solscan.io/tx/${result.submission.address}>, wallet: \`${verification.wallet}\`, discordUserId: \`${s.discordUserId}\`, note: \`${result.submission.note || "(none)"}\`. Verify on-chain (destination cause + amount), then credit it — either through the normal contribution flow if it matches this wallet, or as an EXTERNAL_VERIFIED_CONTRIBUTIONS entry in src/mole/contributions.js if it doesn't (see the 2026-07-25 50M-burn entry for the pattern).`
          : `📥 **External contribution submitted for review** — platform: **${result.submission.platform}** (${result.submission.type}), address: \`${result.submission.address}\`, wallet: \`${verification.wallet}\`, discordUserId: \`${s.discordUserId}\`. Verify on-chain before adding to /transparency/.`
      );
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "contribute_external_submit_failed" });
    }
  });

  /**
   * Every valid wallet gets a durable profile and a cycle-length session.
   * Discord verification upgrades the profile to unlock token payouts; it is
   * not a prerequisite for connecting or saving play.
   */
  app.post("/api/hub/wallet-login/challenge", simpleRateLimit({ windowMs: 10_000, max: 25 }), (req, res) => {
    try {
      const wallet = String(req.body?.wallet || "").trim();
      const challenge = issueWalletActionChallenge({ wallet, action: "gaming-hub-login", payload: {}, ttlSec: 300 });
      return res.json({ ok: true, ...challenge });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "challenge_failed" });
    }
  });

  app.post("/api/hub/wallet-login", simpleRateLimit({ windowMs: 15_000, max: 20 }), async (req, res) => {
    try {
      const wallet = String(req.body?.wallet || "").trim();
      const { signature, message } = req.body || {};
      verifyWalletAction({ wallet, action: "gaming-hub-login", payload: {}, signature, message });

      // FRESH LINK DATA, NOT THE BOOT-TIME CACHE.
      //
      // readJson() serves a cache populated when this process started, and the
      // Discord bot writes links from a DIFFERENT process. So a wallet linked
      // after this web process booted reads as UNLINKED here — the exact
      // failure hodlEligibility.js documents for the Tuesday payout, where a
      // participant who verified on Monday was silently skipped.
      //
      // That was harmless while an unlinked wallet simply got an anonymous
      // profile. The moment a gate refuses unlinked wallets, the same stale
      // read locks a genuinely linked member out of their own account. Best
      // effort: a refresh failure falls through to the cache rather than
      // refusing everyone during a Mongo blip.
      await refreshManagedFile('linked_wallets.json').catch((error) => {
        console.warn('[wallet-login] link refresh failed, using cached data:', error?.message || error);
      });

      const hit = findLinkedProfileByWallet(wallet);

      // WHICH ACCOUNT DOES THIS WALLET JOIN? Three answers, in order, and the
      // order is the owner's: "Discord is our MAIN Gateway, but not everyone
      // has this."
      //
      //   1. The wallet is already linked to a Discord account -> that one.
      //      Discord outranks whatever session is in hand, always.
      //   2. Otherwise, if they are signed in with a PROVEN identity -> the
      //      account they are already using. Before this, connecting a wallet
      //      after signing in with X minted a fresh `wallet:` account and left
      //      the X-rooted one behind, which is a person losing their account by
      //      following the instructions.
      //   3. Otherwise -> a new wallet-rooted account, exactly as before.
      //
      // canBePaid() is the test for step 2 rather than "has a session",
      // deliberately. An anonymous wallet-only session has proved nothing, and
      // letting it absorb further wallets would make an account's membership
      // depend on the order someone happened to connect in. A proven account —
      // Discord snowflake, or a synced Discord/X identity — is a person, and
      // "many wallets per person" is the model.
      const heldAccountId = String(getSession(sessionFromRequest(req))?.discordUserId || "");
      const carryOver = !hit && heldAccountId && canBePaid(heldAccountId) ? heldAccountId : "";

      // A SIGNED WALLET ON ANOTHER OF YOUR ACCOUNTS MERGES THEM (2026-08-22).
      //
      // `hit` used to win outright, which silently switched the person out of
      // the account they were signed into and into whichever one this wallet
      // was filed under — the same wallets scattered across the same person's
      // two logins that the OAuth callbacks now fix from the other end.
      //
      // The proof standard is the same one used everywhere else here: a live
      // session for a PROVEN account (canBePaid, so not an anonymous wallet
      // session that has established nothing), plus a signature over this
      // request's challenge for a wallet that is already verified on the other
      // account. A private key is not something one person hands another, so
      // both accounts belong to whoever is holding this session.
      let mergedInto = null;
      if (hit && heldAccountId && canBePaid(heldAccountId)
          && resolveAccountId(hit.discordUserId) !== resolveAccountId(heldAccountId)) {
        try {
          const merged = await mergeAccountsWithRewardGuard({ a: heldAccountId, b: hit.discordUserId, reason: "wallet-signature" });
          if (merged.changed) {
            mergedInto = merged;
            void logSiteEvent({
              type: "accounts_merged", icon: "🧩", source: SITE_LOG_SOURCES.WALLET,
              title: "Accounts merged (wallet signature proved both)",
              discordUserId: merged.userId, wallet,
              fields: {
                User: merged.userId,
                Absorbed: merged.absorbed || "—",
                Wallets: String(merged.wallets?.verifiedCount ?? 0),
                Payout: merged.wallets?.payoutWallet || "—",
                Proof: "proven session + wallet signature",
              },
            });
          }
        } catch (error) {
          console.warn("[wallet-login] account merge failed:", error?.message || error);
          if (error?.code === "account_merge_review_required") {
            return res.status(409).json({
              error: "account_merge_review_required",
              message: "Both verified identities already contain reward activity. Nothing was merged; this account needs reconciliation review.",
            });
          }
        }
      }

      const discordUserId = mergedInto?.userId || hit?.discordUserId || carryOver || walletProfileId(wallet);
      const profileCreated = !hit && !carryOver && !getProfilePrefsByUser(discordUserId);

      // ONE ACCOUNT PER PERSON (2026-08-20, the owner's decision).
      //
      // Signing a message proves control of a wallet, and a wallet costs
      // nothing to generate — so a wallet-only sign-in was an identity anyone
      // could mint on demand, without limit. That is what the 2026-08-16 run
      // was doing when it created 19 of them in forty minutes.
      //
      // A wallet ALREADY linked to a Discord account still connects directly:
      // the signature authenticates them as that person, the mobile app depends
      // on it, and there is nothing to gain by making a known member re-do
      // OAuth. What is refused is minting a NEW anonymous identity.
      //
      // THIS REVERSES A DELIBERATE DESIGN, stated plainly rather than quietly:
      // web.js has said since the hub shipped that verification "is not a
      // prerequisite for connecting or saving play". Anonymous play was on
      // purpose. The owner was shown that and chose this. Sessions already
      // issued keep working until they expire — nobody is logged out mid-game —
      // and an anonymous player's existing progress is not lost: linking the
      // same wallet after logging in merges it, via the reassignClaims() path
      // that /api/wallet/link has always run.
      if (HUB_REQUIRE_LOGIN_BEFORE_CONNECT && !isDiscordId(discordUserId)) {
        void logSiteEvent({
          type: "wallet_login_needs_account", icon: "🔐", source: SITE_LOG_SOURCES.WALLET,
          title: "Connect refused — no account behind this wallet",
          discordUserId, wallet,
          fields: { Rule: "one account per person" },
        });
        return res.status(403).json({
          error: "login_required",
          loginUrl: "/linked-role/mole",
          message:
            "Sign in with Discord or X first, then connect this wallet. " +
            "One account per person — an account can hold several wallets, and your play carries over when you link it.",
        });
      }

      // Wallet-only sign-in burst -> automatic 24h IP ban. Checked before the
      // log call below, so a tripped burst does not also spam the Discord
      // channel with "New wallet signed in" lines — which is exactly how the
      // 2026-08-16 run buried its own signal in noise.
      //
      // Gated on canBePaid, not isDiscordId: a verified member reconnecting
      // repeatedly is normal and must never trip this, and since 2026-08-21
      // "verified member" includes an X-rooted account — which is not a Discord
      // snowflake and would otherwise be counted as an anonymous wallet every
      // time its owner connected. Only accounts that have proved nothing count.
      if (!canBePaid(discordUserId)) {
        const clientKey = resolveClientKey({
          reqIp: req.ip,
          headers: req.headers,
          secret: WEB_PROXY_SHARED_SECRET,
        });
        const burst = recordWalletOnlyLogin(clientKey, wallet);
        if (burst.triggered) {
          const reason =
            `auto wallet-only burst: ${burst.totalEvents} sign-ins / ${burst.distinctWallets} wallets ` +
            `in ${Math.round(WALLET_ONLY_BURST_WINDOW_MS / 60_000)}m`;
          // Duration comes from the escalation policy, not from this call
          // site: 6 months for a first offence, permanent for a second. See
          // recordIpOffence() — strikes are kept outside the ban record so a
          // lapsed ban does not reset someone to "first offence".
          const { strikeCount, permanent, ban } = recordIpOffence(clientKey, {
            reason,
            bannedBy: 'mole-web:auto',
          });
          console.warn(`[security] auto-banned ${clientKey} (offence ${strikeCount}${permanent ? ', PERMANENT' : ''}): ${reason}`);
          void logSiteEvent({
            type: "wallet_only_burst", icon: "🚨", source: SITE_LOG_SOURCES.WALLET,
            title: permanent ? "Wallet-only burst — IP banned PERMANENTLY (repeat)" : "Wallet-only burst — IP banned 6 months",
            discordUserId, wallet,
            fields: {
              Burst: `${burst.totalEvents} sign-ins / ${burst.distinctWallets} wallets`,
              Offence: permanent ? `#${strikeCount} — PERMANENT` : `#${strikeCount} — 6 months`,
              Until: ban?.expiresAt ? new Date(ban.expiresAt).toISOString() : "permanent",
            },
          });
          return res.status(403).json({
            error: 'ip_blocked',
            until: ban?.expiresAt || null,
            permanent,
            // A ban with no way back turns a false positive into a permanent
            // silent exclusion. Heuristics catch real people — a phone and a
            // laptop on one NAT look exactly like one person scripting wallets.
            message: withAppeal(
              permanent
                ? 'Access from this network has been blocked permanently after a repeat automated-signup pattern.'
                : 'Access from this network has been blocked for 6 months after an automated-signup pattern was detected.'
            ),
          });
        }
      }

      void logSiteEvent({
        type: "wallet_login", icon: "🔑", source: SITE_LOG_SOURCES.WALLET,
        title: profileCreated ? "New wallet signed in (first time)" : "Wallet signed in",
        discordUserId, wallet,
        fields: {
          // Derived from isDiscordId, not from `hit`. Reading `hit` alone
          // printed "Linked: known Discord account" beside "User: —" whenever
          // the linked profile was itself wallet-only — the log contradicting
          // itself in two adjacent lines.
          Linked: isDiscordId(discordUserId)
            ? "known Discord account"
            : (carryOver ? "signed-in account (wallet added)" : "wallet-only profile"),
        },
      });
      if (profileCreated) saveProfilePrefs({ discordUserId, wallet });
      // The carried-over account has no wallet on it yet — it was rooted in X
      // or Discord, not in a wallet — so record this one. Without it the
      // account keeps its identity and forgets where to pay.
      else if (carryOver) {
        saveProfilePrefs({ discordUserId, wallet });
        // LOGGED BECAUSE IT IS ABSORPTION, and absorption is the step an
        // attacker needs. A session token is a bearer credential that travels
        // in URLs (the bot mails them out; see the URL-scrub test), so anyone
        // who can get a victim to open a crafted `?session=` link has that
        // victim's browser holding THEIR account — and this line is where the
        // victim's wallet would join it. Nothing here can tell the two cases
        // apart, so it makes the event visible rather than pretending to.
        // Watch for this firing repeatedly against one account with different
        // wallets: that is the shape of the attack, not of a person.
        void logSiteEvent({
          type: "wallet_joined_account", icon: "🔗", source: SITE_LOG_SOURCES.WALLET,
          title: "Wallet added to the signed-in account",
          discordUserId, wallet,
          fields: { Account: discordUserId, Rule: "carry-over: proven session, unlinked wallet" },
        });
      }
      // Read AFTER any merge: hit.record is the pre-merge half, and reporting
      // that back would tell someone who just joined their two accounts that
      // they hold fewer wallets than they do.
      const verification = hit
        ? getWalletVerificationStatus(mergedInto ? getLinkedWalletRecord(discordUserId) : hit.record)
        : { ...getWalletVerificationStatus(null), wallet };
      // Keep the wallet identity for one quiz cycle. This session only
      // accrues/reads game winnings; it cannot move funds.
      const session = createSession(discordUserId, WALLET_VERIFICATION_TTL_SEC);
      return res.json({
        ok: true,
        session,
        app: "mole",
        discordUserId,
        wallet,
        profileCreated,
        verified: verification.verified,
        verification,
        warning: walletVerificationWarning(verification),
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "wallet_login_failed" });
    }
  });

  /**
   * Mobile-wrapper session hand-off — see src/mole/nativeHandoff.js for the
   * threat model and why this is a code exchange rather than a session token
   * in the deep-link URL. Three steps: the wrapper starts one, the page inside
   * the wallet's browser deposits into it, the wrapper claims it back.
   */
  app.post("/api/hub/native-handoff/start", simpleRateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
    try {
      return res.json(startNativeHandoff({ claimHash: req.body?.claimHash }));
    } catch (error) {
      return res.status(400).json({ error: error?.message || "handoff_start_failed" });
    }
  });

  app.post("/api/hub/native-handoff/deposit", simpleRateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
    try {
      const { handoffId, session, wallet } = req.body || {};
      return res.json(depositNativeHandoff({ handoffId, session, wallet }));
    } catch (error) {
      console.warn("[native-handoff] deposit rejected", JSON.stringify({
        error: error?.message || "handoff_deposit_failed",
        handoffId: String(req.body?.handoffId || "").slice(0, 12),
        hasSession: !!req.body?.session,
        wallet: String(req.body?.wallet || "").trim() || null,
      }));
      return res.status(400).json({ error: error?.message || "handoff_deposit_failed" });
    }
  });

  // Higher ceiling than the other two: the wrapper polls this on app resume
  // when the deep link doesn't arrive, which is the common case in wallet
  // in-app browsers that block custom-scheme navigation.
  app.post("/api/hub/native-handoff/claim", simpleRateLimit({ windowMs: 10_000, max: 30 }), (req, res) => {
    try {
      const { handoffId, claimSecret } = req.body || {};
      return res.json(claimNativeHandoff({ handoffId, claimSecret }));
    } catch (error) {
      return res.status(400).json({ error: error?.message || "handoff_claim_failed" });
    }
  });

  /**
   * Desktop-to-phone hand-off for /verify/. See src/mole/webHandoff.js for why
   * the link carries an id and a pairing code rather than the session token it
   * used to carry — in short, the "Phantom handoff" and "Solflare handoff"
   * buttons put that token into the path of a request to a third party.
   *
   * Rate limits are tighter than the native flow's. `claim` is the one that
   * matters: a six-digit code is guessable in principle, so the per-record
   * five-attempt cap is backed by a per-IP ceiling here to stop the same code
   * being hammered across many records.
   */
  // Hand-off start/claim are logged because they move an authenticated session
  // between devices. The hand-off ID and pairing code are NEVER logged — they
  // are the credential; only the fact that one was created or redeemed is.
  app.post("/api/verify/handoff/start", simpleRateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    try {
      return res.json(startWebHandoff({ session: sessionFromRequest(req), mode: req.body?.mode }));
    } catch (error) {
      const message = error?.message || "handoff_start_failed";
      return res.status(message === "session_invalid" || message === "session_required" ? 401 : 400).json({ error: message });
    }
  });

  app.post("/api/verify/handoff/claim", simpleRateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    try {
      const { handoffId, pairingCode } = req.body || {};
      return res.json(claimWebHandoff({ handoffId, pairingCode }));
    } catch (error) {
      return res.status(400).json({ error: error?.message || "handoff_claim_failed" });
    }
  });

  // Polled by the originating desktop so it can show that its hand-off was
  // used — the signal a user needs to notice a claim they did not make. Never
  // returns a session, and requires the pairing code, so it is not a probe.
  app.post("/api/verify/handoff/peek", simpleRateLimit({ windowMs: 60_000, max: 60 }), (req, res) => {
    try {
      const { handoffId, pairingCode } = req.body || {};
      return res.json(peekWebHandoff({ handoffId, pairingCode }));
    } catch (error) {
      return res.status(400).json({ error: error?.message || "handoff_peek_failed" });
    }
  });

  /** Link + verify (one shot) */
  app.post("/api/wallet/link", simpleRateLimit({ windowMs: 15_000, max: 20 }), async (req, res) => {
    const { session, wallet, signature, message } = req.body || {};
    const s = getSession(String(session || ""));
    if (!s) return res.status(401).json({ error: "session_expired" });

    try {
      const provisionalId = walletProfileId(wallet);
      const provisionalPrefs = getProfilePrefsByUser(provisionalId);
      const appKey = String(req.body?.app || req.body?.appKey || req.query?.app || "mole");

      // Which Discord person is this? Since the identity layer landed (5270f50,
      // fd6095a) a session id may be a snowflake, `wallet:<hash>` or `x:<hash>`,
      // and only the first can own OAuth tokens or a role connection.
      //
      // RESOLVED HERE, NOT AT THE PUSH. pushRoleConnection() is called after
      // completeLink() has already written the link and reassigned claims, so
      // refusing there returned a hard error on a half-finished operation. Same
      // reasoning as the identity-age gate directly below.
      //
      // NOTE the snowflake is used ONLY for the Discord-facing calls.
      // completeLink() keeps s.discordUserId because issueChallenge() keyed the
      // challenge by it and baked it into the signed text — swapping ids there
      // fails signature verification for every wallet-rooted account.
      const discordUserId = discordUserIdForAccount(s.discordUserId);
      if (!discordUserId) {
        return res.status(401).json({
          error: "discord_not_attached",
          message: "You are signed in, but no Discord account is attached to this one yet. Attach Discord to sync your roles.",
          connectUrl: `/linked-role/${encodeURIComponent(appKey)}`,
        });
      }

      // Identity-age gate (2026-08-16). Runs BEFORE completeLink() — refusing
      // after the link is written would leave a verified record behind and make
      // the refusal cosmetic. See src/mole/identityAge.js for why account age
      // rather than account existence is the thing being measured.
      //
      // The guild half is fetched only when the gate needs it, so a deployment
      // with the gate switched off makes no extra Discord call per verification.
      const gate = identityGateConfig();
      if (gate.enabled) {
        const needsGuildFacts = gate.minGuildDays > 0 || gate.requireScreening;
        const guildFacts = needsGuildFacts
          ? await fetchGuildMemberFacts({ appKey, discordUserId: s.discordUserId }).catch(() => null)
          : null;
        let identity = evaluateIdentityAge({ discordUserId: s.discordUserId, guildFacts, gate });

        // HOLDER BYPASS (2026-08-20). Only reached on a refusal, and only for
        // an age refusal, so the ordinary successful link still costs zero
        // extra RPC calls. `isFirstWallet` is read from the verified list
        // rather than from `wallet_history`, because a history entry is an
        // address someone once used, not one they have proved they still hold.
        const ageRefusal = !identity.ok
          && (identity.reason === IDENTITY_REASONS.ACCOUNT_TOO_NEW || identity.reason === IDENTITY_REASONS.GUILD_TOO_NEW);
        if (ageRefusal && gate.firstWalletMinBalance > 0) {
          const alreadyVerified = listVerifiedWallets(getLinkedWalletRecord(s.discordUserId));
          if (alreadyVerified.length === 0) {
            const { WINLEW_MINT } = getConfig();
            // A read failure must not read as a zero balance — getSplBalance
            // throws rather than returning 0, and null means "unknown", which
            // the gate refuses to treat as "qualifies".
            const balance = await getSplBalance(String(wallet || ""), WINLEW_MINT).catch(() => null);
            identity = evaluateIdentityAge({
              discordUserId: s.discordUserId,
              guildFacts,
              gate,
              holder: { isFirstWallet: true, balance },
            });
            if (identity.ok) {
              void logSiteEvent({
                type: "identity_gate_holder_bypass", icon: "🎟️", source: SITE_LOG_SOURCES.WALLET,
                title: "Verification allowed — holder bypass",
                discordUserId: s.discordUserId, wallet,
                fields: {
                  Waived: identity.waived,
                  Balance: `${Number(balance).toLocaleString("en-US")} WinLEW`,
                  Minimum: `${gate.firstWalletMinBalance.toLocaleString("en-US")} WinLEW`,
                },
              });
            }
          }
        }

        if (!identity.ok) {
          void logSiteEvent({
            type: "identity_gate_refused", icon: "🛑", source: SITE_LOG_SOURCES.WALLET,
            title: "Verification refused — identity too new",
            discordUserId: s.discordUserId, wallet,
            fields: {
              Reason: identity.reason,
              Required: `${identity.required ?? "—"} day(s)`,
              Actual: `${identity.actual ?? "—"} day(s)`,
            },
          });
          return res.status(403).json({
            error: identity.reason,
            message: explainIdentityRefusal(identity, gate),
            required: identity.required,
            actual: identity.actual,
          });
        }
      }

      const linked = completeLink({ discordUserId: s.discordUserId, wallet, signature, message });

      if (provisionalId !== String(s.discordUserId)) {
        await reassignClaims(provisionalId, s.discordUserId).catch((error) => {
          console.warn("provisional wallet reward merge failed:", error?.message || error);
        });
        const currentPrefs = getProfilePrefsByUser(s.discordUserId) || {};
        if (provisionalPrefs && !currentPrefs.displayName && !currentPrefs.bio && !currentPrefs.avatarUrl) {
          saveProfilePrefs({
            discordUserId: s.discordUserId,
            wallet,
            displayName: provisionalPrefs.displayName,
            bio: provisionalPrefs.bio,
            avatarUrl: provisionalPrefs.avatarUrl,
          });
        }
      }

      const pushed = await pushRoleConnection(appKey, discordUserId);
      if (!pushed.ok) return res.status(400).json({ error: pushed.error });

      const roles = rolesFromFlags(pushed.flags);
      const guildRoleSync = await syncGuildRolesForUser({
        discordUserId,
        wallet: linked,
        balance: pushed.balance,
        flags: pushed.flags,
        source: `wallet-link:${appKey}`,
      }).catch((err) => ({ ok: false, error: err?.message || String(err) }));

      // Fire-and-forget webhook (do NOT break verification if Discord is slow)

      const webhookUrl =
        (appKey === "utility"
          ? cfg.VERIFICATION_WEBHOOK_URL_UTILITY
          : cfg.VERIFICATION_WEBHOOK_URL_MOLE) || cfg.VERIFICATION_WEBHOOK_URL;

if (!webhookUrl) {
  console.warn("No verification webhook configured for", appKey);
} else {
  if (isDiscordWebhookUrl(webhookUrl)) {
    console.log("Verification webhook is a Discord webhook; sending message-only payload.");
  } else {
    const wh = await postWebhook(
      webhookUrl,
      buildVerificationWebhookPayload({
        appKey,
        userId: s.discordUserId,
        wallet: linked,
        balance: pushed.balance ?? 0,
        flags: pushed.flags ?? {},
        roles,
      })
    );

    if (!wh.ok) console.warn("postWebhook failed:", wh.error);
  }
}

// Optional: send a pretty Discord message to the same webhook
try {
  await sendVerificationMessage({
    webhookUrl,
    userId: s.discordUserId,
    wallet: linked,
    balance: pushed.balance,
    roles,
  });
} catch (err) {
  console.warn("verification message failed:", err?.message || err);
}

      res.json({
  ok: true,
  wallet: linked,
  verification: getWalletVerificationStatus(getLinkedWalletRecord(s.discordUserId)),
  balance: pushed.balance,
  flags: pushed.flags,
  last_verified: pushed.last_verified,
  guild_roles: guildRoleSync,
});

    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  /** Re-sync Linked Roles (no re-sign needed) */
  app.post("/api/roles/sync", simpleRateLimit({ windowMs: 10_000, max: 20 }), async (req, res) => {
  const { session, app: appParam } = req.body || {};
  const s = getSession(String(session || ""));
  if (!s) return res.status(401).json({ error: "session_expired" });

  const appKey = String(appParam || "mole");
  const pushed = await pushRoleConnection(appKey, s.discordUserId);
  if (!pushed.ok) return res.status(400).json({ error: pushed.error });
  void logSiteEvent({
    type: "roles_sync", icon: "🎭", source: SITE_LOG_SOURCES.ROLES,
    title: "Discord roles re-synced from the website",
    discordUserId: s.discordUserId,
    fields: { App: appKey },
  });
  return res.json({ ok: true, ...pushed });
});



  app.get("/api/profile/me", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const session = sessionFromRequest(req);
    const appKey = String(req.query.app || "mole");
    const s = getSession(session);
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const payload = await buildProfilePayload(appKey, s.discordUserId);
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "profile_failed" });
    }
  });

  // SECURITY (fixed 2026-08-05, /profile/ audit). This route used to return the
  // FULL private payload to anyone who supplied a wallet address, with no
  // session check at all — an IDOR. Wallet addresses are public by design: they
  // are on /leaderboards/, the /contribute/ board, /burn/, and Solscan. So
  // anyone could enumerate them and read each owner's Discord username and
  // globalName, every linked wallet, live balance, faucet cooldown timing,
  // governance participation and reward history. Confirmed against the live API
  // during the audit: 42,718 bytes, knownWallets populated, and the
  // faucet.cooldownReady / nextClaimAt fields that buildPublicProfilePayload
  // exists specifically to strip.
  //
  // The caller supplying a wallet address is not evidence they control it. So
  // the full payload is now released only when a valid session proves the
  // requester IS that wallet's owner; everything else gets exactly what
  // /api/profile/public returns. The client's legitimate use (session expired,
  // wallet still remembered in this browser) still works — it just degrades to
  // the public view, which is correct, because at that moment the server has no
  // evidence of ownership either.
  app.get("/api/profile/by-wallet", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const wallet = String(req.query.wallet || "").trim();
    const appKey = String(req.query.app || "mole");
    if (!wallet) return res.status(400).json({ error: "wallet_required" });
    try {
      const hit = findLinkedProfileByWallet(wallet);
      if (!hit?.discordUserId) return res.status(404).json({ error: "profile_not_found" });
      const payload = await buildProfilePayload(appKey, hit.discordUserId);

      const session = getSession(sessionFromRequest(req));
      const isOwner = !!session && session.discordUserId === hit.discordUserId;
      return res.json(isOwner ? payload : buildPublicProfilePayload(payload, publicIdentityFor(hit.discordUserId)));
    } catch (error) {
      return res.status(500).json({ error: error?.message || "profile_failed" });
    }
  });

  app.get("/api/profile/public", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const wallet = String(req.query.wallet || "").trim();
    const appKey = String(req.query.app || "mole");
    if (!wallet) return res.status(400).json({ error: "wallet_required" });
    try {
      const hit = findLinkedProfileByWallet(wallet);
      if (!hit?.discordUserId) return res.status(404).json({ error: "profile_not_found" });
      const payload = await buildProfilePayload(appKey, hit.discordUserId);
      // Same consent check as /by-wallet. Both public routes must agree, or the
      // stricter one is decoration.
      return res.json(buildPublicProfilePayload(payload, publicIdentityFor(hit.discordUserId)));
    } catch (error) {
      return res.status(500).json({ error: error?.message || "profile_failed" });
    }
  });

  app.get("/api/profile/geoagora", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const wallet = String(req.query.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "wallet_required" });
    try {
      const hit = findLinkedProfileByWallet(wallet);
      if (hit?.discordUserId) {
        const linked = getLinkedWalletRecord(hit.discordUserId);
        const prefs = getProfilePrefsByUser(hit.discordUserId) || {};
        const provisionalWallets = buildWalletSnapshot(linked, prefs, null);
        const faucet = await buildFaucetSnapshot(hit.discordUserId, provisionalWallets.knownWallets);
        const wallets = buildWalletSnapshot(linked, prefs, faucet);
        const geoAgora = await buildGeoAgoraSnapshotFast(wallets);
        return res.json({ ok: true, geoAgora });
      }
      const geoAgora = await buildGeoAgoraSnapshotFast({
        primaryWallet: wallet,
        verifiedWallet: wallet,
        payoutWallet: "",
        knownWallets: [{ kind: "external", address: wallet, source: "profile_lookup" }],
      });
      return res.json({ ok: true, geoAgora });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "geoagora_profile_failed" });
    }
  });



app.post("/api/profile/challenge", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
  const { wallet, displayName, bio, avatarUrl } = req.body || {};
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return res.status(400).json({ error: "wallet_required" });
  try {
    const hit = findLinkedProfileByWallet(walletStr);
    if (!hit?.discordUserId) return res.status(404).json({ error: "profile_not_found" });
    const sanitized = normalizeProfileInput({ displayName, bio, avatarUrl });
    const challenge = issueWalletActionChallenge({
      wallet: walletStr,
      action: "profile_update",
      payload: sanitized,
      ttlSec: 300,
    });
    return res.json({ ok: true, ...challenge, profileOwner: hit.discordUserId });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "profile_challenge_failed" });
  }
});

app.post("/api/profile/update-signed", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
  const { wallet, app: appParam, displayName, bio, avatarUrl, message, signature } = req.body || {};
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return res.status(400).json({ error: "wallet_required" });

  try {
    const hit = findLinkedProfileByWallet(walletStr);
    if (!hit?.discordUserId) return res.status(404).json({ error: "profile_not_found" });

    const sanitized = normalizeProfileInput({ displayName, bio, avatarUrl });
    verifyWalletAction({
      wallet: walletStr,
      action: "profile_update",
      payload: sanitized,
      signature,
      message,
    });

    const prefs = saveProfilePrefs({
      discordUserId: hit.discordUserId,
      wallet: walletStr,
      ...sanitized,
    });
    const payload = await buildProfilePayload(String(appParam || "mole"), hit.discordUserId);
    const editGrant = issueProfileEditGrant({
      wallet: walletStr,
      discordUserId: hit.discordUserId,
      ttlSec: 91 * 24 * 60 * 60,
    });
    return res.json({
      ok: true,
      prefs,
      ...payload,
      editGrant,
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "profile_update_failed" });
  }
});


app.post("/api/profile/update-authorized", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
  const { wallet, app: appParam, displayName, bio, avatarUrl, editToken } = req.body || {};
  const walletStr = String(wallet || "").trim();
  if (!walletStr) return res.status(400).json({ error: "wallet_required" });

  try {
    const hit = findLinkedProfileByWallet(walletStr);
    if (!hit?.discordUserId) return res.status(404).json({ error: "profile_not_found" });

    const grant = verifyProfileEditGrant({
      wallet: walletStr,
      token: String(editToken || ""),
      discordUserId: hit.discordUserId,
    });

    const sanitized = normalizeProfileInput({ displayName, bio, avatarUrl });
    const prefs = saveProfilePrefs({
      discordUserId: hit.discordUserId,
      wallet: walletStr,
      ...sanitized,
    });

    const payload = await buildProfilePayload(String(appParam || "mole"), hit.discordUserId);
    return res.json({
      ok: true,
      prefs,
      ...payload,
      editGrant: {
        expires_at: grant.expires_at,
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error?.message || "profile_update_authorized_failed" });
  }
});


app.post("/api/profile/update", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
  const { session, app: appParam, displayName, bio, avatarUrl } = req.body || {};
  const s = getSession(String(session || ""));
  if (!s) return res.status(401).json({ error: "session_expired" });
  try {
    const linked = getLinkedWalletRecord(s.discordUserId);
    const prefs = saveProfilePrefs({
      discordUserId: s.discordUserId,
      wallet: linked?.wallet || linked?.wallets?.verified?.address || null,
      displayName,
      bio,
      avatarUrl,
    });
    const payload = await buildProfilePayload(String(appParam || "mole"), s.discordUserId);
    return res.json({ ok: true, prefs, profile: payload.profile });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "profile_update_failed" });
  }
});


  app.get("/api/rewards/history", simpleRateLimit({ windowMs: 10_000, max: 40 }), async (req, res) => {
    const session = sessionFromRequest(req);
    const appKey = String(req.query.app || "mole");
    const s = getSession(session);
    // Anonymous: read the guest's server-side game totals directly (no heavy
    // profile build — guests have no Discord/wallet to resolve).
    const guest = s ? null : sanitizeGuestId(req.query.guest);
    if (!s && guest) {
      try {
        const guestId = `guest:${guest}`;
        const [history, summary] = await Promise.all([listRewardClaims(guestId, 50), getRewardSummary(guestId)]);
        return res.json({ history, summary });
      } catch (error) {
        return res.status(500).json({ error: error?.message || "history_failed" });
      }
    }
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const payload = await buildProfilePayload(appKey, s.discordUserId);
      return res.json({ history: payload.games?.history || [], summary: payload.games?.summary || {} });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "history_failed" });
    }
  });

  app.post("/api/rewards/claim", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    const { session, app: appParam, game, roundKey, roundLabel, baseReward, multiplier, payout, meta, guestId } = req.body || {};
    const s = getSession(String(session || ""));
    // Identity: a logged-in Discord user, or an anonymous guest (saved server-side
    // and merged into a Discord account when they connect). Same validation path.
    const guest = s ? null : sanitizeGuestId(guestId);
    const identityId = s ? String(s.discordUserId) : (guest ? `guest:${guest}` : null);
    if (!identityId) return res.status(401).json({ error: "session_or_guest_required" });
    try {
      // Server-side payout validation: never trust the client's `payout`.
      // Recompute it from baseReward * (validated multiplier) and apply caps
      // according to REWARD_VALIDATION_MODE (shadow | clamp | reject).
      const rules = getRewardRulesConfig();
      const recentStats = await getRecentClaimStats(identityId).catch(() => ({ dailyPayout: 0, hourlyClaims: 0 }));
      // Guests (no linked Discord session) structurally can't have a PoV/Clout
      // history yet, so skip the fetch entirely rather than looking up a
      // "guest:<id>" string — getCombinedRewardMultiplier would just fail-safe
      // to 1 anyway, but this avoids the pointless lookups.
      const rewardMultiplier = s
        ? await getCombinedRewardMultiplier(s.discordUserId).catch(() => 1)
        : 1;
      const verdict = validateRewardClaim(
        { game, baseReward, multiplier, payout, recentStats, rewardMultiplier },
        rules,
      );

      if (!verdict.ok) {
        console.warn("[rewards] claim flagged:", JSON.stringify({
          identityId,
          game: String(game || ""),
          roundKey: String(roundKey || ""),
          mode: verdict.mode,
          flags: verdict.flags,
          clientPayout: verdict.clientPayout,
          bankedPayout: verdict.bankedPayout,
        }));
        if (verdict.mode === "reject") {
          return res.status(400).json({ error: "reward_rejected", flags: verdict.flags });
        }
      }

      const linked = s ? getLinkedWalletRecord(identityId) : null;
      const result = await recordRewardClaim({
        discordUserId: identityId,
        app: String(appParam || "mole"),
        game: String(game || ""),
        roundKey: String(roundKey || ""),
        roundLabel: String(roundLabel || ""),
        baseReward: verdict.baseReward,
        multiplier: verdict.multiplier,
        payout: verdict.bankedPayout, // server-authoritative amount
        wallet: linked?.wallet || linked?.wallets?.verified?.address || null,
        meta: {
          ...(meta && typeof meta === "object" ? meta : {}),
          validation: {
            mode: verdict.mode,
            flags: verdict.flags,
            clientPayout: verdict.clientPayout,
            serverMultiplier: verdict.serverMultiplier,
          },
        },
      });
      if (!result.ok) return res.status(400).json({ error: result.error || "claim_failed" });
      return res.json({ ok: true, duplicate: !!result.duplicate, payout: Number(result.row?.payout ?? verdict.bankedPayout), flags: verdict.flags, row: result.row });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "claim_failed" });
    }
  });

  // Merge a guest's saved winnings into the connected Discord account, and apply
  // a one-time capped credit for pre-guest-id local winnings. Idempotent.
  app.post("/api/rewards/reconcile", simpleRateLimit({ windowMs: 15_000, max: 10 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    const guest = sanitizeGuestId(req.body?.guestId);
    if (!guest) return res.status(400).json({ error: "invalid_guest" });
    try {
      const userId = String(s.discordUserId);
      const guestId = `guest:${guest}`;

      // What the guest already has server-side (validated claims).
      const guestServerTotal = await getGuestReconciliationTotal(guestId, userId);
      const moved = await reassignClaims(guestId, userId);

      // One-time migration credit for local winnings that predate guest-id
      // recording (e.g. the 374.40). `localTotal` is client-asserted, so the
      // credit is capped AND deduped ONCE PER DISCORD USER — not per guest.
      // Security fix 2026-07-19: the roundKey was `migrate:${guest}`, so an
      // attacker minting fresh guest IDs client-side could reconcile each for
      // up to the cap (4500) repeatedly. A stable per-user roundKey means a
      // given account can ever receive exactly one legacy-local credit; every
      // later reconcile dedups to a no-op. (reassignClaims above still moves
      // real recorded guest claims for as many guests as legitimately exist —
      // that moves already-validated winnings, it mints nothing.)
      const localTotal = Math.max(0, Number(req.body?.localTotal || 0));
      const cap = Math.max(0, Number(process.env.REWARD_MIGRATION_CAP || process.env.REWARD_DAILY_MAX_PAYOUT || 4500));
      const gap = Math.max(0, localTotal - guestServerTotal);
      let migrationCredit = 0;
      if (gap > 0) {
        const credit = Math.round(Math.min(gap, cap) * 100) / 100;
        const linked = getLinkedWalletRecord(userId);
        const result = await recordRewardClaim({
          discordUserId: userId, app: "mole", game: "migration",
          roundKey: "migrate:legacy-local", roundLabel: "Local winnings migration",
          baseReward: credit, multiplier: 1, payout: credit,
          wallet: linked?.wallet || linked?.wallets?.verified?.address || null,
          meta: { migration: { guestId: guest, localTotal, guestServerTotal, requestedGap: gap, credited: credit, capped: gap > cap, flagged: true } },
        });
        if (result.ok && !result.duplicate) migrationCredit = credit;
      }

      console.log("[rewards] reconcile", JSON.stringify({ userId, guestId, movedRows: moved.moved, guestServerTotal, localTotal, migrationCredit }));
      const total = Number((await getRewardSummary(userId)).totalPayout || 0);

      // GAMES had no site logging at all, which left the one money-adjacent
      // path on the hub — moving guest winnings into an account, plus a capped
      // one-time credit — invisible in the channel. This route has already had
      // one security fix (2026-07-19, a per-guest roundKey that could be minted
      // repeatedly); an unlogged path is exactly where the next one hides.
      //
      // Only logged when something actually moved. A no-op reconcile fires on
      // ordinary sign-ins and would drown the channel in nothing.
      if (moved.moved > 0 || migrationCredit > 0) {
        void logSiteEvent({
          type: "rewards_reconcile", icon: "🎮", source: SITE_LOG_SOURCES.GAMES,
          title: "Guest winnings merged into an account",
          discordUserId: userId,
          fields: {
            "Rows moved": moved.moved || undefined,
            "Migration credit": migrationCredit ? `**${migrationCredit}** WinLEW` : undefined,
            Guest: `\`${guest.slice(0, 8)}…\``,
            "Lifetime total": total,
          },
        });
      }
      return res.json({ ok: true, movedRows: moved.moved, migrationCredit, total });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "reconcile_failed" });
    }
  });


  // ── Quiz dashboard (read-only) ─────────────────────────────────────────
  // Surfaces the Discord quiz's existing data layer (src/quiz/db.js) to the web
  // /quiz/ page. Read-only; the quiz is still played in Discord. Other players'
  // Discord IDs are never returned — names come from profile prefs or a masked
  // handle.
  /**
   * THE ONE PLACE that decides what the public may see about a person.
   *
   * Every public surface — the quiz leaderboard, the HODL payout list, a public
   * profile — goes through this. One rule, one place to audit, and no surface
   * inventing its own.
   *
   * THE RULE, and the consent it rests on:
   *
   *  · A DISPLAY NAME is shown if they set one. That has always been the
   *    behaviour on leaderboards, and setting a name is itself the opt-in.
   *  · Otherwise they are MASKED as "Player ••1234". Never the raw Discord id,
   *    which identifies a real account.
   *  · SYNCED HANDLES (Discord, X) are shown ONLY with publicIdentity === true,
   *    which defaults to false and can only be turned on by the person. They
   *    synced to unlock payouts; that is not permission to be listed.
   *  · A wallet-rooted account with no name is masked from its hash, so the
   *    fallback never leaks a wallet address either.
   */
  function publicIdentityFor(discordUserId) {
    const id = String(discordUserId || "").trim();
    const prefs = getProfilePrefsByUser(id) || {};
    const name = String(prefs.displayName || "").trim();
    const opted = prefs.publicIdentity === true;

    const identities = opted
      ? listSyncedIdentities(id)
          .filter((entry) => entry.handle)
          .map((entry) => ({
            provider: entry.provider,
            handle: entry.handle,
            url: entry.provider === "x" ? `https://x.com/${entry.handle}` : null,
          }))
      : [];

    return {
      name: name ? name.slice(0, 32) : `Player ••${id.slice(-4)}`,
      masked: !name,
      // THE LINK CARRIES A FULL WALLET ADDRESS, so it is offered ONLY to people
      // who opted in. Caught by a leak check on the payouts response: the row
      // truncates the wallet to D8oJ…5ZEz and then handed the whole thing back
      // inside this URL, which defeated the truncation entirely.
      //
      // A display name being public is the long-standing leaderboard rule and
      // is fine. Publishing a name, an amount and a full address together, for
      // somebody who never asked to be listed, is a different act — so the
      // link needs the same consent as the handles do.
      profileUrl: opted && prefs.wallet ? `/profile/?wallet=${encodeURIComponent(prefs.wallet)}` : null,
      identities,
      publicIdentity: opted,
    };
  }

  function quizDisplayName(userId) {
    const prefs = getProfilePrefsByUser(userId) || {};
    const name = String(prefs.displayName || "").trim();
    if (name) return { name: name.slice(0, 32), masked: false };
    return { name: `Player ••${String(userId).slice(-4)}`, masked: true };
  }

  function buildQuizLeaderboard(scope, limit) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 25));
    if (scope === "alltime") {
      return quizDb.topUsers(lim).map((u, i) => ({
        rank: i + 1,
        ...quizDisplayName(u.userId),
        lifetimePoints: Number(u.lifetimePoints || 0),
        questions: Number(u.questions || 0),
        cyclesPlayed: Number(u.cyclesPlayed || 0),
      }));
    }
    // default: current cycle
    return quizDb.topCycleUsers(null, lim).map((u, i) => ({
      rank: i + 1,
      ...quizDisplayName(u.userId),
      points: Number(u.points || 0),
      unpaidPoints: Number(u.unpaidPoints || 0),
      questions: Number(u.questions || 0),
      estimatedPayout: Number(quizDb.estimateWinlewForPoints(u.unpaidPoints || 0) || 0),
    }));
  }

  app.get("/api/quiz/cycle", simpleRateLimit({ windowMs: 10_000, max: 60 }), (_req, res) => {
    try {
      const cycle = quizDb.getCurrentCycle() || {};
      const startMs = Number(cycle.startMs || 0);
      const endMs = Number(cycle.endMs || 0);
      return res.json({
        ok: true,
        cycle: {
          id: cycle.id || null,
          startMs, endMs,
          startAt: startMs ? new Date(startMs).toISOString() : null,
          endAt: endMs ? new Date(endMs).toISOString() : null,
          msRemaining: endMs ? Math.max(0, endMs - Date.now()) : null,
        },
        payoutRate: Number(quizDb.getPayoutRate() || 0),
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "cycle_failed" });
    }
  });

  // ── HODL Rewards (v4) ────────────────────────────────────────────────────
  // Public and deliberately aggregate. Counts, pools and totals, plus the
  // transaction signatures — which are already public on-chain and are the
  // whole audit trail. No Discord ids, no participant wallets: who holds what
  // is exactly the correlation data every other surface here keeps private,
  // and a weekly list of paid addresses would rebuild it in one page.
  /**
   * Recent HODL payouts — receipts, not a rich list.
   *
   * The page this feeds argues that participation matters more than wallet
   * size, so it shows WHO GOT PAID and the transaction that proves it, rather
   * than ranking anybody by balance. Every row is already-completed history.
   *
   * WHAT IS DELIBERATELY NOT HERE: no Discord ids, no full wallet addresses,
   * no balances, no PoV scores, and no handle for anyone who has not opted in.
   * Names come from publicIdentityFor(), the single rule that governs every
   * public surface.
   */
  app.get("/api/hodl/payouts", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    try {
      const hodl = await import("./hodlStore.js");
      await hodl.refreshHodlStore().catch(() => {});
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));

      // Only weeks that actually paid. A snapshot that was previewed but never
      // sent is not a receipt, and showing it as one would be the exact kind of
      // claim this page exists to avoid.
      // A snapshot marked `testData` (e.g. the fixture-shaped e1 week left in
      // the live store) is not a real payout: it is kept, unedited, but listed
      // separately and labelled, never mixed into the receipts.
      const all = hodl.listSnapshots();
      const testRecords = all.filter((s) => s.testData).map((s) => ({
        epochId: s.epochId, weekIndex: s.weekIndex, label: "Test record, not a real payout",
        reason: s.testData.reason || null, markedAtIso: s.testData.markedAtIso || null,
      }));
      const snapshots = all
        .filter((s) => (s.status === "paid" || s.status === "partial") && !s.testData)
        .sort((a, b) => Date.parse(b.updatedAtIso || b.savedAtIso || 0) - Date.parse(a.updatedAtIso || a.savedAtIso || 0));

      const rows = [];
      for (const snap of snapshots) {
        // Each row links the transaction that paid THAT row: its own chunk's signature, matched by
        // the stable transferId (hodlBatch.signatureForAllocation). Before 2026-11-17 every row
        // carried every chunk's signature, so nobody could tell which receipt was theirs.
        const { signatureForAllocation } = await import("./hodlBatch.js");
        for (const alloc of snap.allocations || []) {
          const own = signatureForAllocation(snap, alloc);
          const signatures = own ? [own] : [];
          const who = publicIdentityFor(alloc.discordUserId);
          rows.push({
            epochId: snap.epochId,
            weekIndex: snap.weekIndex,
            paidAtIso: snap.updatedAtIso || snap.savedAtIso || null,
            amount: Number(alloc.amount || 0),
            // Truncated on the SERVER. A full address is public on-chain, but
            // publishing a list of them next to names is a different act from
            // each being individually discoverable.
            walletShort: String(alloc.payoutWallet || "").slice(0, 4) + "…" + String(alloc.payoutWallet || "").slice(-4),
            name: who.name,
            masked: who.masked,
            profileUrl: who.profileUrl,
            identities: who.identities,
            signatures,
          });
          if (rows.length >= limit) break;
        }
        if (rows.length >= limit) break;
      }

      return res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        count: rows.length,
        payouts: rows,
        testRecords,
        // Said in the payload, so a consumer cannot mistake an opt-out for an
        // absence of participants.
        note: "Names appear only where a participant chose to be shown publicly. Everyone else is masked; they still took part and were still paid.",
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "hodl_payouts_failed" });
    }
  });

  app.get("/api/hodl/status", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (_req, res) => {
    try {
      const hodl = await import("./hodlStore.js");
      const { weekIndexFor, isPayoutDay, nextPayoutDay, LIMITS, DEFAULT_EPOCH_PARAMS } = await import("./hodlEpochs.js");
      const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      // The bounds governance CANNOT raise. Published because they are the most
      // load-bearing fact about the program — "a vote decides the pool" reads
      // very differently once you can see the ceiling that vote is trapped
      // under. Static, safe to serve with or without an active epoch.
      const limits = {
        maxWeeklyPool: LIMITS.MAX_WEEKLY_POOL,
        maxPerParticipantWeek: LIMITS.MAX_PER_PARTICIPANT_WEEK,
        maxPovBonusMultiplier: LIMITS.MAX_POV_BONUS_MULTIPLIER,
        minEpochWeeks: LIMITS.MIN_EPOCH_WEEKS,
        maxEpochWeeks: LIMITS.MAX_EPOCH_WEEKS,
        // Balance-rate rule (owner policy 2026-11-13): the ceilings that matter.
        maxRatePerWeek: LIMITS.MAX_COMBINED_RATE_PER_WEEK,
        maxQualifyingBalance: LIMITS.MAX_QUALIFYING_BALANCE,
      };
      // The server's own zone. "Tuesday" is decided on this calendar (isPayoutDay),
      // so the page names it instead of letting each viewer's zone shift the date.
      const payoutTimeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } })();
      const povBonusTiers = DEFAULT_EPOCH_PARAMS.povBonusTiers.map((t) => ({ ...t }));
      await hodl.refreshHodlStore().catch(() => {});

      const epoch = hodl.getActiveEpoch();
      if (!epoch) {
        // Not an error. No epoch has been activated yet, and the page says so
        // rather than rendering zeros that look like a broken program.
        return res.json({ ok: true, active: false, epoch: null, weeks: [], limits, povBonusTiers, payoutTimeZone });
      }

      const now = Date.now();
      const snapshots = hodl.listSnapshots(epoch.id).filter((s) => !s.testData).sort((a, b) => a.weekIndex - b.weekIndex);
      const paid = snapshots.filter((s) => s.status === "paid" || s.status === "partial");
      const last = paid[paid.length - 1] || null;
      const balanceRate = Array.isArray(epoch.balanceRates) && epoch.balanceRates.length === 8;
      // Same rule hodl-pay enforces (local weekday, startMs..endMs), skipping a
      // week that is already paid. A schedule, not a guarantee.
      const next = nextPayoutDay(epoch, now, {
        isWeekPaid: (w) => paid.some((s) => Number(s.weekIndex) === w && s.status === "paid"),
      });

      return res.json({
        ok: true,
        active: true,
        epoch: {
          id: epoch.id,
          startAt: new Date(epoch.startMs).toISOString(),
          endAt: new Date(epoch.endMs).toISOString(),
          status: epoch.status,
          weeklyPool: Number(epoch.weeklyPool),
          minHold: Number(epoch.minHold),
          currentWeek: weekIndexFor(epoch, now),
          totalWeeks: Math.round((epoch.endMs - epoch.startMs) / (7 * 24 * 60 * 60 * 1000)),
          isPayoutDayToday: isPayoutDay(epoch, new Date()),
          payoutDay: Number(epoch.payoutDay ?? DEFAULT_EPOCH_PARAMS.payoutDay),
          payoutDayName: DAY_NAMES[Number(epoch.payoutDay ?? DEFAULT_EPOCH_PARAMS.payoutDay)] || null,
          nextPayoutAt: next ? new Date(next.atMs).toISOString() : null,
          nextPayoutDate: next ? next.date : null,
          nextPayoutWeek: next ? next.weekIndex : null,
          payoutTimeZone,
          mode: balanceRate ? "balance-rate" : "equal-share",
          balanceRates: balanceRate ? epoch.balanceRates.map(Number) : null,
        },
        limits,
        payoutTimeZone,
        // PoV tiers apply only to equal-share epochs; balance-rate epochs never stack them.
        povBonusTiers: balanceRate ? [] : povBonusTiers,
        lastDistribution: last && {
          weekIndex: last.weekIndex,
          paidAt: last.updatedAtIso || last.savedAtIso || null,
          participants: Number(last.qualifiedCount || 0),
          total: Number(last.totalAllocated || 0),
          signatures: (last.batch?.chunks || [])
            .filter((c) => c.status === "confirmed" && c.signature)
            .map((c) => c.signature),
        },
        weeks: snapshots.map((s) => ({
          weekIndex: s.weekIndex,
          status: s.status,
          participants: Number(s.qualifiedCount || 0),
          pool: Number(s.weeklyPool || 0),
          total: Number(s.totalAllocated || 0),
        })),
        totals: {
          distributed: paid.reduce((sum, s) => sum + Number(s.totalAllocated || 0), 0),
          weeksPaid: paid.length,
          // Across EVERY epoch, not just the active one. Without this the
          // headline resets to zero the moment a new epoch starts, which reads
          // as "nothing has ever been paid".
          lifetimeDistributed: hodl
            .listEpochs()
            .flatMap((e) => hodl.listSnapshots(e.id))
            .filter((sn) => (sn.status === "paid" || sn.status === "partial") && !sn.testData)
            .reduce((sum, sn) => sum + Number(sn.totalAllocated || 0), 0),
        },
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "hodl_status_failed" });
    }
  });

  app.get("/api/quiz/leaderboard", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    try {
      const scope = String(req.query.scope || "cycle") === "alltime" ? "alltime" : "cycle";
      const entries = buildQuizLeaderboard(scope, req.query.limit);
      return res.json({ ok: true, scope, entries });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "leaderboard_failed" });
    }
  });

  // ── Web vs Discord platform leaderboards (informational, not payout-linked) ─
  // These rank users by the new per-platform `points` bucket in quiz db.js —
  // separate from (and never merged into) the cycle/all-time leaderboard
  // above, which stays tied to real WinLEW payouts exactly as before.
  app.get("/api/quiz/leaderboard/platform", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    try {
      const platform = String(req.query.platform || "").toLowerCase();
      if (platform !== "web" && platform !== "discord") {
        return res.status(400).json({ error: "platform_must_be_web_or_discord" });
      }
      const rows = quizDb.topUsersByPlatform(platform, req.query.limit);
      const entries = rows.map((row) => ({
        ...row,
        ...quizDisplayName(row.userId),
        userId: undefined,
      }));
      return res.json({ ok: true, platform, entries });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "platform_leaderboard_failed" });
    }
  });

  // ── Gaming Hub leaderboards (2026-07-19) ────────────────────────────────
  // Built on src/mole/rewardHistory.js — every game already records a claim
  // row per reward-boxed round/session (game, discordUserId, payout,
  // meta.round|level|score). "Web" only: the mini-games don't exist on
  // Discord yet, so there is no source split to offer here (unlike Quiz/
  // Faucet). Same masked-name privacy model as Quiz's leaderboard above.
  const KNOWN_GAME_KEYS = new Set(["rootglide", "burrowblaster", "pacmole", "diglew", "grubdrop"]);
  app.get("/api/games/leaderboard", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    try {
      const game = String(req.query.game || "").toLowerCase();
      if (!KNOWN_GAME_KEYS.has(game)) {
        return res.status(400).json({ error: "unknown_game" });
      }
      const rows = await getGameLeaderboard({ game, limit: req.query.limit });
      const entries = rows.map((row, i) => ({
        rank: i + 1,
        ...quizDisplayName(row.discordUserId),
        totalEarned: row.totalEarned,
        topLevel: row.topLevel,
        topScore: row.topScore,
        claims: row.claims,
      }));
      return res.json({ ok: true, game, entries });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "games_leaderboard_failed" });
    }
  });

  // Aggregate claim counts per game, across all players — the real signal
  // behind "most played," used to order the hub's catalog. Cached briefly
  // since it scans the whole reward-history store on every call.
  let gamePopularityCache = { at: 0, data: null };
  app.get("/api/games/popularity", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (_req, res) => {
    try {
      const now = Date.now();
      if (!gamePopularityCache.data || now - gamePopularityCache.at > 60_000) {
        gamePopularityCache = { at: now, data: await getGamePopularity() };
      }
      return res.json({ ok: true, games: gamePopularityCache.data });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "games_popularity_failed" });
    }
  });

  app.get("/api/quiz/compare", simpleRateLimit({ windowMs: 10_000, max: 60 }), (_req, res) => {
    try {
      return res.json({ ok: true, comparison: quizDb.getPlatformComparisonStats() });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "compare_failed" });
    }
  });

  // ── Transparency Center (public, read-only on-chain snapshots) ────────────
  // No session required — every figure here is public blockchain data.
  // Every address below was independently verified on-chain (two RPC
  // providers) before being added — see docs/roadmap-sprint-1-3.md and
  // docs/whitepaper.md §5. Each component declares how its balance is
  // actually held on-chain (an owner-of-token-account address, a token
  // account address directly, or a program account we only prove exists):
  // getting this wrong for a given address returns a zero/empty balance
  // rather than a wrong one, but it would still be misleading, so each
  // "kind" below was chosen from a real getAccountInfo lookup, not assumed.
  const TRANSPARENCY_COMPONENTS = [
    {
      id: "liquidity",
      label: "Established Raydium Pool",
      icon: "💧",
      purpose: "The established Raydium WinLEW/SOL pool that remains available as a verified secondary market route after graduation.",
      kind: "program",
      address: "5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx",
      // heldBy/sol fields (added 2026-07-19) flow through the API untouched
      // and render as "Held by …" identity rows + .sol name chips on
      // /transparency/ — same disclosure pattern /contribute/'s cause cards
      // use. Every .sol name was verified resolving on-chain to its address
      // via SNS before being listed (see docs/contribution-system.md);
      // program-owned escrows say so explicitly instead of naming a person.
      heldBy: [{ label: "Raydium AMM (program-owned pool)", url: "https://raydium.io/" }],
      links: {
        raydium: "https://raydium.io/liquidity/increase/?mode=add&pool_id=5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx",
        dexscreener: "https://dexscreener.com/solana/5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx",
      },
    },
    // The two pool vaults (added 2026-08-08). The "liquidity" component above
    // is the PoolState account itself, and a PoolState holds no tokens — only
    // ~0.0053 SOL of rent. So /transparency/ was listing an "Established
    // Raydium Pool" worth about a cent while the position inside it was
    // 35.5M WinLEW. The pool's real inventory lives in two separate vault
    // token accounts, which is what these two components read.
    //
    // Both addresses were decoded from the PoolState account's raw bytes
    // rather than copied from a block explorer: Raydium CPMM lays out
    // 8-byte discriminator | amm_config 32 | pool_creator 32 |
    // token_0_vault @72 | token_1_vault @104 | lp_mint @136 |
    // token_0_mint @168 | token_1_mint @200. The decode is self-verifying — it
    // yields lp_mint 8y5pTux9…uEnm4 and token_1_mint Dnrcd…pump, which are the
    // known LP mint and the canonical WinLEW mint. Balances were then read back
    // from both vaults and matched Solscan.
    //
    // IMPORTANT — these are NOT locked supply, and must never be presented
    // next to the Jupiter/Streamflow locks as though they were. Pool inventory
    // is withdrawable by whoever holds the LP tokens, at any time, with no
    // cliff. At the time of writing the LP mint's 409.13 supply was held 53.66%
    // by the Developer Reserve (which is also the pool_creator), 43.82% by
    // D8oJSdqo…A5ZEz and 2.52% by 6jzprDfy…Nhv41, neither of which is a project
    // wallet. So roughly half of this can be pulled by the project and the rest
    // belongs to outside liquidity providers. The purpose strings below say so;
    // do not "simplify" them into "locked".
    {
      // Merged 2026-08-11 (owner request). These were two separate cards —
      // "Raydium Pool — WinLEW Side" and "— SOL Side" — for the two halves of
      // ONE pool. Double the space, and a meaningless "$WinLEW: 0" on the SOL
      // card, since a wSOL vault holds no WinLEW. One card now shows both
      // sides, which is also how anyone actually thinks about pool depth.
      //
      // Checked before merging, because it LOOKED like a bug and was not: the
      // SOL figure comes from the vault's LAMPORTS, not a token balance. For a
      // wrapped-SOL account those are the same thing — 5.649 lamport-SOL is
      // 5.647 wSOL plus 0.00204 rent. The number was already right.
      //
      // IMPORTANT — this is NOT locked supply and must never be presented next
      // to the Jupiter/Streamflow locks as though it were. Pool inventory is
      // withdrawable by whoever holds the LP tokens, at any time, with no
      // cliff; at the time of writing ~53.66% of that LP was held by the
      // Developer Reserve (also the pool_creator) and the rest by outside
      // providers. The purpose string says so. Pinned by
      // transparencyPageClaims.test.mjs.
      id: "liquidityVaults",
      label: "Raydium Pool — Live Depth",
      icon: "💧",
      purpose: "Both sides of the Raydium pool: the WinLEW quotable as liquidity, and the wrapped SOL paired against it. Together these are the pool's real depth. This is tradeable inventory and is not locked supply — it is withdrawable by whoever holds the pool's LP tokens, with no lock or cliff, and it shrinks or grows as people trade against it. Shown separately from the pool account above, which holds only rent.",
      kind: "poolVaults",
      address: "61mr6d5jAbCvy1tLZycJauESbJJDuu2DvQgqnvDuvijB",
      pairedAddress: "5RXuyxh8WQ4dJ3hN1r55zvD1aL3npB8ookzH86frhcBm",
      heldBy: [{ label: "Raydium CPMM pool vaults (program-owned)", url: "https://raydium.io/" }],
      links: {
        solscan: "https://solscan.io/account/61mr6d5jAbCvy1tLZycJauESbJJDuu2DvQgqnvDuvijB",
        solscanSol: "https://solscan.io/account/5RXuyxh8WQ4dJ3hN1r55zvD1aL3npB8ookzH86frhcBm",
      },
    },
    {
      id: "lock50m",
      label: "50M Token Lock",
      icon: "🔒",
      purpose: "Long-term supply lock via Jupiter Lock — vests 10M tokens/year, Apr 25 2025 → Apr 24 2030.",
      kind: "owner",
      address: "E8Pu1WNFqnAPbA9HDqxwgHz6xLvwBXQpekeNLRoiKzSo",
      heldBy: [{ label: "Jupiter Lock escrow (program-owned)", url: "https://lock.jup.ag/" }],
    },
    {
      // Added 2026-08-11 by the second (independent) audit. The previous audit
      // could not have caught this — the lock was created the same day — but it
      // is the reason locked supply was being understated by 19.19M.
      //
      // Verified end to end rather than taken on report:
      //   tx 2c1Ltdm36wGXrQEigBq4CFoALmcfjdYL2V7Pnn15weKnxG8QPJ2Fd62MmMHyJAEtRXEdaqfoXS7fMjzdV7RJk84H
      //   2026-08-11T02:08:32Z, err:null, signer D6d5byBx…FRkZ (Developer Reserve)
      //   program LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn (Jupiter Lock)
      //   D6d5by… 29,192,210.751092 → 10,000,000; this escrow 0 → 19,192,210.751092
      //
      // The escrow's byte layout was not assumed. It was anchored by locating
      // known pubkeys inside the account (mint at offset 40, Dev Reserve at 8
      // and 72), then VALIDATED by reconstruction: cliff 9,192,210.751092 +
      // 2,000,000 × 5 periods = 19,192,210.751092, matching the transfer to the
      // base unit. Schedule: cliff 2028-08-11 releasing 9,192,210.751092, then
      // 2M/year for 5 years, fully unlocked 2033-08-10, nothing claimed yet.
      //
      // NOT CLAIMED: the escrow's cancel_mode byte reads 0, which probably means
      // it cannot be cancelled — but that enum was not confirmed against
      // Jupiter's program source, so `purpose` below does not call it
      // irrevocable. See WINLEW_FINAL_VERIFIED_FACTS.md §4.
      //
      // Same shape as the locks around it: the address is the escrow PDA that
      // OWNS the token account, not the token account itself.
      id: "lock19mDev",
      label: "19.19M Developer Lock",
      icon: "🔒",
      purpose: "Developer Reserve self-lock via Jupiter Lock — 3-year cliff on Aug 11 2028 releasing 9,192,210.751092, then 2M/year through Aug 10 2033.",
      kind: "owner",
      address: "AvJi2mKqeUz3oRbY8GjSBkWEk3VQdjXaZ9XFnG7S6R5m",
      heldBy: [{ label: "Jupiter Lock escrow (program-owned)", url: "https://lock.jup.ag/" }],
    },
    {
      id: "lock15mTeam",
      label: "15M Team Lock",
      icon: "🔒",
      purpose: "Team allocation lock via Jupiter Lock — vests 7.5M tokens/year, Mar 1 2025 → Mar 1 2027.",
      kind: "owner",
      address: "zLHYYpKtXFnrwQ52PVxwSU7X87955i14RtgaGsE8SWA",
      heldBy: [{ label: "Jupiter Lock escrow (program-owned)", url: "https://lock.jup.ag/" }],
    },
    {
      // Added 2026-08-08. Locked out of the X (Twitter) Faucet Reserve in
      // 5Q2dFg4Ct9Cs8XrxLGKUpWF1FXkKpMAppBvWKJcHqpr58fbnHoyWPAfrf1m3dC3mx5oFFhWrLv3k5hWeHgn1E7ZC
      // — verified on-chain: Jupiter Lock program LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn,
      // GFxz…EhAp went 31,136,088.15 → 6,136,088.15 and this escrow went 0 → 25,000,000.
      //
      // The address below is the escrow PDA that OWNS the token account, not
      // the token account itself — same shape as the two locks above, and
      // confirmed by reading it with getTokenAccountsByOwner (returns exactly
      // 25,000,000, the way E8Pu…KzSo returns 50,000,000). The escrow token
      // account is 2fMxzcrqkCRWqV2P8T5DiBmAjTBDwHWDYEWPkJ14qpne, recorded here
      // for reference the way the Streamflow contract IDs are below.
      //
      // Schedule, read off the lock itself: cliff Sep 1 2031 releasing ZERO,
      // then the full 25,000,000 on Aug 30 2036. So it is a ten-year lock in
      // practice, not the five-year one intended — the owner has said as much
      // publicly, and it is described here as what it actually does rather
      // than what it was meant to do.
      id: "lock25mFaucet",
      label: "25M Faucet Lock",
      icon: "🔒",
      purpose: "Faucet runway locked via Jupiter Lock — 25M set aside from the X Faucet Reserve so future drips stay funded. Cliff Sep 1 2031 releases nothing; the full 25M unlocks Aug 30 2036. A ten-year lock, and it unlocks back to the X Faucet Reserve, not to a person.",
      kind: "owner",
      address: "8jr1Zov74VbbDyvuW55Hei2LgMuki9N5W2hUVnB2f986",
      heldBy: [{ label: "Jupiter Lock escrow (program-owned)", url: "https://lock.jup.ag/" }],
    },
    {
      // Streamflow's own "Contract ID" for this lock is
      // EGAWzqjhhXzaHrRv9rcAT1ujaUNmFznUtLyQAciBxTA9 — that's the contract
      // state account, not the token account. The address below is the
      // actual escrow token account the contract holds WinLEW in (verified
      // 2026-07-17 by reading the contract account's raw byte layout and
      // confirming this pubkey is embedded in it, then confirming its live
      // balance ~22.07M matches Streamflow's own UI). A full cliff unlock,
      // not linear vesting — 0% unlocked until Oct 29, 2035.
      id: "streamflow22m",
      label: "Streamflow Lock (22M)",
      icon: "🔒",
      purpose: "Additional supply locked via Streamflow's on-chain vesting contract — full cliff unlock, 0% until Oct 29, 2035. One of two separate Streamflow locks; see also the 7M lock below.",
      kind: "tokenAccount",
      address: "4XnVM4G2xLiKSTfmLeRXTcS1HBnSZPewv1aQcgtpYwv9",
      heldBy: [{ label: "Streamflow vesting escrow (program-owned)", url: "https://app.streamflow.finance/" }],
    },
    {
      // Same relationship as the 22M lock above: Streamflow's own "Contract
      // ID" for this lock is GE75zFkP1cExEtRGDW6BPAQFYtto7sBoxuM73yQzw5V5;
      // the address below is its actual escrow token account, found and
      // verified the same way (added 2026-07-17 — this lock was previously
      // missing from the Transparency Center entirely). Full cliff unlock,
      // 0% until Oct 29, 2030.
      id: "streamflow7m",
      label: "Streamflow Lock (7M)",
      icon: "🔒",
      purpose: "A second, separate Streamflow vesting contract — full cliff unlock, 0% until Oct 29, 2030.",
      kind: "tokenAccount",
      address: "B4GJSLCH8F5EDXctPynP157FbbF1SbfZ2HsG3bWUYJpz",
      heldBy: [{ label: "Streamflow vesting escrow (program-owned)", url: "https://app.streamflow.finance/" }],
    },
    {
      // BURN LOCK, part 1 of 2. Added 2026-08-16, the day it was created.
      //
      // 40,000,000 left the burn wallet EX5nxVKg…aZ74 in two transactions at
      // 05:25 UTC and went into two Jupiter Lock escrows, 20M each. The burn
      // wallet now holds exactly 10,000,000 — verified with
      // getTokenAccountsByOwner, not taken on trust. The point of the move was
      // tamper-proofing: tokens staged for burn used to sit in a wallet the
      // project could still spend from, and now they cannot be touched before
      // their unlock date.
      //
      // Schedule read off the escrow itself (Jupiter Lock program
      // LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn), and validated by
      // reconstruction — cliffAmount 0 + perPeriod 20,000,000 x 1 period =
      // exactly the 20,000,000 transferred:
      //   cliff 2027-08-01T05:13:04Z releases 0, then the full 20M the same
      //   instant. A single unlock, not a vest.
      //
      // Note it lands on the SAME DAY as the planned 10M burn. Aug 1 2027 is
      // therefore one date with two separate events, and no page should
      // conflate them: 10M is destroyed, 20M merely becomes movable again.
      id: "lock20mBurn2027",
      label: "20M Burn Lock (2027)",
      icon: "🔒",
      purpose: "Burn-staged supply locked via Jupiter Lock so it cannot be spent before its date. Unlocks in full on Aug 1 2027 — the same day as the scheduled 10M burn, but a separate event: this 20M becomes movable, it is not destroyed.",
      kind: "owner",
      address: "6drzVwvru3DEbJ2a1jgfCecV2Mk5vNg8PiKAw8uy76Xw",
      heldBy: [{ label: "Jupiter Lock escrow (program-owned)", url: "https://lock.jup.ag/" }],
    },
    {
      // BURN LOCK, part 2 of 2. Same 2026-08-16 move, the other 20M.
      //
      // Reconstruction: cliffAmount 0 + perPeriod 6,666,666.666666 x 3 annual
      // periods = 19,999,999.999998. The 0.000002 shortfall is integer
      // division inside the lock, not a missing token — the escrow holds a
      // verified 20,000,000. Stated here rather than rounded away, because a
      // number that does not add up should be explained, not hidden.
      id: "lock20mBurn2031",
      label: "20M Burn Lock (2029-31)",
      icon: "🔒",
      purpose: "The second half of the burn-staged lock. Releases in three equal annual instalments of ~6,666,666.67 starting Aug 1 2029, finishing Aug 1 2031. Locked, not destroyed.",
      kind: "owner",
      address: "CQYV3c6tVUznL62WSGpaiUVf7pKemTs4ayoyk4miZVwx",
      heldBy: [{ label: "Jupiter Lock escrow (program-owned)", url: "https://lock.jup.ag/" }],
    },
    {
      id: "burn",
      label: "Burn Wallet",
      icon: "🔥",
      purpose: "Tokens held here are staged for permanent removal from supply. The balance shown is what's currently in the wallet, not yet destroyed — see the Burn Center for verified, independently-confirmed permanent burns (via Solana's actual token burn instruction) and progress toward the 100M long-term target.",
      kind: "owner",
      address: "EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74",
      sol: ["burn.winlew.sol"],
      heldBy: [
        { label: "Project burn wallet", url: "/burn/" },
        { label: "𝕏 @LetEveryOneWin", url: "https://x.com/LetEveryOneWin" },
      ],
      links: {
        burnCenter: "/burn/",
        contribute: "/contribute/?cause=burn",
      },
    },
    {
      // Corrected 2026-07-17: this wallet does NOT fund website /faucet/
      // claims — that was a mislabel. It's the wallet behind the @WinLewToken
      // X/Twitter account (see src/faucet/bot.js's own "WinLewToken Wallet:
      // Winlew.sol" reply, and the site's own "𝕏 Faucet (@WinLewToken)" link
      // in src/public/index.html) — a separate program from the website
      // faucet entirely.
      id: "xFaucetReserve",
      label: "X (Twitter) Faucet Reserve",
      icon: "🚰",
      purpose: "Funds the separate X/Twitter faucet program run via @WinLewToken (winlew.sol) — not the website's own /faucet/ page. See the Discord & Web Faucet Reserve below for what actually funds /faucet/.",
      kind: "owner",
      address: "GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp",
      sol: ["winlew.sol"],
      heldBy: [{ label: "𝕏 @WinLewToken — the X giveaway host account", url: "https://x.com/WinLewToken" }],
      links: {
        contribute: "/contribute/?cause=xFaucet",
      },
    },
    {
      // Corrected 2026-07-17: both the Discord bot AND the website's
      // /faucet/ payout worker load the same BOT_KEYPAIR_PATH keypair (see
      // src/faucet/bot.js's BOT_KEYPAIR and src/faucet/payoutExecutor.js's
      // loadTreasuryKeypair(cfg.botKeypairPath), both reading the identical
      // env var via src/faucet/config.js) — so this is one shared reserve
      // for both surfaces, not a Discord-only wallet as previously labeled.
      id: "faucetReserveDiscordWeb",
      label: "Discord & Web Faucet Reserve",
      icon: "🚰",
      purpose: "Funds rewards distributed through both the Discord Faucet Bot (diglew.sol) and the website's own /faucet/ page — they share one treasury keypair, not two separate reserves. Currently also the signer that pays out quiz and game rewards.",
      kind: "owner",
      address: "FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE",
      sol: ["diglew.sol"],
      heldBy: [
        { label: "WinLEW faucet bot (its Discord account)", url: "https://discord.com/users/1465588126515990692" },
        { label: "💬 Join the Discord", url: "/community/" },
      ],
      links: {
        contribute: "/contribute/?cause=faucet",
      },
    },
    {
      id: "developer",
      label: "Developer Reserve",
      icon: "🛠️",
      purpose: "Development and ecosystem funding.",
      kind: "owner",
      address: "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ",
      sol: ["dev.winlew.sol", "lewsales.sol"],
      heldBy: [{ label: "𝕏 @LewSales — WinLEW founder & developer", url: "https://x.com/LewSales" }],
      links: {
        contribute: "/contribute/?cause=dev",
      },
    },
  ];

  let _transparencyCache = null; // { at, data } — avoid hammering the RPC on every page load
  const TRANSPARENCY_CACHE_MS = 60_000;
  const buildTransparencyOnce = createSingleFlightReader(buildTransparencySnapshot);

  // Reads the last locally-run `npm run faucet:scan` checkpoint. NEVER
  // triggers a scan from a public route — walking ~1,000 transactions per
  // request would be absurd, and the checkpoint only exists because a scan
  // that reconciled against the live balance wrote it (see
  // faucetDistributionCheckpoint.js, which refuses to persist an
  // unreconciled tally). null until someone has run it on this machine.
  function buildFaucetOnChainSummary() {
    const cp = loadFaucetDistributionCheckpoint();
    if (!cp) return null;
    return {
      wallet: cp.owner,
      tokenAccount: cp.ata,
      totalDistributedDisplay: baseUnitsToDecimalString(cp.totalDistributedBaseUnits, WINLEW_DECIMALS),
      totalDistributedBaseUnits: cp.totalDistributedBaseUnits,
      payoutCount: cp.payoutCount,
      distinctRecipients: cp.distinctRecipients,
      firstPayoutAtIso: cp.firstPayoutAtIso,
      lastPayoutAtIso: cp.lastPayoutAtIso,
      lastScanAtIso: cp.lastScanAtIso,
      // Proof the figure is complete: inflow - outflow - burned equalled the
      // account's live balance at scan time. Always true for a persisted
      // checkpoint, surfaced so the page can say so rather than assert it.
      reconciled: cp.reconciles === true,
      liveBalanceDisplay: baseUnitsToDecimalString(cp.liveBalanceBaseUnits || "0", WINLEW_DECIMALS),
    };
  }

  async function buildTransparencySnapshot() {
    const mint = await getMintSnapshot().catch((error) => ({ error: error?.message || "mint_failed" }));
    const components = await Promise.all(
      TRANSPARENCY_COMPONENTS.map(async (component) => {
        try {
          let data;
          if (component.kind === "poolVaults") {
            // One card, two vaults: winlewBalance from the WinLEW side,
            // solBalance from the wSOL side (whose lamports ARE the wrapped SOL).
            const [winlewSide, solSide] = await Promise.all([
              getTokenAccountSnapshot(component.address),
              getTokenAccountSnapshot(component.pairedAddress),
            ]);
            data = { ...winlewSide, solBalance: solSide.solBalance, pairedAddress: component.pairedAddress };
          } else if (component.kind === "tokenAccount") data = await getTokenAccountSnapshot(component.address);
          else if (component.kind === "program") data = await getProgramAccountSnapshot(component.address);
          else data = await getOwnerTokenSnapshot(component.address, { signatureLimit: 5 });
          return { ...component, ...data, ok: true };
        } catch (error) {
          return { ...component, ok: false, error: error?.message || "lookup_failed" };
        }
      }),
    );

    // Community Liquidity Providers — verified, structured records (see
    // src/mole/communityLiquidity.js), not a live RPC lookup like the
    // components above: each entry is anchored to its own already-confirmed
    // deposit transaction, so there's no "current balance" to re-query.
    const communityLiquidity = {
      events: COMMUNITY_LIQUIDITY_EVENTS.map((event) => ({
        ...event,
        winlewAmountDisplay: baseUnitsToDecimalString(event.winlewAmountBaseUnits, WINLEW_DECIMALS),
      })),
      summary: summarizeCommunityLiquidity().map((row) => ({
        ...row,
        totalWinlewDepositedDisplay: baseUnitsToDecimalString(row.totalWinlewDepositedBaseUnits, WINLEW_DECIMALS),
        totalWinlewWithdrawnDisplay: baseUnitsToDecimalString(row.totalWinlewWithdrawnBaseUnits, WINLEW_DECIMALS),
      })),
      poolAddress: TRANSPARENCY_COMPONENTS.find((c) => c.id === "liquidity")?.address || null,
      farmPrograms: FARM_PROGRAMS,
    };

    // Lifetime faucet distribution — the reserve wallet's own outbound total,
    // read from the faucet:scan checkpoint. Belongs here because the
    // Transparency Center already shows that wallet's current BALANCE; the
    // balance alone says nothing about how much has flowed through it.
    return {
      mint,
      components,
      communityLiquidity,
      faucetDistribution: buildFaucetOnChainSummary(),
      circulatingSupply: buildCirculatingSupply(mint, components),
    };
  }

  /** One cached snapshot, shared by every route that needs it. Extracted when
   *  the supply endpoints were added: building it is ~10 RPC reads, and an
   *  external service polling for supply must not trigger that on every hit. */
  async function cachedTransparencySnapshot() {
    if (_transparencyCache && Date.now() - _transparencyCache.at < TRANSPARENCY_CACHE_MS) {
      return _transparencyCache.data;
    }
    const snapshot = await buildTransparencyOnce();
    _transparencyCache = { at: Date.now(), data: snapshot };
    return snapshot;
  }

  app.get("/api/transparency/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await cachedTransparencySnapshot()) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "transparency_status_failed" });
    }
  });

  // ── Account sync ────────────────────────────────────────────────────────
  //
  // The wallet is the account. Connecting one is free and gates nothing; a
  // synced Discord or X identity is what unlocks being PAID. These are the
  // routes that attach one.
  //
  // START IS A POST, NOT A LINK. A plain <a> cannot carry the session — it
  // lives in localStorage, not a cookie — so a link would have to put the
  // session token in the URL, where it lands in the shared host's access log.
  // The page asks for the authorize URL and navigates to it instead.
  app.post("/api/account/sync/discord/start", simpleRateLimit({ windowMs: 15_000, max: 20 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const oauth = getOAuthApp("mole");
      const next = safeNextPath(req.body?.next) || "/verify/profile.html";
      const state = createSession(encodeSyncState({
        appKey: "mole", accountId: s.discordUserId, next, claimHash: bodyClaimHash(req),
      }));
      const url =
        "https://discord.com/oauth2/authorize" +
        `?client_id=${encodeURIComponent(oauth.clientId)}` +
        `&redirect_uri=${encodeURIComponent(oauth.redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(oauth.scope)}` +
        `&state=${encodeURIComponent(state)}`;
      return res.json({ ok: true, url });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "sync_start_failed" });
    }
  });

  app.post("/api/account/sync/x/start", simpleRateLimit({ windowMs: 15_000, max: 20 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    // Says so plainly rather than 500ing. Until an X app exists this is a
    // missing configuration, not a fault, and the UI already greys the button.
    if (!isXOAuthConfigured()) return res.status(503).json({ ok: false, error: "x_oauth_not_configured" });
    try {
      const next = safeNextPath(req.body?.next) || "/verify/profile.html";
      const { verifier, challenge } = createPkcePair();
      // The PKCE verifier is stored SERVER-SIDE against the state and never
      // reaches the browser — that is the whole point of PKCE. An intercepted
      // authorization code is useless without it.
      const state = createSession(encodeSyncState({
        appKey: "x", accountId: s.discordUserId, next, verifier, claimHash: bodyClaimHash(req),
      }));
      return res.json({ ok: true, url: buildXAuthorizeUrl({ state, challenge }) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "sync_start_failed" });
    }
  });

  /**
   * SIGN IN with X — no session required, because this is how the session comes
   * into being.
   *
   * WHY. The nav pill offered a chooser only once you already had a session, so
   * a visitor with no Discord account clicked "Sign in" and got Discord and
   * nothing else: "when i click sign-in ONLY DISCORD LOADS." The premise of
   * this whole feature is that not everyone has Discord, which is worth very
   * little if Discord is still the only way through the front door.
   *
   * The account model absorbs this without a rewrite. An account id is an
   * opaque string — `wallet:<hash>` today, now `x:<hash>` as well — and
   * canBePaid() is already satisfied by ANY synced identity, so an X-rooted
   * account is payable from the moment it exists. A wallet is attached later,
   * the same way a wallet-rooted account attaches Discord.
   *
   * Unauthenticated, so the rate limit is tighter than the sync route's.
   */
  app.post("/api/account/signin/x/start", simpleRateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    if (!isXOAuthConfigured()) return res.status(503).json({ ok: false, error: "x_oauth_not_configured" });
    try {
      const next = safeNextPath(req.body?.next) || "/verify/profile.html";
      const { verifier, challenge } = createPkcePair();
      const state = createSession(encodeSyncState({
        appKey: "x", accountId: "", next, verifier, mode: "signin", claimHash: bodyClaimHash(req),
      }));
      return res.json({ ok: true, url: buildXAuthorizeUrl({ state, challenge }) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "signin_start_failed" });
    }
  });

  // X's callback. Separate from Discord's because the token exchange, the user
  // lookup and the PKCE requirement are all different; sharing one handler
  // would be a branch on every line.
  app.get("/x-oauth-callback", async (req, res) => {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code) return oauthCallbackLanding(res, { provider: "x", query: req.query });

    const decoded = decodeSyncState(getSession(state)?.discordUserId || "");
    if (!decoded || !decoded.verifier) {
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}/verify/profile.html`, { syncError: "sync_failed" }));
    }
    const back = decoded.next || "/verify/profile.html";

    try {
      const token = await exchangeXCode({ code, verifier: decoded.verifier });
      const user = await fetchXUser({ accessToken: token.access_token });

      // ── SIGN IN: no account named, so resolve or create one ──────────────
      //
      // An X id that is already synced somewhere SIGNS IN to that account
      // rather than minting a second one. This is the same "one identity, one
      // account" rule the sync path enforces by refusing — here the right
      // answer is not a refusal but a login, because the person asking IS the
      // owner of that account and has just proved it.
      if (decoded.mode === "signin") {
        const existing = accountForIdentity(IDENTITY_PROVIDERS.X, user.id);
        const accountId = existing || xProfileId(user.id);
        if (!existing) {
          syncIdentity({
            accountId,
            provider: IDENTITY_PROVIDERS.X,
            providerUserId: user.id,
            handle: user.username || null,
          });
        }
        const session = createSession(accountId, cfg.DISCORD_ACTIVITY_SESSION_TTL_SEC);
        void logSiteEvent({
          type: existing ? "x_signin" : "x_account_created", icon: existing ? "🔑" : "✨",
          source: SITE_LOG_SOURCES.WALLET,
          title: existing ? "Signed in with X" : "New account created from X",
          fields: { Account: accountId, Provider: "x" },
        });
        return handoffRedirect(res, {
          base: `${cfg.SITE_BASE_URL}${back}`, session, appKey: "mole", claimHash: decoded.claimHash,
        });
      }

      const result = syncIdentity({
        accountId: decoded.accountId,
        provider: IDENTITY_PROVIDERS.X,
        providerUserId: user.id,
      });
      void logSiteEvent({
        type: "identity_synced", icon: "🔗", source: SITE_LOG_SOURCES.WALLET,
        title: result.changed ? "X synced to an account" : "X re-synced (no change)",
        fields: { Account: decoded.accountId, Provider: "x", Handle: user.username ? `@${user.username}` : "—" },
      });
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}${back}`, { synced: "x" }));
    } catch (error) {
      // Same merge rule as the Discord callback above, for the same reason: a
      // live session for `decoded.accountId` plus a completed X OAuth round
      // trip for an identity that roots another account is one person holding
      // two doors. This is the exact pair the owner hit — "one is linked to my
      // Discord and one is linked to my X" — and the two accounts it made are
      // why two of their wallets both claimed inside 24 hours.
      if (error?.code === "identity_already_synced" && error.linkedTo) {
        try {
          const merged = await mergeAccountsWithRewardGuard({ a: decoded.accountId, b: error.linkedTo, reason: "x-oauth" });
          void logSiteEvent({
            type: "accounts_merged", icon: "🧩", source: SITE_LOG_SOURCES.WALLET,
            title: merged.changed ? "Accounts merged (X proved both)" : "X sync — already one account",
            wallet: merged.wallets?.payoutWallet || null,
            fields: {
              User: merged.userId,
              Absorbed: merged.absorbed || "—",
              Wallets: String(merged.wallets?.verifiedCount ?? 0),
              Payout: merged.wallets?.payoutWallet || "—",
              Proof: "session + x oauth",
            },
          });
          res.setHeader("Cache-Control", "no-store");
          return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}${back}`, {
            synced: "x",
            merged: merged.changed ? "1" : "0",
          }));
        } catch (mergeError) {
          console.warn("[x-oauth] merge failed:", mergeError?.message || mergeError);
        }
      }
      const failure = error?.code === "identity_already_synced" ? "already_linked" : "sync_failed";
      // The raw error is logged server-side only — a token-exchange failure can
      // carry request detail that has no business reaching a query string.
      console.warn("[x-oauth] sync failed:", error?.message || error);
      void logSiteEvent({
        type: "identity_sync_refused", icon: "🚫", source: SITE_LOG_SOURCES.WALLET,
        title: "X sync refused",
        fields: { Account: decoded.accountId, Reason: failure, "Already linked to": error?.linkedTo || "—" },
      });
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, buildUiUrl(`${cfg.SITE_BASE_URL}${back}`, { syncError: failure }));
    }
  });

  /**
   * Which identity providers this deployment can actually offer — no session
   * required.
   *
   * WHY THIS IS PUBLIC. `/api/account/identities` already reports the same
   * availability, but only to someone who is signed in. The nav's sign-in pill
   * has to decide what to OFFER before anyone is signed in, and until this
   * existed it could only hardcode Discord — so an X credential could be
   * present and correct on the server and still never produce a button.
   *
   * It also makes the deployment checkable from outside with one curl. X reads
   * `available:false` when X_CLIENT_ID / X_CLIENT_SECRET / X_REDIRECT_URI are
   * missing from the running process — note RUNNING: adding them to .env does
   * nothing until the app is restarted, and this endpoint is how to tell those
   * two states apart without guessing.
   *
   * `canSignIn` is not the same as `available` — it was false for X until
   * 2026-08-21, when nothing minted an account from an X id and offering
   * "sign in with X" would have been a button that could not finish. It is
   * true now: /api/account/signin/x/start creates an `x:<hash>` account, or
   * signs in to the one that already holds that X id. The distinction stays in
   * the payload because it is a real property of a provider, not a constant.
   */
  app.get("/api/account/providers", simpleRateLimit({ windowMs: 10_000, max: 60 }), (_req, res) => {
    return res.json({
      ok: true,
      // WHAT A SYNC WILL DO, not just which buttons to draw. Since 2026-08-22
      // syncing an identity that already roots another account MERGES the two
      // rather than refusing, and that changes what the button can honestly
      // promise — "link it" instead of "this may be refused". Public because
      // the nav has to decide the wording before anyone is signed in.
      //
      // It doubles as the one-curl proof that a deploy actually restarted the
      // process: code older than that day has no `identity` key here at all.
      identity: {
        model: "user>accounts>wallets",
        mergesOnProvedIdentity: true,
        walletsPerUser: "many",
        payoutWalletsPerUser: 1,
      },
      providers: {
        discord: { available: true, canSignIn: true, canSync: true },
        x: {
          available: isXOAuthConfigured(),
          canSignIn: isXOAuthConfigured(),
          canSync: isXOAuthConfigured(),
        },
      },
    });
  });

  app.get("/api/account/identities", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const accountId = s.discordUserId;
    return res.json({
      ok: true,
      accountId,
      // `wallet:` ids are wallet-rooted accounts; a numeric id is a Discord
      // account from before this model existed, and its id is its own proof;
      // `x:` is an account whose first proof was X. Left as three cases rather
      // than "discord or not", because the page says different things about
      // each and a wrong root reads as the page not knowing who you are.
      rootedIn: isDiscordId(accountId) ? "discord" : (String(accountId).startsWith("x:") ? "x" : "wallet"),
      canBePaid: canBePaid(accountId),
      // USER > ACCOUNT(S) > WALLET, reported in that order. `accounts` is how
      // many doors this person has proved; `wallets` is how many addresses they
      // hold; `payoutWallet` is the one that gets paid. The page can then say
      // the true thing — several wallets, one payout — instead of implying the
      // account is whichever door they walked in through today.
      accounts: accountsForUser(accountId).length,
      wallets: listVerifiedWallets(getLinkedWalletRecord(accountId)).map((entry) => entry.wallet),
      payoutWallet: getPayoutWallet(getLinkedWalletRecord(accountId)),
      publicIdentity: (getProfilePrefsByUser(accountId) || {}).publicIdentity === true,
      identities: listSyncedIdentities(accountId).map((entry) => ({
        provider: entry.provider,
        // The provider's user id is NOT returned. It identifies a real person
        // on another platform and the page has no use for it — the UI only ever
        // needs to know THAT a provider is synced.
        synced: true,
      })),
      providers: {
        discord: { available: true },
        // X stays advertised as unavailable until credentials exist, so the UI
        // can show it greyed rather than offering a button that cannot work.
        x: { available: isXOAuthConfigured() },
      },
    });
  });

  /**
   * Turn public visibility on or off. Off by default, and only the person
   * themselves can move it — the session is the authorisation.
   *
   * Reversible at any time, which is what makes it a real choice rather than a
   * one-way door: turning it off removes the name and the handles from every
   * public surface on the next read, because they all resolve through
   * publicIdentityFor() rather than caching a copy.
   */
  app.post("/api/account/public-identity", simpleRateLimit({ windowMs: 15_000, max: 20 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const show = req.body?.show === true;
    try {
      const prefs = saveProfilePrefs({ discordUserId: s.discordUserId, publicIdentity: show });
      void logSiteEvent({
        type: "public_identity_changed", icon: show ? "👁️" : "🙈", source: SITE_LOG_SOURCES.WALLET,
        title: show ? "Opted IN to public identity" : "Opted OUT of public identity",
        discordUserId: s.discordUserId,
        fields: { Setting: show ? "shown publicly" : "hidden" },
      });
      return res.json({ ok: true, publicIdentity: prefs.publicIdentity === true });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error?.message || "public_identity_failed" });
    }
  });

  app.post("/api/account/unsync", simpleRateLimit({ windowMs: 15_000, max: 10 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    const provider = String(req.body?.provider || "").trim().toLowerCase();
    const entry = listSyncedIdentities(s.discordUserId).find((i) => i.provider === provider);
    if (!entry) return res.status(404).json({ ok: false, error: "not_synced" });
    try {
      unsyncIdentity({ accountId: s.discordUserId, provider, providerUserId: entry.providerUserId });
      return res.json({ ok: true, provider, canBePaid: canBePaid(s.discordUserId) });
    } catch (error) {
      // last_identity_cannot_be_removed is a 409: the request is understood and
      // refused because honouring it would silently strip their own payouts.
      const status = error?.code === "last_identity_cannot_be_removed" ? 409 : 400;
      return res.status(status).json({ ok: false, error: error?.code || "unsync_failed" });
    }
  });

  // ── Supply endpoints, for external listing services ─────────────────────
  //
  // WHY THESE EXIST. Jupiter's token review (verified.jup.ag) asks for a
  // circulating-supply URL and states the contract exactly:
  //
  //     Must return JSON: {"circulatingSupply": number}
  //
  // /api/transparency/status was submitted for that and was REJECTED with
  // "Circulating supply is 0 or less" — for a reason worth writing down,
  // because it is a trap anyone reusing that response will fall into. That
  // payload has a top-level `circulatingSupply` key too, but its value is an
  // OBJECT (totals, percentages, the excluded wallet list). Jupiter reads the
  // key, gets an object where it expects a number, and coerces it to NaN.
  // Same key, wrong type, and the failure reads as "your supply is zero".
  //
  // These return exactly the number, and nothing else.
  //
  // THEY NEVER RETURN 0. If the figure cannot be computed — any component
  // wallet unreadable — buildCirculatingSupply() reports ok:false rather than
  // guessing, and these answer 503. A listing service that gets an error keeps
  // its last known value and retries; one that gets a 0 publishes a zero
  // supply, which is the worst outcome available here.
  //
  // Wildcard CORS is deliberate and safe: public, read-only, no credentials,
  // no secrets, and the site's normal origin allowlist would otherwise block a
  // validator running in a browser — which is precisely how the rejection
  // above was produced.
  function sendSupply(res, { key, value, format }) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=60");
    if (String(format || "").toLowerCase() === "plain") {
      // CoinGecko/CMC-style: a bare number as text, no envelope.
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(String(value));
    }
    return res.json({ [key]: value });
  }

  // LAST KNOWN GOOD, so an external poller is never made to wait for a cold
  // RPC build. The transparency snapshot is ~10 chain reads and takes seconds
  // when the 60s cache has lapsed — long enough for a validator to time out and
  // record a failure. Supply changes only when tokens are burned or locks move,
  // so answering instantly with a value from a minute ago is strictly better
  // than answering slowly, and enormously better than not answering.
  //
  // Bounded: past SUPPLY_MAX_STALE_MS the stale value is abandoned and the
  // endpoint reports unavailable rather than serving a figure old enough to be
  // wrong. Silence beats a stale number presented as current.
  const SUPPLY_MAX_STALE_MS = 30 * 60_000;
  let _supplyLastGood = null;
  let _supplyRefreshing = false;

  function refreshSupplyInBackground() {
    if (_supplyRefreshing) return;
    _supplyRefreshing = true;
    cachedTransparencySnapshot()
      .then((snapshot) => {
        const supply = snapshot?.circulatingSupply;
        if (supply?.ok) {
          const circulating = Number(supply.circulatingDisplay);
          const total = Number(supply.totalSupplyDisplay);
          if (circulating > 0 && total > 0) _supplyLastGood = { circulating, total, at: Date.now() };
        }
      })
      .catch((error) => console.warn("[supply] background refresh failed:", error?.message || error))
      .finally(() => { _supplyRefreshing = false; });
  }

  /** The freshest trustworthy figures, without ever blocking on a cold build. */
  async function resolveSupply() {
    const cacheWarm = _transparencyCache && Date.now() - _transparencyCache.at < TRANSPARENCY_CACHE_MS;
    if (!cacheWarm && _supplyLastGood && Date.now() - _supplyLastGood.at < SUPPLY_MAX_STALE_MS) {
      refreshSupplyInBackground();
      return { ..._supplyLastGood, stale: true };
    }
    const supply = (await cachedTransparencySnapshot())?.circulatingSupply;
    if (!supply?.ok) {
      if (_supplyLastGood && Date.now() - _supplyLastGood.at < SUPPLY_MAX_STALE_MS) {
        return { ..._supplyLastGood, stale: true };
      }
      return { error: supply?.reason || "incomplete_source_data" };
    }
    const circulating = Number(supply.circulatingDisplay);
    const total = Number(supply.totalSupplyDisplay);
    if (!(circulating > 0) || !(total > 0)) return { error: "non_positive_result" };
    _supplyLastGood = { circulating, total, at: Date.now() };
    return { circulating, total, stale: false };
  }

  function supplyUnavailable(res, reason) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    // no-store: never let a proxy cache an outage as if it were an answer.
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "supply_unavailable", reason: reason || "incomplete_source_data" });
  }

  app.get("/api/supply/circulating", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    try {
      const supply = await resolveSupply();
      if (supply.error) return supplyUnavailable(res, supply.error);
      return sendSupply(res, { key: "circulatingSupply", value: supply.circulating, format: req.query.format });
    } catch (error) {
      console.warn("[supply] circulating failed:", error?.message || error);
      return supplyUnavailable(res, "lookup_failed");
    }
  });

  app.get("/api/supply/total", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    try {
      const supply = await resolveSupply();
      if (supply.error) return supplyUnavailable(res, supply.error);
      return sendSupply(res, { key: "totalSupply", value: supply.total, format: req.query.format });
    } catch (error) {
      console.warn("[supply] total failed:", error?.message || error);
      return supplyUnavailable(res, "lookup_failed");
    }
  });

  // ── Live Price ──────────────────────────────────────────────────────────
  // Added 2026-07-27: the landing page and /home/'s "Live Stats" widget used
  // to call DexScreener/GeckoTerminal directly from the browser. That has
  // two real problems, confirmed live rather than assumed: GeckoTerminal's
  // public API sends no Access-Control-Allow-Origin header at all (a
  // browser blocks reading the response even though the request itself
  // succeeds), and DexScreener's own API is genuinely flaky for this token
  // — it returned real data on one request and {pairs:null} on the very
  // next request in testing, no code change in between. Fetching
  // server-side sidesteps the CORS gap entirely (irrelevant server-to-
  // server) and lets a real multi-source fallback chain paper over any one
  // source's flakiness, instead of the browser giving up after one blocked
  // call. pump.fun's own API is the last resort — confirmed its own
  // price/market-cap fields stop updating live once a coin graduates off
  // the bonding curve (its own `updated_at` lagged ~40h behind "now" in
  // testing), so a result from it is explicitly flagged `stale` rather than
  // presented as fresh.
  const PRICE_MARKETS = {
    primary: { pool: "Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL", label: "Primary Post-Graduation Market", allowPumpFun: true },
    raydium: { pool: "5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx", label: "Raydium Market", allowPumpFun: false },
    historical: { pool: "H3HoYtV5tg6a2UZqSJhnCidgWcwX4h3KdNewfJMLMgfg", label: "Historical Launch Market", allowPumpFun: false },
  };

  async function fetchGeckoTerminalMarket(pool) {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`);
    if (!res.ok) throw new Error(`geckoterminal_http_${res.status}`);
    const data = await res.json();
    const attrs = data?.data?.attributes;
    const priceUsd = Number(attrs?.base_token_price_usd);
    if (!priceUsd || !Number.isFinite(priceUsd)) throw new Error("geckoterminal_no_price");
    return {
      source: "geckoterminal",
      priceUsd,
      marketCapUsd: Number(attrs.market_cap_usd ?? attrs.fdv_usd) || null,
      volume24hUsd: Number(attrs.volume_usd?.h24) || null,
      liquidityUsd: Number(attrs.reserve_in_usd) || null,
      priceChange24h: Number(attrs.price_change_percentage?.h24) || null,
      stale: false,
    };
  }

  async function fetchDexScreenerMarket(pool) {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cfg.WINLEW_MINT}`);
    if (!res.ok) throw new Error(`dexscreener_http_${res.status}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const pair = pairs.find((p) => p.pairAddress === pool);
    const priceUsd = Number(pair?.priceUsd);
    if (!priceUsd || !Number.isFinite(priceUsd)) throw new Error("dexscreener_no_price");
    return {
      source: "dexscreener",
      priceUsd,
      marketCapUsd: Number(pair.marketCap ?? pair.fdv) || null,
      volume24hUsd: Number(pair.volume?.h24) || null,
      liquidityUsd: Number(pair.liquidity?.usd) || null,
      priceChange24h: Number(pair.priceChange?.h24) || null,
      stale: false,
    };
  }

  async function fetchPumpFunMarket() {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${cfg.WINLEW_MINT}`);
    if (!res.ok) throw new Error(`pumpfun_http_${res.status}`);
    const data = await res.json();
    // Named for what it is. This was `circulating`, which was misleading in a
    // codebase that now computes a real circulating supply 138M lower — but the
    // DIVISOR is correct and must not be changed: pump.fun derives
    // usd_market_cap from total supply, so dividing by anything else would
    // recover the wrong price.
    const supplyForPrice = Number(data.total_supply) / 10 ** WINLEW_DECIMALS;
    const marketCapUsd = Number(data.usd_market_cap);
    const priceUsd = supplyForPrice > 0 ? marketCapUsd / supplyForPrice : NaN;
    if (!priceUsd || !Number.isFinite(priceUsd)) throw new Error("pumpfun_no_price");
    const updatedAgeMs = data.updated_at ? Date.now() - Number(data.updated_at) * 1000 : null;
    return {
      source: "pumpfun",
      priceUsd,
      marketCapUsd: Number.isFinite(marketCapUsd) ? marketCapUsd : null,
      volume24hUsd: null,
      liquidityUsd: null,
      priceChange24h: null,
      stale: updatedAgeMs == null || updatedAgeMs > 10 * 60 * 1000,
    };
  }

  async function buildPriceSnapshot(marketKey) {
    const market = PRICE_MARKETS[marketKey];
    if (!market) throw new Error("unknown_market");
    const attempts = [
      () => fetchGeckoTerminalMarket(market.pool),
      () => fetchDexScreenerMarket(market.pool),
      ...(market.allowPumpFun ? [() => fetchPumpFunMarket()] : []),
    ];
    const errors = [];
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        return { ...result, market: marketKey, pool: market.pool, label: market.label, fetchedAt: new Date().toISOString() };
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }
    throw new Error(`all_price_sources_failed: ${errors.join("; ")}`);
  }

  const _priceCache = {}; // one slot per market key — { at, data }
  const PRICE_CACHE_MS = 30_000;

  app.get("/api/price/status", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    const marketKey = String(req.query.market || "primary").toLowerCase();
    if (!PRICE_MARKETS[marketKey]) {
      return res.status(400).json({ ok: false, error: "unknown_market", markets: Object.keys(PRICE_MARKETS) });
    }
    try {
      const cached = _priceCache[marketKey];
      if (cached && Date.now() - cached.at < PRICE_CACHE_MS) {
        return res.json({ ok: true, ...cached.data });
      }
      const snapshot = await buildPriceSnapshot(marketKey);
      _priceCache[marketKey] = { at: Date.now(), data: snapshot };
      return res.json({ ok: true, ...snapshot });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "price_status_failed" });
    }
  });

  // Governance vote-weight pricing sampler (2026-07-28) — periodically
  // records a price/market-cap observation for governancePricing.js's 3-day
  // trailing average. Reuses buildPriceSnapshot('primary') directly (the
  // exact same function /api/price/status calls) rather than a second price
  // source, so the two can never disagree about what "the price" is. Runs
  // every 30 minutes — frequent enough that a 3-day window has well over a
  // hundred samples (never dominated by any single reading), infrequent
  // enough to stay well within every upstream API's rate limits. Fires once
  // immediately on startup too, so a fresh deploy doesn't wait 30 minutes
  // for its first sample.
  async function sampleGovernanceVotePrice() {
    try {
      const snapshot = await buildPriceSnapshot("primary");
      if (Number.isFinite(snapshot.priceUsd) && snapshot.priceUsd > 0) {
        recordPriceSample({ priceUsd: snapshot.priceUsd, marketCapUsd: snapshot.marketCapUsd });
      }
    } catch (error) {
      console.warn("[governance] price sample failed, will retry next interval:", error?.message || error);
    }
  }
  // The isolated harness blocks external sockets. Avoid scheduling a known
  // three-provider startup probe there; production startup is unchanged.
  if (process.env.WINLEW_TEST_ISOLATED !== "1") {
    sampleGovernanceVotePrice();
    setInterval(sampleGovernanceVotePrice, 30 * 60 * 1000);
  }

  // ── Burn Program ────────────────────────────────────────────────────────
  // Reuses getOwnerTokenSnapshot() — the exact same live-wallet-balance
  // function the Transparency Center's "burn" component already calls, so
  // this never duplicates Solana query logic. Verified burn EVENTS come
  // from the static src/mole/burnEvents.js source of truth (see
  // docs/burn-program.md) — no signing capability exists anywhere in this
  // route or its dependencies; it only ever reads.
  let _burnCache = null;
  const BURN_CACHE_MS = 60_000;
  const BURN_HISTORY_NOTICE =
    "Historical burn reconciliation remains in progress. The entries shown are verified, but may not yet represent the complete lifetime history.";

  function buildBackupScanSummary() {
    const checkpoint = loadBurnScanCheckpoint();
    if (!checkpoint) return null;
    const reconciliation = reconcileBurnRecords(
      { records: checkpoint.records, mint: checkpoint.mint },
      BURN_EVENTS,
      checkpoint.unresolvedSignatures || [],
    );
    return {
      lastSuccessfulScanAt: checkpoint.lastSuccessfulScanAt || null,
      lastFullScanAt: checkpoint.lastFullScanAt || null,
      address: checkpoint.address || BURN_WALLET_ADDRESS,
      signaturesScanned: checkpoint.signaturesScanned ?? null,
      burnInstructionsFound: checkpoint.records.length,
      totalUiBurned: checkpoint.totalUiBurned || null,
      rpcSourceUsed: checkpoint.rpcSourceUsed || null,
      scanVersion: checkpoint.scanVersion || null,
      reconciliation: {
        matchedCount: reconciliation.matched.length,
        missingFromRpcScanCount: reconciliation.missingFromRpcScan.length,
        missingButUnresolvedCount: reconciliation.missingButUnresolved.length,
        missingFromStoredHistoryCount: reconciliation.missingFromStoredHistory.length,
        amountMismatchCount: reconciliation.amountMismatches.length,
      },
    };
  }

  async function buildBurnSnapshot() {
    const summary = summarizeBurnEvents(BURN_EVENTS);
    const progress = computeBurnProgress(summary.confirmedBurnedBaseUnits, BURN_TARGET_BASE_UNITS);

    let wallet;
    try {
      const snapshot = await getOwnerTokenSnapshot(BURN_WALLET_ADDRESS, { signatureLimit: 5 });
      wallet = { ok: true, ...snapshot };
    } catch (error) {
      // Never a false zero — an honest "unavailable" instead, same pattern
      // as the Transparency Center's per-component failure handling.
      wallet = { ok: false, address: BURN_WALLET_ADDRESS, error: error?.message || "burn_wallet_lookup_failed" };
    }

    return {
      generatedAt: new Date().toISOString(),
      wallet,
      events: BURN_EVENTS.map((event) => ({
        ...event,
        amountDisplay: baseUnitsToDecimalString(event.amountBaseUnits, WINLEW_DECIMALS),
      })),
      summary: {
        ...summary,
        confirmedBurnedDisplay: baseUnitsToDecimalString(summary.confirmedBurnedBaseUnits, WINLEW_DECIMALS),
        // Lifetime staged INFLOW, not the wallet's current balance — the two
        // legitimately differ once staged tokens are burned or moved out. Use
        // wallet.winlewBalance for "awaiting burn". See summarizeBurnEvents().
        stagedInflowDisplay: baseUnitsToDecimalString(summary.stagedInflowBaseUnits, WINLEW_DECIMALS),
        // Deprecated alias, kept so the response shape stays stable.
        stagedDisplay: baseUnitsToDecimalString(summary.stagedBaseUnits, WINLEW_DECIMALS),
      },
      progress: {
        ...progress,
        targetDisplay: baseUnitsToDecimalString(progress.targetBaseUnits, WINLEW_DECIMALS),
        confirmedBurnedDisplay: baseUnitsToDecimalString(progress.confirmedBurnedBaseUnits, WINLEW_DECIMALS),
        remainingDisplay: baseUnitsToDecimalString(progress.remainingBaseUnits, WINLEW_DECIMALS),
      },
      benchmark: BURN_BENCHMARK,
      historyNotice: BURN_HISTORY_NOTICE,
      // Reads the last locally-run `npm run burn:scan` checkpoint, if any —
      // NEVER triggers a live scan from this (public) route. See
      // src/scripts/burn-scan.js and docs/burn-history-scanner.md. null
      // until someone has run the scanner at least once on this machine.
      backupScan: buildBackupScanSummary(),
    };
  }

  app.get("/api/burn/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (_req, res) => {
    try {
      if (_burnCache && Date.now() - _burnCache.at < BURN_CACHE_MS) {
        return res.json({ ok: true, ..._burnCache.data });
      }
      const snapshot = await buildBurnSnapshot();
      _burnCache = { at: Date.now(), data: snapshot };
      return res.json({ ok: true, ...snapshot });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "burn_status_failed" });
    }
  });

  // ── Bug Bounties ─────────────────────────────────────────────────────────
  // Pure static data (src/mole/bounties.js) — a bounty's existence, amount,
  // and paid/pending status is a maintainer decision, not chain state, so
  // (like Partners below) there's no RPC/cache handling needed here.
  app.get("/api/bounties/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), (_req, res) => {
    try {
      const summary = summarizeBounties(BOUNTIES);
      return res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        bounties: BOUNTIES.map((bounty) => ({
          ...bounty,
          amountDisplay: baseUnitsToDecimalString(bounty.amountBaseUnits, WINLEW_DECIMALS),
        })),
        summary: {
          ...summary,
          pendingDisplay: baseUnitsToDecimalString(summary.pendingBaseUnits, WINLEW_DECIMALS),
          paidDisplay: baseUnitsToDecimalString(summary.paidBaseUnits, WINLEW_DECIMALS),
        },
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "bounties_status_failed" });
    }
  });

  // ── Sponsors & Partners ─────────────────────────────────────────────────
  // Pure static data (src/mole/partnersData.js, see docs/sponsors-and-partners.md)
  // — no RPC/live dependency, so no cache/timeout handling is needed here.
  // Served through an API route (rather than inlined into the HTML) only for
  // consistency with how every other data-backed page on this site works.
  app.get("/api/partners/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), (_req, res) => {
    try {
      // relatedEvents is a read-only, computed cross-link (getEventsForPartner)
      // — it never duplicates the event record itself, just its id/title/status
      // so the Partners page can link into /events/ without re-fetching.
      const partnersWithEvents = PARTNERS.map((partner) => ({
        ...partner,
        relatedEvents: getEventsForPartner(partner.id).map((event) => ({ id: event.id, title: event.title, status: event.status })),
      }));
      return res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        partners: partnersWithEvents,
        ecosystemSupport: ECOSYSTEM_SUPPORT,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "partners_status_failed" });
    }
  });

  // ── Health / First-Party Route Status ───────────────────────────────────
  // Backs /health/ — actually probes each first-party route over loopback
  // rather than assuming "reachable." Self-requests hit this same process
  // (default bind is 127.0.0.1, see app.listen below), so a route that 404s,
  // 500s, or hangs shows up honestly instead of the static page's old
  // hardcoded "100% Reachable" claim.
  // The routes /health/ reports on. Adding one here is all that is needed —
  // the page renders whatever this endpoint returns. (That instruction used to
  // be printed on the public page itself, addressed to a maintainer; it lives
  // here now, where the person who needs it will actually be.)
  //
  // Only include routes that need NO session: these are fetched over loopback
  // with no cookies, so a session-gated route (e.g. /api/faucet/status) would
  // report 401 and show as permanently unhealthy.
  const FIRST_PARTY_ROUTES = [
    { path: "/verify/", kind: "page" },
    { path: "/discord-bots/", kind: "page" },
    { path: "/health/", kind: "page" },
    { path: "/bounties/", kind: "page" },
    // Added 2026-08-04: the set above had not grown with the site and covered
    // none of the routes people actually come here for. A health page that
    // omits the faucet, the quiz and the games is not reporting on the parts
    // whose failure anyone would notice.
    { path: "/", kind: "page" },
    { path: "/faucet/", kind: "page" },
    { path: "/quiz/", kind: "page" },
    { path: "/mole-hub/", kind: "page" },
    { path: "/governance/", kind: "page" },
    { path: "/transparency/", kind: "page" },
    { path: "/burn/", kind: "page" },
    // "api" checks go one level deeper than an HTTP 200 — each of these
    // routes can itself 200 with an internal { ok:false, error } body (e.g.
    // a failed Solana RPC lookup), so a plain reachability check would miss
    // that. See the ok/detail parsing below.
    { path: "/api/transparency/status", kind: "api" },
    { path: "/api/burn/status", kind: "api" },
    { path: "/api/partners/status", kind: "api" },
    { path: "/api/events/status", kind: "api" },
    { path: "/api/modules/status", kind: "api" },
    { path: "/api/bounties/status", kind: "api" },
    // Also added 2026-08-04. /api/price/status is the one most worth watching:
    // it exists precisely because the third-party price sources it replaced
    // kept failing, and it is server-cached, so checking it is cheap.
    { path: "/api/price/status", kind: "api" },
    { path: "/api/faucet/global-stats", kind: "api" },
    // NOT included, deliberately: /api/discord-bots/status. It is public and
    // would otherwise belong here, but it is uncached and fans out to 3
    // external services per call. Health-checking it would turn every /health/
    // load into 3 extra outbound requests, and its own rate limit (30 per 10s)
    // would let a page refresh amplify to ~90. Add it once it caches its
    // reachability results the way the price and faucet-stats routes do.
  ];

  let _healthCache = null;
  const HEALTH_CACHE_MS = 90_000;

  async function buildHealthSnapshot() {
      const host = process.env.WEB_HOST || process.env.HOST || "127.0.0.1";
      const routes = await Promise.all(
        FIRST_PARTY_ROUTES.map(async (route) => {
          const startedAt = Date.now();
          const controller = new AbortController();
          // API checks can involve a live Solana RPC call downstream
          // (transparency/burn) — give them more room than a static page.
          const timeout = setTimeout(() => controller.abort(), route.kind === "api" ? 8000 : 3000);
          try {
            const r = await fetch(`http://${host}:${cfg.PORT}${route.path}`, { signal: controller.signal });
            let ok = r.ok;
            let detail;
            if (route.kind === "api") {
              try {
                const body = await r.json();
                ok = ok && body?.ok === true;
                if (!ok && body?.error) detail = body.error;
              } catch {
                ok = false;
                detail = "invalid_json_response";
              }
            }
            return { path: route.path, kind: route.kind, ok, status: r.status, latencyMs: Date.now() - startedAt, detail };
          } catch (error) {
            return { path: route.path, kind: route.kind, ok: false, status: null, latencyMs: Date.now() - startedAt, error: error?.message || "request_failed" };
          } finally {
            clearTimeout(timeout);
          }
        })
      );
      // Store names and "how long" only — no error text. This route is
      // public and unauthenticated; a Mongo error message is an internals
      // leak this endpoint has no business carrying.
      const storageSyncHealth = getStorageSyncHealth().map(({ name, since }) => ({ name, degradedSinceMs: Date.now() - since }));
      return {
        checkedAt: new Date().toISOString(),
        routes,
        reachableCount: routes.filter((r) => r.ok).length,
        totalCount: routes.length,
        storageSyncHealth,
      };
  }

  async function cachedHealthSnapshot() {
    if (_healthCache && Date.now() - _healthCache.at < HEALTH_CACHE_MS) return _healthCache.data;
    const data = await buildHealthSnapshot();
    _healthCache = { at: Date.now(), data };
    return data;
  }

  app.get("/api/health/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await cachedHealthSnapshot()) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "health_status_failed" });
    }
  });

  // ── Discord Bots — Service Reachability (added 2026-07-17) ─────────────
  // What this does NOT claim, stated up front because it matters: this
  // checks whether the underlying proxy TARGET (a port on this host) is
  // reachable and answers an HTTP request at all — it is NOT a Discord
  // gateway check and cannot confirm a bot is actually connected to
  // Discord. That signal isn't observable from this process for any of the
  // 5 bots shown on /discord-bots/ — verified by direct investigation, not
  // assumed: The Mole Guard's and WinLEW Utility Bot's Discord clients are
  // local variables inside their own bot processes (src/mole/bot.js,
  // src/faucet/bot.js), never exported, written to a file, or exposed any
  // other way this web process could read — so they're deliberately absent
  // from DISCORD_BOT_SERVICES below rather than given a fake status. Watch
  // Dog/GeoHackers/GeoAgora at least have a known proxy target to probe.
  // Any HTTP response at all — including a 404/405 from a route that
  // doesn't exist on that target — still proves reachability; only a
  // connection failure or timeout means "not reachable."
  const DISCORD_BOT_SERVICES = [
    { id: "watchdog", label: "WinLEW Watch Dog", url: watchdogLocalUrl },
    { id: "geohackers", label: "GeoHackers", url: geoHackersApiTarget },
    { id: "geoagora", label: "GeoAgora", url: geoAgoraApiTarget },
  ];

  async function checkServiceReachable(url, timeoutMs = 3000) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method: "GET", signal: controller.signal });
      return { reachable: true, status: r.status, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { reachable: false, status: null, latencyMs: Date.now() - startedAt, error: error?.name === "AbortError" ? "timeout" : "connection_failed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  app.get("/api/discord-bots/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (_req, res) => {
    try {
      const services = await Promise.all(
        DISCORD_BOT_SERVICES.map(async (svc) => ({ id: svc.id, label: svc.label, ...(await checkServiceReachable(svc.url)) }))
      );
      return res.json({
        ok: true,
        checkedAt: new Date().toISOString(),
        note: "\"Reachable\" means the underlying service's port answered an HTTP request — it does not confirm the bot is connected to Discord, which isn't observable from this process. The Mole Guard and WinLEW Utility Bot are intentionally absent — there is nothing honest to check for them today.",
        services,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "discord_bots_status_failed" });
    }
  });

  // ── Bot liveness (the red/green light) ──────────────────────────────────
  // Public read. Coarse on purpose: a service id, a state, and how long ago it
  // last checked in. No hostnames, no ports, no versions of anything but the
  // bot itself — this is rendered on a public page.
  app.get("/api/bot/health", simpleRateLimit({ windowMs: 10_000, max: 60 }), (_req, res) => {
    try {
      return res.json({ ok: true, ...botHealthPayload() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "bot_health_failed" });
    }
  });

  // Write path — bots POST here. Shared-secret authenticated, because an open
  // endpoint would let anyone paint the light green during a real outage,
  // which is strictly worse than having no light at all.
  //
  // Falls back to WATCHDOG_HEARTBEAT_TOKEN so an existing deployment does not
  // need a second secret; set BOT_HEARTBEAT_TOKEN to separate them.
  app.post("/api/bot/heartbeat", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    const expected = String(process.env.BOT_HEARTBEAT_TOKEN || cfg.WATCHDOG_HEARTBEAT_TOKEN || "").trim();
    if (!expected) return res.status(503).json({ ok: false, error: "heartbeat_not_configured" });

    const provided = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    // Length-independent compare is overkill for a liveness ping, but the
    // token is shared with the watchdog, so treat it like the credential it is.
    const ok = provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) return res.status(401).json({ ok: false, error: "unauthorized" });

    const service = String(req.body?.service || "").trim();
    if (!isKnownService(service)) {
      // Explicit rather than silently creating a service: a typo in a bot's
      // config should surface as a rejected heartbeat, not a second light.
      return res.status(400).json({ ok: false, error: `unknown_service:${service.slice(0, 40)}` });
    }
    try {
      const record = recordBotHeartbeat({ service, kind: req.body?.kind, version: req.body?.version });
      return res.json({ ok: true, service: record.service, lastSeenAtSec: record.lastSeenAtSec });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error?.message || "heartbeat_failed" });
    }
  });

  // ── Community Events ────────────────────────────────────────────────────
  // Pure static data (src/mole/eventsData.js, see docs/community-events.md)
  // — no RPC/live dependency. Bucketing (upcoming/live/completed/cancelled)
  // is computed at request time via the same classifyEventBucket() the
  // data module exports and unit tests cover, so "live" status is always
  // correct against the real current time rather than a stale stored flag.
  app.get("/api/events/status", simpleRateLimit({ windowMs: 10_000, max: 30 }), (_req, res) => {
    try {
      return res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        groups: groupEventsByBucket(EVENTS),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "events_status_failed" });
    }
  });

  // ── Modules & Roadmap Status ────────────────────────────────────────────
  // Pure static data (src/mole/modulesData.js) — no live RPC/API/Mongo
  // dependency, no secrets, no filesystem paths beyond the module ids/
  // routes that are already public. Single source of truth for /modules/,
  // the homepage roadmap section, and anywhere else module status is
  // shown — see docs/modules-system.md.
  app.get("/api/modules/status", simpleRateLimit({ windowMs: 10_000, max: 40 }), (_req, res) => {
    try {
      return res.json({ ok: true, ...getModulesStatusPayload() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "modules_status_failed" });
    }
  });

  // ── Governance Module v1 ────────────────────────────────────────────────
  // No signing, no treasury access, no burn-execution capability exists
  // anywhere in this block. Every write path (castVote) only ever touches
  // governance_votes.json (via governanceStore.js) — never a wallet, never
  // a Solana transaction. See docs/governance-v1.md's Execution Boundaries.
  // resolveGovernanceEligibility() itself is a top-level function (see
  // above buildProfilePayload) so the Dashboard can share the exact same
  // cached eligibility check these routes use, rather than a second
  // implementation.
  function publicProposalSummary(proposal) {
    const results = computeResults(proposal);
    return {
      id: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      category: proposal.category,
      governanceMode: proposal.governanceMode,
      status: proposal.status,
      authorType: proposal.authorType,
      createdIso: proposal.createdIso,
      votingStartIso: proposal.votingStartIso,
      votingEndIso: proposal.votingEndIso,
      executionStatus: proposal.executionStatus,
      lastUpdatedIso: proposal.lastUpdatedIso,
      results,
    };
  }

  function publicProposalDetail(proposal) {
    const results = computeResults(proposal);
    return {
      ...proposal,
      results,
      // finalResults stays as authored (used for CLOSED archival records);
      // `results` above is always the live, server-computed number so the
      // two can never silently disagree during an active vote.
    };
  }

  app.get("/api/governance/proposals", simpleRateLimit({ windowMs: 10_000, max: 40 }), (_req, res) => {
    try {
      return res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        config: { minWinlewToVote: GOVERNANCE_CONFIG.minWinlewToVote, minWinlewToPurchaseVotes: GOVERNANCE_CONFIG.minWinlewToPurchaseVotes, votingMethod: GOVERNANCE_CONFIG.votingMethod, version: GOVERNANCE_CONFIG.version },
        proposals: PROPOSALS.map(publicProposalSummary),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_proposals_failed" });
    }
  });

  app.get("/api/governance/proposals/:id", simpleRateLimit({ windowMs: 10_000, max: 40 }), (req, res) => {
    try {
      const proposal = getProposalById(String(req.params.id || ""), PROPOSALS);
      if (!proposal) return res.status(404).json({ ok: false, error: "proposal_not_found" });
      return res.json({ ok: true, generatedAt: new Date().toISOString(), proposal: publicProposalDetail(proposal) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_proposal_failed" });
    }
  });

  // Governance participation leaderboard (2026-07-31) — "who shows up",
  // deliberately NOT "who voted which way".
  //
  // governanceData.js sets voteChoicePrivacy: "private-until-never", so this
  // never returns, counts, or groups by `choice`; it only counts how many
  // proposals a wallet has voted on and the total weight they carried. Same
  // aggregate-only discipline computeResults() follows.
  app.get("/api/governance/leaderboard", simpleRateLimit({ windowMs: 10_000, max: 60 }), (_req, res) => {
    try {
      const votes = readAllVotes();
      const byUser = new Map();
      for (const [proposalId, walletVotes] of Object.entries(votes || {})) {
        // Only proposals that still exist — a removed/renamed proposal must
        // not keep inflating someone's participation count.
        if (!getProposalById(proposalId, PROPOSALS)) continue;
        for (const vote of Object.values(walletVotes || {})) {
          const userId = String(vote?.discordUserId || "");
          if (!userId) continue;
          const entry = byUser.get(userId) || { discordUserId: userId, proposalsVoted: 0, totalWeight: 0, lastVotedIso: null };
          entry.proposalsVoted += 1;
          entry.totalWeight += Math.max(1, Number(vote.weight) || 1);
          const at = vote.updatedAtIso || vote.castAtIso || null;
          if (at && (!entry.lastVotedIso || at > entry.lastVotedIso)) entry.lastVotedIso = at;
          byUser.set(userId, entry);
        }
      }

      // Small-turnout privacy gate. Participation plus a public tally can
      // reverse-engineer a private choice: if one person voted and the
      // result reads 1-0, naming that voter names their vote. So this board
      // stays sealed until enough distinct people have voted that no single
      // row can be triangulated back to a choice.
      //
      // Enforced HERE, not in the page — a client-side hide would still
      // serve the identities to anyone who opened the endpoint directly.
      // Below the threshold the response carries counts only: never a name,
      // never a discordUserId, never a choice.
      const minVoters = Math.max(2, Number(process.env.GOVERNANCE_LEADERBOARD_MIN_VOTERS || 5));
      const voterCount = byUser.size;
      const base = {
        ok: true,
        generatedAt: new Date().toISOString(),
        totalProposals: PROPOSALS.filter((p) => VOTABLE_STATUSES.includes(p.status)).length,
        voterCount,
        minVoters,
      };

      if (voterCount > 0 && voterCount < minVoters) {
        return res.json({ ...base, gated: true, entries: [] });
      }

      const entries = [...byUser.values()]
        .sort((a, b) => b.proposalsVoted - a.proposalsVoted || b.totalWeight - a.totalWeight)
        .slice(0, 25)
        .map((row, i) => ({
          rank: i + 1,
          ...quizDisplayName(row.discordUserId),
          proposalsVoted: row.proposalsVoted,
          totalWeight: row.totalWeight,
          lastVotedIso: row.lastVotedIso,
        }));

      return res.json({ ...base, gated: false, entries });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_leaderboard_failed" });
    }
  });

  app.get("/api/governance/eligibility/:id", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const proposal = getProposalById(String(req.params.id || ""), PROPOSALS);
      if (!proposal) return res.status(404).json({ ok: false, error: "proposal_not_found" });
      const eligibility = await resolveGovernanceEligibility(s.discordUserId, proposal);
      const votingOpen = VOTABLE_STATUSES.includes(proposal.status);
      // Balance comes from the eligibility result so purchased weight is
      // judged on the same (snapshot-locked) number eligibility was.
      const voteWeight = await resolveVoteWeightInfo(s.discordUserId, proposal.id, { balance: eligibility.balance });
      return res.json({
        ok: true,
        ...eligibility,
        votingOpen,
        minWinlewToVote: GOVERNANCE_CONFIG.minWinlewToVote,
        minWinlewToPurchaseVotes: GOVERNANCE_CONFIG.minWinlewToPurchaseVotes,
        voteWeight,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_eligibility_failed" });
    }
  });

  app.get("/api/governance/my-vote/:id", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const proposal = getProposalById(String(req.params.id || ""), PROPOSALS);
      if (!proposal) return res.status(404).json({ ok: false, error: "proposal_not_found" });
      const linked = getLinkedWalletRecord(s.discordUserId);
      const verification = getWalletVerificationStatus(linked);
      if (!verification.verified || !verification.wallet) return res.json({ ok: true, hasVoted: false, vote: null });
      const vote = getWalletVote(proposal.id, verification.wallet);
      // Read-only preview. Resolve eligibility purely to learn the snapshot
      // balance, so the purchased-weight figure shown here matches what the
      // vote route would actually allocate. Failing soft to null balance just
      // shows 0 purchased weight; it never blocks reading your own vote.
      const weightEligibility = await resolveGovernanceEligibility(s.discordUserId, proposal).catch(() => null);
      const voteWeight = await resolveVoteWeightInfo(s.discordUserId, proposal.id, { balance: weightEligibility?.balance ?? null });
      return res.json({ ok: true, hasVoted: !!vote, vote: vote ? { choice: vote.choice, weight: vote.weight || 1, castAtIso: vote.castAtIso, updatedAtIso: vote.updatedAtIso } : null, voteWeight });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_my_vote_failed" });
    }
  });

  // Session-authenticated only — identity and wallet are both resolved
  // server-side from the session, exactly like /api/quiz/redeem. The
  // client sends only { session, proposalId, choice }; it can never
  // supply its own wallet address or eligibility claim.
  app.post("/api/governance/vote", simpleRateLimit({ windowMs: 10_000, max: 15 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const proposal = getProposalById(String(req.body?.proposalId || ""), PROPOSALS);
      if (!proposal) return res.status(404).json({ ok: false, error: "proposal_not_found" });

      const eligibility = await resolveGovernanceEligibility(s.discordUserId, proposal);
      if (eligibility.eligible === null) {
        return res.status(503).json({ ok: false, error: "eligibility_check_unavailable" });
      }
      if (!eligibility.eligible) {
        return res.status(403).json({ ok: false, error: eligibility.reason });
      }

      const choice = req.body?.choice;
      // allocate:true actually locks in this proposal's purchased-weight
      // allocation (src/mole/governanceVoteCredits.js), not just previews
      // it — this is the one call site that should ever do that, since it's
      // the point a vote is actually being cast/updated.
      const voteWeight = await resolveVoteWeightInfo(s.discordUserId, proposal.id, { allocate: true, balance: eligibility.balance });
      const totalWeight = 1 + voteWeight.purchasedWeight;
      const result = castVote({ proposal, walletAddress: eligibility.wallet, discordUserId: s.discordUserId, choice, weight: totalWeight });
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

      // Best-effort notification, same pattern as the submission webhook
      // above — never blocks the response on a Discord outage.
      sendGovernanceVoteMessage({ proposal, discordUserId: s.discordUserId, choice });

      return res.json({ ok: true, vote: result.vote, results: computeResults(proposal) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_vote_failed" });
    }
  });

  // ── Governance v1.1 — community proposal submission review queue ────────
  // Every route below resolves identity from the session server-side,
  // exactly like /api/governance/vote — the client never supplies its own
  // discordUserId or wallet. Nothing here can publish a submission into
  // PROPOSALS; see src/mole/governanceSubmissions.js's module header and
  // docs/governance-v1.1-hardening.md.
  app.post("/api/governance/submissions", simpleRateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const linked = getLinkedWalletRecord(s.discordUserId);
      const verification = getWalletVerificationStatus(linked);
      if (!verification.verified || !verification.wallet) {
        return res.status(403).json({ ok: false, error: "verified_wallet_required" });
      }
      const result = createSubmission({ discordUserId: s.discordUserId, wallet: verification.wallet, fields: req.body?.fields });
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error, field: result.field, limit: result.limit });

      // Best-effort notification — sendGovernanceSubmissionMessage already
      // catches its own errors internally, so a webhook outage never fails
      // the submission itself (the record is already durably written above).
      sendGovernanceSubmissionMessage({ webhookUrl: cfg.GOVERNANCE_WEBHOOK_URL, submission: result.submission });

      return res.json({ ok: true, submission: result.submission });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_submission_failed" });
    }
  });

  app.get("/api/governance/submissions/mine", simpleRateLimit({ windowMs: 10_000, max: 30 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      return res.json({ ok: true, submissions: listSubmissionsByOwner(s.discordUserId) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_submissions_list_failed" });
    }
  });

  // Maintainer-only list of every submission — must be registered before
  // the /:id route below so "mine" never matches as a wildcard :id (it
  // already doesn't, since it's a distinct literal path, but this route is
  // ALSO a literal path with no :id, so ordering relative to /:id doesn't
  // matter here — kept adjacent to /mine for readability).
  app.get("/api/governance/submissions", simpleRateLimit({ windowMs: 10_000, max: 30 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    if (!isGovernanceMaintainer(s.discordUserId)) return res.status(403).json({ ok: false, error: "maintainer_required" });
    try {
      return res.json({ ok: true, submissions: listAllSubmissions() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_submissions_list_failed" });
    }
  });

  app.get("/api/governance/submissions/:id", simpleRateLimit({ windowMs: 10_000, max: 30 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const submission = getSubmissionById(String(req.params.id || ""));
      if (!submission) return res.status(404).json({ ok: false, error: "submission_not_found" });
      const isOwner = String(submission.discordUserId) === String(s.discordUserId);
      const isMaintainer = isGovernanceMaintainer(s.discordUserId);
      if (!isOwner && !isMaintainer) {
        // Never distinguish "exists but not yours" from "doesn't exist" —
        // both return the same shape so a caller can't probe for other
        // users' submission ids.
        return res.status(404).json({ ok: false, error: "submission_not_found" });
      }
      return res.json({ ok: true, submission });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_submission_lookup_failed" });
    }
  });

  app.post("/api/governance/submissions/:id/withdraw", simpleRateLimit({ windowMs: 10_000, max: 15 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const result = withdrawSubmission({ id: String(req.params.id || ""), discordUserId: s.discordUserId });
      if (!result.ok) {
        const status = result.error === "not_owner" || result.error === "submission_not_found" ? 404 : 400;
        return res.status(status).json({ ok: false, error: result.error === "not_owner" ? "submission_not_found" : result.error });
      }
      return res.json({ ok: true, submission: result.submission });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_submission_withdraw_failed" });
    }
  });

  // Maintainer moderation actions — approve-for-drafting/reject/
  // request-revision/archive. Explicitly NOT a publish endpoint: even
  // approved-for-drafting only marks review intent. Turning a submission
  // into a real votable PROPOSALS entry is a separate maintainer action
  // outside this API (editing governanceData.js), by design — see
  // docs/governance-v1.1-hardening.md.
  app.post("/api/governance/submissions/:id/review", simpleRateLimit({ windowMs: 10_000, max: 30 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    if (!isGovernanceMaintainer(s.discordUserId)) return res.status(403).json({ ok: false, error: "maintainer_required" });
    try {
      const toStatus = String(req.body?.toStatus || "");
      if (!Object.values(SUBMISSION_STATUSES).includes(toStatus)) {
        return res.status(400).json({ ok: false, error: "invalid_status" });
      }
      const result = reviewSubmission({ id: String(req.params.id || ""), toStatus, byDiscordUserId: s.discordUserId, reason: req.body?.reason || null });
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

      sendGovernanceReviewMessage({ submission: result.submission, toStatus, byDiscordUserId: s.discordUserId, reason: req.body?.reason || null });

      return res.json({ ok: true, submission: result.submission });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "governance_submission_review_failed" });
    }
  });

  app.get("/api/quiz/me", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const quiz = buildQuizSnapshot(s.discordUserId);
      const cycleRank = quizDb.topCycleUsers(null, 1000).findIndex((u) => String(u.userId) === String(s.discordUserId));
      const alltimeRank = quizDb.topUsers(1000).findIndex((u) => String(u.userId) === String(s.discordUserId));
      const webCap = Math.max(1, Number(process.env.QUIZ_WEB_DAILY_CAP || 20));
      // Read-only preview of the wallet redemption settlement will use — the
      // exact same lookup src/quiz/payout-worker.js calls at payout time.
      // Never resolved from anything the browser sends.
      const linked = quizWallets.getLinkedWallet(s.discordUserId, "payout");
      return res.json({
        ok: true,
        quiz,
        ranks: {
          cycle: cycleRank >= 0 ? cycleRank + 1 : null,
          alltime: alltimeRank >= 0 ? alltimeRank + 1 : null,
        },
        quizWeb: {
          capPerDay: webCap,
          remainingToday: Math.max(0, webCap - quizDb.getWebDailyCount(s.discordUserId)),
        },
        platformStats: quizDb.getUserPlatformStats(s.discordUserId),
        tierStats: quizDb.getUserTierStats(s.discordUserId),
        redemption: {
          payoutRate: quizDb.getPayoutRate(),
          minRedeemPoints: quizDb.getMinRedemptionPoints(),
          linkedWallet: linked ? { address: linked.address, source: linked.source } : null,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "quiz_me_failed" });
    }
  });

  // ── Web quiz point redemption (parity with Discord's /redeem) ─────────────
  // Both surfaces call the exact same redeemQuizPoints() service
  // (src/quiz/redemption.js), which itself calls the exact same
  // db.redeemPoints() Discord has always used — same balance, same
  // redemption records, same settlement worker downstream. This route does
  // NOT trigger any on-chain transfer: it only creates a 'pending'
  // redemption record. Settlement (the real WinLEW transfer) is executed
  // exclusively by src/quiz/payout-worker.js, a separate process, exactly
  // as it already does for Discord-originated redemptions — nothing about
  // that worker changed. Session-authenticated only: identity comes from
  // getSession()'s discordUserId, never from a client-supplied wallet/user
  // id, so public-profile mode (no session) cannot reach this route.
  app.post("/api/quiz/redeem", simpleRateLimit({ windowMs: 15_000, max: 8 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const result = await redeemQuizPoints({ userId: s.discordUserId, amount: req.body?.amount, source: "web" });
      // `code` (added 2026-07-26 alongside the holder-only gate) lets the
      // frontend distinguish "you need to buy WinLEW" from every other
      // rejection reason, instead of string-matching the human-readable
      // `error` text.
      if (!result.ok) {
        console.warn("[quiz-web] redeem rejected", JSON.stringify({
          userId: s.discordUserId,
          amount: req.body?.amount ?? null,
          code: result.code || null,
          error: result.error || "quiz_redeem_rejected",
        }));
        return res.status(400).json({ error: result.error, code: result.code });
      }
      void logSiteEvent({
        type: "quiz_redeem", icon: "🎟️", source: SITE_LOG_SOURCES.QUIZ,
        // The title has to agree with the outcome. A refusal headed
        // "redemption requested" reads as a success to anyone skimming, which
        // is the same defect as the User/Linked contradiction: the log saying
        // one thing in the icon and another in the words.
        title: result?.ok === false ? "Quiz redemption refused (website)" : "Quiz redemption requested (website)",
        discordUserId: s.discordUserId,
        outcome: result?.ok === false ? "refused" : undefined,
        fields: {
          Points: req.body?.amount,
          Record: result?.id,
          // The refusal code is the single most useful field for tracing "it
          // would not let me redeem" back to a rule.
          Refused: result?.ok === false ? `\`${result.code || "unknown"}\`` : undefined,
        },
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error?.message || "quiz_redeem_failed" });
    }
  });

  // ── Quiz web-play (per-user on-demand; awards real cycle points) ──────────
  // Server-authoritative: the correct (shuffled) index lives only in the
  // in-memory instance; the client gets { q, choices } and submits an index.
  // Anti-farm: 30s timer, one submit per instance, answer-once per cycle, and a
  // daily scored cap. Awards reuse quizDb.addPoints (parity with Discord).
  const quizInstances = new Map();    // instanceId -> instance
  const quizActiveByUser = new Map(); // userId -> instanceId
  const QUIZ_WEB_CAP = Math.max(1, Number(process.env.QUIZ_WEB_DAILY_CAP || 20));
  const QUIZ_WEB_TTL_SEC = Math.max(5, Number(process.env.QUIZ_WEB_TIME_LIMIT_SEC || 30));

  function sweepQuizInstances() {
    const now = Date.now();
    for (const [id, inst] of quizInstances) {
      if (inst.consumed || inst.expiresAt < now - 60_000) {
        quizInstances.delete(id);
        if (quizActiveByUser.get(inst.userId) === id) quizActiveByUser.delete(inst.userId);
      }
    }
  }

  app.post("/api/quiz/play/next", simpleRateLimit({ windowMs: 10_000, max: 40 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      sweepQuizInstances();
      const userId = String(s.discordUserId);
      const remainingToday = Math.max(0, QUIZ_WEB_CAP - quizDb.getWebDailyCount(userId));
      if (remainingToday <= 0) {
        return res.json({ ok: true, done: true, reason: "daily_cap", remainingToday: 0, capPerDay: QUIZ_WEB_CAP });
      }
      const requestedLevel = String(req.body?.level || "").trim().toLowerCase();
      if (requestedLevel && !QUIZ_TIERS.includes(requestedLevel)) {
        return res.status(400).json({ error: "invalid_level" });
      }
      // Sponsor sub-selection (added 2026-07-18): mirrors Discord's own
      // `/sponsorquiz sponsor:<xyo|winlew>` option — only meaningful when
      // level is "sponsor"; ignored otherwise. normalizeSponsorKey() is the
      // exact same normalizer Discord's /sponsorquiz already uses, so "xyo",
      // "XYO", and "docs.xyo.network" all resolve identically here too.
      const requestedSponsor = requestedLevel === "sponsor" && req.body?.sponsor
        ? quizSponsor.normalizeSponsorKey(req.body.sponsor)
        : null;
      // Idempotent: hand back the live instance if one is still open FOR THE
      // SAME TIER (and, for sponsor questions, the SAME sponsor) the user
      // just picked. A stale instance from a different tier or a different
      // sponsor (left over from switching tiles mid-question) is never
      // returned — it just expires on its own via sweepQuizInstances;
      // nothing was at risk since it was never consumed.
      const active = quizInstances.get(quizActiveByUser.get(userId));
      if (
        active && !active.consumed && active.expiresAt > Date.now() &&
        (!requestedLevel || active.level === requestedLevel) &&
        (!requestedSponsor || active.sponsorKey === requestedSponsor)
      ) {
        return res.json({ ok: true, instanceId: active.id, q: active.q, choices: active.choices, points: active.points, level: active.level, sponsorKey: active.sponsorKey || null, expiresAt: active.expiresAt, timeLimitSec: QUIZ_WEB_TTL_SEC, remainingToday });
      }
      const cycle = quizDb.getCurrentCycle();
      const answered = new Set(quizDb.getWebAnsweredThisCycle(userId, cycle.id));
      let pool = quizWebPool().filter((item) => !answered.has(item.id));
      if (requestedLevel) pool = pool.filter((item) => item.level === requestedLevel);
      if (requestedSponsor) pool = pool.filter((item) => item.sponsorKey === requestedSponsor);
      if (!pool.length) {
        return res.json({ ok: true, done: true, reason: "exhausted", level: requestedLevel || null, sponsor: requestedSponsor || null, remainingToday, capPerDay: QUIZ_WEB_CAP });
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const shuffled = quizShuffle(pick.raw);
      const id = crypto.randomBytes(12).toString("hex");
      const inst = {
        id, userId, questionId: pick.id, level: pick.level, sponsorKey: pick.sponsorKey || null, points: pick.points,
        correctIndex: shuffled.answerIndex, q: shuffled.q, choices: shuffled.choices,
        cycleId: cycle.id, expiresAt: Date.now() + QUIZ_WEB_TTL_SEC * 1000, consumed: false,
      };
      quizInstances.set(id, inst);
      quizActiveByUser.set(userId, id);
      return res.json({ ok: true, instanceId: id, q: inst.q, choices: inst.choices, points: inst.points, level: inst.level, sponsorKey: inst.sponsorKey || null, expiresAt: inst.expiresAt, timeLimitSec: QUIZ_WEB_TTL_SEC, remainingToday });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "quiz_next_failed" });
    }
  });

  app.post("/api/quiz/play/answer", simpleRateLimit({ windowMs: 10_000, max: 60 }), (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const userId = String(s.discordUserId);
      const inst = quizInstances.get(String(req.body?.instanceId || ""));
      if (!inst || inst.userId !== userId) return res.status(404).json({ error: "instance_not_found" });
      if (inst.consumed) return res.status(400).json({ error: "already_answered" });

      // Stage 2 participation signals — hashed on arrival, read by nothing yet.
      // Wrapped so a signal problem can never fail an answer: the participant
      // earned the point either way, and telemetry is not allowed to stand
      // between them and it.
      try {
        const signals = collectSignals(req, req.body?.fingerprint);
        if (signals) {
          quizDb.recordParticipation({
            userId,
            cycleId: quizDb.getCurrentCycle?.()?.id || null,
            deviceHash: signals.deviceHash,
            netHash: signals.netHash,
            answerMs: Number(req.body?.answerMs) || null,
          });
        }
      } catch (error) {
        console.warn("[participation] signal capture failed:", error?.message || error);
      }
      inst.consumed = true; // one submit per instance — no brute force
      if (quizActiveByUser.get(userId) === inst.id) quizActiveByUser.delete(userId);

      const expired = Date.now() > inst.expiresAt;
      const correct = !expired && Number(req.body?.choice) === inst.correctIndex;

      let awarded = 0;
      let dailyCount = quizDb.getWebDailyCount(userId);
      if (correct) {
        // Re-check answer-once + cap at award time (defends against races).
        const answered = new Set(quizDb.getWebAnsweredThisCycle(userId, inst.cycleId));
        if (!answered.has(inst.questionId) && dailyCount < QUIZ_WEB_CAP) {
          // Sponsor questions credit the same payout-eligible points pool as
          // addPoints, but also keep the per-sponsor breakdown Discord's
          // !sponsorquiz already tracks (db.js's addSponsorPoints does both).
          if (inst.level === "sponsor" && inst.sponsorKey) {
            quizDb.addSponsorPoints(userId, inst.sponsorKey, inst.points);
          } else {
            quizDb.addPoints(userId, inst.points);
          }
          dailyCount = quizDb.recordWebAnswer(userId, inst.cycleId, inst.questionId).dailyCount;
          awarded = inst.points;
        }
      }
      // Informational only — separate from the addPoints/addSponsorPoints
      // calls above, which remain the sole source of truth for payout-
      // eligible points. Uses the
      // same `correct`/`awarded` the player actually saw (expired => false).
      quizDb.recordPlatformAnswer(userId, "web", { correct, points: awarded });
      quizDb.recordTierAnswer(userId, inst.level, { correct, points: awarded });
      // Also record the sponsor-specific tile's own accuracy (added
      // 2026-07-18) — the combined "sponsor" bucket above is kept for
      // continuity with any pre-existing accuracy history, but a player
      // choosing the XYO or WinLEW tile specifically wants to see THAT
      // tile's own accuracy, not a blended average across both sponsors.
      if (inst.level === "sponsor" && (inst.sponsorKey === "xyo" || inst.sponsorKey === "winlew")) {
        quizDb.recordTierAnswer(userId, `sponsor-${inst.sponsorKey}`, { correct, points: awarded });
      }

      console.log("[quiz-web] answer", JSON.stringify({ userId, questionId: inst.questionId, level: inst.level, correct, expired, awarded }));
      return res.json({ ok: true, correct, expired, awarded, correctIndex: inst.correctIndex, remainingToday: Math.max(0, QUIZ_WEB_CAP - dailyCount) });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "quiz_answer_failed" });
    }
  });

  // ── Faucet (shared claim/cooldown with the Discord !faucet/!drip command) ──
  // Reservation-only from this process — the actual token transfer for
  // web-originated claims is executed by the separate faucetpayouts worker
  // (src/faucet/payout-worker-main.js), which is the only process besides
  // the Discord bot that ever touches the treasury keypair. See
  // docs/faucet-web-expansion.md.
  function maskWalletAddress(address) {
    const s = String(address || "");
    return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
  }

  function faucetDiscordName(discordUserId) {
    const prefs = getProfilePrefsByUser(discordUserId) || {};
    const name = String(prefs.displayName || "").trim();
    return name ? name.slice(0, 32) : `Player ••${String(discordUserId).slice(-4)}`;
  }

  /**
   * Which id the faucet's linkage store should be queried under.
   *
   * THE STORE IS ACCOUNT-KEYED, NOT DISCORD-KEYED, and that is easy to get
   * wrong: completeLink() writes under the SESSION id (src/mole/web.js), so an
   * X- or wallet-rooted account that verified a wallet on the site is filed
   * under `wallet:<hash>` / `x:<hash>`. Live data already contains such keys.
   * getLinkedWallet() is a plain string lookup and accepts them happily.
   *
   * So resolving to a Discord snowflake and stopping there would tell a
   * wallet-rooted user to "attach Discord" while their wallet sat in the store
   * under the very id we were handed — the same class of lie this whole change
   * exists to remove, pointed at a different group of people.
   *
   * Order: Discord wins where it has a wallet, because it is the older,
   * signature-backed record and the id every other Discord-facing system uses.
   * Otherwise fall back to the account's own key. Returns null only when there
   * is no Discord identity AND no account-keyed wallet — the one case where
   * "attach Discord" is genuinely the next step.
   */
  async function faucetLookupId(accountId) {
    const discordId = discordUserIdForAccount(accountId);
    const probe = (id) => {
      if (!id) return null;
      try {
        return quizWallets.getLinkedWallet(id, "faucet");
      } catch (error) {
        console.warn("[faucet] linkage probe failed:", error?.message || error);
        return null;
      }
    };

    if (probe(discordId)) return discordId;
    if (probe(accountId)) return String(accountId);

    // REFRESH BEFORE REFUSING, and note this must happen HERE rather than only
    // inside checkEligibility(). getLinkedWallet() reads local JSON through a
    // boot-time cache, so a wallet linked seconds ago by another process — the
    // faucet bot's !register, a /verify on another worker — is invisible to the
    // probe above. checkEligibility() does refresh, but returning null here
    // means it never runs: the refusal would sit EARLIER in the path than the
    // freshness fix, which is how this whole class of bug keeps coming back.
    try {
      await refreshManagedFile("linked_wallets.json");
      if (probe(discordId)) return discordId;
      if (probe(accountId)) return String(accountId);
    } catch (error) {
      console.warn("[faucet] linkage refresh failed:", error?.message || error);
    }

    // A Discord-rooted account with no wallet still resolves: checkEligibility
    // answers `no_wallet`, which is the truthful reason for that person.
    return discordId || null;
  }

  /** The faucet block of /api/faucet/status. Lifted out so the needs-a-Discord
   *  branch answers with the same numbers as every other branch instead of a
   *  second copy that can drift. */
  function faucetPublicConfig(cfg) {
    return {
      enabled: cfg.enabled,
      tokenSymbol: cfg.tokenSymbol,
      amount: cfg.dripAmountDecimal,
      cooldownHours: cfg.cooldownHours,
      minimumHolderBalance: cfg.minHolderBalance,
      holderCheckEnabled: cfg.holderCheckEnabled,
      // Exposed so the web faucet and the mobile app home can state the
      // real threshold instead of hardcoding "10". It is tunable via
      // FAUCET_VERIFY_AFTER_CLAIMS, so a hardcoded number silently becomes
      // a lie the moment it is changed.
      verifyAfterClaims: cfg.verifyAfterClaims,
    };
  }

  app.get("/api/faucet/status", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ authenticated: false, error: "session_expired" });
    try {
      // The faucet linkage store is keyed by Discord snowflake, but a session id
      // can be `wallet:<hash>` or `x:<hash>` since the identity layer landed.
      // Handing one of those to checkEligibility() looks up a key that cannot
      // exist and comes back `no_wallet` — which told a verified owner to go run
      // !register. Resolve first, and say the true thing when we cannot.
      const faucetUserId = await faucetLookupId(s.discordUserId);
      if (!faucetUserId) {
        return res.json({
          authenticated: true,
          discord: { displayName: faucetDiscordName(s.discordUserId) },
          wallet: null,
          faucet: faucetPublicConfig(getFaucetConfig()),
          eligibility: {
            eligible: false,
            reason: FAUCET_REASONS.NEEDS_DISCORD_LINK,
            currentBalance: null,
            nextEligibleAt: null,
            lastClaimSource: null,
          },
        });
      }
      const eligibility = await checkEligibility({ discordUserId: faucetUserId });
      const cfg = eligibility.config;
      return res.json({
        authenticated: true,
        discord: { displayName: faucetDiscordName(s.discordUserId) },
        wallet: eligibility.wallet
          ? { masked: maskWalletAddress(eligibility.wallet.address), source: eligibility.wallet.source, verified: true }
          : null,
        faucet: faucetPublicConfig(cfg),
        eligibility: {
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          currentBalance: eligibility.balance,
          nextEligibleAt: eligibility.cooldown?.nextEligibleAt ? new Date(eligibility.cooldown.nextEligibleAt).toISOString() : null,
          lastClaimSource: eligibility.cooldown?.lastClaimSource || null,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "faucet_status_failed" });
    }
  });

  app.post("/api/faucet/claim", simpleRateLimit({ windowMs: 15_000, max: 6 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      // Only session-derived identity and an optional client idempotency
      // key are honored. wallet/amount/mint/source are never read from the
      // request body — claimFaucet() resolves/derives all of them
      // server-side, and source is hardcoded to "web" here regardless of
      // anything the client sends.
      // Same resolution as /api/faucet/status — see the note there.
      const faucetUserId = await faucetLookupId(s.discordUserId);
      if (!faucetUserId) {
        return res.status(400).json({ ok: false, reason: FAUCET_REASONS.NEEDS_DISCORD_LINK });
      }
      // The client may supply an idempotency key so a retried tap does not
      // reserve twice, but it is NAMESPACED under the caller's account rather
      // than used raw. A raw key is a lookup into every claim ever made, so
      // presenting somebody else's — a Discord message id is public — would
      // replay their claim. claimStore refuses a foreign replay too; this
      // makes the collision impossible to express in the first place.
      const clientKey = req.body?.requestId ? String(req.body.requestId).slice(0, 96) : null;
      const requestId = `web:${faucetUserId}:${clientKey || Date.now()}`;
      const result = await claimFaucet({
        discordUserId: faucetUserId,
        source: "web",
        requestId,
      });

      if (!result.ok) {
        const status = result.reason === "cooldown" ? 409 : 400;
        // A 'reconciling' refusal means the transfer DID reach the network and
        // only the confirmation call timed out, so it carries a signature.
        // Pass it through: the explorer is the authority and the user should
        // never have to take our word for a transaction they can go look at.
        const signature = result.signature || result.claim?.signature || null;

        // Log the REFUSAL, not just the success. Jim, 2026-08-15, on what this
        // channel should be: "something that can be used as true debug logs".
        // Only logging claims that worked made it a highlight reel — when
        // somebody says "it will not let me claim", the line explaining why was
        // the one line never written down.
        //
        // ROUTINE refusals are excluded. `cooldown` fires every time anyone
        // taps claim a second time — it is the system working, and at real
        // volume it would bury the refusals that mean something. A debug log
        // that scrolls is a debug log nobody reads.
        //
        // Everything else stays: a ban, a holder minimum, a verification
        // demand or an unreachable treasury are all "why did this not work"
        // questions somebody will ask, and `reconciling` in particular carries
        // a signature for a transfer that DID reach the chain.
        if (!ROUTINE_REFUSALS.has(String(result.reason || ""))) void logSiteEvent({
          type: "faucet_claim", source: SITE_LOG_SOURCES.FAUCET, outcome: "refused",
          title: "Faucet claim refused (website)",
          discordUserId: s.discordUserId,
          fields: {
            Reason: `\`${result.reason || "unknown"}\``,
            "Next eligible": result.nextEligibleAt ? `<t:${Math.floor(Number(result.nextEligibleAt) / 1000)}:R>` : undefined,
            "Last claim via": result.lastClaimSource || undefined,
            Tx: signature ? `<https://solscan.io/tx/${signature}>` : undefined,
          },
        });
        return res.status(status).json({
          ok: false,
          reason: result.reason,
          nextEligibleAt: result.nextEligibleAt ? new Date(result.nextEligibleAt).toISOString() : null,
          lastClaimSource: result.lastClaimSource || null,
          signature,
          explorerUrl: signature ? `https://solscan.io/tx/${signature}` : null,
        });
      }

      // Same proof fields the GET poll route returns. A claim that confirms
      // fast enough to already be 'confirmed' here would otherwise be the one
      // case where the site reported success without showing the transaction.
      void logSiteEvent({
        type: "faucet_claim", icon: "🚰", source: SITE_LOG_SOURCES.FAUCET,
        title: "Faucet claim (website)",
        discordUserId: s.discordUserId,
        fields: {
          Claim: result?.claim?.id ? `\`${result.claim.id}\`` : undefined,
          Amount: result?.claim?.amount != null ? `**${result.claim.amount}** WinLEW` : undefined,
          Status: result?.claim?.status || "submitted",
          Tx: result?.claim?.signature ? `<https://solscan.io/tx/${result.claim.signature}>` : undefined,
        },
      });
      return res.json({
        ok: true,
        claim: {
          id: result.claim.id,
          status: result.claim.status,
          amount: result.claim.amountDisplay,
          signature: result.claim.signature || null,
          explorerUrl: result.claim.signature ? `https://solscan.io/tx/${result.claim.signature}` : null,
        },
        pending: !!result.pending,
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "faucet_claim_failed" });
    }
  });

  // Poll a specific claim's progress while the separate faucetpayouts worker
  // processes it. Ownership-checked so a claim ID can never expose another
  // user's record.
  app.get("/api/faucet/claim/:id", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ error: "session_expired" });
    try {
      const claim = await getFaucetClaimById(String(req.params.id || ""));
      if (!claim || String(claim.discordUserId) !== String(s.discordUserId)) {
        return res.status(404).json({ error: "claim_not_found" });
      }
      return res.json({
        ok: true,
        claim: {
          id: claim.id,
          status: claim.status,
          amount: claim.amountDisplay,
          signature: claim.signature || null,
          explorerUrl: claim.signature ? `https://solscan.io/tx/${claim.signature}` : null,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "faucet_claim_status_failed" });
    }
  });

  // Your own past claims — confirmed ones only count toward the total shown
  // (matches the summary math getRewardSummary/getClaimHistoryForUser
  // already use elsewhere), oldest-first, capped at 100 for the page (the
  // Dashboard's own use of this same function requests more; the faucet
  // page just needs a readable recent history, not a full export).
  app.get("/api/faucet/history", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
    const s = getSession(sessionFromRequest(req));
    if (!s) return res.status(401).json({ ok: false, error: "session_expired" });
    try {
      const history = await getClaimHistoryForUser(s.discordUserId, 100);
      return res.json({
        ok: true,
        summary: {
          count: history.count,
          confirmedCount: history.confirmedCount,
          totalConfirmedAmount: history.totalConfirmedAmount,
          firstClaimAt: history.firstClaimAt ? new Date(history.firstClaimAt).toISOString() : null,
          lastConfirmedAt: history.lastConfirmedAt ? new Date(history.lastConfirmedAt).toISOString() : null,
        },
        claims: history.claims.map((c) => ({
          id: c.id,
          source: c.source,
          status: c.status,
          amount: c.amountDisplay,
          createdAt: new Date(c.createdAt).toISOString(),
          signature: c.signature || null,
          explorerUrl: c.signature ? `https://solscan.io/tx/${c.signature}` : null,
        })),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faucet_history_failed" });
    }
  });

  // ── Faucet — global distribution stats (added 2026-07-18) ───────────────
  // Public, no session required — same "anyone can see the aggregate, only
  // the account holder sees their own row" boundary the rest of this site
  // already draws (Burn Center, Transparency, Governance results). Confirmed
  // claims only, never a projection. 60s cache matches the Burn/Transparency
  // pattern — this scans the whole confirmed-claims set, not worth doing on
  // every page load.
  let _faucetStatsCache = null;
  const FAUCET_STATS_CACHE_MS = 60_000;
  async function cachedFaucetStats() {
      if (_faucetStatsCache && Date.now() - _faucetStatsCache.at < FAUCET_STATS_CACHE_MS) return _faucetStatsCache.data;
      const stats = await getGlobalFaucetStats();
      const faucetCfg = getFaucetConfig();
      const data = {
        generatedAt: new Date().toISOString(),
        totalConfirmedCount: stats.totalConfirmedCount,
        totalConfirmedAmount: stats.totalConfirmedAmount,
        bySource: stats.bySource,
        firstClaimAt: stats.firstClaimAt ? new Date(stats.firstClaimAt).toISOString() : null,
        lastClaimAt: stats.lastClaimAt ? new Date(stats.lastClaimAt).toISOString() : null,
        // Lifetime on-chain total sent by the reserve wallet, from the last
        // `npm run faucet:scan` checkpoint (never a live scan from this
        // public route — same rule as /api/burn/status's backupScan).
        //
        // This is a DIFFERENT measurement from totalConfirmedAmount above,
        // and deliberately so: that counts claims THIS PLATFORM RECORDED,
        // while this counts everything the wallet has actually paid out —
        // including Discord payouts predating the claim store, and the quiz
        // and game rewards the same wallet signs. onChain >= platform is the
        // expected relationship, not a discrepancy. null until someone runs
        // the scan on this machine.
        onChain: buildFaucetOnChainSummary(),
        // Public claim rules. Already published on /policies/abuse/ and to any
        // signed-in user via /api/faucet/status — repeated here only so the
        // faucet page can state its own rules to a visitor who has not
        // connected yet, instead of rendering them as "—". Config only: no
        // per-user data, no treasury key material.
        rules: {
          enabled: faucetCfg.enabled,
          tokenSymbol: faucetCfg.tokenSymbol,
          amount: faucetCfg.dripAmountDecimal,
          cooldownHours: faucetCfg.cooldownHours,
          minimumHolderBalance: faucetCfg.minHolderBalance,
          verifyAfterClaims: faucetCfg.verifyAfterClaims,
        },
      };
      _faucetStatsCache = { at: Date.now(), data };
      return data;
  }

  app.get("/api/faucet/global-stats", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await cachedFaucetStats()) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faucet_global_stats_failed" });
    }
  });

  // Homepage 3.0 summary: public, read-only, independently cached facts.
  // Keep this next to the final source it composes so every provider below is
  // already defined. No provider performs an internal HTTP request.
  const buildHomepageSummary = createHomepageSummary({
    sources: {
      price: {
        ttlMs: 60_000, evidence: "/links/",
        read: async () => {
          const cached = _priceCache.primary;
          if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.data;
          const data = await buildPriceSnapshot("primary");
          _priceCache.primary = { at: Date.now(), data };
          return data;
        },
        normalize: (data) => ({ priceUsd: data.priceUsd, liquidityUsd: data.liquidityUsd }),
        sourceAt: (data) => data.fetchedAt,
      },
      burn: {
        ttlMs: 300_000, evidence: "/burn/",
        read: async () => {
          if (_burnCache && Date.now() - _burnCache.at < BURN_CACHE_MS) return _burnCache.data;
          const data = await buildBurnSnapshot();
          _burnCache = { at: Date.now(), data };
          return data;
        },
        normalize: (data) => ({ percentOfTarget: data.progress?.percentOfTarget ?? null }),
        sourceAt: (data) => data.generatedAt,
      },
      transparency: {
        ttlMs: 300_000, evidence: "/transparency/", read: cachedTransparencySnapshot,
        normalize: (data) => ({ circulatingSupplyOk: data.circulatingSupply?.ok === true, circulatingDisplay: data.circulatingSupply?.circulatingDisplay ?? null }),
        sourceAt: (data) => data.circulatingSupply?.computedAtIso,
      },
      modules: {
        ttlMs: 900_000, evidence: "/modules/", read: async () => getModulesStatusPayload(),
        normalize: (data) => {
          const visible = Array.isArray(data.modules) ? data.modules.filter((item) => item.publicVisibility !== false && item.status !== "internal") : [];
          return { visibleCount: visible.length, liveCount: visible.filter((item) => item.status === "live").length };
        },
        sourceAt: (data) => data.generatedAt,
      },
      quiz: {
        ttlMs: 60_000, evidence: "/quiz/", read: async () => quizDb.getCurrentCycle() || {},
        normalize: (cycle) => ({ cycleEndMs: Number(cycle.endMs || 0) }),
        sourceAt: (cycle) => Number(cycle.startMs) ? new Date(Number(cycle.startMs)).toISOString() : null,
      },
      faucet: {
        ttlMs: 60_000, evidence: "/faucet/", read: cachedFaucetStats,
        normalize: (data) => ({ totalConfirmedCount: Number(data.totalConfirmedCount || 0) }),
        sourceAt: (data) => data.generatedAt,
      },
      governance: {
        ttlMs: 60_000, evidence: "/governance/", read: async () => ({ generatedAt: new Date().toISOString(), proposals: PROPOSALS }),
        normalize: (data) => ({ proposalCount: data.proposals.length, activeCount: data.proposals.filter((item) => item.status === "active").length }),
        sourceAt: (data) => data.generatedAt,
      },
      events: {
        ttlMs: 300_000, evidence: "/events/", read: async () => ({ generatedAt: new Date().toISOString(), groups: groupEventsByBucket(EVENTS) }),
        normalize: (data) => ({ liveCount: data.groups.live?.length || 0, upcomingCount: data.groups.upcoming?.length || 0 }),
        sourceAt: (data) => data.generatedAt,
      },
      health: {
        ttlMs: HEALTH_CACHE_MS, evidence: "/health/",
        // Summary traffic may observe a completed Health snapshot, but must
        // never initiate Health's 19-route probe fan-out.
        read: async () => readFreshCachedSnapshot(_healthCache, { ttlMs: HEALTH_CACHE_MS }),
        normalize: (data) => ({ reachableCount: data.reachableCount, totalCount: data.totalCount }),
        sourceAt: (data) => data.checkedAt,
      },
    },
  });

  app.get("/api/homepage/summary", simpleRateLimit({ windowMs: 10_000, max: 60 }), async (_req, res) => {
    try {
      const payload = await buildHomepageSummary();
      if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 16_384) throw new Error("summary_response_too_large");
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message === "summary_response_too_large" ? error.message : "homepage_summary_failed" });
    }
  });

  // Per-user leaderboard (2026-07-19) — total confirmed WinLEW claimed.
  // ?source=web|discord splits it, mirroring Quiz's platform leaderboard;
  // omit for a combined "top claimers overall" view. Same masked-name
  // privacy model as Quiz/Games above.
  app.get("/api/faucet/leaderboard", simpleRateLimit({ windowMs: 10_000, max: 30 }), async (req, res) => {
    try {
      const sourceParam = String(req.query.source || "").toLowerCase();
      const source = sourceParam === "web" || sourceParam === "discord" ? sourceParam : null;
      const rows = await getFaucetLeaderboard(req.query.limit, source);
      const entries = rows.map((row, i) => ({
        rank: i + 1,
        ...quizDisplayName(row.discordUserId),
        totalAmount: row.totalAmount,
        claims: row.claims,
      }));
      return res.json({ ok: true, source: source || "all", entries });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "faucet_leaderboard_failed" });
    }
  });

  /** Nice 404 */
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "not_found" });
    res.status(404).send(htmlPage("Not found", `<h2 class="bad">404</h2><p>Route not found: <code>${req.path}</code></p>`));
  });

  /** Last-resort error handler */
  app.use((err, _req, res, _next) => {
    console.error("Unhandled web error:", err);
    res.status(500).send(htmlPage("Server error", `<h2 class="bad">Server error</h2><pre>${String(err)}</pre>`));
  });

  const host = process.env.WEB_HOST || process.env.HOST || "127.0.0.1";
  app.listen(cfg.PORT, host, () => {
  console.log(`🌐 Web listening on http://${host}:${cfg.PORT}`);
  console.log(`🔗 Configured API public base URL: ${cfg.PUBLIC_BASE_URL}`);
  console.log(`🖥️ Configured verify UI URL: ${cfg.VERIFY_UI_URL}`);
  console.log(`📚 Configured bot services URL: ${cfg.BOT_SERVICES_URL}`);
  console.log(`📁 Serving static from: ${PUBLIC_DIR}`);
  console.log(`🧭 GeoAgora API proxy path: /geoagora-api -> ${geoAgoraApiTarget}`);
  console.log(`🧭 GeoHackers API proxy path: /geohackers-api -> ${geoHackersApiTarget}`);
  console.log(`🧭 GeoHackers verify proxy path: /geohackers-verify -> ${geoHackersVerifyTarget}`);
  console.log(`🐕 Watchdog relay path: /watchdog -> ${watchdogLocalUrl}`);
});
}
