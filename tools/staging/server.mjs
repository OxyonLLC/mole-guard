// Guard-preloaded staging child. Never imports src/index.js, bots or workers.
import assert from 'node:assert/strict';
import { startLocalStaging } from '../../test/support/localStaging.mjs';
import { createLocalGateway } from './gateway.mjs';
assert.equal(process.env.WINLEW_TEST_ISOLATED, '1');
assert.equal(process.env.WINLEW_TEST_FILE, 'tools/staging/server.mjs');
const cleanup = [];
const t = { after: callback => cleanup.push(callback), mock: { method(object, key, replacement) {
  const original = object[key]; object[key] = replacement;
  return { mock: { restore() { object[key] = original; } } };
} } };
const staging = await startLocalStaging(t, { funded: true });
const gateway = await createLocalGateway(staging);
process.send?.({ event: 'ready', base: gateway.base });
let closing = false;
process.on('message', async message => {
  if (message !== 'shutdown' || closing) return; closing = true;
  await gateway.close();
  for (const callback of cleanup.reverse()) await callback();
  process.disconnect?.();
});
