require('dotenv').config();
const { initQuizStorage } = require('./storage');
const storageReady = initQuizStorage().catch((error) => {
  console.warn('[quiz-storage] bootstrap failed:', error?.message || error);
});

if (globalThis.__WINLEW_QUIZ_STARTED) {
  console.log('⚠️ Quiz already started — skipping duplicate launch.');
  process.exit(0);
}
globalThis.__WINLEW_QUIZ_STARTED = true;

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} = require('discord.js');

const { getPool } = require('./questions');
const { getSponsorPool } = require('./sponsor');
const db = require('./db');
const { redeemQuizPoints, REDEMPTION_REASONS } = require('./redemption');
const { buildBuyWinlewButtonsRow, BUY_WINLEW_NOTE, WHY_HOLDER_ONLY } = require('./buyWinlewLinks');
const recentHistory = require('./recent-history');
const { resolvePayoutConfig, payoutModeLabel } = require('./payout-config');
const { commandInventory: quizCommandInventory } = require('./command-data.cjs');
const { runQuizDiagnostics } = require('./diagnostics');
// Read from package.json, not hardcoded — a hardcoded string here is
// exactly what silently went stale (v3.3.3) through the v3.3.4 release.
const RELEASE_VERSION = `v${require('../../package.json').version}`;

/* ───────────────────── CONFIG ───────────────────── */

const TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN (or DISCORD_BOT_TOKEN) missing in .env');
  process.exit(1);
}

const BASE_POINTS = Number(process.env.BASE_POINTS || 100);
const SPONSOR_BASE_POINTS = Number(process.env.SPONSOR_BASE_POINTS || 125);

const MULTIPLIER = { easy: 1, medium: 1.5, hard: 2.25 };
const POINTS = {
  easy: Math.round(BASE_POINTS * MULTIPLIER.easy),
  medium: Math.round(BASE_POINTS * MULTIPLIER.medium),
  hard: Math.round(BASE_POINTS * MULTIPLIER.hard),
};

const QUIZ_CHANNELS = (process.env.QUIZ_CHANNELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const QUIZ_TIME_MS = Number(process.env.QUIZ_TIME_MS || 15_000);
const QUIZ_COOLDOWN_MS = Number(process.env.QUIZ_COOLDOWN_MS || 30_000);
const PAYOUT_CONFIG = resolvePayoutConfig();

function formatPayoutRate(rate = db.getPayoutRate()) {
  const amount = Number(rate || 0);
  return `${amount} WinLEW for every 1 point`;
}

// Cycles (91-day quarters)
const CYCLE_LENGTH_DAYS = Number(process.env.CYCLE_LENGTH_DAYS || 91);
const CYCLE_EPOCH = process.env.CYCLE_EPOCH || null;

const quizDiagnostics = runQuizDiagnostics();

/* ───────────────────── STATE ───────────────────── */

const activeQuizzes = new Map(); // channelId -> quiz
const lastQuizTime = new Map();  // channelId -> timestamp
const lastClick = new Map();     // userId -> ms

/* ───────────────────── INIT CYCLE CONFIG ───────────────────── */

function initCycleConfig() {
  if (!CYCLE_EPOCH) return;
  let epochMs = null;

  if (/^\d+$/.test(CYCLE_EPOCH)) {
    epochMs = Number(CYCLE_EPOCH);
  } else {
    const d = new Date(CYCLE_EPOCH);
    if (!isNaN(d.getTime())) epochMs = d.getTime();
  }

  if (!epochMs) {
    console.warn('[cycle] Invalid CYCLE_EPOCH; ignoring:', CYCLE_EPOCH);
    return;
  }

  const did = db.setCycleEpochIfEmpty(epochMs, CYCLE_LENGTH_DAYS);
  if (did) {
    const cur = db.getCurrentCycle();
    console.log(`[cycle] Configured epoch=${new Date(epochMs).toISOString()} lengthDays=${CYCLE_LENGTH_DAYS} current=${cur.id}`);
  }
}

/* ───────────────────── CLIENT ───────────────────── */

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

/* ───────────────────── SAFETY ───────────────────── */

process.on('unhandledRejection', err =>
  console.error('UNHANDLED REJECTION:', err)
);

process.on('uncaughtException', err =>
  console.error('UNCAUGHT EXCEPTION:', err)
);

/* ───────────────────── HELPERS ───────────────────── */

async function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

function isAllowedChannel(channelId) {
  return !QUIZ_CHANNELS.length || QUIZ_CHANNELS.includes(channelId);
}

function requireManageGuild(interaction) {
  const perms = interaction.memberPermissions;
  return perms && perms.has(PermissionsBitField.Flags.ManageGuild);
}

function isOnCooldown(channelId) {
  const last = lastQuizTime.get(channelId) || 0;
  return Date.now() - last < QUIZ_COOLDOWN_MS;
}

function cooldownRemainingMs(channelId) {
  const last = lastQuizTime.get(channelId) || 0;
  const remaining = QUIZ_COOLDOWN_MS - (Date.now() - last);
  return Math.max(0, remaining);
}

function msToPretty(ms) {
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return '0s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'2-digit' });
}

function hasAnswerLeak(q) {
  const txt = `${q?.q ?? ''}\n${(q?.choices || []).join('\n')}`;
  return /answer\s*[:\-]/i.test(txt) || /\(correct\)/i.test(txt) || /✅|✔️|☑️/.test(txt);
}

function validatePool(pool, label) {
  pool.forEach((q, i) => {
    const okChoices = Array.isArray(q.choices) && q.choices.length === 4;
    const okIndex = Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3;

    if (!okChoices || !okIndex || typeof q.q !== 'string') {
      console.warn(`⚠️ [${label}] malformed question #${i}`, {
        q: q.q, choices: q.choices, answerIndex: q.answerIndex,
      });
    }

    if (hasAnswerLeak(q)) {
      console.warn(`⚠️ [${label}] possible ANSWER LEAK #${i}: "${q.q}"`);
    }
  });
}

function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\n?\s*(answer|correct answer)\s*[:\-].*$/i, '')
    .replace(/^\s*[✅✔️☑️]\s*/g, '')
    .replace(/\s*\(correct\)\s*/gi, '')
    .replace(/\s*\[correct\]\s*/gi, '')
    .replace(/\s*\*\s*$/g, '')
    .trim();
}

