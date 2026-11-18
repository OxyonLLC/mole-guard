require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { rpcConnectionOptions } = require('../shared/solanaRpcFetch.cjs');
const {
  getMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} = require('@solana/spl-token');
const db = require('./db');
const { getLinkedWallet } = require('./wallets');
const { resolvePayoutConfig, payoutModeLabel } = require('./payout-config');
const { initQuizStorage, flushManagedQuizWrites } = require('./storage');
const { confirmSignatureByPolling } = require('../shared/solanaConfirm.cjs');
const { sweepReviewQueue } = require('./reviewQueue');

const config = resolvePayoutConfig();
const WORKER_NAME = 'quiz-payout-worker';
let mintDecimals = null;
let running = false;
let signer = null;
let connection = null;
let timer = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRuntimePath(targetPath) {
  if (!targetPath) return targetPath;
  if (path.isAbsolute(targetPath)) return targetPath;
  return path.resolve(__dirname, targetPath);
}

function getConnection() {
  if (connection) return connection;
  const rpcUrl = config.rpcUrl || 'https://solana-rpc.publicnode.com';
  connection = new Connection(rpcUrl, rpcConnectionOptions('confirmed'));
  return connection;
}

function getSigner() {
  if (signer) return signer;
  const keypairPath = resolveRuntimePath(config.keypairPath);
  const bytes = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  return signer;
}

async function getDecimals() {
  if (mintDecimals !== null) return mintDecimals;
  const mint = new PublicKey(config.mint);
  const info = await getMint(getConnection(), mint);
  mintDecimals = info.decimals;
  return mintDecimals;
}

function computeRetryMs(record, missingWallet = false) {
  const attempts = Number(record.attempts || 0) + 1;
  const base = missingWallet ? config.missingWalletRetryMs : config.baseRetryMs;
  const scaled = base * Math.min(attempts, 6);
  return Math.max(base, scaled);
}

async function sendWinlew(walletAddress, amountWinlew, onSubmitted) {
  const conn = getConnection();
  const payoutSigner = getSigner();
  const mint = new PublicKey(config.mint);
  const recipient = new PublicKey(walletAddress);
  const decimals = await getDecimals();
  const rawAmount = BigInt(Math.round(Number(amountWinlew) * (10 ** decimals)));

  const fromAta = await getAssociatedTokenAddress(mint, payoutSigner.publicKey);
  if (!(await conn.getAccountInfo(fromAta, 'confirmed'))) {
    throw new Error(`source_ata_missing:${fromAta.toBase58()}`);
  }

  const toAta = await getAssociatedTokenAddress(mint, recipient);
  const tx = new Transaction();
  if (!(await conn.getAccountInfo(toAta, 'confirmed'))) {
    tx.add(createAssociatedTokenAccountInstruction(payoutSigner.publicKey, toAta, recipient, mint));
  }
  tx.add(createTransferInstruction(
    fromAta,
    toAta,
    payoutSigner.publicKey,
    rawAmount,
  ));

  const latest = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = payoutSigner.publicKey;
  tx.sign(payoutSigner);

  const signature = await conn.sendRawTransaction(tx.serialize());

  // The signature exists now, and the money may already be gone. Hand it back
  // BEFORE confirming so the caller can persist an intent — everything after
  // this point can crash without losing the fact that a transfer was sent.
  if (typeof onSubmitted === 'function') {
    await onSubmitted({ signature, lastValidBlockHeight: latest.lastValidBlockHeight });
  }

  const result = await confirmSignatureByPolling(conn, {
    signature,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    commitment: 'confirmed',
  });
  if (result?.value?.err) {
    throw new Error(`payout confirmed with on-chain error: ${JSON.stringify(result.value.err)}`);
  }

  return signature;
}

/** What the chain says about a signature we know we sent.
 *  'confirmed' | 'failed' | 'unknown' — never a guess. */
