const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function buildCommandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName('startquiz')
      .setDescription('Start a regular quiz')
      .addStringOption(o => o.setName('level').setDescription('easy | medium | hard (or xyo/winlew shortcut)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('sponsorquiz')
      .setDescription('Start a sponsored XYO or WinLEW quiz')
      .addStringOption(o => o.setName('sponsor').setDescription('Sponsor key (xyo | winlew)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show the lifetime leaderboard with unpaid points, questions, and cycles'),

    new SlashCommandBuilder()
      .setName('sponsorboard')
      .setDescription('Show sponsor leaderboard')
      .addStringOption(o => o.setName('sponsor').setDescription('Sponsor key (xyo | winlew)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('mypoints')
      .setDescription('Check points and sponsor totals'),

    new SlashCommandBuilder()
      .setName('redeem')
      .setDescription('Create a manual redemption request')
      // Min mirrors QUIZ_MIN_REDEMPTION_WINLEW's default (1500, one faucet
      // drip at the 1:1 rate). The server enforces the real env-driven floor
      // either way — this just stops obviously-too-small requests in Discord's
      // own UI. Re-run `npm run register:quiz` after changing it.
      .addIntegerOption(o => o.setName('amount').setDescription('Points to redeem (minimum 1500)').setRequired(true).setMinValue(1500)),

    new SlashCommandBuilder()
      .setName('pastredeems')
      .setDescription('Show recent redeems and payouts'),

    new SlashCommandBuilder()
      .setName('quizstatus')
      .setDescription('Show quiz status for this channel'),

    new SlashCommandBuilder()
      .setName('quizhelp')
      .setDescription('Show the quiz command guide'),

    new SlashCommandBuilder()
      .setName('quizcancel')
      .setDescription('Cancel an active quiz in this channel (Manage Server)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('redeemspending')
      .setDescription('List pending redeems and cycle payouts (Manage Server)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('markredeempaid')
      .setDescription('Mark a redemption as PAID by redeem ID (Manage Server)')
      .addStringOption(o => o.setName('id').setDescription('Redeem ID from /redeemspending').setRequired(true))
      .addNumberOption(o => o.setName('winlew').setDescription('WinLEW amount sent').setRequired(true))
      .addStringOption(o => o.setName('tx').setDescription('Optional transaction hash / reference').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('requeueredeem')
      .setDescription('Requeue a failed settlement record by ID (Manage Server)')
      .addStringOption(o => o.setName('id').setDescription('Redeem ID to requeue').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('payoutstatus')
      .setDescription('Show payout worker status and queue health (Manage Server)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('rejectredeem')
      .setDescription('Reject a pending redemption by redeem ID (Manage Server)')
      .addStringOption(o => o.setName('id').setDescription('Redeem ID from /redeemspending').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Optional reason (ephemeral)').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('cycleinfo')
      .setDescription('Show cycle points and estimated WinLEW payout')
      .addUserOption(o => o.setName('user').setDescription('Optional: view another user (Manage Server)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('cycleboard')
      .setDescription('Show the cycle leaderboard with total and unpaid cycle points'),

    new SlashCommandBuilder()
      .setName('cycleclose')
      .setDescription('Close the current cycle and generate pending payouts (Manage Server)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('cycleswitchmonthly')
      .setDescription('One-time switch: close the current cycle, then move from 91-day to 30-day cycles (Manage Server)')
      .addStringOption(o => o.setName('confirm').setDescription('Type CONFIRM to proceed').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('leaderboardpayout')
      .setDescription('Queue payouts for unpaid non-cycle leaderboard points (500+ only) (Manage Server)')
      .addIntegerOption(o => o.setName('minimum').setDescription('Minimum unpaid non-cycle points to include (floor 500)').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('leaderboardpayouts')
      .setDescription('List leaderboard payout records (Manage Server)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('cyclepayouts')
      .setDescription('List pending payouts for a cycle (Manage Server)')
      .addStringOption(o => o.setName('cycle').setDescription('Cycle ID (defaults to current)').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ];
}

const commandInventory = [
  { path: '/startquiz [level]', description: 'Start a regular quiz.', audience: 'all', category: 'Quiz / Play' },
  { path: '/sponsorquiz sponsor:<xyo|winlew>', description: 'Start a sponsored XYO or WinLEW quiz.', audience: 'all', category: 'Quiz / Play' },
  { path: '/leaderboard', description: 'Show the lifetime leaderboard with unpaid points, questions, and cycles.', audience: 'all', category: 'Leaderboards' },
  { path: '/sponsorboard sponsor:<xyo|winlew>', description: 'Show the sponsor leaderboard.', audience: 'all', category: 'Leaderboards' },
  { path: '/cycleboard', description: 'Show the current cycle leaderboard with total and unpaid cycle points.', audience: 'all', category: 'Leaderboards' },
  { path: '/mypoints', description: 'Check your points and sponsor totals.', audience: 'all', category: 'Progress' },
  { path: '/cycleinfo [user]', description: 'Show cycle points and estimated WinLEW payout.', audience: 'all', category: 'Progress' },
  { path: '/quizstatus', description: 'Show quiz status for the current channel.', audience: 'all', category: 'Progress' },
  { path: '/quizhelp', description: 'Show the quiz command guide.', audience: 'all', category: 'Progress' },
  { path: '/redeem amount:<points>', description: 'Create a manual redemption request.', audience: 'all', category: 'Redeems' },
  { path: '/pastredeems', description: 'Show your recent redeems and payouts.', audience: 'all', category: 'Redeems' },
  { path: '/quizcancel', description: 'Cancel an active quiz in this channel.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/redeemspending', description: 'List pending redeems and cycle payouts.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/markredeempaid id:<id> winlew:<amt> [tx]', description: 'Mark a redeem as paid.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/requeueredeem id:<id>', description: 'Requeue a failed or held settlement record.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/payoutstatus', description: 'Show payout worker mode and queue health.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/rejectredeem id:<id> [reason]', description: 'Reject a pending redeem.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/cycleclose', description: 'Close the current cycle and generate payouts.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/cycleswitchmonthly [confirm:CONFIRM]', description: 'One-time: close the current cycle, then switch from 91-day to 30-day cycles.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/leaderboardpayout [minimum]', description: 'Queue payouts for unpaid non-cycle leaderboard points (500+ only).', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/leaderboardpayouts', description: 'List leaderboard payout records.', audience: 'admin', category: 'Admin / Cycle' },
  { path: '/cyclepayouts [cycle]', description: 'List pending payouts for a cycle.', audience: 'admin', category: 'Admin / Cycle' },
];

module.exports = {
  buildCommandBuilders,
  commandData: buildCommandBuilders().map(c => c.toJSON()),
  commandInventory,
};
