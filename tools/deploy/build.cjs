'use strict';
// Fixed verified source -> deployment overlay. Never starts application code.
if (require.main !== module || process.env.WINLEW_TEST_ISOLATED === '1' || process.argv.length !== 2) throw new Error('Standalone fixed release builder only');
const fs = require('node:fs'), path = require('node:path');
const { digest, inventory } = require('./lib.cjs');
const snapshot = require('../staging/integrity.cjs'), compare = require('../test-audit/compare.cjs');
const repo = path.resolve(__dirname, '../..');
const source = path.join(repo, '.test-tmp/winlew3-rc-wrU4UK');
for (const name of ['.test-tmp', '.test-tmp/winlew3-rc-wrU4UK']) {
  if (fs.lstatSync(path.join(repo, name)).isSymbolicLink()) throw new Error('Candidate parent link refused');
}
const trusted = 'b4c343cf7304905c6e91267ae9275aeafcb3a5da19dfbfdc037854c863a43e31';
const output = fs.mkdtempSync(path.join(repo, '.test-tmp/deployment-preparation-'));
const before = snapshot();
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
save('before.json', before);
let report = { ok: false, source: '.test-tmp/winlew3-rc-wrU4UK' };
try {
  const bytes = fs.readFileSync(path.join(source, 'manifest.json'));
  if (digest(bytes) !== trusted) throw new Error('Verified candidate manifest changed');
  const original = JSON.parse(bytes);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(repo, '.test-tmp/completion-checkpoint-spUAJa/manifest.json'), 'utf8'));
  for (const [name, expected] of Object.entries(checkpoint.historical)) {
    if (digest(fs.readFileSync(path.join(repo, name))) !== expected) throw new Error('Historical integrity discrepancy');
  }
  const actualPublic = inventory(path.join(source, 'public'));
  const actualRuntime = inventory(path.join(source, 'runtime'));
  for (const [actual, expected] of [[actualPublic, original.publicFiles], [actualRuntime, original.runtime.files]]) {
    if (Object.keys(actual).length !== Object.keys(expected).length) throw new Error('Candidate inventory discrepancy');
    for (const [file, item] of Object.entries(actual)) if (item.sha256 !== expected[file]?.sha256 || item.bytes !== expected[file]?.bytes) throw new Error('Candidate source changed');
  }
  const packageRoot = path.join(output, 'release'); fs.mkdirSync(packageRoot);
  function copy(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, fs.readFileSync(from));
  }
  const excluded = ['future/lab/probe.php', 'xl1/verify/api-proxy-upstream.example.php'];
  for (const name of Object.keys(actualPublic)) {
    if (excluded.includes(name)) continue;
    copy(path.join(source, 'public', name), path.join(packageRoot, 'public', name));
    // Node also serves/reads its PUBLIC_DIR; static host alone is insufficient.
    copy(path.join(source, 'public', name), path.join(packageRoot, 'backend/src/public', name));
  }
  for (const name of Object.keys(actualRuntime)) copy(path.join(source, 'runtime', name), path.join(packageRoot, 'backend', name));
  for (const name of ['lib.cjs', 'preflight.cjs', 'smoke.cjs', 'host-plan.example.json', 'hosting.env.example', 'host-check.php', 'apache-deny.conf']) {
    copy(path.join(__dirname, name), path.join(packageRoot, 'operations', name));
  }
  copy(path.join(repo, 'docs/winlew-3-deployment-runbook.md'), path.join(packageRoot, 'operations/RUNBOOK.md'));
  const names = new Set();
  for (const name of Object.keys(actualRuntime).filter(n => /\.(js|cjs|mjs)$/.test(n))) {
    const text = fs.readFileSync(path.join(source, 'runtime', name), 'utf8');
    for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
  }
  fs.writeFileSync(path.join(packageRoot, 'operations/environment-names.json'), JSON.stringify([...names].sort(), null, 2));
  const files = inventory(packageRoot);
  const releaseId = 'winlew3-' + digest(JSON.stringify(files)).slice(0, 16);
  const manifest = { format: 'winlew-deployment-overlay-v1', releaseId, sourceManifestSha256: trusted,
    mode: 'frontend plus Mole API overlay onto retained existing private runtime; NOT full ecosystem bootstrap',
    entry: 'backend/src/index.js', excluded, files,
    retainedServices: ['faucet', 'faucet-payouts', 'quiz', 'quiz-payouts', 'game-payouts', 'watchdog', 'public', 'ngrok'],
    migration: 'No data migration. Preserve existing data paths, configuration and auxiliary-service code.' };
  fs.writeFileSync(path.join(packageRoot, 'release.json'), JSON.stringify(manifest, null, 2));
  require('./lib.cjs').verify(packageRoot, manifest);
  report = { ...report, ok: true, releaseId, package: path.relative(repo, packageRoot).replaceAll('\\', '/'),
    manifestSha256: digest(fs.readFileSync(path.join(packageRoot, 'release.json'))), files: Object.keys(files).length,
    publicFiles: Object.keys(actualPublic).length - excluded.length, runtimeFiles: Object.keys(actualRuntime).length, excluded,
    historicalFilesUnchanged: Object.keys(checkpoint.historical).length,
    appProcessesStarted: 0, networkRequests: 0 };
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  const after = snapshot(); save('after.json', after); report.protectedChanges = compare(before, after);
  report.protectedFiles = Object.values(after).filter(value => value.kind === 'file').length;
  if (report.protectedChanges.length) { report.ok = false; process.exitCode = 1; }
  save('report.json', report);
  console.log(JSON.stringify({ ...report, evidence: path.relative(repo, output).replaceAll('\\', '/') }));
}