async function inspectSignature(signature, lastValidBlockHeight) {
  const conn = getConnection();
  const statuses = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = statuses?.value?.[0] ?? null;
  if (status?.err) return { state: 'failed', err: status.err };
  if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
    return { state: 'confirmed' };
  }
  if (status && status.confirmations === null && status.slot != null) return { state: 'confirmed' };

  // No status. Either it never landed, or it is too old to be in history. Only
  // an expired blockhash makes "never landed" safe to conclude.
  if (lastValidBlockHeight != null) {
    const height = await conn.getBlockHeight('confirmed');
    if (height > Number(lastValidBlockHeight)) return { state: 'failed', expired: true };
  }
  return { state: 'unknown' };
}

/**
 * Resolve transfers that were sent but never recorded.
 *
 * Runs before every scan. A record carrying an intent is NEVER re-sent until
 * the chain has been asked what happened to the first attempt — that is the
 * whole point. 'unknown' leaves the intent in place and skips the record, which
 * is deliberately the stuck state: waiting is recoverable, paying twice is not.
 */
async function reconcilePayoutIntents() {
  const pending = db.listPayoutIntents();
  if (!pending.length) return { checked: 0, settled: 0, cleared: 0, unresolved: 0 };

  let settled = 0, cleared = 0, unresolved = 0;
  for (const rec of pending) {
    const { signature, lastValidBlockHeight } = rec.payoutIntent;
    let verdict;
    try {
      verdict = await inspectSignature(signature, lastValidBlockHeight);
    } catch (error) {
      console.warn(`[payout][reconcile] ${rec.id} could not be checked: ${error?.message || error}`);
      unresolved += 1;
      continue;
    }

    if (verdict.state === 'confirmed') {
      // It DID land. Record it rather than sending a second one.
      const amount = Number(rec.winlewDue ?? db.estimateWinlewForPoints(rec.amount));
      const result = db.markRedemptionPaidById({
        id: rec.id,
        winlewSent: amount,
        tx: signature,
        walletAddress: rec.payoutWallet || null,
        walletSource: rec.payoutWalletSource || null,
        settlementMode: 'auto_worker_reconciled',
        settlementWorker: WORKER_NAME,
      });
      if (result.ok) {
        settled += 1;
        console.log(`[payout][reconcile] ${rec.id} was already paid on-chain — recorded, not re-sent. tx=${signature}`);
      }
    } else if (verdict.state === 'failed') {
      db.clearPayoutIntent({ id: rec.id, reason: verdict.expired ? 'previous attempt expired unconfirmed' : 'previous attempt failed on-chain' });
      cleared += 1;
    } else {
      unresolved += 1;
      console.warn(`[payout][reconcile] ${rec.id} still unknown (${signature}) — holding, will not re-send`);
    }
  }
  return { checked: pending.length, settled, cleared, unresolved };
}


async function postDiscordAnnouncement(content) {
  if (!config.announceChannelId || !config.botToken) return { ok: false, skipped: true };
  const response = await fetch(`https://discord.com/api/v10/channels/${config.announceChannelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${config.botToken}`,
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`[payout] announcement failed status=${response.status} body=${body}`);
    return { ok: false, error: body || `status_${response.status}` };
  }
  return { ok: true };
}

function txUrl(tx) {
  return tx ? `https://solscan.io/tx/${tx}` : null;
}

function formatSettlementMessage(record, linked, amount, tx) {
  const lines = [
    '💸 **Quiz payout settled**',
    `• User: <@${record.userId}>`,
    `• Kind: ${record.kind === 'cycle_payout' ? `cycle ${record.cycleId}` : record.kind === 'leaderboard_payout' ? 'leaderboard residual' : 'redeem'}`,
    `• Points: **${record.amount}**`,
    `• WinLEW sent: **${amount}**`,
    `• Wallet: \`${linked.address}\``,
    `• Source: **${linked.source || 'linked_wallet'}**`,
    `• Record: \`${record.id}\``,
  ];
  if (tx) lines.push(`• TX: <${txUrl(tx)}>`);
  return lines.join('\n');
}


