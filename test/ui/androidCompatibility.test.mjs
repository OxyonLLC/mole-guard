import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
const app = fs.readFileSync('src/public/app/index.html', 'utf8');
const latest = JSON.parse(fs.readFileSync('src/public/jdid93hf8dh/latest.json', 'utf8'));
test('existing Android package matches published integrity metadata', () => {
  assert.equal(latest.version, '0.2.1'); assert.equal(latest.build, 201);
  assert.equal(latest.url, '/jdid93hf8dh/winlew-beta-0.2.1.apk');
  const bytes = fs.readFileSync('src/public' + latest.url);
  assert.equal(bytes.length, 25840435);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), latest.sha256);
  const download = fs.readFileSync('src/public/jdid93hf8dh/index.html', 'utf8');
  assert.ok(download.includes(latest.url)); assert.ok(download.includes(latest.sha256));
  assert.match(download, /noindex,nofollow,noarchive/);
});
test('3.0 keeps app discovery and native entry route without replacing the beta', () => {
  assert.match(fs.readFileSync('src/public/index.html', 'utf8'), /href="\/app\/"/);
  const build = fs.readFileSync('src/public/build/index.html', 'utf8');
  assert.match(build, /href="\/app\/"/); assert.match(build, /href="\/jdid93hf8dh\/"/);
  assert.match(app, /completeNativeHandoff/); assert.match(app, /href="\/jdid93hf8dh\/"/);
  const config = JSON.parse(fs.readFileSync('mobile/capacitor.config.json', 'utf8'));
  // 1.0.1+: the app starts at /app/start/ (welcome + 18+ confirmation), which then opens /app/.
  assert.ok(['/app', '/app/start'].includes(new URL(config.server.url).pathname.replace(/\/$/, '')), config.server.url);
});
const updater = app.slice(app.indexOf('async function checkForUpdate()'), app.indexOf('async function finishHandoff('));
async function updateFixture(build, native = true) {
  const calls = []; const elements = {};
  const element = id => elements[id] ||= { attributes: {}, classList: { remove: value => calls.push(['show', value]) }, setAttribute: (key, value) => elements[id].attributes[key] = value };
  const context = { window: { Capacitor: native ? { Plugins: { App: { getInfo: async () => ({ build, version: 'synthetic' }) }, Browser: { open: async value => calls.push(['open', value.url]) } } } : undefined },
    location: { origin: 'http://127.0.0.1:12345' }, URL, $: element,
    fetch: async (url, options) => { calls.push(['fetch', url, options.cache]); return { ok: true, json: async () => latest }; } };
  await vm.runInNewContext(updater + '\ncheckForUpdate();', context);
  return { calls, elements };
}
test('older native build offers existing local APK through explicit browser handoff', async () => {
  const fixture = await updateFixture(200);
  assert.equal(fixture.elements.btnUpdate.attributes.href, 'http://127.0.0.1:12345' + latest.url);
  let prevented = false; fixture.elements.btnUpdate.onclick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(fixture.calls.at(-1)[0], 'open');
  assert.equal(fixture.calls.at(-1)[1], 'http://127.0.0.1:12345' + latest.url);
});
test('current native build has no update banner; ordinary browser makes no update request', async () => {
  const current = await updateFixture(201); assert.equal(current.elements.btnUpdate, undefined);
  assert.equal(current.calls.length, 1);
  assert.deepEqual((await updateFixture(0, false)).calls, []);
});