function sanitizeQuestionForEmbed(q) {
  return {
    ...q,
    q: sanitizeText(q.q),
    choices: Array.isArray(q.choices) ? q.choices.map(sanitizeText) : [],
  };
}

function shuffleQuestion(rawQuestion) {
  const base = sanitizeQuestionForEmbed(rawQuestion);
  const zipped = base.choices.map((choice, idx) => ({ choice, idx }));
  for (let i = zipped.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [zipped[i], zipped[j]] = [zipped[j], zipped[i]];
  }
  return {
    ...base,
    choices: zipped.map(x => x.choice),
    answerIndex: zipped.findIndex(x => x.idx === rawQuestion.answerIndex),
  };
}

function pickQuestion(pool, configKey, channelId) {
  const recent = recentHistory.getRecentQuestionKeys(channelId);
  const enriched = pool.map((q, idx) => ({ q, idx, key: `${configKey}:${idx}` }));
  const unseen = enriched.filter(item => !recent.includes(item.key));
  const source = unseen.length ? unseen : enriched;
  const picked = source[Math.floor(Math.random() * source.length)];
  recentHistory.rememberQuestion(channelId, picked.key, 12);
  return picked.q;
}


/* ───────────────────── READY ───────────────────── */

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ───────────────────── COMMANDS ───────────────────── */

