'use strict';
// Local-only persistent staging, with an independent pre/post integrity audit.
if (process.env.WINLEW_TEST_ISOLATED === '1') throw new Error('Standalone staging supervisor only');
const flags=process.argv.slice(2);
if (new Set(flags).size!==flags.length||flags.some(flag=>!['--smoke','--candidate'].includes(flag))) throw new Error('Usage: node tools/staging/run.cjs [--candidate] [--smoke]');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const snapshot = require('./integrity.cjs'), compare = require('../test-audit/compare.cjs');
const environment = require('./environment.cjs');
const repo = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(repo, '.test-tmp/staging-')); fs.mkdirSync(path.join(root, 'tmp'));
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
async function main() {
  const before = snapshot(); save('before.json', before);
  const report = { mode: flags.includes('--smoke') ? 'smoke' : 'serve', tests: [], protectedIntegrity: 'pending' };
  let child, candidate, log = '', stop;
  const shutdown = new Promise(resolve => { stop = resolve; });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop());
  try {
    if(flags.includes('--candidate')){candidate=require('./candidate.cjs')(repo);report.candidate=candidate.candidate;report.manifestSha256=candidate.manifestSha256;}
    child = fork(candidate?.entry||path.join(repo, 'tools/staging/server.mjs'), [], { cwd: candidate?.root||repo, env: environment(repo, root),
      execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    child.stdout.on('data', chunk => { log += chunk; if (log.includes('[isolation:unexpected]')) { report.unexpectedGuard = true; stop(); } });
    child.stderr.on('data', chunk => { log += chunk; if (log.includes('[isolation:unexpected]')) { report.unexpectedGuard = true; stop(); } });
    const exit = new Promise(resolve => child.once('exit', code => resolve(code)));
    const ready = await Promise.race([
      new Promise((resolve, reject) => { child.on('message', value => value?.event === 'ready' && resolve(value)); child.once('error', reject); }),
      exit.then(() => { throw new Error('Staging child exited before readiness'); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Staging startup timeout')), 30000); timer.unref(); }),
    ]);
    assert.match(ready.base, /^http:\/\/127\.0\.0\.1:\d{1,5}$/); report.base = ready.base;
    save('connection.json', { base: ready.base, data: root, personas: ready.base + '/__staging/', kind: 'synthetic-only', mongo: false });
    console.log(`Isolated staging: ${ready.base}/__staging/\nDisposable data: ${path.relative(repo, root)}\nStop with Ctrl+C; post-test integrity comparison always runs.`);
    if (report.mode === 'smoke') {
      const get = (url, headers) => fetch(ready.base + url, { headers, signal: AbortSignal.timeout(15000) });
      for (const url of ['/', '/play/', '/__staging/']) { assert.equal((await get(url)).status, 200); report.tests.push({ url, pass: true }); }
      const personas = await (await get('/__staging/identities')).json(); assert.equal(personas.length, 2);
      const profile = await get('/verify/api-proxy.php?path=/api/profile/me', { 'x-winlew-session': personas[0].session });
      assert.equal(profile.status, 200); assert.equal((await profile.json()).profile.displayName, 'Synthetic A'); report.tests.push({ url: 'proxy authenticated profile', pass: true });
      assert.equal((await get('/verify/api-proxy.php?path=/api/profile/me')).status, 401);
      for (const url of ['/verify/api-proxy.php?path=/api/../.env', '/verify/OTHER.PHP', '/.tmp-audit/phase5.json', '/.tmp-audit.zip']) assert.ok([400, 404].includes((await get(url)).status), url);
      assert.equal((await get('/jdid93hf8dh/latest.json')).headers.get('cache-control'), 'no-store');
      assert.equal((await get('/app/')).headers.get('cache-control'), 'no-cache, must-revalidate');
      report.tests.push({ url: 'denied paths and update caches', pass: true });
    } else await Promise.race([shutdown, exit]);
    child.send('shutdown');
    const code = await Promise.race([exit, new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(-1); }, 10000); timer.unref(); })]);
    assert.equal(code, 0);
    assert.match(log, /\[isolation:summary\]/); assert.ok(!log.includes('[isolation:unexpected]'));
    report.guardVerified = true;
    if(candidate){candidate.verify();report.candidateIntegrity='unchanged';}
  } catch (error) { report.error = error.code || error.message; child?.kill(); process.exitCode = 1; }
  finally {
    if (child && child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    fs.writeFileSync(path.join(root, 'child.log'), log);
    const after = snapshot(); save('after.json', after);
    report.differences = compare(before, after); report.protectedIntegrity = report.differences.length ? 'changed' : 'unchanged';
    report.protectedFiles = Object.values(after).filter(entry => entry.kind === 'file').length;
    report.ok = !report.error && !report.unexpectedGuard && report.guardVerified && !report.differences.length;
    save('report.json', report); if (!report.ok) process.exitCode = 1;
    console.log(`Staging ${report.ok ? 'PASS' : 'STOP'}; protected=${report.protectedIntegrity}; report=${path.relative(repo, root)}/report.json`);
  }
}
main().catch(error => { console.error('Staging supervisor failed:', error.name); process.exitCode = 1; });
