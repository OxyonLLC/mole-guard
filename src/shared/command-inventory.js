import quizCommandModule from '../quiz/command-data.cjs';
import { commandInventory as geoAgoraSlashInventory } from '../geoagora/commands.js';
import { commandInventory as moleSlashInventory } from '../mole/commands.js';
import pkg from '../../package.json' with { type: 'json' };

const { commandInventory: quizSlashInventory = [] } = quizCommandModule;

// Read from package.json, not hardcoded — a hardcoded string here is
// exactly what silently went stale (v3.3.3) through the v3.3.4 release.
export const RELEASE_VERSION = `v${pkg.version}`;

const PREFIX_GROUPS = [
  {
    title: 'Quick Start',
    entries: [
      { primary: 'help', aliases: ['menu'], usage: 'help', description: 'Show the quick-start overview.' },
      { primary: 'commands', aliases: ['fhelp'], usage: 'commands', description: 'Show the full command catalog.' },
      { primary: 'navigation', aliases: ['nav'], usage: 'navigation', description: 'Show grouped shortcuts by area.' },
    ],
  },
  {
    title: 'Identity & Wallets',
    entries: [
      { primary: 'register', aliases: ['save', 'setwallet', 'linkwallet'], usage: 'register <wallet-or-domain>', description: 'Register a wallet for airdrops and manual fallback; Mole Guard verification now auto-saves faucet + payout wallets.' },
      { primary: 'mywallet', aliases: ['savedwallet'], usage: 'mywallet', description: 'Show your saved wallet and current balance.' },
      { primary: 'whoami', aliases: ['me'], usage: 'whoami', description: 'Show your Discord identity, linked wallet, and faucet cooldown.' },
      { primary: 'unlinkwallet', aliases: ['forgetwallet'], usage: 'unlinkwallet', description: 'Remove the saved wallet from faucet + Mole Guard storage.' },
      { primary: 'reverse', usage: 'reverse <solana-pubkey>', description: 'Reverse lookup an SNS name for a Solana address.' },
    ],
  },
  {
    title: 'Faucet & Token',
    entries: [
      { primary: 'hodl', usage: 'hodl [me]', description: 'HODL Rewards — weekly pool, how to qualify, and the limits governance cannot raise. `hodl me` shows what you have earned.', audience: 'everyone' },
      // Usage shows the ZERO-ARGUMENT form on purpose. Once a wallet is
      // linked (`/mole link`) or registered (`!register`), `!drip` alone pays
      // it — the explicit `<wallet-or-domain>` form is the fallback for
      // sending elsewhere, and leading with it made the fallback look like
      // the main way to claim.
      { primary: 'drip', aliases: ['faucet'], usage: 'drip', description: 'Claim {DRIP} {TOKEN_SYMBOL} to the wallet saved on your account. Save it first with `{PREFIX}register <wallet-or-domain>` — `{PREFIX}drip` no longer accepts a one-off address.' },
      { primary: 'faucetstatus', usage: 'faucetstatus', description: 'Show claim readiness, holder floor, and cooldown.' },
      { primary: 'abuse', usage: 'abuse', description: 'How coordinated faucet abuse is detected and decided — who decides, what counts, and how to appeal.' },
      { primary: 'balance', usage: 'balance <wallet-or-domain>', description: 'Check a {TOKEN_SYMBOL} token balance.' },
      { primary: 'supply', usage: 'supply', description: 'Show total token supply.' },
      { primary: 'uptime', usage: 'uptime', description: 'Show bot uptime.' },
    ],
  },
  {
    title: 'Market Data',
    entries: [
      { primary: 'price', usage: 'price', description: 'Show the best current market price.' },
      { primary: 'data', usage: 'data', description: 'Show all market sources in one message.' },
      { primary: 'ddata', usage: 'ddata', description: 'DexScreener market data.' },
      { primary: 'gdata', usage: 'gdata', description: 'GeckoTerminal market data.' },
      { primary: 'pdata', usage: 'pdata', description: 'Pump.fun market data.' },
      { primary: 'rdata', usage: 'rdata', description: 'Raydium market data.' },
      { primary: 'sdata', usage: 'sdata', description: 'Solscan market data.' },
    ],
  },
  {
    title: 'Links & Public Wallets',
    entries: [
      { primary: 'links', aliases: ['socials'], usage: 'links', description: 'Show social, website, and chart links.' },
      { primary: 'quicklinks', aliases: ['buylinks'], usage: 'quicklinks', description: 'Show direct buy and chart shortcuts.' },
      { primary: 'buy', usage: 'buy', description: 'Open the Pump.fun coin page.' },
      { primary: 'swap', usage: 'swap', description: 'Open the Raydium swap link.' },
      { primary: 'dexscreener', usage: 'dexscreener', description: 'Open DexScreener.' },
      { primary: 'geckoterminal', usage: 'geckoterminal', description: 'Open GeckoTerminal.' },
      { primary: 'cmc', usage: 'cmc', description: 'Open CoinMarketCap DexScan.' },
      { primary: 'website', usage: 'website', description: 'Open the official website.' },
      { primary: 'pages', aliases: ['sitemap', 'site', 'webpages', 'allpages', 'winlewpages'], usage: 'pages', description: 'List every winlew.co page (faucet, quiz, transparency, etc.).' },
      { primary: 'rugcheck', usage: 'rugcheck', description: 'Open RugCheck.' },
      { primary: 'rpc', aliases: ['rpcstatus', 'endpoint'], usage: 'rpc', description: 'Show the active Solana RPC endpoint safely.' },
      { primary: 'contracts', aliases: ['pools'], usage: 'contracts', description: 'Show every official on-chain contract: token mint, Raydium pool, and market pair.' },
      { primary: 'wallet', usage: 'wallet', description: 'Show the public faucet wallet.' },
      { primary: 'xwallet', usage: 'xwallet', description: 'Show the public project wallet.' },
      { primary: 'devwallet', usage: 'devwallet', description: 'Show the public developer wallet.' },
    ],
  },
  {
    title: 'Moderator & Admin',
    entries: [
      // Read-only on purpose. Paying stays on the CLI behind
      // `npm run hodl:pay -- --apply` — see the note on the command itself.
      { primary: 'hodl', usage: 'hodl preview', description: 'The latest planned HODL week — participants and total. READ-ONLY: paying stays on the CLI behind `npm run hodl:pay -- --apply`.', audience: 'admin' },
      { primary: 'modhelp', usage: 'modhelp', description: 'Show the moderator command list.', audience: 'admin' },
      { primary: 'send', usage: 'send <wallet-or-domain>', description: 'Manual send helper.', audience: 'admin' },
      { primary: 'debugprice', usage: 'debugprice', description: 'Show raw diagnostics for all price sources.', audience: 'admin' },
      { primary: 'restart', usage: 'restart', description: 'Restart the faucet bot process.', audience: 'admin' },
      { primary: 'faucetcluster', usage: 'faucetcluster <wallet>', description: 'Show the on-chain funding cluster around a wallet — read-only, look before banning.', audience: 'admin' },
      { primary: 'rewards', usage: 'rewards <@user>', description: 'Lifetime WinLEW an account has received across faucet, quiz and games.', audience: 'admin' },
      { primary: 'faucetcotiming', usage: 'faucetcotiming [windowMin] [minDays] [lookbackDays]', description: 'Accounts that keep claiming together across days. Review only, never bans.', audience: 'admin' },
      { primary: 'ipban', usage: 'ipban <ip> [--ttl 24h] [reason]', description: 'Temporarily or permanently block one exact IP from the Mole Guard web app.', audience: 'admin' },
      { primary: 'ipunban', usage: 'ipunban <ip>', description: 'Lift an IP denylist entry.', audience: 'admin' },
      { primary: 'ipbans', usage: 'ipbans', description: 'List active IP denylist entries.', audience: 'admin' },
      { primary: 'faucetban', usage: 'faucetban <wallet> [--review] [reason]', description: 'Ban a wallet from the faucet; wallets it funded are refused too. --review records without refusing.', audience: 'admin' },
      { primary: 'faucetunban', usage: 'faucetunban <wallet>', description: 'Lift a faucet ban.', audience: 'admin' },
      { primary: 'faucetbanuser', usage: 'faucetbanuser <discord-id> [--review] [reason]', description: 'Ban a Discord ACCOUNT from the faucet and quiz — a fresh wallet does not reset it.', audience: 'admin' },
      { primary: 'faucetunbanuser', usage: 'faucetunbanuser <discord-id>', description: 'Lift an account ban.', audience: 'admin' },
      { primary: 'faucetbanusers', usage: 'faucetbanusers', description: 'List banned Discord accounts.', audience: 'admin' },
      { primary: 'unregister', usage: 'unregister <wallet>', description: 'Remove a wallet from the airdrop registry. A faucet ban does not do this on its own.', audience: 'admin' },
      { primary: 'faucetbans', usage: 'faucetbans', description: 'List recorded faucet bans.', audience: 'admin' },
      { primary: 'quizreview', usage: 'quizreview [id]', description: 'List quiz payouts held for risk review, or inspect one.', audience: 'admin' },
      { primary: 'quizapprove', usage: 'quizapprove <id>', description: 'Approve a held quiz payout back into the settlement queue.', audience: 'admin' },
      { primary: 'quizwatch', usage: 'quizwatch [userId]', description: 'List everyone flagged on their first payout, or see the evidence for one.', audience: 'admin' },
      { primary: 'quizclear', usage: 'quizclear <userId> <note>', description: 'Clear a first-payout flag and release anything it is holding. A note is required.', audience: 'admin' },
      { primary: 'quizreject', usage: 'quizreject <id> <reason>', description: 'Reject a held quiz payout — a reason is required.', audience: 'admin' },
    ],
  },
];

