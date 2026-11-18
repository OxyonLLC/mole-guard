import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import assembleRuntime from '../../tools/release/runtime.cjs';
const destination = path.join(process.env.WINLEW_TEST_ROOT, 'assembly');
fs.mkdirSync(destination);
const result = assembleRuntime(path.resolve('.'), destination);
test('static runtime assembly includes extensionless CommonJS quiz dependencies', () => {
  for (const name of ['db', 'payout-config', 'platform-stats', 'storage', 'wallets']) assert.ok(result.files[`src/quiz/${name}.js`], name);
  assert.deepEqual(result.resourceReferences, []);
});
test('runtime preserves quiz package type and resolves modules without executing them', () => {
  const marker = JSON.parse(fs.readFileSync(path.join(destination, 'runtime/src/quiz/package.json'), 'utf8'));
  assert.equal(marker.type, 'commonjs');
  const require = createRequire(path.join(destination, 'runtime/src/mole/web.js'));
  for (const name of ['db', 'payout-config', 'platform-stats', 'storage', 'wallets']) assert.equal(require.resolve(`../quiz/${name}`), path.join(destination, 'runtime/src/quiz', name + '.js'));
});

test('direct createRequire(import.meta.url) literal dependencies are packaged without execution', () => {
  const relative='src/shared/solanaRpcFetch.cjs';assert.ok(result.files[relative]);
  const require=createRequire(path.join(destination,'runtime/src/faucet/walletLinkage.js'));
  assert.equal(require.resolve('../shared/solanaRpcFetch.cjs'),path.join(destination,'runtime',relative));
});
test('every assembled source and lockfile matches its recorded SHA-256', () => {
  for (const [relative, item] of Object.entries(result.files)) {
    const bytes = fs.readFileSync(path.join(destination, 'runtime', relative));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, relative);
  }
});
test('runtime assembly has no credentials, member stores or application execution', () => {
  assert.equal(result.entry, 'src/index.js');
  for (const relative of Object.keys(result.files)) {
    assert.ok(/\.(?:js|cjs|mjs)$/.test(relative) || relative.endsWith('package.json') || relative === 'package-lock.json');
    assert.ok(!/(?:^|\/)(?:\.env|data|node_modules)(?:\/|$)/.test(relative));
  }
});
