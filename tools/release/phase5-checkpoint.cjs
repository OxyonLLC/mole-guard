'use strict';
// Fixed local candidate verification and source-only rollback checkpoint.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const candidate = '.test-tmp/winlew3-rc-B60Vfn';
const manifest = JSON.parse(fs.readFileSync(path.join(repo, candidate, 'manifest.json')));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [relative, item] of Object.entries(manifest.publicFiles)) {
  if (hash(path.join(repo, candidate, 'public', relative)) !== item.sha256
    || hash(path.join(repo, 'src/public', relative)) !== item.sha256) throw new Error('Initial public candidate discrepancy');
}
for (const [relative, item] of Object.entries(manifest.implementationFiles)) {
  if (hash(path.join(repo, relative)) !== item.sha256) throw new Error('Initial implementation discrepancy');
}
const root = fs.mkdtempSync(path.join(repo, '.test-tmp/phase5-checkpoint-'));
const targets = ['src/public/verify/profile.js', 'src/public/faucet/index.html', 'src/public/quiz/index.html',
  'src/public/.htaccess', 'src/public/_redirects', 'tools/release/package.cjs',
  'tools/test-audit/run.cjs', 'tools/test-audit/policy.cjs', 'tools/test-audit/browsers.cjs'];
const files = {};
for (const relative of targets) {
  const source = path.join(repo, relative), target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
  files[relative] = { sha256: hash(source) };
}
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ candidate,
  branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']),
  status: git(['status', '--short']), publicFilesVerified: Object.keys(manifest.publicFiles).length,
  implementationFilesVerified: Object.keys(manifest.implementationFiles).length, files }, null, 2));
console.log(JSON.stringify({ checkpoint: path.relative(repo, root), publicFilesVerified: Object.keys(manifest.publicFiles).length,
  implementationFilesVerified: Object.keys(manifest.implementationFiles).length }));