const handlers = {

  async quizhelp(interaction) {
    const sections = [];
    const order = ['Quiz / Play', 'Leaderboards', 'Progress', 'Redeems', 'Admin / Cycle'];

    sections.push(`**Quiz Commands — ${RELEASE_VERSION}**`);
    sections.push('');

    for (const category of order) {
      const entries = quizCommandInventory.filter((entry) => entry.category === category);
      if (!entries.length) continue;
      sections.push(`**${category}**`);
      for (const entry of entries) {
        sections.push(`• \`${entry.path}\` — ${entry.description}${entry.audience === 'admin' ? ' (Manage Server)' : ''}`);
      }
      sections.push('');
    }

    sections.push(`💸 This cycle settles at **${formatPayoutRate()}** — earn now, then cash out clean at close.`);
    sections.push(`⚙️ Settlement engine: **${payoutModeLabel(PAYOUT_CONFIG)}**.`);
    return interaction.reply({ content: sections.join('\n').trim(), ephemeral: true });
  },


  async cycleinfo(interaction) {
    const cur = db.getCurrentCycle();
    const target = interaction.options.getUser('user');
    const viewingOther = !!target && target.id !== interaction.user.id;

    if (viewingOther && !requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to view other users.', ephemeral: true });
    }

    const userId = target ? target.id : interaction.user.id;
    const totalPts = db.getUserCyclePoints(userId, cur.id);
    const unpaidCyclePts = db.getCycleOutstandingPoints(userId, cur.id);

    const msg = [
      `📆 **Cycle ${cur.id}**`,
      `• Window: **${fmtDate(cur.startMs)} → ${fmtDate(cur.endMs)}**`,
      `• Length: **${Math.round((cur.endMs - cur.startMs) / (24*60*60*1000))} days**`,
      '',
      `⭐ ${target ? `<@${userId}>` : 'You'} have **${totalPts}** total cycle points.`,
      `🧾 Unpaid cycle points: **${unpaidCyclePts}**`,
      `💸 Estimated unpaid cycle payout: **${db.estimateWinlewForPoints(unpaidCyclePts)} WinLEW** at this cycle's **${formatPayoutRate()}** rate.`,
    ].join('\n');

    return interaction.reply({ content: msg, ephemeral: true });
  },

  async cycleboard(interaction) {
    await interaction.deferReply();
    const cur = db.getCurrentCycle();
    const top = db.topCycleUsers(cur.id, 10);
    if (!top.length || !top.some(u => u.points > 0)) return interaction.editReply('No cycle scores yet.');

    const lines = await Promise.all(
      top.map(async (u, i) => {
        const cached = interaction.guild.members.cache.get(u.userId) || null;
        const member = cached || await interaction.guild.members.fetch(u.userId).catch(() => null);
        const questionPart = u.questions ? ` __${u.questions} ${u.questions === 1 ? 'Question' : 'Questions'}__` : '';
        return `**#${i + 1}** — ${member?.displayName ?? `<@${u.userId}>`}: **${u.points} pts** (*${u.unpaidPoints} Unpaid Points*)${questionPart}`;
      })
    );

    return interaction.editReply(`📆 **Cycle ${cur.id} Leaderboard** (${fmtDate(cur.startMs)} → ${fmtDate(cur.endMs)})\n${lines.join('\n')}`);
  },

  async cycleclose(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to close a cycle.', ephemeral: true });
    }

    const cur = db.getCurrentCycle();
    const res = db.closeCycle(cur.id);
    if (!res.ok) return interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });

    return interaction.reply({
      content:
        `✅ Closed **Cycle ${res.id}** (${fmtDate(res.startMs)} → ${fmtDate(res.endMs)})\n` +
        `Created **${res.createdCount}** pending payout records at **${db.getPayoutRate()} WinLEW per point**.\n` +
        (res.carriedCount ? `↪️ Carried **${res.carriedCount}** below-minimum balance${res.carriedCount === 1 ? '' : 's'} (< ${db.getMinRedemptionPoints()} pts) forward into **${res.carryCycleId}**.\n` : '') +
        `Use \`/cyclepayouts\` to list them.${PAYOUT_CONFIG.enabled && PAYOUT_CONFIG.autoCyclePayouts ? '\n🤖 The payout worker will pick these up automatically when it is running.' : ''}`,
      ephemeral: false
    });
  },

  // Added 2026-07-18 — one-time cadence switch (91-day quarterly -> 30-day
  // monthly), per the project owner's own request. Requires typing the
  // literal word CONFIRM as a safety rail (mirrors how other genuinely
  // hard-to-reverse admin actions in this codebase require deliberate
  // confirmation, not just a permission check) — this is a one-way door for
  // the "C" cycle numbering scheme, not something to fire by accident.
  async cycleswitchmonthly(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to change the cycle cadence.', ephemeral: true });
    }
    const confirm = interaction.options.getString('confirm') || '';
    if (confirm.trim().toUpperCase() !== 'CONFIRM') {
      const cur = db.getCurrentCycle();
      return interaction.reply({
        content:
          `⚠️ This closes the current cycle **${cur.id}** (settling everyone's points into pending payouts, exactly like \`/cycleclose\`) and permanently switches from 91-day cycles to 30-day cycles going forward, starting from a new **M1, M2, M3…** numbering — the old **C1, C2…** history is kept, never renumbered or deleted, just retired.\n` +
          `This cannot be undone by running the command again (a prefix can only be used once).\n` +
          `Re-run with \`confirm:CONFIRM\` to proceed.`,
        ephemeral: true,
      });
    }

    const res = db.switchCycleCadence({ lengthDays: 30, prefix: 'M', reason: `Discord /cycleswitchmonthly by ${interaction.user?.tag || interaction.user?.id}` });
    if (!res.ok) return interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });

    return interaction.reply({
      content:
        `✅ Closed **Cycle ${res.closedPreviousCycle.id}** and switched to **30-day monthly cycles**.\n` +
        `Created **${res.closedPreviousCycle.createdCount ?? 0}** pending payout records at **${db.getPayoutRate()} WinLEW per point** for the closed cycle.\n` +
        `New active cycle: **${res.firstNewCycleId}**. The old \`C\`-prefixed cycle history is preserved exactly as-is — only new cycles use the \`M\` prefix from here on.\n` +
        `Use \`/cyclepayouts\` to list the settled payouts from ${res.closedPreviousCycle.id}.`,
      ephemeral: false,
    });
  },

  async cyclepayouts(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to view cycle payouts.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const cycleId = interaction.options.getString('cycle') || db.getCurrentCycle().id;
    const rows = db.listCyclePayouts(cycleId, null, 25);

    if (!rows.length) {
      return interaction.editReply(`No cycle payout records for **${cycleId}**.`);
    }

    const lines = rows.map(r => {
      const when = new Date(r.paidTs || r.ts).toLocaleString();
      const status = (r.status || 'pending').toUpperCase();
      const paidPart = r.tx ? ` — tx: \`${r.tx}\`` : '';
      return `• **${status}** — **ID:** \`${r.id}\` — <@${r.userId}> — **${r.amount} pts** — **${r.winlewDue ?? db.estimateWinlewForPoints(r.amount)} WinLEW** — _${when}_${paidPart}`;
    });

    return interaction.editReply(`💸 **Cycle payout records — ${cycleId}**\n${lines.join('\n')}`);
  },

