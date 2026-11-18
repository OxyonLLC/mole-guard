'use strict';
// Offline operations supervisor. Fixed builders/native syntax checks only;
// no application startup, production credentials or arbitrary commands.
if (require.main !== module || process.env.WINLEW_TEST_ISOLATED === '1' || process.argv.length !== 2) throw new Error('Standalone release verifier only');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verify, preflight, digest } = require('./lib.cjs');
const snapshot = require('../staging/integrity.cjs'), compare = require('../test-audit/compare.cjs');
const repo = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(repo, '.test-tmp/deployment-verification-'));
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
const before = snapshot(); save('before.json', before); let report = { ok: false };
try {
  const builds = [];
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'build.cjs')], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 240000 });
    if (result.status !== 0) throw new Error('Offline package builder failed; inspect preserved build report');
    const build = JSON.parse(result.stdout.trim());
    if (!build.ok) throw new Error('Package audit failed');
    builds.push(build);
  }
  if (builds[0].manifestSha256 !== builds[1].manifestSha256 || builds[0].releaseId !== builds[1].releaseId) throw new Error('Non-reproducible release');
  const root = path.join(repo, builds[1].package), bytes = fs.readFileSync(path.join(root, 'release.json'));
  const integrity = verify(root, JSON.parse(bytes));
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'operations/host-plan.example.json'), 'utf8'));
  const expectedBlocked = preflight(plan); if (expectedBlocked.ready) throw new Error('Template preflight unexpectedly allowed launch');
  const cli = spawnSync(process.execPath, [path.join(root, 'operations/preflight.cjs'), root,
    path.join(root, 'operations/host-plan.example.json'), digest(bytes)], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (cli.status !== 1 || JSON.parse(cli.stdout).host.ready !== false) throw new Error('Preflight CLI fail-closed regression');
  const image = spawnSync('docker', ['image', 'inspect', 'php:8.3-cli', '--format', '{{.Id}}'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (image.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim())) throw new Error('Cached PHP image unavailable; no automatic pulls');
  const imageId = image.stdout.trim();
  function php(args, env = []) {
    return spawnSync('docker', ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--mount', `type=bind,source=${path.join(root, 'operations')},target=/work,readonly`,
      ...env.flatMap(v => ['-e', v]), imageId, 'php', ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  }
  const lint = php(['-l', '/work/host-check.php']); if (lint.status !== 0) throw new Error('PHP syntax failure');
  const absent = php(['/work/host-check.php']);
  if (absent.status !== 1 || JSON.parse(absent.stdout).ok !== false) throw new Error('PHP missing-config check failed');
  const synthetic = php(['/work/host-check.php'], ['WINLEW_API_BASE=https://mole.host.test', 'GEOHACKERS_API_BASE=https://geohackers.host.test',
    'GEOAGORA_API_BASE=https://geoagora.host.test/api', 'WINLEW_PROXY_SECRET=synthetic-only-proxy-secret']);
  if (synthetic.status !== 0 || JSON.parse(synthetic.stdout).ok !== true) throw new Error('PHP synthetic configuration check failed');
  report = { ok: true, builds, integrity, reproducible: true, preflightTemplateBlocked: true,
    php: { imageId, network: 'none', syntax: 'PASS', missingConfiguration: 'expected FAIL', syntheticConfiguration: 'PASS', checks: 3 },
    applicationProcessesStarted: 0, productionRequests: 0, deploys: 0 };
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  const after = snapshot(); save('after.json', after); report.protectedChanges = compare(before, after);
  report.protectedFiles = Object.values(after).filter(value => value.kind === 'file').length;
  if (report.protectedChanges.length) { report.ok = false; process.exitCode = 1; }
  save('report.json', report); console.log(JSON.stringify({ ...report, evidence: path.relative(repo, output).replaceAll('\\', '/') }));
}