/** The admin role that may clear a watchlist entry or decide a held payout.
 *  Defaulted to the server's Admin role so this works without configuration —
 *  a review queue whose commands nobody can run is the same hole as one nobody
 *  reads. Overridable for other servers. */
const REVIEWER_ROLE_IDS = (process.env.QUIZ_REVIEWER_ROLE_IDS || '1350888808283115630')
  .split(',').map((v) => v.trim()).filter(Boolean);

function reviewerMention() {
  return REVIEWER_ROLE_IDS.map((id) => `<@&${id}>`).join(' ');
}

/** Posted after a first payout that was flagged. The money has ALREADY gone —
 *  this asks an admin to look before the next one, and says so plainly, because
 *  a message that reads like a refusal when nothing was refused just breeds
 *  distrust of the alert. Names the signals, not the funding wallets: this goes
 *  to a channel, and tying a Discord handle to specific addresses in public is a
 *  privacy problem regardless of what the person did. */
function formatWatchlistedMessage(record, linked, firstPayout) {
  return [
    '👀 **First payout sent — and flagged for a look**',
    `• User: <@${record.userId}> · **paid in full**, nothing was withheld`,
    `• Record: \`${record.id}\``,
    `• On-chain funding history flagged: ${(firstPayout.signals || []).join(', ') || 'review'}`,
    firstPayout.provenance?.degraded ? '• Note: the check was incomplete — treat it as "not checked", not as a finding.' : null,
    '',
    `${reviewerMention()} — their **next** payout is held until someone clears this. To look and decide:`,
    `\`\`\``,
    `!quizwatch                     list everyone flagged`,
    `!quizwatch ${record.userId}${' '.repeat(Math.max(1, 22 - String(record.userId).length))}the evidence for this one`,
    `!quizclear ${record.userId} looks fine   clear them — a note is required`,
    `\`\`\``,
    '_Clearing costs them nothing and is the normal outcome. Being funded by a friend who plays here is ordinary._',
  ].filter(Boolean).join('\n');
}

/** Posted when a REPEAT payout is held because a first-payout flag was never
 *  cleared. This one genuinely is withheld, so it leads with what that means for
 *  the person and how to end it. */
function formatWatchlistHeldMessage(record, linked) {
  const entry = db.getWatchlistEntry(record.userId);
  const waiting = entry?.addedTs ? Math.floor((Date.now() - entry.addedTs) / 3_600_000) : 0;
  return [
    '⏸️ **Payout held — flagged on their first payout, never cleared**',
    `• User: <@${record.userId}> · Points: **${Number(record.amount || 0)}** — still earned, nothing lost`,
    `• Record: \`${record.id}\``,
    `• Flagged ${waiting}h ago for: ${(entry?.signals || []).join(', ') || 'review'}`,
    `• Their first payout was **paid in full** at the time.`,
    '',
    `${reviewerMention()} — one command ends this:`,
    `\`\`\``,
    `!quizwatch ${record.userId}`,
    `!quizclear ${record.userId} <note>`,
    `\`\`\``,
    '_If nobody acts, the review timer releases and pays it anyway. Nothing here can auto-reject._',
  ].join('\n');
}

function formatMissingWalletMessage(record) {
  const points = Number(record.amount || 0);
  const estimated = Number(record.winlewDue ?? db.estimateWinlewForPoints(points));
  return [
    '⚠️ **Quiz payout waiting on wallet verification**',
    `• User: <@${record.userId}>`,
    `• Kind: ${record.kind === 'cycle_payout' ? `cycle ${record.cycleId}` : record.kind === 'leaderboard_payout' ? 'leaderboard residual' : 'redeem'}`,
    `• Points blocked: **${points}**`,
    `• WinLEW queued: **${estimated}**`,
    `• Record: \`${record.id}\``,
    '• Status: no linked payout wallet was found in Mole Guard or faucet saved-wallet stores yet.',
    '• Action: have the user verify through Mole Guard or use `!save <wallet>` / `!register <wallet>`, then requeue the payout.',
  ].join('\n');
}

