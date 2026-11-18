import { execFileSync as execFileSyncDefault } from 'node:child_process';

const TAILSCALE_HOST_VALUES = new Set(['tailscale', 'tailnet', 'auto-tailscale']);

function isIpv4(value) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function readTailscaleIpv4(execFileSync = execFileSyncDefault) {
  let stdout = '';
  try {
    stdout = String(execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    const detail = error?.code === 'ENOENT'
      ? 'command not found in PATH'
      : (error?.stderr ? String(error.stderr).trim() : error?.message || 'unknown error');
    throw new Error(
      `WATCHDOG_HOST=tailscale requires the \`tailscale\` CLI, but \`tailscale ip -4\` failed: ${detail}`
    );
  }

  const ip = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  if (!ip) {
    throw new Error('WATCHDOG_HOST=tailscale resolved no IPv4 address. Is this machine connected to Tailscale?');
  }
  if (!isIpv4(ip)) {
    throw new Error(`WATCHDOG_HOST=tailscale returned an invalid IPv4 address: ${ip}`);
  }
  return ip;
}

export function resolveWatchdogListenHost(env = process.env, options = {}) {
  const execFileSync = options.execFileSync || execFileSyncDefault;
  const rawHost = String(env.WATCHDOG_HOST || env.HOST || '').trim();
  if (!rawHost) return undefined;

  if (!TAILSCALE_HOST_VALUES.has(rawHost.toLowerCase())) {
    return rawHost;
  }

  return readTailscaleIpv4(execFileSync);
}
