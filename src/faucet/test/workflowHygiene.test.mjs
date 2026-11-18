import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const lockfilePath = path.join(rootDir, 'package-lock.json');

function gitTracked(paths) {
  try {
    const output = execFileSync('git', ['ls-files', '--', ...paths], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();
    return output ? output.split('\n').filter(Boolean) : [];
  } catch (error) {
    throw new Error(`git ls-files failed: ${error.message}`);
  }
}

test('package-lock.json exists and is tracked', () => {
  assert.equal(fs.existsSync(lockfilePath), true, 'package-lock.json is missing');
  const tracked = gitTracked(['package-lock.json']);
  assert.deepEqual(tracked, ['package-lock.json']);
});

test('no alternate package-manager lockfiles are tracked', () => {
  const tracked = gitTracked(['yarn.lock', '.yarnrc.yml', 'pnpm-lock.yaml', '.yarn']);
  assert.deepEqual(tracked, []);
});

test('packageManager is absent or explicitly npm', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.ok(
    pkg.packageManager == null || String(pkg.packageManager).startsWith('npm'),
    `packageManager must be npm when present, got ${pkg.packageManager}`,
  );
});

test('package-lock metadata matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.['']?.name, pkg.name);
  assert.equal(lock.packages?.['']?.version, pkg.version);
});
