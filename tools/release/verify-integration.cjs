'use strict';
// Fixed local package assembly + integrity comparison, never application startup.
if (process.env.WINLEW_TEST_ISOLATED === '1' || process.argv.length !== 2) throw new Error('Standalone fixed release verifier only');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const snapshot = require('../staging/integrity.cjs'), compare = require('../test-audit/compare.cjs');
const repo = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(repo, '.test-tmp/integration-verification-'));
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const phase5Pointer = path.join(repo, '.test-tmp/phase5-final-artifact.json');
const phase5PointerHash = hash(phase5Pointer);
const before = snapshot(); save('before.json', before);
const report = { startedAt: new Date().toISOString(), applicationStarted: false, networkRequests: 0 };
try {
  const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const result = spawnSync(process.execPath, [path.join(__dirname, 'package.cjs'), '--integration'],
    { cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 240000 });
  assert.equal(result.status, 0, 'Fixed package assembly failed');
  const pointer = JSON.parse(fs.readFileSync(path.join(repo, '.test-tmp/integration-final-artifact.json'), 'utf8'));
  assert.match(pointer.candidate, /^\.test-tmp\/winlew3-rc-[A-Za-z0-9]+$/);
  const destination = path.join(repo, pointer.candidate), manifestPath = path.join(destination, 'manifest.json');
  assert.equal(hash(manifestPath), pointer.manifestSha256);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  function verify(prefix, files) {
    for (const [relative, expected] of Object.entries(files)) {
      assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).some(part => part === '..' || part === '.'), 'Manifest path refused');
      const file = path.join(destination, prefix, relative);
      assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
      assert.equal(hash(file), expected.sha256);
    }
    return Object.keys(files).length;
  }
  report.publicFiles = verify('public', manifest.publicFiles);
  report.runtimeFiles = verify('runtime', manifest.runtime.files);
  report.localToolingFiles = verify('local-tooling', manifest.localToolingFiles);
  report.stagingFiles = verify('staging', manifest.staging.files);
  for (const [relative, expected] of Object.entries(manifest.implementationFiles)) {
    assert.equal(hash(path.join(repo, relative)), expected.sha256, 'Implementation changed during package assembly');
  }
  report.implementationCurrent = true;
  assert.ok(!fs.existsSync(path.join(destination, 'public/.tmp-audit')));
  assert.ok(!fs.existsSync(path.join(destination, 'public/.tmp-audit.zip')));
  assert.equal(manifest.android.version, '0.2.1');
  const baseline = JSON.parse(fs.readFileSync(path.join(repo, '.test-tmp/winlew3-rc-0tmCRv/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.android, baseline.android, 'Signed APK and metadata must match the frozen Phase 5 baseline');
  for(const file of ['diglew.js','pac-mole.js','root-glide.js','burrow-blaster.js','grub-drop.js','mole-ice.js','tunnel-tap.js','mole-spades.js']){
    const relative='mole-hub/js/games/'+file;assert.equal(manifest.publicFiles[relative].sha256,baseline.publicFiles[relative].sha256,'Game engine changed');
  }
  report.allEightEnginesUnchanged=true;
  report.android = manifest.android;
  report.historicalFilesUnchanged = manifest.historicalFilesUnchanged;
  report.candidate = pointer.candidate; report.manifestSha256 = pointer.manifestSha256;
} catch (error) { report.error = error.code || error.name; }
finally {
  try {
    const after = snapshot(); save('after.json', after);
    report.differences = compare(before, after);
    report.protectedFiles = Object.values(after).filter(row => row.kind === 'file').length;
    report.protectedIntegrity = report.differences.length ? 'changed' : 'unchanged';
    assert.equal(hash(phase5Pointer), phase5PointerHash, 'Phase 5 pointer changed');
    report.phase5PointerUnchanged = true;
  } catch (error) { report.auditError = error.code || error.name; report.protectedIntegrity = 'failed'; }
  report.finishedAt = new Date().toISOString();
  report.ok = !report.error && !report.auditError && report.protectedIntegrity === 'unchanged';
  save('report.json', report);
  console.log(`Integration artifact ${report.ok ? 'PASS' : 'STOP'}; report=${path.relative(repo, root)}/report.json`);
  if (!report.ok) process.exitCode = 1;
}
