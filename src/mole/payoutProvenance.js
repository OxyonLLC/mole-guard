// First-payout provenance check.
//
// The owner's call, 2026-08-14, after deciding NOT to raise the holder minimum:
// any holder should be able to earn, but the FIRST time money leaves the system
// to a person, we look at where their wallet came from. One check, once, on the
// payout that actually opens an account — not a tax on everyone forever.
//
// It answers, in this order:
//   • who funded this wallet?
//   • is that funder someone who plays here?
//   • do they still hold anything, or did they empty out?
//   • does this read as the same person wearing a second hat, or a friend?
//
// THE ANSWER TO THE LAST ONE IS USUALLY "FRIEND", AND THAT IS FINE. Someone
// buying their mate a bag of tokens is normal and must not cost that mate their
// first payout. What is NOT normal is a wallet funded by a wallet WE paid, that
// belongs to the SAME Discord account. That is the 2026-08-14 pattern exactly:
// redeem, move the payout to a fresh wallet, relink, redeem again.
//
// THREE THINGS THIS DELIBERATELY REFUSES TO DO:
//
// 1. It never rejects. The worst outcome is `review` — the payout is held, the
//    points stay earned, and a human looks. An automated system must not be the
//    last word on whether someone gets paid.
//
// 2. It fails OPEN. If the chain is unreachable, the walk is truncated, or
//    anything throws, the verdict is `clear` and the reason is recorded. "We
//    could not check" must never silently become "you look guilty" — the whole
//    point of a first-payout check is that it runs once, and running it during
//    an RPC outage must not permanently mark someone.
//
// 3. It does not treat a busy funder as a person. An exchange hot wallet, a
//    Jupiter router or a pump.fun curve funds thousands of people. A funder that
//    has funded many of our participants is INFRASTRUCTURE, and finding it is
//    evidence of nothing at all. See INFRASTRUCTURE_FANOUT below — without this
//    the check would flag every user who ever bought on an exchange, which is
//    most of them.

/** A funder shared with this many of our participants is a router, an exchange
 *  or a market, not somebody's friend. Being downstream of one says nothing. */
export const INFRASTRUCTURE_FANOUT = 3;

/** Verdicts. There is no `blocked` — see refusal 1 above. */
export const VERDICTS = Object.freeze({ CLEAR: "clear", REVIEW: "review" });

export function firstPayoutCheckEnabled() {
  return String(process.env.QUIZ_FIRST_PAYOUT_CHECK_ENABLED || "").toLowerCase() === "true";
}

// There is deliberately no "first payout enforcement" switch. A `review` verdict
// NEVER holds a first payout — it puts the participant on the watchlist, which
// gates their SECOND one (QUIZ_WATCHLIST_GATE_ENABLED, read in the worker).
//
// The owner's reasoning, 2026-08-14: making a brand new participant wait days
// for money they earned, on circumstantial evidence, to catch a farmer who will
// just wait too, costs every honest newcomer and stops nobody. One payout is a
// cheap price for real evidence — and the pattern this exists to catch only
// becomes visible on the repeat anyway.

/**
 * Is the next payout this user's first?
 *
 * Keyed on the DISCORD USER, not the wallet — keying on the wallet would make
 * every new wallet a fresh start, which is the loophole this exists to close.
 */
export function isFirstPayout(db, userId) {
  try {
    return db.countPaidPayouts(String(userId)) === 0;
  } catch {
    // Unknown means treat it as first: a check that runs once too often is
    // cheap, one that never runs is the hole.
    return true;
  }
}

/** Reduce a funding-cluster walk to the direct funders — depth 1, and never the
 *  `weak` early-counterparty edges, which on a young wallet are just ordinary
 *  transfers. Treating those as parentage is the mistake walletBans.js records
 *  v1 of the cluster walk having made. */
function directFunders(cluster) {
  return (cluster?.members || []).filter(
    (m) => m.depth === 1 && !m.weak && String(m.via || "").startsWith("created "),
  );
}

