import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import lib from '../../tools/deploy/lib.cjs';
import { startLocalStaging } from '../support/localStaging.mjs';
import { createLocalGateway } from '../../tools/staging/gateway.mjs';
import smokeModule from '../../tools/deploy/smoke.cjs';

test('release paths reject traversal, absolute and Windows aliases', () => {
  for (const value of ['../data/db.json', '/etc/passwd', 'C:/data', 'public/../data', 'public\\file', 'public//file']) assert.throws(() => lib.relativePath(value));
  assert.equal(lib.relativePath('public/app/index.html'), 'public/app/index.html');
});
test('fixed package inventory detects changes, additions and removals without application imports', () => {
  const root = path.join(process.env.WINLEW_TEST_ROOT, 'deploy-fixture'); fs.mkdirSync(root);
  const file = path.join(root, 'asset.txt'); fs.writeFileSync(file, 'synthetic');
  const first = lib.inventory(root); fs.writeFileSync(file, 'changed'); assert.notDeepEqual(lib.inventory(root), first);
  fs.writeFileSync(path.join(root, 'extra.txt'), 'extra'); assert.equal(Object.keys(lib.inventory(root)).length, 2);
  fs.unlinkSync(file); assert.equal(Object.hasOwn(lib.inventory(root), 'asset.txt'), false);
});
test('preflight fails closed on template, test bypass flag and unverified gates', () => {
  const plan = JSON.parse(fs.readFileSync('tools/deploy/host-plan.example.json', 'utf8'));
  assert.equal(lib.preflight(plan).ready, false);
  const reviewed = { ...plan, moleUpstream: 'https://api.host.test', geoHackersUpstream: 'https://geohackers.host.test', geoAgoraUpstream: 'https://geoagora.host.test/api', gates: Object.fromEntries(lib.requiredGates.map(k => [k, true])) };
  assert.equal(lib.preflight(reviewed).ready, true);
  assert.equal(lib.preflight({ ...reviewed, testIsolationFlagPresent: true }).ready, false);
  assert.equal(lib.preflight({ ...reviewed, activatePayoutWorkers: true }).ready, false);
  assert.equal(lib.preflight({ ...reviewed, moleUpstream: 'https://user:secret@api.host.test' }).ready, false);
});
test('deployment controls preserve PHP, Node, Android and separate private data boundaries', () => {
  const build = fs.readFileSync('tools/deploy/build.cjs', 'utf8');
  assert.match(build, /backend\/src\/public/); assert.match(build, /future\/lab\/probe.php/);
  const php = fs.readFileSync('tools/deploy/host-check.php', 'utf8');
  assert.match(php, /PHP_SAPI !== 'cli'/); assert.doesNotMatch(php, /curl_exec|include|require|file_get_contents/);
  const template = fs.readFileSync('tools/deploy/hosting.env.example', 'utf8');
  assert.match(template, /GEOAGORA_API_BASE=/); assert.match(template, /FAUCET_DATA_DIR/);
  assert.match(fs.readFileSync('tools/deploy/apache-deny.conf', 'utf8'), /Require all denied/);
});
test('release read-only smoke rejects external origins without making requests', async () => {
  for (const origin of ['https://evil.test', 'http://winlew.co', 'http://127.0.0.1:42/path', 'https://user:secret@winlew.co']) {
    await assert.rejects(smokeModule.smoke(origin, () => { throw new Error('must not connect'); }), /Unapproved smoke origin/);
  }
});
test('deployment routes, Android metadata and private-path denies match actual isolated backend', async t => {
  const staging = await startLocalStaging(t);
  const gateway = await createLocalGateway(staging);
  t.after(() => gateway.close());
  const result = await smokeModule.smoke(gateway.base);
  assert.deepEqual(result.results.filter(row => !row.ok), []);
  const privateProfile = await fetch(gateway.base + '/verify/api-proxy.php?path=/api/profile/me');
  assert.equal(privateProfile.status, 401);
  await privateProfile.body?.cancel();
  assert.deepEqual(staging.evidence.unexpectedRpc, []);
});
