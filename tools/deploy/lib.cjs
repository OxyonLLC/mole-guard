'use strict';
// Pure release verification. No application imports, environment-file reads,
// process launches, network access or deployment operations.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function relativePath(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':')
    || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe release path');
  return relative;
}
function inventory(root) {
  root = path.resolve(root);
  let ancestor = path.parse(root).root;
  for (const part of path.relative(ancestor, root).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Release link refused');
  }
  const result = Object.create(null);
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = relativePath(prefix + name), file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Release link refused');
      if (stat.isDirectory()) walk(file, rel + '/');
      else if (stat.isFile()) result[rel] = { bytes: stat.size, sha256: digest(fs.readFileSync(file)) };
      else throw new Error('Unexpected release entry');
    }
  }
  walk(root); return result;
}
function verify(root, manifest) {
  if (manifest.format !== 'winlew-deployment-overlay-v1') throw new Error('Unknown release format');
  const actual = inventory(root); delete actual['release.json'];
  for (const name of Object.keys(manifest.files)) relativePath(name);
  if (Object.keys(actual).length !== Object.keys(manifest.files).length
    || Object.entries(actual).some(([name, value]) => value.bytes !== manifest.files[name]?.bytes
      || value.sha256 !== manifest.files[name]?.sha256)) throw new Error('Release inventory/hash discrepancy');
  const apk = actual['public/jdid93hf8dh/winlew-beta-0.2.1.apk'];
  if (apk?.sha256 !== 'cbe67a8de3f14a4dadde8019db24e30e052be94ae618ed2dd32a1a7d891d10d7') throw new Error('APK discrepancy');
  return { files: Object.keys(actual).length, releaseId: manifest.releaseId, verified: true };
}
const requiredGates = Object.freeze(['apachePhpCurl', 'pathInfo', 'httpsCertificate', 'outboundUpstreams',
  'cacheAndDenyRules', 'existingRuntimeBaseline', 'retainedAuxiliaryServices', 'persistentPathsPreserved',
  'consistentBackup', 'rollbackRehearsed', 'privateEnvironmentInstalled', 'proxySecretsMatch',
  'singleWriterTopology', 'providerAcceptance', 'androidDeviceAcceptance', 'manualAccessibility']);
function preflight(plan) {
  const blockers = [];
  if (plan.architecture !== 'apache-php-plus-existing-node') blockers.push('architecture');
  for (const key of ['siteOrigin', 'moleUpstream', 'geoHackersUpstream', 'geoAgoraUpstream']) {
    try { const u = new URL(plan[key]); if (u.protocol !== 'https:' || u.username || u.password
      || u.search || u.hash || /(?:example|invalid|REPLACE)/i.test(u.hostname)) throw new Error(); }
    catch { blockers.push(key); }
  }
  if (plan.nodeMajor !== 22) blockers.push('nodeMajor: locally verified major is 22');
  if (plan.testIsolationFlagPresent !== false) blockers.push('remove test-only isolation flag');
  if (plan.activatePayoutWorkers !== false) blockers.push('release must not activate payout workers');
  for (const gate of requiredGates) if (plan.gates?.[gate] !== true) blockers.push(gate);
  return { ready: blockers.length === 0, blockers };
}
module.exports = { digest, relativePath, inventory, verify, preflight, requiredGates };
