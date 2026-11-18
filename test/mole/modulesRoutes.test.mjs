// GET /api/modules/status — HTTP-level test. Starts the real server
// (src/mole/web.js's startWeb()) against an isolated scratch DATA_DIR and
// MONGO_ENABLED=false so this never touches real data or the live Mongo
// cluster — this route is pure static data anyway, but the isolation
// discipline is kept consistent with every other route test in this repo.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-route-test-'));
process.env.DATA_DIR = scratchDataDir;
process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;
process.env.PUBLIC_HOST = '127.0.0.1';
const PORT = 8796;
process.env.PUBLIC_PORT = String(PORT);
process.env.PORT = String(PORT);

import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES, ROADMAP_PHASES } from '../../src/mole/modulesData.js';

const BASE = `http://127.0.0.1:${PORT}`;
let web;

before(async () => {
  web = await import('../../src/mole/web.js');
  await web.startWeb();
  await new Promise((r) => setTimeout(r, 400));
});

after(() => {
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  // startWeb()'s listening server keeps the event loop alive forever — see
  // the identical comment in governanceSubmissionsRoutes.test.mjs.
  setImmediate(() => process.exit(0));
});

describe('GET /api/modules/status', () => {
  test('returns 200 with ok:true and the full registry payload', async () => {
    const res = await fetch(`${BASE}/api/modules/status`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.registryVersion);
    assert.ok(body.generatedAt);
    assert.equal(body.modules.length, MODULES.length);
    assert.equal(body.roadmapPhases.length, ROADMAP_PHASES.length);
    assert.ok(body.countsByStatus);
  });

  test('never leaks a raw local filesystem path', async () => {
    const res = await fetch(`${BASE}/api/modules/status`);
    const text = await res.text();
    assert.doesNotMatch(text, /\/home\/|\/Users\/|C:\\\\/);
  });

  test('is unauthenticated (public, read-only) — no session required', async () => {
    const res = await fetch(`${BASE}/api/modules/status`);
    assert.equal(res.status, 200);
  });

  test('Governance appears as live in the live HTTP response', async () => {
    const res = await fetch(`${BASE}/api/modules/status`);
    const body = await res.json();
    const governance = body.modules.find((m) => m.id === 'governance');
    assert.ok(governance);
    assert.equal(governance.status, 'live');
  });

  test('every module with a live status has a resolvable route field (non-empty string)', async () => {
    const res = await fetch(`${BASE}/api/modules/status`);
    const body = await res.json();
    for (const m of body.modules) {
      if (m.status === 'live') {
        assert.ok(m.route && typeof m.route === 'string' && m.route.length > 0, `${m.id} is live but has no route`);
      }
    }
  });

  test('rate limiting is applied to this route like every other public status route', async () => {
    const results = [];
    for (let i = 0; i < 45; i += 1) {
      const res = await fetch(`${BASE}/api/modules/status`);
      results.push(res.status);
    }
    assert.ok(results.includes(429), `expected at least one 429 among ${results.length} rapid requests`);
  });
});
