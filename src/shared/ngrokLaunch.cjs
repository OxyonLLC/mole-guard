const fs = require('node:fs');
const path = require('node:path');

// How to launch ngrok, in one place.
//
// This existed twice — in src/scripts/dev-all.js and in ecosystem.config.cjs —
// and `npm run start:all` had neither, which is why `dev:all` brought the
// tunnel up and `start:all` silently didn't. Three consumers, two
// implementations, one of them missing: exactly the drift a shared module
// exists to prevent.
//
// CommonJS on purpose. ecosystem.config.cjs is loaded by pm2 as CJS and cannot
// import ESM, while the ESM callers reach it through createRequire — so one
// file can serve all three.

/** Hostnames that indicate a RESERVED ngrok domain worth requesting by name.
 *  Union of the two lists that had drifted apart between the old copies. */
const NGROK_HOST = /\.ngrok(-free)?\.(io|app|dev)$/i;

function isDisabled(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

/**
 * A reserved ngrok URL from PUBLIC_BASE_URL, or null.
 *
 * Without one ngrok issues a random hostname each start, which breaks the PHP
 * proxy on winlew.co and every Discord redirect URL until they're updated by
 * hand — so "not an ngrok domain" is worth saying out loud, not silently
 * shrugging at.
 */
function parseDesiredNgrokUrl(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    return NGROK_HOST.test(u.hostname) ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

/**
 * Resolves everything needed to spawn ngrok from an env-shaped object.
 * `DEV_ALL_NGROK` is still honoured as the legacy name dev-all.js used.
 */
function resolveNgrokLaunch(env = process.env) {
  const localBinary = path.resolve(__dirname, '../../.tools/ngrok');
  const command = String(env.NGROK_BIN || '').trim() ||
    (fs.existsSync(localBinary) ? localBinary : 'ngrok');
  const port = Number(env.PORT || 8787);
  const desiredUrl = parseDesiredNgrokUrl(String(env.PUBLIC_BASE_URL || '').trim());
  const authtoken = String(env.NGROK_AUTHTOKEN || '').trim();
  const enabled = !isDisabled(env.NGROK_ENABLED ?? env.DEV_ALL_NGROK ?? 'true');

  const args = ['http', String(port)];
  if (desiredUrl) args.push('--url', desiredUrl);
  if (authtoken) args.push('--authtoken', authtoken);

  return { enabled, command, port, desiredUrl, args };
}

module.exports = { resolveNgrokLaunch, parseDesiredNgrokUrl };
