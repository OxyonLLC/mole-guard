import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class FakeElement {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function loadRules() {
  const source = fs.readFileSync(new URL('../../src/public/mole-hub/js/games/mole-spades.js', import.meta.url), 'utf8');
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  const memory = new Map();
  const localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  const context = { window: { WinLEWGameFactories: {} }, console };
  vm.runInNewContext(source, context, { filename: 'mole-spades.js' });
  const deps = {
    $: getElement,
    Storage: { moleSpadesState: 'meta', moleSpadesSession: 'session' },
    views: { molespades: getElement('view') },
    load: (key, fallback) => memory.has(key) ? JSON.parse(memory.get(key)) : fallback,
    save: (key, value) => memory.set(key, JSON.stringify(value)),
    localStorage,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    hideRewardOverlay() {}, showRewardOverlay() {}, showView() {},
    balanceGameReward: (_game, value) => value,
    buildRewardBoxes: () => [], addWallet: () => 0, postRewardClaim: () => Promise.resolve(),
    reconcileClaimResult: (_optimisticPayout, claimPromise) => claimPromise,
    Sound: { blip() {}, coin() {} },
    setTimeout: () => 0, clearTimeout() {}, Math, Date,
  };
  return context.window.WinLEWGameFactories.molespades(deps).__test;
}

test('Mole Spades deals 52 unique cards with one WinLEW Wild and 13 per seat', () => {
  const rules = loadRules();
  const deck = rules.deckFor('stable-seed');
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.id)).size, 52);
  assert.equal(deck.filter((card) => card.wild).length, 1);
  assert.equal(deck.some((card) => card.id === '0-0'), false);
  assert.deepEqual([0, 1, 2, 3].map((seat) => deck.slice(seat * 13, seat * 13 + 13).length), [13, 13, 13, 13]);
});

test('legal-card rules enforce following faction and locked Deep Spades', () => {
  const rules = loadRules();
  const lantern = { id: '1-3', suit: 1, rank: 3 };
  const gem = { id: '2-5', suit: 2, rank: 5 };
  const spade = { id: '0-8', suit: 0, rank: 8 };
  const state = { hands: [[lantern, gem, spade], [], [], []], trick: [{ player: 3, card: { id: '1-7', suit: 1, rank: 7 } }], leadSuit: 1, trumpBroken: false };
  assert.deepEqual(rules.legalCardsFor(state, 0).map((card) => card.id), ['1-3']);
  state.trick = []; state.leadSuit = null;
  assert.deepEqual(rules.legalCardsFor(state, 0).map((card) => card.id), ['1-3', '2-5']);
  state.hands[0] = [spade];
  assert.deepEqual(rules.legalCardsFor(state, 0).map((card) => card.id), ['0-8']);
});

test('WinLEW Wild is highest trump and trump beats the led faction', () => {
  const rules = loadRules();
  const trick = [
    { player: 0, card: { id: '2-12', suit: 2, rank: 12 } },
    { player: 1, card: { id: '0-4', suit: 0, rank: 4 } },
    { player: 2, card: { id: '0-13', suit: 0, rank: 13, wild: true } },
    { player: 3, card: { id: '2-11', suit: 2, rank: 11 } },
  ];
  assert.equal(rules.currentWinner(trick).player, 2);
});

test('partnership settlement continues a tie at 25 and ends on a unique team lead', () => {
  const rules = loadRules();
  const base = {
    hands: [[], [], [], []], trick: [], leadSuit: null, trumpBroken: true, turn: 0,
    tricks: [3, 3, 3, 3], streaks: [0, 0, 0, 0], drops: [0, 0, 0, 0], topStreak: [0, 0, 0, 0],
    bids: [3, 3, 3, 3], stakes: [1, 1, 1, 1], settle: null, scores: [0, 0, 0, 0], teamScores: [20, 20],
    round: 2, phase: 'playing', message: '', log: [], rewardClaimed: false,
  };
  rules.setState(structuredClone(base)); rules.settleRound();
  assert.equal(rules.getState().phase, 'roundEnd');
  assert.deepEqual(Array.from(rules.getState().teamScores), [32, 32]);

  const unique = structuredClone(base);
  unique.tricks = [5, 3, 3, 3]; unique.bids = [5, 3, 3, 3];
  rules.setState(unique); rules.settleRound();
  assert.equal(rules.getState().phase, 'matchEnd');
  assert.equal(rules.getState().winningTeam, 0);
});
