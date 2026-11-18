'use strict';
// Local rollback checkpoint. Explicit source allowlist; never copies credentials
// or application stores. Historical audit artifacts are fingerprinted only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const targets = ['src/public/index.html', 'src/public/assets/nav.js',
  'src/public/assets/nav.css', 'src/public/.htaccess', 'src/public/_redirects',
  'src/public/sitemap.xml', 'src/public/mole-hub/index.html',
  'src/mole/web.js', 'tools/test-audit/policy.cjs',
  'test/mole/approvalAReconstructed.test.mjs'];
const destination = fs.mkdtempSync(path.join(repo, '.test-tmp', 'completion-checkpoint-'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = { createdAt: new Date().toISOString(), branch: execFileSync('git', ['branch', '--show-current'], { cwd: repo }).toString().trim(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(),
  status: execFileSync('git', ['status', '--porcelain=v1'], { cwd: repo }).toString(), files: {}, historical: {} };
for (const relative of targets) {
  const file = path.join(repo, relative);
  manifest.files[relative] = { sha256: hash(file) };
  const backup = path.join(destination, relative);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(file, backup);
}
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Historical link requires review');
    if (entry.isDirectory()) inventory(file);
    else if (entry.isFile()) manifest.historical[path.relative(repo, file).replaceAll('\\', '/')] = hash(file);
  }
}
inventory(path.join(repo, 'src/public/.tmp-audit'));
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(path.relative(repo, destination));