/**
 * The check itself.
 *
 * @param {object} deps  injected so this is testable without a chain, a Discord
 *                       bot or a database — every one of these is optional and a
 *                       missing one degrades to "could not check", never to a
 *                       negative finding.
 * @returns {Promise<{verdict, first, findings, funders, degraded, reason}>}
 */
export async function checkFirstPayoutProvenance({
  userId,
  wallet,
  db,
  describeCluster,
  findLinkedProfileByWallet,
  getWalletFaucetStatus,
  getBalance,
  now = Date.now(),
} = {}) {
  const findings = [];
  const report = {
    verdict: VERDICTS.CLEAR,
    first: true,
    checkedAt: new Date(now).toISOString(),
    wallet: wallet ? String(wallet) : null,
    funders: [],
    findings,
    degraded: false,
    reason: null,
  };

  if (!userId || !wallet) {
    report.degraded = true;
    report.reason = "no_wallet";
    return report;
  }

  let cluster;
  try {
    cluster = await describeCluster(wallet);
  } catch (error) {
    // Fail open, loudly. See refusal 2.
    report.degraded = true;
    report.reason = `cluster_walk_failed:${error?.message || "unknown"}`;
    return report;
  }

  if (cluster?.degraded || cluster?.truncatedWalk) {
    report.degraded = true;
    report.reason = cluster.truncatedWalk ? "walk_truncated" : "chain_partially_unreachable";
  }

  // Who has this system already paid, and to whom. Built once, used per funder.
  const paidOwners = new Map();
  try {
    for (const row of db.listPaidWalletOwners()) paidOwners.set(row.wallet, row);
  } catch {
    report.degraded = true;
  }

  const funders = directFunders(cluster);
  if (!funders.length && !report.degraded) {
    // A wallet with no identifiable funder is not suspicious. It is what a
    // wallet funded before our linkage cache existed, or by a transfer the
    // scanner could not attribute, looks like.
    findings.push({ signal: "no_identifiable_funder", weight: 0, note: "funding source not attributable — not a negative finding" });
  }

  for (const funder of funders) {
    const entry = {
      wallet: funder.wallet,
      banned: Boolean(funder.banned),
      reviewOnly: Boolean(funder.reviewOnly),
      participant: null,
      paidByUs: paidOwners.get(funder.wallet) || null,
      stillHolds: null,
      balance: null,
      faucetClaims: null,
      infrastructure: false,
    };

    // Did the funder play here?
    try {
      const profile = findLinkedProfileByWallet ? findLinkedProfileByWallet(funder.wallet) : null;
      if (profile?.discordUserId) entry.participant = { discordUserId: String(profile.discordUserId) };
    } catch { report.degraded = true; }

    try {
      if (getWalletFaucetStatus) {
        const status = await getWalletFaucetStatus(funder.wallet);
        if (status) entry.faucetClaims = Number(status.count ?? status.claimCount ?? 0) || 0;
      }
    } catch { report.degraded = true; }

    // Do they still hold anything?
    try {
      if (getBalance) {
        const balance = await getBalance(funder.wallet);
        if (Number.isFinite(balance)) {
          entry.balance = balance;
          entry.stillHolds = balance > 0;
        }
      }
    } catch { report.degraded = true; }

    // Infrastructure test, run BEFORE any conclusion is drawn from this funder.
    // How many other wallets came out of this same one? Many means exchange,
    // router or bonding curve, and every finding below is then meaningless.
    const fanout = (cluster.members || []).filter(
      (m) => String(m.via || "") === `created by ${funder.wallet}`,
    ).length;
    if (fanout >= INFRASTRUCTURE_FANOUT) {
      entry.infrastructure = true;
      findings.push({
        signal: "funded_via_shared_infrastructure",
        weight: 0,
        note: `${funder.wallet} has funded ${fanout} wallets — exchange or router, not a person`,
      });
      report.funders.push(entry);
      continue;
    }

    // ── The findings that actually mean something ────────────────────────────

    if (entry.banned && !entry.reviewOnly) {
      findings.push({ signal: "funded_by_banned_wallet", weight: 100, note: `${funder.wallet} is banned` });
    }

    if (entry.paidByUs) {
      const sameUser = entry.paidByUs.userId === String(userId);
      if (sameUser) {
        // The 2026-08-14 pattern, exactly: their own earlier payout funded this
        // wallet. The strongest signal available here.
        findings.push({
          signal: "funded_by_own_earlier_payout",
          weight: 100,
          note: "this wallet was funded by a wallet we already paid this same account",
        });
      } else {
        // A different account's payout funded this wallet. Could genuinely be a
        // friend passing tokens on. Worth a look, not worth a conviction.
        findings.push({
          signal: "funded_by_another_participants_payout",
          weight: 60,
          note: "funded by a wallet we paid to a different account",
        });
      }
      // Funded by one of our payouts AND emptied out since: the pass-through
      // shape, where a wallet exists only to move money onward.
      if (entry.stillHolds === false) {
        findings.push({
          signal: "funder_emptied_after_funding",
          weight: 25,
          note: "the funding wallet holds nothing now",
        });
      }
    } else if (entry.participant) {
      // Plays here, but we never paid them — they bought in and shared some.
      // Recorded so a reviewer can see the relationship, weighted at nothing.
      findings.push({
        signal: "funded_by_known_participant",
        weight: 0,
        note: "funder plays here but has never been paid by us — ordinary",
      });
    }

    report.funders.push(entry);
  }

  const score = findings.reduce((sum, f) => sum + f.weight, 0);
  // One strong signal earns a look. Same rule as the risk engine, and the same
  // ceiling: a look, never a refusal.
  if (score >= 60) report.verdict = VERDICTS.REVIEW;

  report.score = score;
  return report;
}

