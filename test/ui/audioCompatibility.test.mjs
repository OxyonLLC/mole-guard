import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('src/public/mole-hub/js/app.js', 'utf8');
const soundSource = source.slice(source.indexOf('const Sound = {'), source.indexOf('soundToggle.textContent ='));
function fixture(AudioContext) {
  const context = vm.createContext({ window: { AudioContext }, load: () => true, Storage: { sound: 'synthetic' }, setTimeout: () => {} });
  vm.runInContext(soundSource + '\nglobalThis.fixtureSound = Sound;', context); return context.fixtureSound;
}
test('missing Web Audio never prevents game startup or input sounds', () => {
  const sound = fixture(undefined); sound.enabled = true;
  assert.equal(sound.ensure(), false); assert.doesNotThrow(() => sound.coin()); assert.doesNotThrow(() => sound.hurt());
});
test('unavailable audio device construction never throws into a game engine', () => {
  const sound = fixture(class { constructor() { throw new Error('synthetic audio unavailable'); } }); sound.enabled = true;
  assert.equal(sound.ensure(), false); assert.doesNotThrow(() => sound.blip());
});
test('supported audio retains initialization and oscillator rendering', () => {
  let started = 0;
  const sound = fixture(class { state = 'running'; currentTime = 0; destination = {};
    createOscillator() { return { frequency: {}, connect() {}, start() { started++; }, stop() {} }; }
    createGain() { return { gain: { exponentialRampToValueAtTime() {} }, connect() {} }; }
  }); sound.enabled = true; assert.equal(sound.ensure(), true); sound.blip(); assert.equal(started, 1);
});
