// WinLEW Modules Registry — pure data/validation tests. No storage, no
// network, no Mongo — src/mole/modulesData.js is static data only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULES, ROADMAP_PHASES, MODULE_STATUSES, ROADMAP_ITEM_STATES,
  validateModulesRegistry, getModuleById, countsByStatus, getModulesStatusPayload,
} from '../../src/mole/modulesData.js';

function baseModule(overrides = {}) {
  return {
    id: 'x', title: 'X', shortDescription: 'short', fullDescription: 'full',
    category: 'foundation-transparency', status: MODULE_STATUSES.LIVE, progress: 100,
    route: '/x/', docs: [], roadmapPhase: 1, roadmapItem: 'Website', launchDate: null,
    lastVerifiedIso: '2026-07-12', publicVisibility: true, mobileSupport: true,
    discordEquivalent: null, relatedModules: [], evidence: [], limitations: null,
    ongoingOperation: false, sortOrder: 1, icon: '⚙️',
    ...overrides,
  };
}

describe('registry data integrity', () => {
  test('the real, seeded registry passes validation with zero errors', () => {
    const result = validateModulesRegistry(MODULES);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  test('every module has a non-empty id and title', () => {
    for (const m of MODULES) {
      assert.ok(m.id && m.id.trim(), `module missing id: ${JSON.stringify(m.title)}`);
      assert.ok(m.title && m.title.trim(), `module ${m.id} missing title`);
    }
  });

  test('no duplicate module ids in the real registry', () => {
    const ids = MODULES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('no duplicate routes in the real registry', () => {
    const routes = MODULES.filter((m) => m.route).map((m) => m.route);
    assert.equal(new Set(routes).size, routes.length);
  });
});

describe('validateModulesRegistry — synthetic failure cases', () => {
  test('detects a duplicate id', () => {
    const modules = [baseModule({ id: 'a' }), baseModule({ id: 'a', route: '/other/' })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('Duplicate module id')));
  });

  test('detects a duplicate route', () => {
    const modules = [baseModule({ id: 'a', route: '/same/' }), baseModule({ id: 'b', route: '/same/' })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('Duplicate route')));
  });

  test('detects an unsupported status value', () => {
    const modules = [baseModule({ status: 'warming' })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('unsupported status')));
  });

  test('detects progress outside 0-100', () => {
    const modules = [baseModule({ progress: 150 })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('progress out of 0-100')));

    const modulesNeg = [baseModule({ progress: -5 })];
    const resultNeg = validateModulesRegistry(modulesNeg, []);
    assert.equal(resultNeg.ok, false);
  });

  test('detects a live module with no route', () => {
    const modules = [baseModule({ status: MODULE_STATUSES.LIVE, route: null })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('status is live but has no route')));
  });

  test('a non-live module with no route is valid (e.g. deferred/planned/internal)', () => {
    const modules = [baseModule({ status: MODULE_STATUSES.DEFERRED, route: null })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, true);
  });

  test('detects a missing roadmapPhase', () => {
    const modules = [baseModule({ roadmapPhase: null })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('missing roadmapPhase')));
  });

  test('detects a relatedModules reference to an unknown id', () => {
    const modules = [baseModule({ id: 'a', relatedModules: ['ghost-module'] })];
    const result = validateModulesRegistry(modules, []);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('relatedModules references unknown id')));
  });
});

describe('getModuleById', () => {
  test('returns the matching real module', () => {
    const m = getModuleById('governance');
    assert.ok(m);
    assert.equal(m.title, 'Governance');
  });

  test('returns null for an unknown id', () => {
    assert.equal(getModuleById('does-not-exist'), null);
  });
});

describe('countsByStatus', () => {
  test('every count is a non-negative integer and the counts sum to the module count', () => {
    const counts = countsByStatus(MODULES);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, MODULES.length);
    for (const v of Object.values(counts)) {
      assert.ok(Number.isInteger(v) && v >= 0);
    }
  });
});

describe('getModulesStatusPayload', () => {
  test('returns a well-shaped payload with modules sorted by sortOrder', () => {
    const payload = getModulesStatusPayload();
    assert.ok(payload.registryVersion);
    assert.ok(payload.generatedAt);
    assert.ok(Array.isArray(payload.modules));
    assert.ok(Array.isArray(payload.roadmapPhases));
    assert.ok(payload.countsByStatus);
    for (let i = 1; i < payload.modules.length; i += 1) {
      assert.ok((payload.modules[i - 1].sortOrder ?? 0) <= (payload.modules[i].sortOrder ?? 0), 'modules must be sorted by sortOrder ascending');
    }
  });

  test('the payload never contains a raw filesystem path outside evidence (which is intentionally source-code references, not secrets)', () => {
    const payload = getModulesStatusPayload();
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /\/home\/|\/Users\/|C:\\\\/, 'no absolute local filesystem path may appear in the public payload');
  });
});