const SLASH_GROUPS = [
  { title: 'Slash Commands — Mole Guard / Gaming', app: 'Mole Guard / Gaming', entries: moleSlashInventory },
  { title: 'Slash Commands — Quiz / Utility', app: 'Quiz / Utility', entries: quizSlashInventory },
  { title: 'Slash Commands — GeoAgora', app: 'GeoAgora', entries: geoAgoraSlashInventory },
];

const WATCHDOG_NOTES = [
  'Type `!wd-help` for the full Watchdog command list.',
  '`!wd-help` / `!watchdog-help` — show this list (public)',
  '`!scaminfo` / `!scam` / `!scam-info` — "aged wallet" / seed-phrase scam PSA (public)',
  '`!wd-ping` / `!watchdog-ping`, `!wd-test` / `!watchdog-test` — Claude config checks (approved users/roles/mods only)',
  '`!wd <question>` / `!watchdog <question>`, `!debug <error/log>`, `!wd-last [instruction]`, `@Watchdog <question>` — chat with the Watchdog AI (approved users/roles/mods only)',
];

function applyVars(text, vars) {
  return String(text || '').replace(/\{([A-Z_]+)\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

function fmtPrefix(prefix, usage) {
  return `\`${prefix}${usage}\``;
}

function fmtAliases(prefix, aliases = []) {
  if (!aliases.length) return '';
  return ` (aliases: ${aliases.map((alias) => `\`${prefix}${alias}\``).join(', ')})`;
}

function prefixAudienceSuffix(entry) {
  return entry.audience === 'admin' ? ' (Admin only)' : '';
}

function slashAudienceSuffix(entry) {
  if (entry.audience === 'admin') return ' (Manage Server)';
  if (entry.audience === 'mod') return ' (Manage Channels/Admin)';
  return '';
}

function formatPrefixEntry(entry, vars) {
  return `• ${fmtPrefix(vars.PREFIX, entry.usage)} — ${applyVars(entry.description, vars)}${fmtAliases(vars.PREFIX, entry.aliases)}${prefixAudienceSuffix(entry)}`;
}

function formatSlashEntry(entry) {
  return `• \`${entry.path}\` — ${entry.description}${slashAudienceSuffix(entry)}`;
}