function isKindEnabled(kind) {
  if (kind === 'cycle_payout') return config.autoCyclePayouts;
  if (kind === 'leaderboard_payout') return config.autoCyclePayouts;
  if (kind === 'user_redeem') return config.autoRedeems;
  return false;
}

/**
 * Score a payout before sending it.
 *
 * Three distinct states, and the difference matters:
 *   engine off        -> nothing is computed, nothing is stored
 *   shadow (default)  -> scored and RECORDED, but every payout still settles
 *   enforcement       -> a `held` band parks the record for human review
 *
 * Shadow exists so thresholds can be argued about against real cycles before
 * anything is withheld from a real person. Enforcement is a separate flag on
 * purpose: turning scoring on must not quietly start holding money.
 *
 * FAILS OPEN. A scoring bug must never freeze payouts — an exception here is
 * logged loudly and the payout proceeds, because the participant earned it and
 * our inability to judge that is our problem, not theirs.
 */
/** Does this wallet's funding graph reach a banned wallet? Fails OPEN — an RPC
 *  outage returns false, matching the faucet's own behaviour on the same call.
 *  "Could not check" must not become a signal. */
async function fundingClusterHit(walletAddress) {
  if (!walletAddress) return false;
  try {
    const { findBannedLink } = await import('../faucet/walletBans.js');
    const link = await findBannedLink(walletAddress);
    return Boolean(link?.banned);
  } catch (error) {
    console.warn('[payout][risk] cluster check unavailable:', error?.message || error);
    return false;
  }
}

async function assessRisk(record, walletAddress = null) {
  let trust;
  try {
    trust = await import('../mole/participationTrust.js');
  } catch (error) {
    console.warn('[payout][risk] engine unavailable:', error?.message || error);
    return { proceed: true };
  }
  if (!trust.riskEngineEnabled()) return { proceed: true };

  try {
    const since = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const risk = trust.evaluateParticipation({
      userId: record.userId,
      participation: db.listParticipation({ since }),
      recentPayouts: db.listRecentPaidRedemptions ? db.listRecentPaidRedemptions({ since }) : [],
      // NOT YET SOURCED. Wallet-link history lives in Mole Guard's store, not
      // the quiz DB, so the wallet-swap-after-payout signal is inert until it
      // is plumbed through. Passing [] makes that signal score zero rather than
      // score wrongly — an unavailable signal must never invent a verdict.
      walletChanges: [],
      // Was false regardless of what the chain said, which made the one signal
      // already proven against real abuse here dead weight on the payout path.
      // Quiz redemption has always consulted this; settlement never did.
      clusterHit: await fundingClusterHit(walletAddress),
    });

    const enforcing = trust.riskEnforcementEnabled();
    const hold = enforcing && risk.band === trust.BANDS.HELD;

    db.noteRiskAssessment({
      id: record.id,
      risk,
      decision: hold ? 'held' : 'settle',
      heldReason: hold ? risk.signals.join(', ') : null,
    });

    if (risk.band !== trust.BANDS.NORMAL) {
      console.log(
        `[payout][risk] ${record.id} band=${risk.band} score=${risk.score} ` +
        `signals=${risk.signals.join(',')} ${enforcing ? (hold ? 'HELD' : 'settling') : 'SHADOW — settling regardless'}`,
      );
    }
    return { proceed: !hold, risk };
  } catch (error) {
    console.error('[payout][risk] scoring failed, settling anyway:', error?.message || error);
    return { proceed: true };
  }
}

/**
 * The first-payout provenance check, wired.
 *
 * THE FIRST PAYOUT IS NEVER HELD. The owner's call, 2026-08-14: "lets pay out
 * the First one instant, and put them on a list." Making a brand new
 * participant wait three days for money they earned, on circumstantial
 * evidence, to catch a farmer who will simply wait three days, costs every
 * honest newcomer and stops nobody.
 *
 * What a flag does instead is put them on the WATCHLIST, which gates their
 * SECOND payout. One payout is the price of getting real evidence — and the
 * pattern this exists to catch (redeem, move, relink, redeem again) only becomes
 * visible on the repeat anyway. An admin who clears the flag before then costs
 * that person nothing at all.
 *
 * Fails open like everything else on this path.
 */