describe('current expected truth (per the WinLEW Modules closeout spec)', () => {
  function statusOf(id) { return getModuleById(id)?.status; }

  test('Governance is LIVE, not incomplete', () => {
    assert.equal(statusOf('governance'), MODULE_STATUSES.LIVE);
  });

  test('Proof of Value is LIVE, not warming/in build', () => {
    assert.equal(statusOf('proof-of-value'), MODULE_STATUSES.LIVE);
  });

  test('Dashboard is LIVE', () => {
    assert.equal(statusOf('dashboard'), MODULE_STATUSES.LIVE);
  });

  test('Burn Center is LIVE, not only planned', () => {
    assert.equal(statusOf('burn-center'), MODULE_STATUSES.LIVE);
  });

  test('Community Events is LIVE, not unbuilt', () => {
    assert.equal(statusOf('community-events'), MODULE_STATUSES.LIVE);
  });

  test('Mobile App Beta is BETA, not "not started"', () => {
    assert.equal(statusOf('mobile-app-beta'), MODULE_STATUSES.BETA);
  });

  test('Cross-Chain Bridge is not marked complete/live', () => {
    const status = statusOf('cross-chain-bridge');
    assert.notEqual(status, MODULE_STATUSES.LIVE);
    assert.equal(status, MODULE_STATUSES.DEFERRED);
  });

  test('Platform v2 enhancements are not falsely marked complete', () => {
    const status = statusOf('platform-v2-enhancements');
    assert.notEqual(status, MODULE_STATUSES.LIVE);
  });

  test('ongoing programs (Governance, Burn, Events) render as ongoingOperation, not as incomplete', () => {
    for (const id of ['governance', 'burn-center', 'community-events']) {
      const m = getModuleById(id);
      assert.equal(m.ongoingOperation, true, `${id} must be flagged ongoingOperation`);
      assert.equal(m.status, MODULE_STATUSES.LIVE, `${id}'s platform status must still be live, not "incomplete"`);
    }
  });

  test('no module anywhere in the registry uses a vague/misleading status label', () => {
    const forbidden = new Set(['warming', 'soon', 'almost', 'in build', 'in-build', 'coming soon']);
    for (const m of MODULES) {
      assert.ok(!forbidden.has(String(m.status).toLowerCase()), `${m.id} uses a forbidden vague status: ${m.status}`);
    }
  });
});

describe('roadmap phase reconciliation', () => {
  test('Phase 5 is not flattened to "complete" — it contains a deferred item', () => {
    const phase5 = ROADMAP_PHASES.find((p) => p.phase === 5);
    assert.ok(phase5);
    assert.notEqual(phase5.state, ROADMAP_ITEM_STATES.COMPLETE, 'Phase 5 must not be silently marked fully complete while Cross-Chain Bridge is deferred');
    const crossChain = phase5.items.find((i) => i.label === 'Cross-Chain Bridge');
    assert.ok(crossChain);
    assert.equal(crossChain.state, ROADMAP_ITEM_STATES.DEFERRED);
  });

  test('Phase 5 explicitly lists Governance Module v1 as complete', () => {
    const phase5 = ROADMAP_PHASES.find((p) => p.phase === 5);
    const gov = phase5.items.find((i) => i.label === 'Governance Module v1');
    assert.ok(gov);
    assert.equal(gov.state, ROADMAP_ITEM_STATES.COMPLETE);
  });

  test('Phase 5 lists ongoing PoV cycles and burns as ongoing, not complete or not-started', () => {
    const phase5 = ROADMAP_PHASES.find((p) => p.phase === 5);
    const ongoingItem = phase5.items.find((i) => i.label === 'Ongoing PoV cycles and burns');
    assert.ok(ongoingItem);
    assert.equal(ongoingItem.state, ROADMAP_ITEM_STATES.ONGOING);
  });

  test('phases 1-4 are marked complete (fully reconciled against real shipped modules)', () => {
    for (const phaseNum of [1, 2, 3, 4]) {
      const phase = ROADMAP_PHASES.find((p) => p.phase === phaseNum);
      assert.ok(phase, `phase ${phaseNum} must exist`);
      assert.equal(phase.state, ROADMAP_ITEM_STATES.COMPLETE, `phase ${phaseNum} should be complete`);
    }
  });

  test('every roadmap item state is one of the controlled ROADMAP_ITEM_STATES', () => {
    for (const phase of ROADMAP_PHASES) {
      for (const item of phase.items) {
        assert.ok(Object.values(ROADMAP_ITEM_STATES).includes(item.state), `${phase.title} / ${item.label}: invalid state "${item.state}"`);
      }
    }
  });
});

