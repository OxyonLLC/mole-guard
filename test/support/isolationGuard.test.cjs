'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const compare = require('../../tools/test-audit/compare.cjs');

const root = path.resolve(process.env.WINLEW_TEST_ROOT || '');

test('allows writes only inside the configured disposable root', () => {
  const file = path.join(root, 'guard-self-test', 'ok.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'ok');
  assert.equal(fs.readFileSync(file, 'utf8'), 'ok');
  assert.throws(() => fs.writeFileSync(path.resolve('guard-escape.txt'), 'no'), /blocked write outside disposable root/);
});

test('blocks protected persistent and credential reads', () => {
  assert.throws(() => fs.existsSync(path.resolve('src/faucet/.env')), /blocked protected read/);
  assert.throws(() => fs.readFileSync(path.resolve('src/faucet/.env.bak-20260801-221118')), /blocked protected read/);
  assert.throws(() => fs.readFileSync(path.resolve('src/faucet/wallet_bans.json')), /blocked protected read/);
  for (const file of [
    'src/quiz/data/db.json', 'data/profile_prefs.json', 'data/sessions.json',
    'src/data/linked_wallets.json', 'src/faucet/data/claims_v3.json',
  ]) assert.throws(() => fs.readFileSync(path.resolve(file)), /blocked protected read/);
});

test('allows the verified MIME dependency database and unrelated lookalike names', () => {
  const mimeDb = require.resolve('mime-db/db.json');
  const mimeTypes = JSON.parse(fs.readFileSync(mimeDb, 'utf8'));
  assert.ok(mimeTypes['application/json']);
  const lookalike = path.join(root, 'lookalike-data');
  fs.mkdirSync(lookalike, { recursive: true });
  for (const name of ['db.json', 'claims_v3.json', 'profile_prefs.json', 'wallet_bans.json']) {
    const file = path.join(lookalike, name);
    fs.writeFileSync(file, '{}');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')) !== null, true);
  }
});

test('blocks traversal and symlink aliases to protected application data', () => {
  const protectedFile = path.resolve('src/quiz/data/db.json');
  const traversal = path.join(root, '..', '..', '..', 'src', 'quiz', 'data', 'db.json');
  assert.throws(() => fs.readFileSync(traversal), /blocked protected read/);

  const alias = path.join(root, 'quiz-data-alias');
  fs.symlinkSync(path.resolve('src/quiz/data'), alias, 'junction');
  assert.throws(() => fs.readFileSync(path.join(alias, 'db.json')), /blocked protected read/);
  assert.throws(() => fs.writeFileSync(path.join(alias, 'db.json'), '{}'), /blocked write outside disposable root/);
  assert.throws(() => fs.writeFileSync(path.join(alias, 'new-subdirectory', 'new-store.json'), '{}'), /blocked write outside disposable root/);
  assert.notEqual(protectedFile, alias);
});

test('blocks non-localhost network connections', () => {
  assert.throws(() => net.connect({ host: 'example.com', port: 443 }), /blocked non-local network connection/);
});

test('blocks unapproved child processes', () => {
  assert.throws(() => spawnSync(process.execPath, ['-e', '0']), /blocked unapproved child process/);
});

test('integrity comparison detects content, additions, removals and metadata changes', () => {
  const file = { kind: 'file', sha256: 'a', size: 1, mtimeMs: 1, mode: 1 };
  const before = { unchanged: file, edited: file, removed: file,
    absent: { kind: 'missing' }, metadata: file, stillMissing: { kind: 'missing' } };
  const after = { unchanged: { ...file }, edited: { ...file, sha256: 'b' },
    absent: file, metadata: { ...file, mtimeMs: 2 }, stillMissing: { kind: 'missing' } };
  assert.deepEqual(compare(before, after), [
    { file: 'absent', change: 'added' }, { file: 'edited', change: 'changed' },
    { file: 'metadata', change: 'changed' }, { file: 'removed', change: 'removed' },
  ]);
});

test('auditor cannot be imported as a protected-read API', () => {
  assert.throws(() => require('../../tools/test-audit/run.cjs'), /standalone supervisor/);
});