async function checkFirstPayout(record, walletAddress) {
  let mod;
  try {
    mod = await import('../mole/payoutProvenance.js');
  } catch (error) {
    console.warn('[payout][provenance] module unavailable:', error?.message || error);
    return { provenance: null, watchlisted: false };
  }

  let provenance;
  try {
    provenance = await mod.runFirstPayoutCheck({ userId: record.userId, wallet: walletAddress, db });
  } catch (error) {
    console.error('[payout][provenance] check failed, settling anyway:', error?.message || error);
    return { provenance: null, watchlisted: false };
  }
  // null means the check is off, or this is not their first payout.
  if (!provenance) return { provenance: null, watchlisted: false };

  db.noteFirstPayoutCheck({ id: record.id, provenance });

  const flagged = provenance.verdict === mod.VERDICTS.REVIEW;
  console.log(
    `[payout][provenance] ${record.id} first payout — ${mod.summarizeProvenance(provenance)}` +
    `${flagged ? ' WATCHLISTED — paying this one anyway' : ''}`,
  );
  if (!flagged) return { provenance, watchlisted: false };

  const signals = (provenance.findings || []).filter((f) => f.weight > 0).map((f) => f.signal);
  const added = db.addToWatchlist({
    userId: record.userId,
    reason: 'first_payout_review',
    signals,
    wallet: walletAddress,
    redemptionId: record.id,
    report: provenance,
  });
  return { provenance, watchlisted: true, alreadyListed: Boolean(added?.alreadyListed), signals };
}

/**
 * The gate that actually bites: a repeat payout to somebody flagged on their
 * first and never cleared.
 *
 * This is where withholding is defensible. They have been paid once, an admin
 * was asked to look, and the review queue's timer still releases it if nobody
 * does — so the worst case is a delay on a SECOND payout, never a first.
 */
function watchlistHold(record) {
  if (!firstPayoutGateEnabled()) return false;
  try {
    if (!db.isWatchlisted(record.userId)) return false;
  } catch (error) {
    // Fails open: an unreadable watchlist is our problem, not theirs.
    console.warn('[payout][watchlist] unreadable, settling:', error?.message || error);
    return false;
  }
  const entry = db.getWatchlistEntry(record.userId);
  db.noteRiskAssessment({
    id: record.id,
    risk: record.risk || null,
    decision: 'held',
    heldReason: `watchlist: ${(entry?.signals || []).join(', ') || 'first payout flagged, not yet cleared'}`,
  });
  console.warn(`[payout] ${record.id} held — user is on the watchlist from their first payout and has not been cleared`);
  return true;
}

function firstPayoutGateEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.QUIZ_WATCHLIST_GATE_ENABLED || '').trim().toLowerCase(),
  );
}

