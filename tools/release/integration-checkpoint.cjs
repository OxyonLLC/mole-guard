'use strict';
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(repo, '.test-tmp/integration-checkpoint-'));
const targets = ['tools/test-audit/policy.cjs', 'tools/test-audit/run.cjs', 'tools/release/package.cjs', 'mobile/package.json', 'mobile/capacitor.config.json'];
for (const relative of targets) {
  const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fs.readFileSync(path.join(repo, relative)));
}
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ baseline: '.test-tmp/winlew3-rc-0tmCRv',
  branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']), status: git(['status', '--short']), targets }, null, 2));
console.log(path.relative(repo, root));
