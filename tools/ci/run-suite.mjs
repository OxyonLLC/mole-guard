#!/usr/bin/env node
// `npm run test:ci`: the same files as `npm test`, minus the files of the
// supervised stages CI runs in its own "Isolated tests" job
// (tools/ci/isolated-stages.json). Those tests need the supervisor (disposable
// root, isolation guard, supervised browsers) and fail by design under a plain
// `node --test`; running them here only produced known-failure noise.
//
// Coverage is not reduced: workflowHygiene asserts that every excluded file
// belongs to a stage the Isolated job's matrix runs, and that this runner's
// patterns are exactly npm test's.
//
// Patterns are expanded the way `npm test` expands them on the CI runner
// (POSIX sh, where `**` matches one directory level), so the file set is
// identical to `npm test` in CI.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, globSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

export const PATTERNS = ['src/xl1-arcade/*.test.js', 'src/xl1-connect/*.test.js', 'src/xl1-faucet/*.test.js', 'test/**/*.test.cjs', 'test/**/*.test.mjs', 'src/faucet/test/**/*.test.mjs'];

export function isolatedStages() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'tools/ci/isolated-stages.json'), 'utf8')).stages;
}

export function excludedFiles(stages = isolatedStages()) {
  const { stages: established } = require('../test-audit/policy.cjs');
  const all = { ...established, ...require('../test-audit/deployment-policy.cjs') };
  const out = new Set();
  for (const s of stages) {
    if (!all[s]) throw new Error(`unknown supervised stage ${s}`);
    for (const f of all[s]) out.add(f);
  }
  return out;
}

export function expand(patterns = PATTERNS) {
  if (process.platform !== 'win32') {
    // The patterns must be UNQUOTED words for sh to glob them (passing them as
    // "$@" arguments left them literal and matched nothing). They are the
    // constants above, never input, so there is nothing to inject.
    if (!patterns.every((p) => /^[A-Za-z0-9_./*-]+$/.test(p))) throw new Error('unexpected characters in a test pattern');
    const out = execFileSync('sh', ['-c', `for f in ${patterns.join(' ')}; do [ -e "$f" ] && printf '%s\\n' "$f"; done; true`], { cwd: repoRoot, encoding: 'utf8' });
    // sh leaves an unmatched pattern as-is; the [ -e ] test above drops it.
    return [...new Set(out.split('\n').filter(Boolean))];
  }
  return [...new Set(patterns.flatMap((p) => globSync(p, { cwd: repoRoot })).map((f) => f.replace(/\\/g, '/')))];
}

export function suiteFiles() {
  const skip = excludedFiles();
  return expand().filter((f) => !skip.has(f));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = suiteFiles();
  console.log(`test:ci: ${files.length} files (${excludedFiles().size} run in the Isolated job: stages ${isolatedStages().join(', ')})`);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=./tools/ci/results-reporter.mjs', '--test-reporter-destination=test-results.jsonl', ...files], { cwd: repoRoot, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
