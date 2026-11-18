import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve('src/public');
const candidate = '.test-tmp/winlew3-rc-B60Vfn';
const manifest = JSON.parse(fs.readFileSync(candidate + '/manifest.json', 'utf8'));
test('frozen baseline release has all 596 exact public files and no excluded sensitive paths', () => {
  assert.equal(Object.keys(manifest.publicFiles).length, 596);
  for (const [file, expected] of Object.entries(manifest.publicFiles)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(candidate, 'public', file))).digest('hex'), expected.sha256, file);
  }
  for (const file of manifest.excluded) assert.equal(fs.existsSync(path.join(candidate, 'public', file)), false, file);
});
test('primary journeys have working local markup assets, links and canonical URLs', () => {
  for (const route of ['', 'play', 'earn', 'community-hub', 'token', 'proof', 'build']) {
    const file = path.join(root, route, 'index.html'); const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.includes(`href="https://winlew.co/${route ? route + '/' : ''}"`), route);
    for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      const href = match[1]; if (/^(?:https?:|mailto:|tel:|data:|javascript:)/.test(href)) continue;
      const url = new URL(href, 'http://127.0.0.1/' + (route ? route + '/' : ''));
      assert.equal(url.hostname, '127.0.0.1');
      const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      assert.ok(target === root || target.startsWith(root + path.sep));
      assert.ok(fs.existsSync(target), `missing ${route}: ${url.pathname}`);
    }
  }
});
test('historical evidence cannot be public under any configured serving surface', () => {
  const apache = fs.readFileSync(path.join(root, '.htaccess'), 'utf8');
  assert.ok(apache.includes('\\.tmp-audit(?:\\.zip)?(/|$) - [F,L,NC]'));
  assert.match(apache, /Options -Indexes/);
  const redirects = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
  assert.ok(redirects.includes('/.tmp-audit/* /404.html 404!'));
  assert.ok(redirects.includes('/.tmp-audit.zip /404.html 404!'));
  const web = fs.readFileSync('src/mole/web.js', 'utf8');
  assert.ok(web.indexOf('isPublicRequestPath(req.path)') < web.indexOf('express.static('));
});
test('Android content type, update cache and unversioned presentation revalidation are explicit', () => {
  const apache = fs.readFileSync(path.join(root, '.htaccess'), 'utf8');
  assert.match(apache, /application\/vnd.android.package-archive \.apk/);
  assert.match(apache, /Cache-Control "no-cache, must-revalidate"/);
  assert.match(apache, /Cache-Control "no-store"/);
  assert.match(apache, /X-Content-Type-Options "nosniff"/);
  assert.match(fs.readFileSync(path.join(root, 'app/index.html'), 'utf8'), /fetch\('\/jdid93hf8dh\/latest.json', \{ cache: 'no-store' \}\)/);
});
test('homepage frontend and production proxy retain backend compatibility', () => {
  const proxy = fs.readFileSync(path.join(root, 'verify/api-proxy.php'), 'utf8');
  assert.match(proxy, /getenv\('WINLEW_API_BASE'\)/); assert.match(proxy, /getenv\('WINLEW_PROXY_SECRET'\)/);
  const web = fs.readFileSync('src/mole/web.js', 'utf8');
  assert.ok(web.includes('/api/homepage/summary'));
  assert.ok(fs.readFileSync(path.join(root, 'assets/homepage-data.js'), 'utf8').includes('/api/homepage/summary'));
});
