import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWatchdogListenHost } from '../../src/watchdog/listenHost.js';

test('returns explicit host unchanged', () => {
  assert.equal(resolveWatchdogListenHost({ WATCHDOG_HOST: '100.87.240.19' }), '100.87.240.19');
});

test('returns undefined when no host is configured', () => {
  assert.equal(resolveWatchdogListenHost({}), undefined);
});

test('resolves tailscale host from CLI output', () => {
  const host = resolveWatchdogListenHost(
    { WATCHDOG_HOST: 'tailscale' },
    { execFileSync: () => '100.87.240.19\n' }
  );
  assert.equal(host, '100.87.240.19');
});

test('throws a clear error when tailscale is missing', () => {
  assert.throws(
    () => resolveWatchdogListenHost(
      { WATCHDOG_HOST: 'tailscale' },
      { execFileSync: () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } }
    ),
    /requires the `tailscale` CLI/
  );
});

test('throws a clear error when tailscale returns no IPv4', () => {
  assert.throws(
    () => resolveWatchdogListenHost(
      { WATCHDOG_HOST: 'tailscale' },
      { execFileSync: () => '\n' }
    ),
    /resolved no IPv4 address/
  );
});