function groupedSlashPreview() {
  return SLASH_GROUPS.map((group) => {
    const preview = group.entries.slice(0, 4).map((entry) => `\`${entry.path}\``).join(' • ');
    const suffix = group.entries.length > 4 ? ' • …' : '';
    return `• **${group.app}** → ${preview}${suffix}`;
  }).join('\n');
}

export function getCommandInventory() {
  return {
    prefixGroups: PREFIX_GROUPS,
    slashGroups: SLASH_GROUPS,
    watchdogNotes: WATCHDOG_NOTES,
  };
}

export function buildHelpOverview({ prefix = '!', tokenSymbol = 'WinLEW', dripAmount = 1000 } = {}) {
  return [
    `📘 **WinLEW Help — ${RELEASE_VERSION}**`,
    `Use ${fmtPrefix(prefix, 'commands')} for the full catalog and ${fmtPrefix(prefix, 'navigation')} for grouped shortcuts.`,
    '',
    '**Start here**',
    `1️⃣ Verify your wallet → ${'`/mole link`'} or <https://winlew.co/mole-link/> — links your wallet to Discord, syncs your holder roles, and earns you **1 free governance vote**.`,
    `2️⃣ Claim from the faucet → just ${fmtPrefix(prefix, 'drip')} — once step 1 is done that is all you need, it pays your linked wallet automatically (${dripAmount} $${tokenSymbol}, cooldown applies) • or <https://winlew.co/faucet/>`,
    `   ↳ Different wallet? ${fmtPrefix(prefix, 'register <wallet-or-domain>')} to change the one on your account, then ${fmtPrefix(prefix, 'drip')}. A one-off address is no longer accepted.`,
    `3️⃣ Check yourself → ${fmtPrefix(prefix, 'whoami')} • ${fmtPrefix(prefix, 'mywallet')} • ${fmtPrefix(prefix, 'faucetstatus')} • ${fmtPrefix(prefix, 'balance <wallet>')}`,
    '',
    '**Explore**',
    `🏛️ Governance → ${'`/mole proposals`'} • ${'`/mole vote`'} • ${'`/mole myvote`'} • ${'`/mole votes`'} • ${'`/mole propose`'} — verified holders get 1 free vote per proposal; every submission is maintainer-reviewed before it can go live.`,
    `💎 HODL Rewards → ${'`!hodl`'} • ${'`!hodl me`'} — weekly pool for holding ${'$WinLEW'}.`,
    `🧠 Quiz / earn → ${'`/startquiz [level]`'} • ${'`/sponsorquiz sponsor:<xyo|winlew>`'} • ${'`/mypoints`'} • ${'`/cycleinfo`'} • ${'`/quizhelp`'} • <https://winlew.co/quiz/>`,
    `🎮 Gaming Hub → ${'`/game hub`'} • <https://winlew.co/mole-hub/>`,
    `📊 Market & data → ${fmtPrefix(prefix, 'price')} • ${fmtPrefix(prefix, 'data')} • ${fmtPrefix(prefix, 'ddata')} • ${fmtPrefix(prefix, 'gdata')} • ${fmtPrefix(prefix, 'pdata')} • ${fmtPrefix(prefix, 'rdata')} • ${fmtPrefix(prefix, 'sdata')}`,
    `🔍 Proof & receipts → ${fmtPrefix(prefix, 'contracts')} (official addresses) • ${fmtPrefix(prefix, 'wallet')} • ${fmtPrefix(prefix, 'xwallet')} • ${fmtPrefix(prefix, 'devwallet')} • ${fmtPrefix(prefix, 'supply')} • <https://winlew.co/transparency/>`,
    `💜 Contribute & burn → <https://winlew.co/contribute/> • <https://winlew.co/burn/>`,
    `🔗 Links & pages → ${fmtPrefix(prefix, 'links')} • ${fmtPrefix(prefix, 'quicklinks')} • ${fmtPrefix(prefix, 'pages')} • ${fmtPrefix(prefix, 'navigation')}`,
    `🪐 GeoAgora → ${'`/geoagora help`'} • ${'`/geoagora status`'} • ${'`/geoagora marketplace`'} • ${'`/geoagora recent`'}`,
    `🛠️ Full command list → ${fmtPrefix(prefix, 'commands')}`,
    '',
    'Tip: Discord commands accept exact arguments (a specific wallet, quiz tier, or sponsor) for more precise control — the website is the point-and-click version of the same system, and both share the same cooldowns and points.',
  ].join('\n');
}

