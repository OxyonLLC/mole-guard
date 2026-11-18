// Reusable local-only transport for CLI staging and guarded browser acceptance.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
export async function createLocalGateway(staging) {
  assert.equal(process.env.WINLEW_TEST_ISOLATED, '1');
  assert.equal(process.env.MONGO_ENABLED, 'false');
  assert.match(staging.base, /^http:\/\/127\.0\.0\.1:\d{1,5}$/);
const gateway = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__staging/identities') {
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(staging.accounts.map(({ name, wallet, session }) => ({ name, wallet, session })))); return;
    }
    if (url.pathname === '/__staging/') {
      res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store');
      res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>WinLEW isolated staging</title><h1>WinLEW isolated staging</h1><p>Disposable data · Mongo off · synthetic identities · no bots or payout workers.</p><p>Never connect a funded wallet. Use these local personas instead.</p><div id="personas"></div><a href="/">Home</a> · <a href="/play/">Play</a> · <a href="/verify/profile.html">Profile</a><script>fetch('/__staging/identities').then(r=>r.json()).then(rows=>{for(const row of rows){const b=document.createElement('button');b.textContent=row.name;b.onclick=()=>{localStorage.setItem('winlew.verify.session',row.session);localStorage.setItem('winlew.verify.app','mole');localStorage.setItem('winlew.verify.wallet',row.wallet);location.href='/verify/profile.html';};document.getElementById('personas').appendChild(b);}});</script></html>`); return;
    }
    let targetPath = url.pathname + url.search;
    if (url.pathname === '/verify/api-proxy.php') {
      const value = url.searchParams.get('path') || '';
      const decoded = decodeURIComponent(value);
      if (!value.startsWith('/api/') || /(?:^|\/)\.\.?(?:\/|$)/.test(decoded) || decoded.includes('\\') || /%(?:25|2e|2f|5c)/i.test(decoded) || value.startsWith('//')) {
        res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"invalid_proxy_path"}'); return;
      }
      const extra = new URLSearchParams(url.searchParams); extra.delete('path');
      targetPath = value + (extra.size ? (value.includes('?') ? '&' : '?') + extra : '');
    } else if (/\.php$/i.test(url.pathname)) { res.writeHead(404); res.end(); return; }
    const headers = {};
    for (const name of ['accept', 'content-type', 'x-winlew-session']) if (req.headers[name]) headers[name] = req.headers[name];
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error('fixture_body_limit'); }
    const response = await fetch(staging.base + targetPath, { method: req.method, headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    res.statusCode = response.status;
    for (const name of ['content-type', 'cache-control', 'x-content-type-options']) if (response.headers.has(name)) res.setHeader(name, response.headers.get(name));
    if (url.pathname.endsWith('/latest.json')) res.setHeader('cache-control', 'no-store');
    if (/\.(?:html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/')) res.setHeader('cache-control', 'no-cache, must-revalidate');
    if (url.pathname.endsWith('.apk')) { res.setHeader('content-type', 'application/vnd.android.package-archive'); res.setHeader('x-content-type-options', 'nosniff'); }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"isolated_upstream_unavailable"}'); }
});

  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  return { base: `http://127.0.0.1:${gateway.address().port}`,
    close: () => new Promise(resolve => { gateway.close(resolve); gateway.closeAllConnections(); }) };
}