async redeemspending(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to view pending redeems.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const pending = db.listPendingRedemptions(20);
    const failed = db.listFailedRedemptions(10);
    if (!pending.length && !failed.length) {
      return interaction.editReply('✅ No pending or failed redemption requests.');
    }

    const pendingLines = pending.map((r) => {
      const when = new Date(r.ts).toLocaleString();
      const kind = r.kind === 'cycle_payout' ? `cycle:${r.cycleId}` : r.kind === 'leaderboard_payout' ? 'leaderboard' : 'manual';
      return `• **ID:** \`${r.id || 'missing-id'}\` — <@${r.userId}> — **${r.amount} pts** — **${r.winlewDue ?? db.estimateWinlewForPoints(r.amount)} WinLEW due** — _${kind}_ — _${when}_`;
    });

    const failedLines = failed.map((r) => {
      const when = new Date(r.lastAttemptTs || r.ts).toLocaleString();
      const reason = r.lastError ? ` — ${r.lastError}` : '';
      return `• **ID:** \`${r.id || 'missing-id'}\` — <@${r.userId}> — **${r.amount} pts** — attempts: **${r.attempts || 0}** — _${when}_${reason}`;
    });

    const sections = [];
    if (pendingLines.length) {
      sections.push(`🧾 **Pending redeems** (latest ${pendingLines.length})`);
      sections.push(pendingLines.join('\n'));
    }
    if (failedLines.length) {
      sections.push(`\n⚠️ **Failed settlements** (latest ${failedLines.length})`);
      sections.push(failedLines.join('\n'));
      sections.push('Use `/requeueredeem id:<id>` after fixing the wallet or env issue.');
    }

    return interaction.editReply(sections.join('\n'));
  },

