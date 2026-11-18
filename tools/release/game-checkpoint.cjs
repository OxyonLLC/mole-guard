'use strict';
// Read source + git metadata; write only a new disposable checkpoint.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(repo, '.test-tmp/game-checkpoint-'));
const targets = ['tools/test-audit/policy.cjs', 'tools/test-audit/run.cjs', 'tools/release/package.cjs',
  'tools/release/verify-integration.cjs', 'tools/staging/server.mjs', 'tools/staging/README.md',
  'docs/winlew-3-integration-progress.md', 'test/support/localStaging.mjs',
  'src/public/mole-hub/js/app.js', 'src/public/mole-hub/index.html',
  'src/public/faucet/js/app.js', 'src/public/faucet/index.html',
  'src/public/verify/profile.js', 'src/public/verify/profile.html',
  'tools/release/runtime.cjs', 'test/mole/runtimeAssembly.test.mjs'];
const hashes = {};
for (const relative of targets) {
  const bytes = fs.readFileSync(path.join(repo, relative)), target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  hashes[relative] = crypto.createHash('sha256').update(bytes).digest('hex');
}
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ baseline: '.test-tmp/winlew3-rc-t0dwsj',
  branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']), status: git(['status', '--short']), hashes }, null, 2));
console.log(path.relative(repo, root));
