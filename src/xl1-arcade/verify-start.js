// "Verify XL1 wallet" on the arcade page: ask the GeoHackers bot, on this PC, for a verify
// session for the player WinLEW has already signed in with Discord. The player signs in
// their own XL1 wallet on GeoHackers' verify page; once that succeeds the bot's store holds
// the signed record that getVerifiedXl1Wallet() already reads. This only starts the flow.
//
// GEOHACKERS_WEB_VERIFY_TOKEN must equal the bot's; the bot's route is public through the
// winlew.co relay, so it refuses requests without it.

const ARCADE_RETURN = 'https://winlew.co/xl1/arcade/';
// The bot's PUBLIC_BASE_URL: its verify pages are reached through winlew.co's PHP relay.
const VERIFY_BASE = 'https://winlew.co/xl1/verify/api-proxy.php';

/** True for a real Discord ID; wallet-backed WinLEW logins ("wallet:…") have no Discord account. */
export const isDiscordIdentity = id => /^\d{17,20}$/.test(String(id ?? ''));

export function makeStartVerification({
  base = process.env.GEOHACKERS_VERIFY_LOCAL_URL || 'http://127.0.0.1:8793',
  token = process.env.GEOHACKERS_WEB_VERIFY_TOKEN || '',
  returnTo = process.env.XL1_ARCADE_RETURN_URL || ARCADE_RETURN,
  verifyBase = process.env.XL1_VERIFY_PUBLIC_BASE || VERIFY_BASE,
  fetchFn = fetch,
} = {}) {
  const url = `${String(base).trim().replace(/\/$/, '')}/api/web-verify-session`;
  const prefix = `${String(verifyBase).trim().replace(/\/$/, '')}/verify/`;
  const verifyLink = link => link.startsWith(prefix) && /^[A-Za-z0-9_-]{16,64}$/.test(link.slice(prefix.length));
  return async function startVerification(identityId) {
    if (!isDiscordIdentity(identityId)) throw new Error('needs_identity_sync');
    if (!String(token).trim()) throw new Error('xl1_verify_unavailable');
    let response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${String(token).trim()}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ discordUserId: String(identityId), returnTo }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error('xl1_verify_unavailable');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('xl1_verify_unavailable');
    // Only a link to the bot's public verify page (XL1_VERIFY_PUBLIC_BASE) is handed to the browser.
    if (typeof body.url !== 'string' || !verifyLink(body.url)) {
      throw new Error('xl1_verify_unavailable');
    }
    return { url: body.url, expiresAt: body.expiresAt };
  };
}
