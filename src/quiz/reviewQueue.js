// The review queue's safety valve.
//
// The owner's objection, 2026-08-14, on being shown the hold-for-review design:
// "the system can't do this? i would hate not to see something and it never get
// reviewed and then..."
//
// He is right, and it was a real hole. A payout held pending human review is
// only fail-open if a human actually turns up. If nobody reads the channel that
// week, the participant is never paid, never told why, and nothing anywhere
// says so. That is fail-CLOSED wearing a fail-open costume, and it is worse
// than not holding at all — at least an outright refusal is visible.
//
// So a hold is a TIMER, not a state. Three mechanisms, in order of how much
// they matter:
//
//   1. AUTO-RELEASE. A soft hold that nobody has touched by its deadline is
//      released and paid. Recorded as `auto_released`, never as `approved` —
//      an unattended queue must not be able to masquerade as a reviewed one.
//      This is on by DEFAULT. Enforcement without it is a money black hole.
//
//   2. ESCALATION. While a hold is waiting, it is announced again as it ages,
//      and the reminders change rather than repeating identically, because an
//      alert that never changes is one people stop reading.
//
//   3. DIGEST. Everything currently held, with ages and deadlines, posted on a
//      schedule even when nothing has changed. Silence should mean "nothing is
//      waiting", and that is only true if a non-empty queue is never silent.
//
// WHAT NEVER AUTO-RELEASES. One category: a hold caused by a link to a BANNED
// wallet. The faucet already refuses those outright, so releasing one on a timer
// would quietly overrule a decision a human made on purpose. Those escalate
// forever instead — loudly, and increasingly so. Nothing here can auto-REJECT,
// under any circumstances; the timer only ever runs in the participant's favour.

const HOUR_MS = 60 * 60 * 1000;

/** Hold reasons a timer must never overrule, because a human already decided.
 *  Matched against the recorded signal names, not free text. */
const HARD_SIGNALS = Object.freeze([
  'linked_to_banned_wallet',
  'funded_by_banned_wallet',
]);

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function resolveReviewConfig(env = process.env) {
  return {
    // Long enough that a mod who checks in every couple of days catches it,
    // short enough that nobody waits a fortnight for money they earned.
    slaHours: parseNumber(env.QUIZ_REVIEW_SLA_HOURS, 72),
    // DEFAULT ON. See the header — this is the valve, not a feature.
    autoReleaseEnabled: parseBool(env.QUIZ_REVIEW_AUTO_RELEASE_ENABLED, true),
    digestHours: parseNumber(env.QUIZ_REVIEW_DIGEST_HOURS, 24),
    escalateEveryHours: parseNumber(env.QUIZ_REVIEW_ESCALATE_HOURS, 24),
  };
}

/** Every signal recorded against a held record, from both the risk engine and
 *  the first-payout check. */
function signalsFor(rec) {
  const risk = Array.isArray(rec?.risk?.signals) ? rec.risk.signals : [];
  const provenance = (rec?.firstPayoutCheck?.findings || [])
    .filter((f) => Number(f?.weight) > 0)
    .map((f) => f.signal);
  return [...new Set([...risk, ...provenance])];
}

function isHardHold(rec) {
  return signalsFor(rec).some((s) => HARD_SIGNALS.includes(s));
}

/**
 * What should happen to one held record right now.
 *
 * Pure — no database, no clock beyond `now`, no Discord. The decision to pay
 * somebody without a human in the loop deserves to be testable on its own.
 */
function classifyHold(rec, { now = Date.now(), config = resolveReviewConfig() } = {}) {
  const heldTs = Number(rec?.heldTs || 0);
  const ageMs = heldTs ? Math.max(0, now - heldTs) : 0;
  const hard = isHardHold(rec);
  const dueAt = heldTs ? heldTs + config.slaHours * HOUR_MS : null;
  const overdue = Boolean(dueAt) && now >= dueAt;

  // A hold with no timestamp cannot be aged. Escalate it rather than releasing
  // it on a guess — and rather than leaving it silent, which is the whole bug.
  if (!heldTs) {
    return { action: 'escalate', reason: 'no_held_timestamp', ageMs: 0, dueAt: null, hard, signals: signalsFor(rec) };
  }

  if (hard) {
    return {
      action: overdue ? 'escalate' : 'wait',
      reason: 'hard_signal_requires_a_human',
      ageMs, dueAt, overdue, hard, signals: signalsFor(rec),
    };
  }

  if (overdue && config.autoReleaseEnabled) {
    return { action: 'release', reason: 'review_sla_expired', ageMs, dueAt, overdue, hard, signals: signalsFor(rec) };
  }
  if (overdue) {
    // Auto-release deliberately switched off: the operator has chosen to hold
    // indefinitely, so the least we do is refuse to be quiet about it.
    return { action: 'escalate', reason: 'overdue_auto_release_disabled', ageMs, dueAt, overdue, hard, signals: signalsFor(rec) };
  }
  return { action: 'wait', reason: 'within_sla', ageMs, dueAt, overdue: false, hard, signals: signalsFor(rec) };
}

function hoursOf(ms) {
  return Math.floor(ms / HOUR_MS);
}

/** Should this record be escalated again, or was it announced recently enough? */
function dueForEscalation(rec, { now = Date.now(), config = resolveReviewConfig() } = {}) {
  const last = Number(rec?.lastEscalatedTs || 0);
  if (!last) return true;
  return now - last >= config.escalateEveryHours * HOUR_MS;
}