export function buildCommandsCatalog({ prefix = '!', tokenSymbol = 'WinLEW', dripAmount = 1000 } = {}) {
  const vars = { PREFIX: prefix, TOKEN_SYMBOL: tokenSymbol, DRIP: dripAmount };
  const sections = [];

  sections.push(`📚 **Full Command Catalog — ${RELEASE_VERSION}**`);
  sections.push('');
  sections.push('**Prefix Commands**');
  sections.push('');

  for (const group of PREFIX_GROUPS) {
    sections.push(`**${group.title}**`);
    sections.push(...group.entries.map((entry) => formatPrefixEntry(entry, vars)));
    sections.push('');
  }

  for (const group of SLASH_GROUPS) {
    sections.push(`**${group.title}**`);
    sections.push(...group.entries.map(formatSlashEntry));
    sections.push('');
  }

  sections.push('**Watchdog / Ops**');
  sections.push(...WATCHDOG_NOTES.map((note) => `• ${note}`));

  return sections.join('\n').trim();
}

export function buildNavigationMessage({ prefix = '!' } = {}) {
  const lines = [`🧭 **Navigation — ${RELEASE_VERSION}**`, ''];

  // Derived from PREFIX_GROUPS rather than hand-listed (2026-07-31): the
  // hand-maintained version silently dropped the entire "Links & Public
  // Wallets" group — 13 real commands (!links, !buy, !swap, !pages,
  // !rugcheck, !rpc, !xwallet, !devwallet, …) were invisible here while
  // being listed in !commands. Deriving makes that class of drift
  // impossible: a new prefix command shows up in both, or neither.
  for (const group of PREFIX_GROUPS) {
    lines.push(`**${group.title}**`);
    lines.push(`• ${group.entries.map((entry) => fmtPrefix(prefix, entry.primary)).join(' • ')}`);
    lines.push('');
  }

  lines.push('**Mole Guard & Verification**');
  lines.push(`• ${'`/mole link`'} • ${'`/mole sync`'} • ${'`/mole status`'} • or <https://winlew.co/mole-link/>`);
  lines.push('');
  lines.push('**Governance**');
  lines.push(`• ${'`/mole proposals`'} • ${'`/mole vote`'} • ${'`/mole myvote`'} • ${'`/mole votes`'} • ${'`/mole propose`'} • or <https://winlew.co/governance/>`);
  lines.push('');
  lines.push('**Gaming**');
  lines.push(`• ${'`/game hub`'} • or <https://winlew.co/mole-hub/>`);
  lines.push('');
  lines.push('**Quiz**');
  lines.push(`• ${'`/startquiz`'} • ${'`/sponsorquiz`'} • ${'`/leaderboard`'} • ${'`/mypoints`'} • ${'`/cycleinfo`'} • ${'`/quizhelp`'} • or <https://winlew.co/quiz/>`);
  lines.push('');
  lines.push('**GeoAgora**');
  lines.push(`• ${'`/geoagora help`'} • ${'`/geoagora status`'} • ${'`/geoagora marketplace`'} • ${'`/geoagora recent`'}`);
  lines.push('');
  lines.push('**Slash command lanes**');
  lines.push(groupedSlashPreview());
  lines.push('');
  lines.push('**Watchdog / Ops**');
  lines.push(`• ${WATCHDOG_NOTES[0]}`);
  return lines.join('\n').trim();
}

