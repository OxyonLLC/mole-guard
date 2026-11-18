import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script = fs.readFileSync('src/public/assets/homepage-data.js', 'utf8');
function harness(payload, { hostname = '127.0.0.1', fail = false, hang = false } = {}) {
  const calls = [];
  const window = { location: { hostname, origin: `http://${hostname}` } };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (hang) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('test deadline'), { name: 'AbortError' }))));
    if (fail) throw new Error('synthetic offline');
    return { ok: true, status: 200, json: async () => payload };
  };
  vm.runInNewContext(script, { window, fetch, URL, AbortController, setTimeout, clearTimeout });
  return { data: window.WinLEW3AData, calls };
}
test('homepage reads coalesce and omit account credentials', async () => {
  const h = harness({ ok: true, schemaVersion: 1, items: { price: { state: 'live', priceUsd: 0, liquidityUsd: 0 } } });
  const results = await Promise.all(Array.from({ length: 9 }, () => h.data.read('price')));
  assert.ok(results.every(result => result.ok && result.data.priceUsd === 0));
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/api/homepage/summary');
  assert.equal(h.calls[0].options.method, 'GET'); assert.equal(h.calls[0].options.credentials, 'omit');
});
test('malformed live items never become invented zeros or huge arrays', async () => {
  for (const [name, fields] of [['price', { priceUsd: null, liquidityUsd: 0 }], ['modules', { visibleCount: 1e9, liveCount: 1 }], ['events', {}], ['health', { totalCount: 3, reachableCount: 4 }]]) {
    const h = harness({ ok: true, schemaVersion: 1, items: { [name]: { state: 'live', ...fields } } });
    assert.equal((await h.data.read(name)).ok, false);
  }
});
test('stale source metadata stays stale; invalid source timestamp remains absent', async () => {
  const h = harness({ ok: true, schemaVersion: 1, items: { price: { state: 'stale', priceUsd: .1, liquidityUsd: 2, sourceAt: 'invalid' } } });
  const result = await h.data.read('price'); assert.equal(result.state, 'stale'); assert.equal(result.sourceTimestamp, null);
});
test('offline and timeout failures issue no legacy-source fallback', async () => {
  for (const options of [{ fail: true }, { hang: true }]) {
    const h = harness(null, options); assert.equal((await h.data.read('price', { timeoutMs: 10 })).ok, false);
    assert.equal(h.calls.length, 1);
  }
});
test('unconfigured preview origins never contact production', async () => {
  const h = harness(null, { hostname: 'preview.invalid' });
  assert.equal((await h.data.read('price')).ok, false); assert.equal(h.calls.length, 0);
});