async function settleRecord(record) {
  const linked = getLinkedWallet(record.userId);
  if (!linked || !linked.address) {
    const retryMs = computeRetryMs(record, true);
    const noted = db.noteSettlementAttempt({
      id: record.id,
      error: 'No linked payout wallet found. Link a wallet in Mole Guard or save one in faucet, then requeue if needed.',
      retryAfterMs: retryMs,
      maxAttempts: config.maxAttempts,
      walletAddress: null,
      walletSource: null,
    });
    console.warn(`[payout] ${record.id} user=${record.userId} missing wallet; retry in ${Math.round(retryMs/1000)}s`);
    if (noted && noted.ok && Number(noted.rec?.attempts || 0) === 1) {
      await postDiscordAnnouncement(formatMissingWalletMessage(record));
    }
    return;
  }

  const amount = Number(record.winlewDue ?? db.estimateWinlewForPoints(record.amount));
  if (!(amount > 0)) {
    db.noteSettlementAttempt({
      id: record.id,
      error: 'Calculated payout amount was not positive.',
      retryAfterMs: computeRetryMs(record, false),
      maxAttempts: config.maxAttempts,
      walletAddress: linked.address,
      walletSource: linked.source,
    });
    return;
  }

  if (config.dryRun) {
    console.log(`[payout][dry-run] ${record.id} -> ${linked.address} (${amount} WinLEW)`);
    db.noteSettlementAttempt({
      id: record.id,
      error: `Dry run only — would send ${amount} WinLEW to ${linked.address}`,
      retryAfterMs: config.scanMs,
      maxAttempts: Number.MAX_SAFE_INTEGER,
      walletAddress: linked.address,
      walletSource: linked.source,
    });
    return;
  }

  const assessment = await assessRisk(record, linked.address);
  if (!assessment.proceed) {
    console.warn(`[payout] ${record.id} held for review — points remain earned and the record stays queued`);
    return;
  }

  // First payout for this PERSON: look at where the wallet came from, once.
  // The owner's decision, 2026-08-14 — no holder minimum, any holder can earn,
  // but the payout that opens an account gets checked against public chain
  // history. Keyed on the Discord user, because keying on the wallet would make
  // every new wallet a clean slate, which is the loophole itself.
  // Repeat payout to someone flagged on their first and never cleared. Checked
  // BEFORE the first-payout check, since the two are mutually exclusive.
  if (watchlistHold(record)) {
    await postDiscordAnnouncement(formatWatchlistHeldMessage(record, linked));
    return;
  }

  // First payout: check, record, flag — but never hold. See checkFirstPayout().
  const firstPayout = await checkFirstPayout(record, linked.address);

  // An intent that survived reconciliation is unresolved — the chain could not
  // tell us whether the first transfer landed. Sending now is exactly the
  // double-payment this guards against.
  if (record.payoutIntent?.signature) {
    console.warn(`[payout] ${record.id} has an unresolved payout intent (${record.payoutIntent.signature}); skipping rather than re-sending`);
    return;
  }

  const tx = await sendWinlew(linked.address, amount, ({ signature, lastValidBlockHeight }) => {
    // Persisted BEFORE confirmation, so a crash between here and
    // markRedemptionPaidById leaves evidence instead of a silent re-send.
    db.notePayoutIntent({ id: record.id, signature, lastValidBlockHeight });
  });

  const result = db.markRedemptionPaidById({
    id: record.id,
    winlewSent: amount,
    tx,
    walletAddress: linked.address,
    walletSource: linked.source,
    settlementMode: 'auto_worker',
    settlementWorker: WORKER_NAME,
  });

  if (!result.ok) {
    throw new Error(result.error || 'mark_paid_failed');
  }

  db.clearPayoutIntent({ id: record.id });

  // Receipt AFTER the payout is recorded, never before, and never blocking it.
  // A receipt is evidence produced alongside a payout, not a gate on one.
  //
  // BUILT FROM result.rec, THE PERSISTED RECORD — NOT from `record`. The
  // in-memory copy was read before assessRisk() and markRedemptionPaidById()
  // wrote to the database, so it is missing the risk verdict and carries no
  // paidTs. A receipt built from it would hash a decision that never existed,
  // and `npm run receipts:verify` — which replays against what is stored —
  // would report every payout as tampered with.
  try {
    const receipts = await import('../mole/payoutReceipt.js');
    const receipt = await receipts.issuePayoutReceipt(result.rec);
    if (receipt) db.notePayoutReceipt({ id: record.id, receipt });
  } catch (error) {
    console.warn('[payout][receipt] not issued:', error?.message || error);
  }
  console.log(`[payout] settled ${record.id} user=${record.userId} amount=${amount} tx=${tx}`);
  await postDiscordAnnouncement(formatSettlementMessage(record, linked, amount, tx));

  // Announced AFTER the money went out, because this is not a refusal and must
  // not read like one. It is a note asking an admin to look before the next one.
  if (firstPayout.watchlisted && !firstPayout.alreadyListed) {
    await postDiscordAnnouncement(formatWatchlistedMessage(record, linked, firstPayout));
  }
}