// Every first-party winlew.co page, grouped so a Discord user can grab any of
// them without leaving chat. URLs are wrapped in <…> to suppress 20 embeds.
// Base URL defaults to the canonical winlew.co (env WEBSITE_BASE_URL overrides).
// Groups are hand-mirrored from src/public/assets/nav.js's NAV_GROUPS (a
// browser file, not importable into these Node bot processes) so Discord and
// the site teach the same mental model.
//
// This used to end with "if nav.js's groups/order change again, update this
// function too." It changed on 2026-08-11 and this did not, so Discord handed
// out a stale site map for two days. A comment asking the next person to
// remember is not a mechanism — test/mole/botPagesMirrorsNav.test.mjs now
// parses nav.js and fails on any divergence, in both directions.
export function buildWebsiteLinks({ baseUrl = (process.env.WEBSITE_BASE_URL || 'https://winlew.co') } = {}) {
  const b = String(baseUrl).replace(/\/+$/, '');
  const u = (p) => `<${b}${p}>`;
  return [
    `🌐 **All $WinLEW website pages** — ${b}`,
    '',
    // Group order, titles and membership mirror nav.js's NAV_GROUPS. Realigned
    // 2026-08-13: the nav was reordered and "START HERE" renamed to
    // "LEARN & CONNECT" on 2026-08-11, and this list was not updated with it —
    // exactly the drift the note above this function warned about. It now
    // leads with Play & Earn for the same reason the nav does: almost everyone
    // arriving already knows what WinLEW is and came to do something.
    //
    // Realigned again 2026-08-21 with the first-four-group rebuild: PLAY &
    // PARTICIPATE -> PLAY & EARN, EXPLORE & BUILD -> BUILD & CONTRIBUTE, and
    // seven links changed column. Same 30 destinations as the nav, same order.
    // Pinned by test/mole/botPagesMirrorsNav.test.mjs.
    '**🎮 Play & Earn**',
    `• Dashboard — ${u('/verify/profile.html')}`,
    `• Verify wallet — ${u('/verify/')}`,
    `• Link Wallet + Roles — ${u('/mole-link/')}`,
    `• The Mole Hub (games) — ${u('/mole-hub/')}`,
    `• XL1 Arcade (earn real XL1) — ${u('/xl1/arcade/')}`,
    `• XL1 Hub — ${u('/xl1/')}`,
    `• Claimable Quiz — ${u('/quiz/')}`,
    `• $WinLEW Faucet — ${u('/faucet/')}`,
    `• HODL Rewards — ${u('/hodl/')}`,
    `• Airdrop Registry — ${u('/community/')}`,
    `• $WinLEW Leaderboards (games, quiz, faucet, clout, governance) — ${u('/leaderboards/')}`,
    '',
    '**🧭 Learn & Connect**',
    `• Ecosystem Hub — ${u('/home/')}`,
    `• News — ${u('/news/')}`,
    `• About — ${u('/about/')}`,
    `• Contact — ${u('/contact/')}`,
    `• Who We Are — ${u('/who-we-are/')}`,
    `• Proof of Value — ${u('/proof-of-value/')}`,
    `• Discord Bots — ${u('/discord-bots/')}`,
    `• Community Events — ${u('/events/')}`,
    `• Terms / Policies — ${u('/policies/')}`,
    '',
    '**🔍 Trust & Transparency**',
    `• Transparency Center — ${u('/transparency/')}`,
    `• Whitepaper — ${u('/whitepaper/')}`,
    `• Burn Center — ${u('/burn/')}`,
    `• Giveaway Records — ${u('/giveaways/')}`,
    `• No Paid Promotion (we don't pay KOLs) — ${u('/no-thank-you/promotions/')}`,
    `• Health / Status — ${u('/health/')}`,
    '',
    '**🛠️ Build & Contribute**',
    `• Modules — ${u('/modules/')}`,
    `• Roadmap — ${u('/roadmap/')}`,
    `• WinLEW Forge (maintainers) — ${u('/winlew-forge/')}`,
    `• Contribute — ${u('/contribute/')}`,
    `• Bug Bounties — ${u('/bounties/')}`,
    `• Merch (coming soon) — ${u('/merch/')}`,
    '',
    '**🏛️ Governance**',
    `• Governance — ${u('/governance/')}`,
    `• Submit a Proposal — ${u('/governance/submit/')}`,
    `• Sponsors & Partners — ${u('/partners/')}`,
    '',
    // nav.js also has a THIRD-PARTY LINKS group. It is deliberately not
    // repeated here: this command answers "what pages does the site have", and
    // !links already owns the external set. /links/ itself is a first-party
    // page, so it appears — as the one route into that group.
    `• All external links — ${u('/links/')}`,
    '',
    // Mirrors nav.js's OXYON group (renamed from BEYOND WINLEW on 2026-10-03).
    '**🚀 Oxyon**',
    '• Oxyon — <https://oxyon.io/>',
    `• Oxyon Wallet (Beta) — ${u('/ecosystem/geowallet/')}`,
    `• In the XYO Ecosystem — ${u('/xyo/')}`,
    `• GeoAgora (Soon) — ${u('/ecosystem/geoagora/')}`,
    `• GeoJustice (Soon) — ${u('/ecosystem/geojustice/')}`,
    `• GeoHackers (Soon) — ${u('/ecosystem/geohackers/')}`,
    `• GeoPresence (Soon) — ${u('/ecosystem/geopresence/')}`,
    `• GeoProof (Soon) — ${u('/ecosystem/geoproof/')}`,
    `• uBlock (Soon) — ${u('/ecosystem/ublock/')}`,
    '',
    `🏠 Home — ${u('/')}`,
  ].join('\n').trim();
}

export function buildModHelp({ prefix = '!' } = {}) {
  const vars = { PREFIX: prefix };
  const adminGroup = PREFIX_GROUPS.find((group) => group.title === 'Moderator & Admin');
  const lines = [`🛠️ **Moderator & Admin — ${RELEASE_VERSION}**`, ''];

  if (adminGroup) {
    lines.push(...adminGroup.entries.map((entry) => formatPrefixEntry(entry, vars)));
    lines.push('');
  }

  lines.push(`• Quiz admin slash commands are listed under ${fmtPrefix(prefix, 'commands')} and marked \`Manage Server\`.`);
  lines.push('• GeoAgora watch controls require Manage Channels or Administrator via `/geoagora watch ...`.');

  return lines.join('\n').trim();
}
