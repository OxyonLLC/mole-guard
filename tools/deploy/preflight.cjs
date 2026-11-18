'use strict';
// Read-only, offline CLI. Root must be the deployment package, never app data.
const fs = require('node:fs'), path = require('node:path');
const { verify, preflight, digest } = require('./lib.cjs');
if (require.main !== module) throw new Error('Standalone preflight only');
if (process.argv.length !== 5) throw new Error('Usage: node preflight.cjs RELEASE_ROOT HOST_PLAN.json EXPECTED_MANIFEST_SHA256');
const root = path.resolve(process.argv[2]);
const bytes = fs.readFileSync(path.join(root, 'release.json'));
if (!/^[a-f0-9]{64}$/.test(process.argv[4]) || digest(bytes) !== process.argv[4]) throw new Error('Trusted manifest hash discrepancy');
const manifest = JSON.parse(bytes);
const integrity = verify(root, manifest);
const host = preflight(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
console.log(JSON.stringify({ integrity, host }, null, 2));
if (!host.ready) process.exitCode = 1;
