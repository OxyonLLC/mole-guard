import test from "node:test";
import assert from "node:assert/strict";
import {
  createHomepageSummary,
  createSingleFlightReader,
  readFreshCachedSnapshot,
} from "../../src/mole/homepageSummary.js";

test("homepage summary caches normalized public fields and coalesces refreshes", async () => {
  let clock = Date.parse("2026-10-09T12:00:00.000Z");
  let reads = 0;
  const build = createHomepageSummary({
    now: () => clock,
    sources: {
      price: {
        ttlMs: 60_000,
        evidence: "/links/",
        read: async () => { reads += 1; return { priceUsd: 0.01, secret: "never-copy", fetchedAt: "2026-10-09T11:59:55.000Z" }; },
        normalize: (raw) => ({ priceUsd: raw.priceUsd }),
        sourceAt: (raw) => raw.fetchedAt,
      },
    },
  });
  const [a, b] = await Promise.all([build(), build()]);
  assert.equal(reads, 1);
  assert.equal(a.items.price.priceUsd, 0.01);
  assert.equal(a.items.price.secret, undefined);
  assert.equal(a.items.price.state, "live");
  assert.deepEqual(a, b);
});

test("homepage summary serves expired last-known-good data only as stale", async () => {
  let clock = Date.parse("2026-10-09T12:00:00.000Z");
  let fail = false;
  const build = createHomepageSummary({
    now: () => clock,
    sources: {
      health: {
        ttlMs: 1_000,
        evidence: "/health/",
        read: async () => { if (fail) throw new Error("private upstream detail"); return { reachableCount: 18, checkedAt: iso(clock) }; },
        normalize: (raw) => ({ reachableCount: raw.reachableCount }),
        sourceAt: (raw) => raw.checkedAt,
      },
    },
  });
  const first = await build();
  fail = true;
  clock += 1_001;
  const second = await build();
  assert.equal(second.items.health.state, "stale");
  assert.equal(second.items.health.reachableCount, 18);
  assert.equal(second.items.health.sourceAt, first.items.health.sourceAt);
  assert.equal(second.items.health.error, "source_unavailable");
});

test("homepage summary isolates a failed source", async () => {
  const build = createHomepageSummary({
    sources: {
      events: { ttlMs: 300_000, evidence: "/events/", read: async () => { throw new Error("hostname must not leak"); }, normalize: () => ({}) },
      modules: { ttlMs: 900_000, evidence: "/modules/", read: async () => ({ live: 3 }), normalize: (raw) => raw },
    },
  });
  const result = await build();
  assert.equal(result.ok, true);
  assert.equal(result.items.events.state, "unavailable");
  assert.equal(result.items.events.error, "source_unavailable");
  assert.equal(result.items.events.evidence, "/events/");
  assert.equal(result.items.events.retryAt, result.items.events.expiresAt);
  assert.ok(result.items.events.cachedAt);
  assert.ok(result.items.events.servedAt);
  assert.equal(result.items.modules.state, "live");
});

test("homepage summary enforces a deadline when a source ignores abort", async () => {
  const build = createHomepageSummary({
    timeoutMs: 10,
    sources: {
      health: {
        ttlMs: 60_000,
        evidence: "/health/",
        read: async () => new Promise(() => {}),
        normalize: (raw) => raw,
      },
    },
  });
  const result = await build();
  assert.equal(result.items.health.state, "unavailable");
  assert.equal(result.items.health.error, "source_timeout");
  assert.equal(result.items.health.retryAt, result.items.health.expiresAt);
});

test("unavailable sources are negatively cached and warm requests return promptly", async () => {
  let clock = Date.parse("2026-10-09T12:00:00.000Z");
  let reads = 0;
  const build = createHomepageSummary({
    now: () => clock,
    timeoutMs: 20,
    negativeTtlMs: 5_000,
    sources: {
      price: {
        ttlMs: 60_000,
        evidence: "/links/",
        read: async () => { reads += 1; return new Promise(() => {}); },
        normalize: (raw) => raw,
      },
    },
  });

  const coldStarted = performance.now();
  const cold = await build();
  const coldElapsed = performance.now() - coldStarted;
  const warmStarted = performance.now();
  const warm = await build();
  const warmElapsed = performance.now() - warmStarted;

  assert.equal(reads, 1);
  assert.equal(cold.items.price.state, "unavailable");
  assert.equal(warm.items.price.state, "unavailable");
  assert.equal(warm.items.price.retryAt, cold.items.price.retryAt);
  assert.equal(warm.items.price.expiresAt, cold.items.price.expiresAt);
  assert.ok(coldElapsed >= 15, `cold failure should wait for its deadline (${coldElapsed} ms)`);
  assert.ok(warmElapsed < coldElapsed / 2, `negative-cache hit should be prompt (${warmElapsed} ms vs ${coldElapsed} ms)`);

  clock += 5_001;
  await build();
  assert.equal(reads, 2);
});

test("summary Health reads consume only an existing fresh snapshot and never initiate probes", async () => {
  let probeBuilds = 0;
  const cachedEntry = { at: 1_000, data: { reachableCount: 18, totalCount: 19 } };
  assert.deepEqual(
    readFreshCachedSnapshot(cachedEntry, { now: () => 1_100, ttlMs: 90_000 }),
    cachedEntry.data,
  );
  const build = createHomepageSummary({
    sources: {
      health: {
        ttlMs: 90_000,
        evidence: "/health/",
        read: async () => readFreshCachedSnapshot(null, { ttlMs: 90_000 }),
        normalize: (raw) => raw,
      },
    },
  });

  const result = await build();
  assert.equal(result.items.health.state, "unavailable");
  assert.equal(probeBuilds, 0);
});

test("concurrent cold Transparency reads coalesce with the Health-side caller", async () => {
  let builds = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const readTransparency = createSingleFlightReader(async () => {
    builds += 1;
    await gate;
    return { circulatingSupply: { ok: true } };
  });

  const summaryRead = readTransparency();
  const healthRead = readTransparency();
  await Promise.resolve();
  assert.equal(builds, 1);
  release();
  const [summary, health] = await Promise.all([summaryRead, healthRead]);
  assert.equal(builds, 1);
  assert.strictEqual(summary, health);
});

test("a summary failure never invokes a nine-endpoint fallback", async () => {
  let legacyReads = 0;
  const legacyFallback = Array.from({ length: 9 }, () => async () => { legacyReads += 1; });
  const build = createHomepageSummary({
    sources: {
      price: { ttlMs: 60_000, evidence: "/links/", read: async () => { throw new Error("down"); }, normalize: (raw) => raw },
    },
  });

  const result = await build();
  assert.equal(result.items.price.state, "unavailable");
  assert.equal(legacyReads, 0);
  assert.equal(legacyFallback.length, 9);
});

function iso(ms) { return new Date(ms).toISOString(); }
