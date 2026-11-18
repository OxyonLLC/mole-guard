import { getConfig } from './config.js';
import { getUserContributionSummary } from './contributions.js';

const API_BASE = 'https://discord.com/api/v10';
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

function parseEnabled(raw, fallback = true) {
  if (raw == null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

// LewCREW 1M/10M/100M tiers are deliberately NOT in this catalog (2026-07-29)
// -- Discord limits how many roles a bot can usefully manage/display, and
// these three are a "nice to see" visual tier, not something worth spending
// role slots on. Left as a manual, eyeballed process instead: the Discord
// bot's faucet-claim reply shows the claimer's new total balance
// (src/faucet/bot.js) so a maintainer can hand-assign/update these roles as
// a wallet crosses a threshold. If Discord's role limits are ever less of a
// concern, re-add them here the same way token_holder is done below.
function roleCatalog(cfg) {
  return [
    { key: 'verified_wallet', label: 'Verified Wallet', roleId: String(cfg.VERIFIED_WALLET_ROLE_ID || '').trim(), wanted: true },
    { key: 'token_holder', label: 'Verified Holders', roleId: String(cfg.VERIFIED_HOLDERS_ROLE_ID || '').trim(), wanted: false },
    // Contribution-based roles (2026-07-29) -- `wanted` is driven by
    // contribution-ledger flags computed fresh inside syncGuildRolesForUser()
    // below, never by whatever the caller happens to pass in `flags`. Every
    // OTHER entry in this catalog is re-affirmed on every sync call, so if a
    // caller's `flags` object silently omitted these two keys, computeDesired
    // would resolve them to `false` and strip the role from someone who
    // rightfully has it (e.g. a routine wallet-verification re-sync that only
    // ever computed balance-based flags). Looking these up here instead of
    // trusting the caller closes that gap.
    { key: 'contributor', label: 'Contributor', roleId: String(cfg.CONTRIBUTOR_ROLE_ID || '').trim(), wanted: false },
    { key: 'governance_voter', label: 'Governance Voter', roleId: String(cfg.GOVERNANCE_VOTER_ROLE_ID || '').trim(), wanted: false },
  ];
}

function computeDesired(entries, flags = {}) {
  return entries.map((entry) => {
    let wanted = entry.wanted;
    if (entry.key === 'token_holder') wanted = !!flags.token_holder;
    if (entry.key === 'contributor') wanted = !!flags.contributor;
    if (entry.key === 'governance_voter') wanted = !!flags.governance_voter;
    return { ...entry, wanted };
  });
}

function resolveGuildSyncBot(appKey, cfg = getConfig()) {
  const normalized = String(appKey || '').trim().toLowerCase();
  const table = {
    mole: [
      ['MOLE_GUILD_ROLE_SYNC_BOT_TOKEN', cfg.MOLE_GUILD_ROLE_SYNC_BOT_TOKEN],
      ['MOLE_DISCORD_BOT_TOKEN', cfg.MOLE_DISCORD_BOT_TOKEN],
      ['GUILD_ROLE_SYNC_BOT_TOKEN', cfg.GUILD_ROLE_SYNC_BOT_TOKEN],
      ['DISCORD_TOKEN', cfg.DISCORD_TOKEN],
    ],
    utility: [
      ['UTILITY_GUILD_ROLE_SYNC_BOT_TOKEN', cfg.UTILITY_GUILD_ROLE_SYNC_BOT_TOKEN],
      ['UTILITY_DISCORD_BOT_TOKEN', cfg.UTILITY_DISCORD_BOT_TOKEN],
      ['GUILD_ROLE_SYNC_BOT_TOKEN', cfg.GUILD_ROLE_SYNC_BOT_TOKEN],
      ['DISCORD_TOKEN', cfg.DISCORD_TOKEN],
    ],
    default: [
      ['GUILD_ROLE_SYNC_BOT_TOKEN', cfg.GUILD_ROLE_SYNC_BOT_TOKEN],
      ['DISCORD_TOKEN', cfg.DISCORD_TOKEN],
    ],
  };

  for (const [source, token] of (table[normalized] || table.default)) {
    const value = String(token || '').trim();
    if (value) return { appKey: normalized || 'default', token: value, tokenSource: source };
  }

  return { appKey: normalized || 'default', token: '', tokenSource: 'missing' };
}

async function discordRoleMutation({ botToken, guildId, userId, roleId, shouldHave, reason }) {
  const url = `${API_BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`;
  const headers = { Authorization: `Bot ${botToken}` };
  if (reason) headers['X-Audit-Log-Reason'] = reason;
  const r = await fetch(url, { method: shouldHave ? 'PUT' : 'DELETE', headers });

  if (r.ok) return { ok: true, status: r.status, action: shouldHave ? 'added' : 'removed' };

  const text = await r.text().catch(() => '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { message: text || `http_${r.status}` }; }
  return { ok: false, status: r.status, action: shouldHave ? 'add' : 'remove', error: parsed?.message || text || `http_${r.status}`, raw: parsed };
}

async function apiGet(url, botToken) {
  const r = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
  const text = await r.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

function highestRolePosition(memberRoleIds = [], rolesById = new Map()) {
  let top = 0;
  for (const roleId of memberRoleIds) {
    const pos = Number(rolesById.get(String(roleId))?.position || 0);
    if (pos > top) top = pos;
  }
  return top;
}

function computeMemberPermissions(memberRoleIds = [], guildId = '', rolesById = new Map()) {
  let perms = 0n;
  const everyone = rolesById.get(String(guildId));
  if (everyone?.permissions != null) perms |= BigInt(everyone.permissions);
  for (const roleId of memberRoleIds) {
    const role = rolesById.get(String(roleId));
    if (role?.permissions != null) perms |= BigInt(role.permissions);
  }
  if ((perms & ADMINISTRATOR) === ADMINISTRATOR) return { permissions: perms, isAdministrator: true, canManageRoles: true };
  return { permissions: perms, isAdministrator: false, canManageRoles: (perms & MANAGE_ROLES) === MANAGE_ROLES };
}

async function runGuildRoleDiagnosticsForApp(appKey, cfg, targetRoles) {
  const guildId = String(cfg.DISCORD_GUILD_ID || '').trim();
  const resolved = resolveGuildSyncBot(appKey, cfg);
  if (!resolved.token) {
    console.log(`[guild-role-diagnostics] app=${appKey} skipped: no bot token configured`);
    return { ok: true, skipped: true, reason: 'missing_bot_token', appKey };
  }

  const me = await apiGet(`${API_BASE}/users/@me`, resolved.token);
  if (!me.ok) {
    console.warn(`[guild-role-diagnostics] app=${appKey} failed: cannot inspect bot identity status=${me.status}`);
    return { ok: false, error: `bot_identity_failed:${me.status}`, appKey };
  }

  const member = await apiGet(`${API_BASE}/guilds/${guildId}/members/${me.body.id}`, resolved.token);
  if (!member.ok) {
    console.warn(`[guild-role-diagnostics] app=${appKey} failed: bot is not readable in guild ${guildId} status=${member.status}`);
    return { ok: false, error: `bot_member_failed:${member.status}`, appKey, botId: me.body.id };
  }

  const rolesResp = await apiGet(`${API_BASE}/guilds/${guildId}/roles`, resolved.token);
  if (!rolesResp.ok || !Array.isArray(rolesResp.body)) {
    console.warn(`[guild-role-diagnostics] app=${appKey} failed: cannot inspect guild roles status=${rolesResp.status}`);
    return { ok: false, error: `guild_roles_failed:${rolesResp.status}`, appKey, botId: me.body.id };
  }

  const rolesById = new Map(rolesResp.body.map((role) => [String(role.id), role]));
  const botTopPosition = highestRolePosition(member.body.roles || [], rolesById);
  const perms = computeMemberPermissions(member.body.roles || [], guildId, rolesById);

  console.log(`[guild-role-diagnostics] app=${appKey} bot=${me.body.username}#${me.body.discriminator || '0'} id=${me.body.id} guild=${guildId} tokenSource=${resolved.tokenSource}`);
  console.log(`[guild-role-diagnostics] app=${appKey} manage_roles=${perms.canManageRoles} admin=${perms.isAdministrator} botTopRolePosition=${botTopPosition} configuredTargets=${targetRoles.length}`);

  for (const entry of targetRoles) {
    const role = rolesById.get(entry.roleId);
    if (!role) {
      console.warn(`[guild-role-diagnostics] app=${appKey} target missing: ${entry.label} (${entry.roleId})`);
      continue;
    }
    const position = Number(role.position || 0);
    const manageable = perms.canManageRoles && botTopPosition > position;
    const summary = `[guild-role-diagnostics] app=${appKey} target=${entry.label} roleId=${entry.roleId} position=${position} manageable=${manageable}`;
    if (manageable) console.log(summary);
    else console.warn(`${summary} reason=${!perms.canManageRoles ? 'missing_manage_roles' : 'role_hierarchy'}`);
  }

  return { ok: true, appKey, botId: me.body.id, guildId, canManageRoles: perms.canManageRoles, isAdministrator: perms.isAdministrator, botTopPosition, tokenSource: resolved.tokenSource };
}

export async function runGuildRoleDiagnostics() {
  const cfg = getConfig();
  const enabled = parseEnabled(cfg.GUILD_ROLE_DIAGNOSTICS_ON_START, true);
  if (!enabled) return { ok: true, skipped: true, reason: 'guild_role_diagnostics_disabled' };

  const syncEnabled = parseEnabled(cfg.GUILD_ROLE_SYNC_ENABLED, true);
  const guildId = String(cfg.DISCORD_GUILD_ID || '').trim();
  const targetRoles = roleCatalog(cfg).filter((entry) => entry.roleId);

  if (!syncEnabled) {
    console.log('[guild-role-diagnostics] skipped: GUILD_ROLE_SYNC_ENABLED is false');
    return { ok: true, skipped: true, reason: 'guild_role_sync_disabled' };
  }
  if (!guildId) {
    console.log('[guild-role-diagnostics] skipped: DISCORD_GUILD_ID missing');
    return { ok: true, skipped: true, reason: 'missing_guild_id' };
  }
  if (!targetRoles.length) {
    console.log('[guild-role-diagnostics] skipped: no target role ids configured');
    return { ok: true, skipped: true, reason: 'no_target_roles' };
  }

  const appKeys = ['mole', 'utility'];
  const results = [];
  for (const appKey of appKeys) {
    const result = await runGuildRoleDiagnosticsForApp(appKey, cfg, targetRoles).catch((e) => ({ ok: false, appKey, error: e?.message || String(e) }));
    results.push(result);
  }
  return { ok: true, results };
}

/**
 * Guild-membership facts for the identity-age gate (src/mole/identityAge.js):
 * how long they have been in the server, and whether they have finished
 * Discord's membership screening.
 *
 * Returns `null` for every reason that is OUR fault rather than the user's —
 * no bot token, no guild id, Discord unreachable, 429, 5xx. The gate treats a
 * null as "this check could not run" and lets the user through on the account-age
 * signal alone, which is the same fail-open stance walletBans.js takes for its
 * RPC-dependent cluster walk. Never return `{ inGuild: false }` for a lookup
 * failure: that is indistinguishable from a real refusal and would lock out
 * every honest member the moment the bot token expired.
 *
 * A genuine 404 IS a real answer — Discord is telling us they are not a member.
 */
export async function fetchGuildMemberFacts({ appKey = 'mole', discordUserId } = {}) {
  const cfg = getConfig();
  const userId = String(discordUserId || '').trim();
  if (!userId) return null;

  const guildId = String(cfg.DISCORD_GUILD_ID || '').trim();
  if (!guildId) return null;

  const resolved = resolveGuildSyncBot(appKey, cfg);
  if (!resolved.token) return null;

  let member;
  try {
    member = await apiGet(`${API_BASE}/guilds/${guildId}/members/${userId}`, resolved.token);
  } catch (err) {
    console.warn('[identity-gate] guild member lookup threw:', err?.message || err);
    return null;
  }

  if (member.status === 404) return { inGuild: false, joinedAtMs: null, pending: false };
  if (!member.ok || !member.body || typeof member.body !== 'object') {
    console.warn(`[identity-gate] guild member lookup failed status=${member.status} — failing open`);
    return null;
  }

  const joinedAt = Date.parse(member.body.joined_at || '');
  return {
    inGuild: true,
    joinedAtMs: Number.isFinite(joinedAt) ? joinedAt : null,
    // `pending` is true while a member has not accepted the rules screen.
    // Absent on guilds without membership screening enabled — absent means
    // "no screening to fail", not "pending".
    pending: member.body.pending === true,
  };
}

export async function syncGuildRolesForUser({ appKey = 'mole', discordUserId, wallet, balance, flags, source = 'verification' }) {
  const cfg = getConfig();
  const enabled = parseEnabled(cfg.GUILD_ROLE_SYNC_ENABLED, true);
  if (!enabled) return { ok: true, skipped: true, reason: 'guild_role_sync_disabled' };

  const guildId = String(cfg.DISCORD_GUILD_ID || '').trim();
  if (!guildId) return { ok: true, skipped: true, reason: 'missing_guild_id' };

  const resolved = resolveGuildSyncBot(appKey, cfg);
  if (!resolved.token) return { ok: true, skipped: true, reason: 'missing_guild_role_sync_bot_token', appKey };

  // Always looked up fresh from the contribution ledger -- never trusts
  // whatever (if anything) the caller passed for these two keys, see the
  // comment on the catalog entries above.
  let contributionFlags = { contributor: false, governance_voter: false };
  if (discordUserId) {
    try {
      const summary = await getUserContributionSummary(discordUserId);
      contributionFlags = {
        contributor: Number(summary?.total || 0) > 0,
        governance_voter: Number(summary?.byCause?.governance || 0) > 0,
      };
    } catch (err) {
      console.warn(`[guild-role-sync] contribution flag lookup failed for ${discordUserId}, defaulting to false:`, err?.message || err);
    }
  }

  const desiredRoles = computeDesired(roleCatalog(cfg), { ...flags, ...contributionFlags });
  const configured = desiredRoles.filter((entry) => entry.roleId);
  if (!configured.length) return { ok: true, skipped: true, reason: 'no_configured_role_ids' };

  const results = [];
  let hardFailure = null;

  for (const entry of configured) {
    const result = await discordRoleMutation({
      botToken: resolved.token,
      guildId,
      userId: discordUserId,
      roleId: entry.roleId,
      shouldHave: entry.wanted,
      reason: `${source}:${entry.label}:${wallet || 'unknown_wallet'}:${Math.floor(Number(balance || 0))}`,
    });

    const row = { key: entry.key, label: entry.label, roleId: entry.roleId, wanted: entry.wanted, ...result };
    results.push(row);

    if (result.ok) {
      console.log(`[guild-role-sync] app=${appKey} botToken=${resolved.tokenSource} ${row.action} role=${row.label} roleId=${row.roleId} user=${discordUserId} wanted=${row.wanted}`);
      continue;
    }

    console.warn(`[guild-role-sync] app=${appKey} botToken=${resolved.tokenSource} failed role=${row.label} roleId=${row.roleId} user=${discordUserId} wanted=${row.wanted} status=${row.status} error=${row.error}`);
    if ([400, 401, 403, 404].includes(Number(row.status))) {
      hardFailure = row;
      break;
    }
  }

  const summary = { ok: !hardFailure, skipped: false, appKey, tokenSource: resolved.tokenSource, guildId, discordUserId: String(discordUserId), wallet: String(wallet || ''), balance: Number(balance || 0), results };
  if (hardFailure) summary.error = `guild_role_sync_failed:${hardFailure.status}:${hardFailure.key}:${hardFailure.error}`;
  return summary;
}
