import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStagingConfig } = require('../../mobile/staging-config.cjs');
test('Android staging has a separate app/storage identity and only local origins', () => {
  for (const [mode, host] of [['usb', '127.0.0.1'], ['emulator', '10.0.2.2']]) {
    const config = createStagingConfig(18080, mode);
    assert.equal(config.appId, 'co.winlew.app.staging'); assert.equal(new URL(config.server.url).hostname, host);
    assert.equal(config.server.cleartext, true); assert.equal(config.android.allowMixedContent, false);
    assert.deepEqual(config.server.allowNavigation, [host]);
  }
  const production = JSON.parse(fs.readFileSync('mobile/capacitor.config.json', 'utf8'));
  assert.equal(production.appId, 'co.winlew.app'); assert.equal(production.server.url, 'https://winlew.co/app/'); assert.equal(production.server.cleartext, false);
});
test('Android staging refuses arbitrary URLs, unknown transports and invalid ports', () => {
  for (const port of ['https://winlew.co', 80, 65536, '../.env']) assert.throws(() => createStagingConfig(port));
  assert.throws(() => createStagingConfig(18080, 'production'));
});
test('staging environment never inherits credentials or Node injection', () => {
  const environment = require('../../tools/staging/environment.cjs');
  const env = environment(process.cwd(), process.env.WINLEW_TEST_ROOT);
  assert.equal(env.MONGO_ENABLED, 'false'); assert.equal(env.MONGO_URI, '');
  assert.equal(env.DISCORD_TOKEN, 'isolated-placeholder'); assert.equal(env.FAUCET_PAYOUTS_DRY_RUN, 'true');
  assert.match(env.NODE_OPTIONS, /isolation-guard/); assert.equal(env.HTTP_PROXY, undefined);
});