async markredeempaid(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to mark redeems paid.', ephemeral: true });
    }

    const id = interaction.options.getString('id');
    const winlew = interaction.options.getNumber('winlew');
    const tx = interaction.options.getString('tx') || null;

    if (!id || !Number.isFinite(winlew)) {
      return interaction.reply({ content: 'Missing required inputs: id, winlew', ephemeral: true });
    }

    const res = db.markRedemptionPaidById({ id, winlewSent: winlew, tx });
    if (!res.ok) {
      return interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });
    }

    const r = res.rec;
    const msg = [
      `✅ Marked redeem as **PAID**`,
      `• ID: \`${r.id}\``,
      `• User: <@${r.userId}>`,
      `• Points: **${r.amount}**`,
      r.kind === 'cycle_payout' ? `• Cycle: **${r.cycleId}**` : r.kind === 'leaderboard_payout' ? `• Kind: leaderboard residual` : `• Kind: manual`,
      `• WinLEW sent: **${winlew}**`,
      `• Policy rate: **${db.getPayoutRate()} WinLEW per point**`,
      tx ? `• TX: ${tx}` : null,
    ].filter(Boolean).join('\n');

    return interaction.reply({ content: msg, ephemeral: false });
  },

  async rejectredeem(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to reject redeems.', ephemeral: true });
    }

    const id = interaction.options.getString('id');
    const reason = interaction.options.getString('reason') || null;

    if (!id) {
      return interaction.reply({ content: 'Missing required input: id', ephemeral: true });
    }

    const res = db.rejectRedemptionById({ id, reason });
    if (!res.ok) {
      return interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });
    }

    const r = res.rec;
    const publicMsg =
      r.kind === 'user_redeem'
        ? `❌ Redeem rejected (**${r.amount}** pts refunded) — <@${r.userId}> — ID: \`${r.id}\``
        : `❌ Cycle payout rejected (no refund; re-run cycle close if needed) — <@${r.userId}> — ID: \`${r.id}\``;

    await interaction.reply({ content: publicMsg, ephemeral: false });

    if (reason) {
      try {
        await interaction.followUp({ content: `Reason (ephemeral): ${reason}`, ephemeral: true });
      } catch {}
    }
  },

  async leaderboard(interaction) {
    await interaction.deferReply();

    const top = db.topUsers(10);
    if (!top.length) return interaction.editReply('No scores yet.');

    const lines = await Promise.all(
      top.map(async (u, i) => {
        const cached = interaction.guild.members.cache.get(u.userId) || null;
        const member = cached || await interaction.guild.members.fetch(u.userId).catch(() => null);
        const activityPart = `__${u.questions} ${u.questions === 1 ? 'Question' : 'Questions'} & ${u.cyclesPlayed} ${u.cyclesPlayed === 1 ? 'Cycle' : 'Cycles'}__`;
        return `**#${i + 1}** — ${member?.displayName ?? `<@${u.userId}>`}: **${u.lifetimePoints} pts** (*${u.unpaidPoints} Unpaid Points*) ${activityPart}`;
      })
    );

    return interaction.editReply(`🏆 **Leaderboard**\n${lines.join('\n')}`);
  },

  async sponsorboard(interaction) {
    await interaction.deferReply();

    const sponsor = interaction.options.getString('sponsor').toLowerCase();
    const top = db.topSponsorUsers(sponsor, 10);

    if (!top.some(u => u.sponsorPoints > 0)) {
      return interaction.editReply(`No scores for **${sponsor.toUpperCase()}** yet.`);
    }

    const lines = await Promise.all(
      top.map(async (u, i) => {
        const cached = interaction.guild.members.cache.get(u.userId) || null;
        const member = cached || await interaction.guild.members.fetch(u.userId).catch(() => null);
        return `**#${i + 1}** — ${member?.displayName ?? `<@${u.userId}>`}: **${u.sponsorPoints} pts**`;
      })
    );

    return interaction.editReply(`💠 **${sponsor.toUpperCase()} Leaderboard**\n${lines.join('\n')}`);
  },

  async mypoints(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const u = db.getUser(interaction.user.id);
    const cur = db.getCurrentCycle();
    const cyclePts = db.getUserCyclePoints(interaction.user.id, cur.id);

    const sponsorLines = Object.entries(u.sponsor || {}).map(
      ([k, v]) => `• ${k.toUpperCase()}: ${v} pts`
    );

    return interaction.editReply(
      `You have **${u.unpaidPoints ?? u.points}** unpaid points (lifetime: **${u.lifetimePoints ?? u.points}**, redeemed: ${u.redeemed}).\n` +
      `Questions won: **${u.questions ?? 0}** | Cycles played: **${u.cyclesPlayed ?? 0}**.\n` +
      `Current cycle (${cur.id}) points: **${cyclePts}**.\n` +
      `Estimated cycle payout at close: **${db.estimateWinlewForPoints(db.getCycleOutstandingPoints(interaction.user.id, cur.id))} WinLEW**.\n\n` +
      (sponsorLines.length ? `Sponsor breakdown:\n${sponsorLines.join('\n')}` : 'No sponsor points yet.')
    );
  },

  async pastredeems(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const redeems = db.listRedemptions(interaction.user.id);
    if (!redeems.length) {
      return interaction.editReply('No redemption history yet.');
    }

    const lines = redeems.slice(0, 15).map((r) => {
      const when = new Date(r.ts).toLocaleString();
      const status = (r.status || 'pending').toUpperCase();
      const winlewSent = (typeof r.winlewSent === 'number') ? r.winlewSent : null;
      const winlewPart = winlewSent !== null ? ` | WinLEW sent: **${winlewSent}**` : '';
      const txPart = r.tx ? ` | tx: ${r.tx}` : '';
      const idPart = r.id ? ` | id: \`${r.id}\`` : '';
      const kindPart = r.kind === 'cycle_payout' ? ` | cycle: **${r.cycleId}**` : r.kind === 'leaderboard_payout' ? ' | leaderboard residual' : '';
      return `• **${status}** — ${r.amount} pts${kindPart}${winlewPart}${txPart}${idPart} — _${when}_`;
    });

    return interaction.editReply(
      `📜 **Your past redeems** (showing latest ${Math.min(15, redeems.length)})\n` +
      lines.join('\n')
    );
  },

  async quizstatus(interaction) {
    const quiz = activeQuizzes.get(interaction.channelId);
    const remaining = cooldownRemainingMs(interaction.channelId);

    const status = quiz
      ? `✅ Active quiz: **${quiz.mode === 'sponsor' ? `sponsor (${quiz.sponsor})` : quiz.level}** | answers: **${quiz.answered.size}**`
      : '❌ No active quiz in this channel.';

    const cd = remaining
      ? `⏳ Cooldown remaining: **${msToPretty(remaining)}**`
      : '✅ Not on cooldown.';

    const allowed = isAllowedChannel(interaction.channelId)
      ? '✅ Channel allowed.'
      : '❌ Channel not allowed (QUIZ_CHANNELS).';

    const memory = recentHistory.getSummary(interaction.channelId);
    return interaction.reply({ content: `${status}\n${cd}\n${allowed}\n🧠 Recent question memory: **${memory.count}** stored across restarts.`, ephemeral: true });
  },

  async quizcancel(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to cancel quizzes.', ephemeral: true });
    }

    const quiz = activeQuizzes.get(interaction.channelId);
    if (!quiz) {
      return interaction.reply({ content: 'No active quiz to cancel in this channel.', ephemeral: true });
    }

    if (quiz.ended) {
      activeQuizzes.delete(interaction.channelId);
      return interaction.reply({ content: 'Quiz already ended.', ephemeral: true });
    }

    quiz.ended = true;
    if (quiz.timeout) clearTimeout(quiz.timeout);

    try {
      const msg = await interaction.channel.messages.fetch(quiz.msgId);
      const disabled = new ActionRowBuilder().addComponents(
        ...msg.components[0].components.map(b => ButtonBuilder.from(b).setDisabled(true))
      );
      await msg.edit({ components: [disabled] });
    } catch {}

    activeQuizzes.delete(interaction.channelId);
    lastQuizTime.set(interaction.channelId, Date.now());

    return interaction.reply({ content: '🛑 Quiz cancelled.', ephemeral: false });
  },

  async startquiz(interaction) {
    if (!isAllowedChannel(interaction.channelId)) {
      return interaction.reply({ content: '❌ Quizzes aren’t enabled in this channel.', ephemeral: true });
    }

    const rawInput = interaction.options.getString('level');
    const raw = (rawInput || 'easy').toLowerCase();

    if (raw === 'xyo' || raw === 'winlew') {
      return handlers.sponsorquiz({
        ...interaction,
        options: { getString: () => raw },
      });
    }

    const level = ['easy', 'medium', 'hard'].includes(raw) ? raw : 'easy';
    const pool = getPool(level);

    if (!pool.length) {
      return interaction.reply({ content: `No **${level}** questions yet.`, ephemeral: true });
    }

    if (activeQuizzes.has(interaction.channelId)) {
      return interaction.reply({ content: 'A quiz is already running here.', ephemeral: true });
    }

    if (isOnCooldown(interaction.channelId)) {
      return interaction.reply({
        content: `⏳ Please wait **${msToPretty(cooldownRemainingMs(interaction.channelId))}** before starting another quiz.`,
        ephemeral: true
      });
    }

    lastQuizTime.set(interaction.channelId, Date.now());

    await interaction.reply(
      `🎯 **${level.toUpperCase()} QUIZ** — ${Math.round(QUIZ_TIME_MS / 1000)}s to answer\nPoints: **${POINTS[level]}**`
    );

    startQuestion(interaction.channel, {
      mode: 'regular',
      level,
      points: POINTS[level],
    });
  },

  async sponsorquiz(interaction) {
    if (!isAllowedChannel(interaction.channelId)) {
      return interaction.reply({ content: '❌ Quizzes aren’t enabled in this channel.', ephemeral: true });
    }

    const sponsor = interaction.options.getString('sponsor').toLowerCase();
    const pool = getSponsorPool(sponsor);

    if (!pool.length) {
      return interaction.reply({ content: `Unknown sponsor **${sponsor}**. Use: xyo | winlew`, ephemeral: true });
    }

    if (activeQuizzes.has(interaction.channelId)) {
      return interaction.reply({ content: 'A quiz is already running here.', ephemeral: true });
    }

    if (isOnCooldown(interaction.channelId)) {
      return interaction.reply({
        content: `⏳ Please wait **${msToPretty(cooldownRemainingMs(interaction.channelId))}** before starting another quiz.`,
        ephemeral: true
      });
    }

    lastQuizTime.set(interaction.channelId, Date.now());

    await interaction.reply(
      `💠 **SPONSORED: ${sponsor.toUpperCase()}** — ${Math.round(QUIZ_TIME_MS / 1000)}s\nPoints: **${SPONSOR_BASE_POINTS}**`
    );

    startQuestion(interaction.channel, {
      mode: 'sponsor',
      sponsor,
      points: SPONSOR_BASE_POINTS,
    });
  },

  async redeem(interaction) {
    const amount = interaction.options.getInteger('amount');
    const res = await redeemQuizPoints({ userId: interaction.user.id, amount, source: 'discord' });
    if (!res.ok) {
      // Holder-only gate (2026-07-26): NO_WALLET and ZERO_BALANCE both mean
      // "you need to hold real WinLEW to redeem" — show exactly how, on
      // whichever platform they'd rather use, instead of a bare rejection.
      if (res.code === REDEMPTION_REASONS.NO_WALLET || res.code === REDEMPTION_REASONS.ZERO_BALANCE) {
        return interaction.reply({
          content: `❌ ${res.error}\n\n${WHY_HOLDER_ONLY}\n\n${BUY_WINLEW_NOTE}`,
          components: [buildBuyWinlewButtonsRow({ ActionRowBuilder, ButtonBuilder, ButtonStyle })],
          ephemeral: true,
        });
      }
      return interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });
    }

    return interaction.reply(`✅ Redemption request created for **${res.amount}** points (**${res.estimatedWinlew} WinLEW** at the current rate).`);
  },

  async leaderboardpayout(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to queue leaderboard payouts.', ephemeral: true });
    }

    const minimum = Math.max(db.getMinRedemptionPoints(), Number(interaction.options.getInteger('minimum') || 0));
    const res = db.createLeaderboardPayouts({ minPoints: minimum, limit: 25 });
    if (!res.ok) {
      return interaction.reply({ content: `❌ ${res.error || 'Unable to queue leaderboard payouts.'}`, ephemeral: true });
    }

    if (!res.createdCount) {
      return interaction.reply({
        content: `No leaderboard residual payouts were created. Only unpaid **non-cycle** points at **${minimum}+** qualify, and existing leaderboard payout records are skipped until settled or requeued.`,
        ephemeral: true,
      });
    }

    const preview = res.rows.slice(0, 10).map((row) => `• <@${row.userId}> — **${row.amount} pts** (**${row.winlewDue} WinLEW**)`).join('\n');
    return interaction.reply({
      content:
        `💰 Queued **${res.createdCount}** leaderboard payout record${res.createdCount === 1 ? '' : 's'} at **${db.getPayoutRate()} WinLEW per point**.\n` +
        `Only unpaid **non-cycle** points at **${minimum}+** were included, so cycle payouts are not double-counted.\n` +
        `${preview}${PAYOUT_CONFIG.enabled && PAYOUT_CONFIG.autoCyclePayouts ? '\n🤖 The payout worker will pick these up automatically when it is running.' : ''}`,
      ephemeral: false,
    });
  },

  async leaderboardpayouts(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to view leaderboard payout records.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const rows = db.listLeaderboardPayouts(null, 25);
    const summary = db.summarizeLeaderboardPayouts();
    if (!rows.length) {
      return interaction.editReply('No leaderboard payout records yet.');
    }

    const lines = rows.map((r) => {
      const when = new Date(r.paidTs || r.ts).toLocaleString();
      const status = (r.status || 'pending').toUpperCase();
      const txPart = r.tx ? ` — tx: \`${r.tx}\`` : '';
      return `• **${status}** — \`${r.id}\` — <@${r.userId}> — **${r.amount} pts** — **${r.winlewDue ?? db.estimateWinlewForPoints(r.amount)} WinLEW** — _${when}_${txPart}`;
    });

    return interaction.editReply(
      `🏆 **Leaderboard payout records**\n` +
      `• Queue: **${summary.pending} pending / ${summary.failed} failed / ${summary.paid} paid / ${summary.rejected} rejected**\n` +
      `• Total paid so far: **${summary.totalWinlewPaid} WinLEW**\n` +
      lines.join('\n')
    );
  },

  async payoutstatus(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to view payout status.', ephemeral: true });
    }

    const stats = db.getSettlementStats();
    const summary = recentHistory.getSummary(interaction.channelId);
    const lines = [
      `💸 **Payout Engine**`,
      `• Mode: **${payoutModeLabel(PAYOUT_CONFIG)}**`,
      `• Enabled: **${PAYOUT_CONFIG.enabled ? 'yes' : 'no'}**`,
      `• Dry run: **${PAYOUT_CONFIG.dryRun ? 'yes' : 'no'}**`,
      `• Auto cycle payouts: **${PAYOUT_CONFIG.autoCyclePayouts ? 'yes' : 'no'}**`,
      `• Auto leaderboard payouts: **${PAYOUT_CONFIG.autoCyclePayouts ? 'yes' : 'no'}**`,
      `• Auto redeems: **${PAYOUT_CONFIG.autoRedeems ? 'yes' : 'no'}**`,
      `• Scan interval: **${msToPretty(PAYOUT_CONFIG.scanMs)}**`,
      `• Queue: **${stats.pending} pending / ${stats.failed} failed / ${stats.paid} paid**`,
      `• Records: **${stats.cycle}** cycle payouts, **${stats.leaderboard}** leaderboard payouts, **${stats.redeem}** user redeems`,
      `• Question memory in this channel: **${summary.count}** recent prompts tracked across restarts`,
    ];
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  },

  async requeueredeem(interaction) {
    if (!requireManageGuild(interaction)) {
      return interaction.reply({ content: '❌ You need **Manage Server** to requeue payouts.', ephemeral: true });
    }

    const id = interaction.options.getString('id');
    const res = db.requeueRedemptionById({ id });
    if (!res.ok) {
      return interaction.reply({ content: `❌ ${res.error}`, ephemeral: true });
    }

    return interaction.reply({ content: `🔁 Requeued settlement record **${id}**.`, ephemeral: false });
  },
};

