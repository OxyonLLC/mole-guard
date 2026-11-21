// Talks to the Oxyon Blitz server's bridge-only routes (/bridge/v1/*). The token is a shared secret read from a
// file (mode 600); it is never logged. Errors carry only the route and HTTP status.
export function createBlitzClient({ apiUrl, token, fetchImpl = fetch, timeoutMs = 15000 }) {
  const base = new URL(apiUrl);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('blitz_api_url_must_be_https');
  if (!/^\S{32,256}$/.test(token || '')) throw new Error('blitz_bridge_token_invalid');
  async function call(route, body) {
    const response = await fetchImpl(new URL(route, base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) throw new Error(`blitz_bridge_http_${response.status}_${route.split('/').pop()}`);
    return response.json();
  }
  return {
    claim: limit => call('/bridge/v1/claim', { limit }),
    settle: input => call('/bridge/v1/settle', input),
    verifiedWallets: wallets => call('/bridge/v1/verified-wallets', { wallets }),
  };
}
