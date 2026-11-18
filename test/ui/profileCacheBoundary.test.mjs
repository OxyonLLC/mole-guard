import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('src/public/verify/profile.js', 'utf8');
function fixture() {
  const values = new Map(); const state = { app: 'mole', session: 'synthetic-A', wallet: 'synthetic-wallet-A', public: false };
  const context = vm.createContext({ getAuth: () => state, isPublicView: () => state.public,
    ProfileStore: { cache: 'cache', draft: 'draft' }, localStorage: { setItem: (k, v) => values.set(k, v), getItem: k => values.get(k), removeItem: k => values.delete(k) } });
  vm.runInContext(source.slice(source.indexOf('function saveDraft('), source.indexOf('function persistWalletSnapshot(')), context);
  return { state, values, save: value => context.saveProfileCache(value), load: () => context.loadProfileCache(),
    saveDraft: value => context.saveDraft(value), loadDraft: () => context.loadDraft() };
}
test('same synthetic session can use its clearly labelled offline profile snapshot', () => {
  const h = fixture(); h.save({ profile: { displayName: 'Synthetic A' } }); assert.equal(h.load().profile.displayName, 'Synthetic A');
});
test('account switch cannot recover another account private snapshot', () => {
  const h = fixture(); h.save({ profile: { displayName: 'Synthetic A' } }); h.state.session = 'synthetic-B'; assert.equal(h.load(), null);
});
test('expired or disconnected session cannot recover private snapshot', () => {
  const h = fixture(); h.save({ profile: { displayName: 'Synthetic A' } }); h.state.session = ''; assert.equal(h.load(), null);
  h.save({ profile: {} }); assert.equal(h.values.has('cache'), false);
});
test('public-wallet and private-session cache scopes cannot cross', () => {
  const h = fixture(); h.save({ profile: { displayName: 'Synthetic A' } }); h.state.public = true; assert.equal(h.load(), null);
  h.save({ profile: { displayName: 'Public A' } }); assert.equal(h.load().profile.displayName, 'Public A');
  h.state.wallet = 'synthetic-wallet-B'; assert.equal(h.load(), null);
});
test('legacy unscoped profile snapshots are not accepted as identity evidence', () => {
  const h = fixture(); h.values.set('cache', JSON.stringify({ profile: { displayName: 'Unscoped synthetic' } })); assert.equal(h.load(), null);
});
test('private profile drafts cannot cross account switches or logout', () => {
  const h = fixture(); h.saveDraft({ displayName: 'Draft A' }); assert.equal(h.loadDraft().displayName, 'Draft A');
  h.state.session = 'synthetic-B'; assert.equal(h.loadDraft().displayName, undefined);
  h.state.session = ''; assert.equal(h.loadDraft().displayName, undefined);
});
test('guest device drafts remain usable without importing legacy unscoped drafts', () => {
  const h = fixture(); h.state.session = ''; h.saveDraft({ displayName: 'Guest draft' }); assert.equal(h.loadDraft().displayName, 'Guest draft');
  h.values.set('draft', JSON.stringify({ displayName: 'Legacy draft' })); assert.equal(h.loadDraft().displayName, undefined);
});