describe('Cross-Chain Bridge — retained on roadmap, deferred (2026-07-12 product decision)', () => {
  test('retained = true, status = deferred, implementation = not-started, roadmapPhase = 5', () => {
    const bridge = getModuleById('cross-chain-bridge');
    assert.ok(bridge, 'Cross-Chain Bridge must remain a real registry record, not be deleted');
    assert.equal(bridge.retainedOnRoadmap, true);
    assert.equal(bridge.status, MODULE_STATUSES.DEFERRED);
    assert.equal(bridge.implementationState, 'not-started');
    assert.equal(bridge.roadmapPhase, 5);
  });

  test('is never marked removed, retired, cancelled, out-of-scope, abandoned, complete, or partial', () => {
    const bridge = getModuleById('cross-chain-bridge');
    const forbidden = [MODULE_STATUSES.RETIRED, MODULE_STATUSES.HISTORICAL, MODULE_STATUSES.PARTIAL, MODULE_STATUSES.LIVE];
    assert.ok(!forbidden.includes(bridge.status), `status "${bridge.status}" is not an acceptable state for a retained-but-deferred commitment`);
  });

  test('has no live route (no fake/placeholder implementation page) and no progress percentage', () => {
    const bridge = getModuleById('cross-chain-bridge');
    assert.equal(bridge.route, null);
    assert.equal(bridge.progress, null);
  });

  test('remains listed in the Phase 5 roadmap mapping, and its item state is deferred (never complete or removed-from-scope)', () => {
    const phase5 = ROADMAP_PHASES.find((p) => p.phase === 5);
    const item = phase5.items.find((i) => i.moduleId === 'cross-chain-bridge');
    assert.ok(item, 'Cross-Chain Bridge must not be omitted from the Phase 5 roadmap mapping');
    assert.equal(item.state, ROADMAP_ITEM_STATES.DEFERRED);
  });

  test('the public description does not imply development is currently underway', () => {
    const bridge = getModuleById('cross-chain-bridge');
    const text = `${bridge.shortDescription} ${bridge.fullDescription}`.toLowerCase();
    // These phrases only ever appear in an affirmative "work is happening"
    // claim in practice — a negated form ("none is currently underway")
    // is the honest, correct thing to say and must not trip this check,
    // so "underway" alone isn't included; the phrases below are specific
    // enough that they aren't naturally used in a negated sentence.
    assert.doesNotMatch(text, /\bin progress\b|\bbuilding now\b|\bcurrently building\b|\bin development\b|\bwork has begun\b|\bactively (?:building|developing)\b/);
  });

  test('2026-07-12 wording correction: describes the original XL1 intent, not generic EVM interoperability', () => {
    const bridge = getModuleById('cross-chain-bridge');
    const text = `${bridge.shortDescription} ${bridge.fullDescription}`;
    assert.match(text, /XL1/, 'must name XL1 as the original intended target, not a generic description');
    assert.doesNotMatch(text.toLowerCase(), /\bevm\b/, 'must not describe the target as generic EVM interoperability');
  });

  test('does not claim XL1 bridging has been publicly announced or that an official spec currently exists', () => {
    const bridge = getModuleById('cross-chain-bridge');
    const text = `${bridge.shortDescription} ${bridge.fullDescription}`.toLowerCase();
    assert.doesNotMatch(text, /\bannounced\b|\bofficially announced\b/);
    assert.match(text, /no official public xl1 bridging mechanism/, 'must state that no official public XL1 bridging mechanism currently exists');
  });

  test('does not expose internal assumptions or speculative bridge architecture', () => {
    const bridge = getModuleById('cross-chain-bridge');
    const text = `${bridge.shortDescription} ${bridge.fullDescription}`.toLowerCase();
    assert.doesNotMatch(text, /lock-and-mint|burn-and-mint|wrapped token|custodial|liquidity pool|smart contract|validator set|multisig/);
  });

  describe('drift protection — validateModulesRegistry() rejects each forbidden tampering scenario', () => {
    function bridgeModules(overrides) {
      return MODULES.map((m) => (m.id === 'cross-chain-bridge' ? { ...m, ...overrides } : m));
    }

    test('rejects Cross-Chain Bridge marked live', () => {
      const result = validateModulesRegistry(bridgeModules({ status: MODULE_STATUSES.LIVE }), ROADMAP_PHASES);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /never be marked live/.test(e)));
    });

    test('rejects Cross-Chain Bridge marked retired', () => {
      const result = validateModulesRegistry(bridgeModules({ status: MODULE_STATUSES.RETIRED }), ROADMAP_PHASES);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /never be marked retired/.test(e)));
    });

    test('rejects Cross-Chain Bridge with retainedOnRoadmap flipped to false', () => {
      const result = validateModulesRegistry(bridgeModules({ retainedOnRoadmap: false }), ROADMAP_PHASES);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /retainedOnRoadmap: true/.test(e)));
    });

    test('rejects Cross-Chain Bridge with implementationState changed away from not-started without real evidence', () => {
      const result = validateModulesRegistry(bridgeModules({ implementationState: 'in-progress' }), ROADMAP_PHASES);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /implementationState must be "not-started"/.test(e)));
    });

    test('rejects Cross-Chain Bridge deleted from the registry entirely while still referenced in Phase 5', () => {
      const withoutBridge = MODULES.filter((m) => m.id !== 'cross-chain-bridge');
      const result = validateModulesRegistry(withoutBridge, ROADMAP_PHASES);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /missing from the registry entirely/.test(e)));
    });

    test('rejects Cross-Chain Bridge omitted from the Phase 5 roadmap mapping while still present in MODULES', () => {
      const phasesWithoutBridge = ROADMAP_PHASES.map((phase) =>
        phase.phase === 5 ? { ...phase, items: phase.items.filter((i) => i.moduleId !== 'cross-chain-bridge') } : phase
      );
      const result = validateModulesRegistry(MODULES, phasesWithoutBridge);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /missing from the Phase 5 roadmap item mapping/.test(e)));
    });

    test('rejects the Phase 5 roadmap item state changed to complete', () => {
      const phasesTampered = ROADMAP_PHASES.map((phase) =>
        phase.phase === 5
          ? { ...phase, items: phase.items.map((i) => (i.moduleId === 'cross-chain-bridge' ? { ...i, state: ROADMAP_ITEM_STATES.COMPLETE } : i)) }
          : phase
      );
      const result = validateModulesRegistry(MODULES, phasesTampered);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /roadmap-item state must never be "complete"/.test(e)));
    });

    test('rejects the Phase 5 roadmap item state changed to removed-from-scope without a recorded decision', () => {
      const phasesTampered = ROADMAP_PHASES.map((phase) =>
        phase.phase === 5
          ? { ...phase, items: phase.items.map((i) => (i.moduleId === 'cross-chain-bridge' ? { ...i, state: ROADMAP_ITEM_STATES.REMOVED_FROM_SCOPE } : i)) }
          : phase
      );
      const result = validateModulesRegistry(MODULES, phasesTampered);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /removed-from-scope.*without a later/.test(e)));
    });

    test('rejects Phase 5 marked fully complete while it still contains deferred/not-started items', () => {
      const phasesTampered = ROADMAP_PHASES.map((phase) => (phase.phase === 5 ? { ...phase, state: ROADMAP_ITEM_STATES.COMPLETE } : phase));
      const result = validateModulesRegistry(MODULES, phasesTampered);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /marked complete but contains a deferred\/not-started\/blocked item/.test(e)));
    });

    test('rejects Platform v2 enhancements falsely marked live', () => {
      const tampered = MODULES.map((m) => (m.id === 'platform-v2-enhancements' ? { ...m, status: MODULE_STATUSES.LIVE } : m));
      const result = validateModulesRegistry(tampered, ROADMAP_PHASES);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /Platform v2 enhancements must never be marked live/.test(e)));
    });

    test('rejects ongoing PoV cycles/burns roadmap item represented as complete instead of ongoing', () => {
      const phasesTampered = ROADMAP_PHASES.map((phase) =>
        phase.phase === 5
          ? { ...phase, items: phase.items.map((i) => (/ongoing/i.test(i.label) ? { ...i, state: ROADMAP_ITEM_STATES.COMPLETE } : i)) }
          : phase
      );
      const result = validateModulesRegistry(MODULES, phasesTampered);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => /describes ongoing activity but its state is/.test(e)));
    });
  });
});
