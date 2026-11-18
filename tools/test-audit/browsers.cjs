'use strict';
// Fixed browser tooling owned by the independent supervisor. Guarded tests
// connect over loopback; they never receive a subprocess exception.
if (process.env.WINLEW_TEST_ISOLATED === '1') throw new Error('Supervisor-only browser tooling');
const path = require('node:path');
const fs = require('node:fs');
const { chromium, firefox, webkit } = require('playwright');
module.exports = async function browsers(reportDir) {
  const directory = path.join(reportDir, 'browser-runtime');
  fs.mkdirSync(directory);
  // Chromium (chrome, msedge) creates a unix socket (SingletonSocket) under
  // TMPDIR inside its profile directory, and unix socket paths are limited to
  // 107 bytes. Under a deep checkout (/home/runner/work/<repo>/<repo>/.test-tmp/
  // audit-X-…/browser-runtime/playwright_chromiumdev_profile-…/SingletonSocket)
  // that limit is exceeded and the launch fails with "session closed", which left
  // every supervised browser stage without chrome on Linux CI. Windows uses named
  // pipes, so it keeps the in-repo directory; elsewhere a short disposable
  // directory under the OS temp dir is used and removed on close.
  const runtime = process.platform === 'win32' ? directory : fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wlb-'));
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { TEMP: runtime, TMP: runtime, TMPDIR: runtime });
  const servers = [], entries = [];
  const configurations = [
    ['chrome', chromium, { channel: 'chrome' }], ['edge', chromium, { channel: 'msedge' }],
    ['firefox', firefox, { firefoxUserPrefs: { 'app.update.enabled': false, 'toolkit.telemetry.enabled': false, 'network.prefetch-next': false } }],
    ['webkit', webkit, {}],
  ];
  for (const [name, type, options] of configurations) {
    try {
      const server = await type.launchServer({ ...options, headless: true, env, host: '127.0.0.1', timeout: 20000 });
      servers.push(server); entries.push({ name, type: type.name(), endpoint: server.wsEndpoint() });
    } catch (error) { entries.push({ name, unavailable: true, reason: error.name }); }
  }
  return { entries, close: async () => {
    try {
      for (const server of servers) await server.close();
    } finally {
      // Removed even when a server fails to close (the caller still reports
      // BrowserCleanupFailed), so no /tmp/wlb-* directory is left behind.
      if (runtime !== directory) fs.rmSync(runtime, { recursive: true, force: true });
    }
  } };
};
