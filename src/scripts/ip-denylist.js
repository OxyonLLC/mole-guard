import 'dotenv/config';

import { initFaucetStorage } from '../faucet/storage.js';
import { addIpBan, checkIpBan, listIpBans, normalizeIpBanTarget, parseIpBanTtl, removeIpBan } from '../shared/ipDenylist.js';

function usage() {
  console.log(
    'Usage:\n' +
    '  node src/scripts/ip-denylist.js list\n' +
    '  node src/scripts/ip-denylist.js add <ip> [--ttl 24h] [reason...]\n' +
    '  node src/scripts/ip-denylist.js remove <ip>\n' +
    '  node src/scripts/ip-denylist.js check <ip>\n',
  );
}

function formatExpiry(expiresAt) {
  const ts = Number(expiresAt || 0);
  return ts ? new Date(ts).toISOString().replace('.000Z', 'Z') : 'never';
}

function parseAddArgs(args) {
  let ip = '';
  let ttlMs = null;
  const reason = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '').trim();
    if (!token) continue;
    if (token === '--ttl') {
      ttlMs = parseIpBanTtl(args[i + 1] || '');
      i += 1;
      continue;
    }
    if (!ip) {
      ip = token;
      continue;
    }
    reason.push(token);
  }

  return { ip, ttlMs, reason: reason.join(' ').trim() };
}

async function main() {
  await initFaucetStorage().catch((error) => {
    console.warn('[ip-denylist] storage bootstrap failed:', error?.message || error);
  });

  const [, , commandRaw, ...args] = process.argv;
  const command = String(commandRaw || '').trim().toLowerCase();

  if (!command || ['help', '--help', '-h'].includes(command)) {
    usage();
    return;
  }

  if (command === 'list') {
    const bans = listIpBans();
    if (!bans.length) {
      console.log('No IP bans recorded.');
      return;
    }
    for (const ban of bans) {
      console.log(`${ban.ip}\texpires=${formatExpiry(ban.expiresAt)}\tby=${ban.bannedBy || 'unknown'}\t${ban.reason || ''}`.trim());
    }
    return;
  }

  if (command === 'add') {
    const parsed = parseAddArgs(args);
    if (!parsed.ip) {
      usage();
      process.exitCode = 1;
      return;
    }
    const ip = normalizeIpBanTarget(parsed.ip);
    const ban = addIpBan(ip, {
      ttlMs: parsed.ttlMs,
      reason: parsed.reason,
      bannedBy: 'cli',
    });
    console.log(`Blocked ${ban.ip} until ${formatExpiry(ban.expiresAt)}${ban.reason ? ` — ${ban.reason}` : ''}`);
    return;
  }

  if (command === 'remove') {
    const ip = normalizeIpBanTarget(args[0] || '');
    console.log(removeIpBan(ip) ? `Removed ${ip}` : `${ip} was not banned`);
    return;
  }

  if (command === 'check') {
    const ip = normalizeIpBanTarget(args[0] || '');
    const result = await checkIpBan(ip, { maxAgeMs: 0 });
    if (!result.blocked) {
      console.log(`${ip} is not blocked`);
      return;
    }
    console.log(`${ip} is blocked until ${formatExpiry(result.ban?.expiresAt)}${result.ban?.reason ? ` — ${result.ban.reason}` : ''}`);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
