'use strict';
// Fixed unauthenticated, read-only probes; no wallet, challenge, claim, vote,
// reconciliation, logout, session or OAuth requests. No redirects followed.
const paths = ['/', '/play/', '/earn/', '/community-hub/', '/token/', '/proof/', '/build/', '/app/',
  '/mole-hub/', '/faucet/', '/quiz/', '/transparency/', '/governance/', '/jdid93hf8dh/latest.json'];
async function smoke(origin, request = fetch) {
  const url = new URL(origin);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password
    || !((url.protocol === 'http:' && url.hostname === '127.0.0.1')
      || (url.protocol === 'https:' && url.hostname === 'winlew.co' && !url.port))) throw new Error('Unapproved smoke origin');
  const results = [];
  for (const route of [...paths, '/.tmp-audit/phase3b-browser-qa-results.json', '/.tmp-audit.zip',
    '/verify/api-proxy-secret.php', '/future/lab/probe.php']) {
    const response = await request(new URL(route, origin), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const denied = route.includes('.tmp-audit') || route.includes('secret.php') || route.endsWith('probe.php');
    let ok = denied ? [403, 404].includes(response.status) : response.status === 200;
    if (route.endsWith('latest.json') && response.status === 200) {
      const data = await response.json();
      ok &&= data.version === '0.2.1' && data.build === 201
        && data.sha256 === 'cbe67a8de3f14a4dadde8019db24e30e052be94ae618ed2dd32a1a7d891d10d7'
        && /no-store/.test(response.headers.get('cache-control') || '');
    } else await response.body?.cancel();
    results.push({ route, status: response.status, ok });
  }
  return { ok: results.every(r => r.ok), results };
}
module.exports = { smoke };
if (require.main === module) {
  const origin = process.argv[2];
  const external = origin === 'https://winlew.co';
  if (process.argv.length !== (external ? 4 : 3) || (external && process.argv[3] !== '--owner-authorized-host')) throw new Error('Usage: node smoke.cjs http://127.0.0.1:PORT (or https://winlew.co --owner-authorized-host after separate authorization)');
  smoke(origin).then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