function formatEscalation(rec, verdict) {
  const hours = hoursOf(verdict.ageMs);
  const n = Number(rec.escalations || 0) + 1;
  // The reminder changes as it ages. An alert that reads identically the tenth
  // time is one nobody reads the tenth time.
  const lead = verdict.hard
    ? '🚫 **Held payout needs a decision — it will NOT auto-release**'
    : n === 1
      ? '⏳ **Held payout waiting on review**'
      : `⏳ **Still waiting — reminder #${n}**`;

  return [
    lead,
    `• Record: \`${rec.id}\` · User: <@${rec.userId}> · Points: **${Number(rec.amount || 0)}**`,
    `• Held for: **${hours}h**`,
    verdict.hard
      ? '• Why it will not auto-release: linked to a banned wallet — a human banned that on purpose, and a timer must not overrule them.'
      : verdict.dueAt
        ? `• Auto-releases: ${new Date(verdict.dueAt).toISOString()} if nobody reviews it`
        : '• No hold timestamp recorded — cannot age this one, please look at it.',
    `• Signals: ${verdict.signals.join(', ') || 'none recorded'}`,
    `• \`!quizreview ${rec.id}\` · \`!quizapprove ${rec.id}\` · \`!quizreject ${rec.id} <reason>\``,
    '',
    '_Their points are intact either way. Nothing here can auto-reject._',
  ].join('\n');
}

function formatDigest(rows, { now = Date.now(), config = resolveReviewConfig() } = {}) {
  if (!rows.length) return null;
  const lines = [
    `📋 **Payout review queue — ${rows.length} held**`,
    '',
  ];
  for (const { rec, verdict } of rows) {
    const hours = hoursOf(verdict.ageMs);
    const when = verdict.hard
      ? 'needs a decision — will not auto-release'
      : verdict.dueAt
        ? `releases in ${Math.max(0, hoursOf(verdict.dueAt - now))}h`
        : 'no timestamp — please look';
    lines.push(`• \`${rec.id}\` · <@${rec.userId}> · ${Number(rec.amount || 0)} pts · held ${hours}h · ${when}`);
  }
  lines.push('');
  lines.push(config.autoReleaseEnabled
    ? `_Soft holds auto-release after ${config.slaHours}h — money nobody reviewed still gets paid._`
    : '_⚠️ Auto-release is DISABLED. Nothing here will ever pay itself out; every one of these needs a human._');
  return lines.join('\n');
}

/**
 * One pass over the review queue.
 *
 * NEVER THROWS and never blocks settlement — it runs alongside the payout scan.
 * A failure here must not stop payouts, but it also must not be silent, so the
 * caller logs whatever comes back.
 *
 * @param {object} deps
 * @param {object} deps.db        the quiz db module
 * @param {function} deps.announce  async (message) => void
 */
async function sweepReviewQueue({ db, announce, now = Date.now(), config = resolveReviewConfig() } = {}) {
  const result = { held: 0, released: 0, escalated: 0, waiting: 0, hard: 0, digested: false, errors: [] };

  let held;
  try {
    held = db.listHeldRedemptions();
  } catch (error) {
    result.errors.push(`list_failed:${error?.message || error}`);
    return result;
  }
  result.held = held.length;

  const rows = [];
  for (const rec of held) {
    let verdict;
    try {
      verdict = classifyHold(rec, { now, config });
    } catch (error) {
      result.errors.push(`classify_failed:${rec?.id}:${error?.message || error}`);
      continue;
    }
    if (verdict.hard) result.hard += 1;
    rows.push({ rec, verdict });

    if (verdict.action === 'release') {
      try {
        const released = db.autoReleaseHeldRedemption({ id: rec.id, reason: verdict.reason, heldForMs: verdict.ageMs });
        if (released?.ok) {
          result.released += 1;
          // Announced, not silent. Someone being paid without review is a fact
          // the operator should have to see, not a convenience they never learn
          // about — it is the system telling them the queue is unattended.
          if (announce) {
            await announce([
              '⌛ **Auto-released after review timed out**',
              `• Record: \`${rec.id}\` · User: <@${rec.userId}> · Points: **${Number(rec.amount || 0)}**`,
              `• Held ${hoursOf(verdict.ageMs)}h with no review, past the ${config.slaHours}h limit — paying it.`,
              `• Signals were: ${verdict.signals.join(', ') || 'none recorded'}`,
              '',
              '_Nobody reviewed this. Withholding earned money because a queue went unread is not a decision anyone made — if these are appearing often, either review them or turn enforcement off._',
            ].join('\n'));
          }
        } else {
          result.errors.push(`release_failed:${rec.id}:${released?.error || 'unknown'}`);
        }
      } catch (error) {
        result.errors.push(`release_threw:${rec.id}:${error?.message || error}`);
      }
      continue;
    }

    if (verdict.action === 'escalate' && dueForEscalation(rec, { now, config })) {
      try {
        db.noteHoldEscalation({ id: rec.id, now });
        result.escalated += 1;
        if (announce) await announce(formatEscalation(rec, verdict));
      } catch (error) {
        result.errors.push(`escalate_threw:${rec.id}:${error?.message || error}`);
      }
      continue;
    }

    result.waiting += 1;
  }

  // The digest fires on its schedule whether or not anything changed — a queue
  // that only speaks up when something happens goes quiet exactly when it is
  // being ignored.
  try {
    const remaining = rows.filter((r) => r.verdict.action !== 'release');
    const last = db.getReviewDigestTs();
    if (remaining.length && now - last >= config.digestHours * HOUR_MS) {
      const message = formatDigest(remaining, { now, config });
      if (message && announce) await announce(message);
      db.setReviewDigestTs(now);
      result.digested = true;
    }
  } catch (error) {
    result.errors.push(`digest_failed:${error?.message || error}`);
  }

  return result;
}

module.exports = {
  HARD_SIGNALS,
  resolveReviewConfig,
  classifyHold,
  isHardHold,
  signalsFor,
  dueForEscalation,
  formatEscalation,
  formatDigest,
  sweepReviewQueue,
};