async function scanOnce() {
  if (running) return;
  // Before anything is sent, resolve what was already sent. This is the first
  // thing a restarted worker does.
  try {
    const rc = await reconcilePayoutIntents();
    if (rc.checked) {
      console.log(`[payout][reconcile] checked=${rc.checked} settled=${rc.settled} cleared=${rc.cleared} unresolved=${rc.unresolved}`);
    }
  } catch (error) {
    console.error('[payout][reconcile] failed:', error?.message || error);
  }
  // The review queue is swept BEFORE settling, so anything auto-released this
  // pass is paid in the same run rather than waiting for the next one. A person
  // whose payout was held for three days should not then wait another 45s
  // because the sweep ran in the wrong order.
  try {
    const sweep = await sweepReviewQueue({ db, announce: postDiscordAnnouncement });
    if (sweep.held) {
      console.log(`[payout][review] held=${sweep.held} released=${sweep.released} escalated=${sweep.escalated} waiting=${sweep.waiting} hard=${sweep.hard}`);
    }
    for (const error of sweep.errors) console.error('[payout][review]', error);
  } catch (error) {
    // Must never stop payouts — but must never be silent either.
    console.error('[payout][review] sweep failed:', error?.message || error);
  }

  running = true;
  try {
    const candidates = db.listAutoSettlementCandidates({
      limit: config.maxBatch,
      allowKinds: [
        config.autoCyclePayouts ? 'cycle_payout' : null,
        config.autoCyclePayouts ? 'leaderboard_payout' : null,
        config.autoRedeems ? 'user_redeem' : null,
      ].filter(Boolean),
    });

    for (const record of candidates) {
      if (!isKindEnabled(record.kind)) continue;
      try {
        await settleRecord(record);
        await delay(350);
      } catch (err) {
        const retryMs = computeRetryMs(record, false);
        db.noteSettlementAttempt({
          id: record.id,
          error: err?.message || String(err),
          retryAfterMs: retryMs,
          maxAttempts: config.maxAttempts,
        });
        console.error(`[payout] failed ${record.id}:`, err?.message || err);
      }
    }
  } finally {
    running = false;
  }
}

function start() {
  console.log(`[payout] mode=${payoutModeLabel(config)} scan=${config.scanMs}ms batch=${config.maxBatch}`);
  if (!config.enabled) {
    console.log('[payout] Disabled. Set QUIZ_PAYOUTS_ENABLED=true to activate the worker.');
    return;
  }
  if (!config.mint) {
    console.error('[payout] WINLEW_MINT missing. Worker cannot start.');
    process.exit(1);
  }
  try {
    const pubkey = getSigner().publicKey.toBase58();
    console.log(`[payout] signer=${pubkey}`);
  } catch (err) {
    console.error('[payout] Failed to load payout signer:', err?.message || err);
    process.exit(1);
  }
  scanOnce().catch((err) => console.error('[payout] initial scan failed:', err));
  timer = setInterval(() => {
    scanOnce().catch((err) => console.error('[payout] scan failed:', err));
  }, Math.max(5_000, config.scanMs));
}

// pm2 restarts this worker routinely. A payout intent is written the moment a
// signature exists and before it is confirmed — the whole idempotency scheme
// rests on that record surviving. It reaches local disk synchronously, but the
// Mongo push is queued, and exiting on the signal drops it. Local disk still
// carries it here (this layer reads local), so the running machine stays
// correct; what suffers is the backup, which is the copy that becomes truth
// after a disk loss or on a machine that boots empty.
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  await flushManagedQuizWrites().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

initQuizStorage()
  .catch((error) => {
    console.warn('[quiz-storage] bootstrap failed:', error?.message || error);
  })
  .finally(() => {
    start();
  });