/* ───────────────────── INTERACTIONS ───────────────────── */

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = handlers[interaction.commandName];
      if (handler) await handler(interaction);
    }

    if (interaction.isButton()) {
      const now = Date.now();
      const prev = lastClick.get(interaction.user.id) || 0;
      if (now - prev < 800) {
        return interaction.reply({ content: 'Slow down 😅', ephemeral: true });
      }
      lastClick.set(interaction.user.id, now);

      const [kind, qid, choice] = interaction.customId.split(':');
      if (kind !== 'quiz') return;

      const quiz = activeQuizzes.get(interaction.channelId);
      if (!quiz || quiz.qid !== qid) {
        return interaction.reply({ content: 'This question is no longer active.', ephemeral: true });
      }

      if (quiz.answered.has(interaction.user.id)) {
        return interaction.reply({ content: 'You already answered.', ephemeral: true });
      }

      quiz.answered.set(interaction.user.id, Number(choice));
      return interaction.reply({ content: 'Answer locked ✅', ephemeral: true });
    }
  } catch (err) {
    console.error('INTERACTION ERROR:', err);
    if (interaction.isRepliable()) {
      safeReply(interaction, { content: '⚠️ Something went wrong.', ephemeral: true });
    }
  }
});

/* ───────────────────── QUIZ LOGIC ───────────────────── */