/**
 * The wiring the payout worker uses. Kept apart from the pure function above so
 * the logic can be tested without a chain.
 *
 * NEVER THROWS. Any failure returns a `clear` verdict marked degraded.
 */
export async function runFirstPayoutCheck({ userId, wallet, db, now = Date.now() } = {}) {
  if (!firstPayoutCheckEnabled()) return null;
  try {
    if (!isFirstPayout(db, userId)) return null;

    const [{ describeCluster }, { findLinkedProfileByWallet }, claimStore, solana, config] = await Promise.all([
      import("../faucet/walletBans.js"),
      import("./walletLink.js"),
      import("../faucet/claimStore.js"),
      import("./solana.js"),
      import("../faucet/config.js").catch(() => null),
    ]);

    const mint = config?.getConfig?.()?.mintAddress || process.env.WINLEW_MINT || process.env.MINT_ADDRESS || "";

    return await checkFirstPayoutProvenance({
      userId,
      wallet,
      db,
      now,
      describeCluster: (w) => describeCluster(w, { timeBudgetMs: 20_000 }),
      findLinkedProfileByWallet,
      getWalletFaucetStatus: (w) => claimStore.getStatusForWallet(w),
      getBalance: mint ? async (w) => {
        const res = await solana.getSplBalance(w, mint);
        return Number(res?.uiAmount ?? res ?? 0);
      } : null,
    });
  } catch (error) {
    console.error("[payout][provenance] check failed, settling anyway:", error?.message || error);
    return { verdict: VERDICTS.CLEAR, first: true, degraded: true, reason: "check_threw", findings: [], funders: [] };
  }
}

/** One line for the worker log and the review queue. Wallets are shown — this
 *  goes to mods and to the payout log, both of which already see wallets — but
 *  never a Discord id, which would put an identity next to an address. */
export function summarizeProvenance(report) {
  if (!report) return "not checked";
  const signals = (report.findings || []).filter((f) => f.weight > 0).map((f) => f.signal);
  const parts = [
    `verdict=${report.verdict}`,
    `score=${report.score ?? 0}`,
    `funders=${(report.funders || []).length}`,
  ];
  if (signals.length) parts.push(`signals=${signals.join(",")}`);
  if (report.degraded) parts.push(`degraded=${report.reason || "yes"}`);
  return parts.join(" ");
}
