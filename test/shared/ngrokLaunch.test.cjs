const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveNgrokLaunch } = require('../../src/shared/ngrokLaunch.cjs');

test('native ngrok executable retains the configured domain and local port', () => {
  const launch = resolveNgrokLaunch({ NGROK_BIN: '/tmp/ngrok', PORT: '8787', PUBLIC_BASE_URL: 'https://example.ngrok-free.dev' });
  assert.equal(launch.command, '/tmp/ngrok');
  assert.deepEqual(launch.args, ['http', '8787', '--url', 'https://example.ngrok-free.dev']);
  assert.equal(launch.enabled, true);
});

test('disabling ngrok still disables the native executable', () => {
  assert.equal(resolveNgrokLaunch({ NGROK_ENABLED: 'false', NGROK_BIN: '/tmp/ngrok' }).enabled, false);
});