async function startQuestion(channel, config) {
  const pool =
    config.mode === 'sponsor'
      ? getSponsorPool(config.sponsor)
      : getPool(config.level);

  validatePool(pool, config.mode === 'sponsor'
    ? `sponsor:${config.sponsor}`
    : `regular:${config.level}`
  );

  const rawQuestion = pickQuestion(pool, config.mode === 'sponsor' ? `sponsor:${config.sponsor}` : `regular:${config.level}`, channel.id);
  const question = Object.freeze(shuffleQuestion(rawQuestion));
  const qid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const row = new ActionRowBuilder().addComponents(
    ...['A', 'B', 'C', 'D'].map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`quiz:${qid}:${i}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(false)
    )
  );

  const embed = new EmbedBuilder()
    .setTitle(config.mode === 'sponsor'
      ? `💠 Sponsored Quiz — ${String(config.sponsor).toUpperCase()}`
      : '🧠 Crypto Quiz')
    .setDescription(
      `**${question.q}**\n\n` +
      question.choices.map((c, i) => `${['A','B','C','D'][i]}) ${c}`).join('\n')
    )
    .setFooter({ text: `You have ${Math.round(QUIZ_TIME_MS / 1000)} seconds to answer.` });

  const msg = await channel.send({ embeds: [embed], components: [row] });

  const state = {
    qid,
    msgId: msg.id,
    answered: new Map(),
    correct: question.answerIndex,
    points: config.points,
    mode: config.mode,
    sponsor: config.sponsor,
    level: config.level,
    ended: false,
    timeout: null,
  };

  const prev = activeQuizzes.get(channel.id);
  if (prev?.timeout) clearTimeout(prev.timeout);

  activeQuizzes.set(channel.id, state);
  state.timeout = setTimeout(() => endQuestion(channel, state), QUIZ_TIME_MS);
}

async function endQuestion(channel, quiz) {
  if (quiz.ended) return;
  quiz.ended = true;
  if (quiz.timeout) clearTimeout(quiz.timeout);

  const winners = [];

  for (const [userId, answer] of quiz.answered.entries()) {
    const correct = answer === quiz.correct;
    if (correct) {
      quiz.mode === 'sponsor'
        ? db.addSponsorPoints(userId, quiz.sponsor, quiz.points)
        : db.addPoints(userId, quiz.points);
      winners.push(userId);
    }
    // Informational only — separate from the addPoints/addSponsorPoints call
    // above, which remains the sole source of truth for payout-eligible
    // points. See src/quiz/platform-stats.js.
    db.recordPlatformAnswer(userId, 'discord', { correct, points: correct ? quiz.points : 0 });
  }

  try {
    const msg = await channel.messages.fetch(quiz.msgId);
    const disabled = new ActionRowBuilder().addComponents(
      ...msg.components[0].components.map(b => ButtonBuilder.from(b).setDisabled(true))
    );
    await msg.edit({ components: [disabled] });
  } catch {}

  const answerLabel = ['A', 'B', 'C', 'D'][quiz.correct];
  await channel.send(
    `⏱️ Time’s up! Correct answer: **${answerLabel}**\n` +
    (winners.length
      ? `Winners: ${winners.map(id => `<@${id}>`).join(', ')} (+${quiz.points} pts)`
      : 'No correct answers this round.')
  );

  activeQuizzes.delete(channel.id);
}

storageReady.finally(async () => {
  // Same duplicate-instance hazard as the faucet bot: PM2 and runner.js
  // (`yarn dev:all` / Docker) both start this file, so two supervisors means
  // two logins on one token and every quiz command handled twice. Checked
  // before login so a duplicate never reaches the gateway.
  // See src/shared/singleInstance.js and docs/faucet-double-drip-incident.md.
  //
  // Dynamic import because this file is CommonJS and the guard is ESM — a
  // plain require() of it throws. The globalThis.__WINLEW_QUIZ_STARTED check
  // at the top of this file only catches a double-launch WITHIN one process;
  // it cannot see a second process, which is exactly the PM2-plus-Docker case.
  const { assertSingleInstance } = await import('../shared/singleInstance.js');
  await assertSingleInstance({ service: 'winlew-quiz', token: TOKEN });
  initCycleConfig();
  client.login(TOKEN);
});
