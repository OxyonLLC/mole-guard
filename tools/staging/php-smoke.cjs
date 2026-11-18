'use strict';
// Fixed, auditable native tool supervisor. Container cannot see host data or net.
if (process.env.WINLEW_TEST_ISOLATED === '1') throw new Error('Parent-only PHP tooling');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const snapshot = require('./integrity.cjs'), compare = require('../test-audit/compare.cjs');
const repo = path.resolve(__dirname, '../..'), root = fs.mkdtempSync(path.join(repo, '.test-tmp/php-staging-'));
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
const before = snapshot(); save('before.json', before);
const sources = ['src/public/verify/api-proxy.php', 'tools/staging/php-fixtures/upstream.php', 'tools/staging/php-fixtures/router.php', 'tools/staging/php-fixtures/run.php'];
sources.push('src/public/xl1/verify/api-proxy.php');
const hashes = {};
for (const relative of sources) {
  const bytes = fs.readFileSync(path.join(repo, relative)), name = relative.startsWith('src/public/xl1/') ? 'geo-api-proxy.php' : path.basename(relative);
  fs.writeFileSync(path.join(root, name), bytes); hashes[relative] = crypto.createHash('sha256').update(bytes).digest('hex');
}
let report;
try {
  const inspect = spawnSync('docker', ['image', 'inspect', 'php:8.3-cli', '--format', '{{.Id}}'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (inspect.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(inspect.stdout.trim())) throw new Error('Reviewed PHP image unavailable; no automatic pulls');
  const image = inspect.stdout.trim();
  const run = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,source=${root},target=/work,readonly`,
    '-e', 'WINLEW_API_BASE=http://127.0.0.1:19091', '-e', 'GEOHACKERS_API_BASE=http://127.0.0.1:19091', '-e', 'WINLEW_PROXY_SECRET=synthetic-local-proxy-secret', image, 'php', '/work/run.php'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  report = { image, code: run.status, sourceHashes: hashes, containerNetwork: 'none', hostMount: 'disposable snapshots only, read-only', result: JSON.parse(run.stdout) };
  if (run.status !== 0 || !report.result.ok) process.exitCode = 1;
} catch (error) { report = { error: error.message }; process.exitCode = 1; }
finally {
  const after = snapshot(); save('after.json', after); report.differences = compare(before, after);
  report.integrity = report.differences.length ? 'changed' : 'unchanged'; if (report.differences.length) process.exitCode = 1;
  save('report.json', report); console.log(JSON.stringify({ report: path.relative(repo, root), ok: !process.exitCode, integrity: report.integrity, tests: report.result?.tests?.length }));
}
