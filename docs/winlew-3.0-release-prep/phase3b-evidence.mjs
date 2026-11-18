import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createHomepageSummary } from "../../mole/homepageSummary.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sourceNames = ["price", "burn", "transparency", "modules", "quiz", "faucet", "governance", "events", "health"];
const calls = Object.fromEntries(sourceNames.map((name) => [name, 0]));
const at = "2026-10-09T18:00:00.000Z";
const fixtures = {
  price: { priceUsd: 0.00001234, liquidityUsd: 123456, fetchedAt: at },
  burn: { percentOfTarget: 42.5, generatedAt: at },
  transparency: { circulatingSupplyOk: true, circulatingDisplay: "862000000", computedAtIso: at },
  modules: { visibleCount: 29, liveCount: 18, generatedAt: at },
  quiz: { cycleEndMs: Date.parse(at) + 86400000, startAt: at },
  faucet: { totalConfirmedCount: 321, generatedAt: at },
  governance: { proposalCount: 4, activeCount: 1, generatedAt: at },
  events: { liveCount: 1, upcomingCount: 2, generatedAt: at },
  health: { reachableCount: 18, totalCount: 19, checkedAt: at },
};
const delays = { price: 32, burn: 38, transparency: 41, modules: 8, quiz: 4, faucet: 12, governance: 3, events: 5, health: 45 };
const evidence = {
  price: "/links/", burn: "/burn/", transparency: "/transparency/", modules: "/modules/",
  quiz: "/quiz/", faucet: "/faucet/", governance: "/governance/", events: "/events/", health: "/health/",
};
const sourceAt = {
  price: (x) => x.fetchedAt, burn: (x) => x.generatedAt, transparency: (x) => x.computedAtIso,
  modules: (x) => x.generatedAt, quiz: (x) => x.startAt, faucet: (x) => x.generatedAt,
  governance: (x) => x.generatedAt, events: (x) => x.generatedAt, health: (x) => x.checkedAt,
};
const sources = Object.fromEntries(sourceNames.map((name) => [name, {
  ttlMs: 60_000,
  evidence: evidence[name],
  read: async () => { calls[name] += 1; await wait(delays[name]); return fixtures[name]; },
  normalize: (x) => Object.fromEntries(Object.entries(x).filter(([key]) => !/At$|AtIso$/.test(key))),
  sourceAt: sourceAt[name],
}]));
const build = createHomepageSummary({ sources });

const coldStart = performance.now();
const concurrent = await Promise.all(Array.from({ length: 12 }, () => build()));
const coldMs = performance.now() - coldStart;
const warmStart = performance.now();
const warm = await build();
const warmMs = performance.now() - warmStart;
const payload = JSON.stringify(warm);
const payloadBytes = Buffer.byteLength(payload);
const priorBytes = 185_800;
const forbiddenKey = /(wallet|discord|session|cookie|authorization|token|secret|ip|userId|accountId)/i;
const foundForbidden = [];
function scan(value, pointer = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) foundForbidden.push(`${pointer}.${key}`);
    scan(child, `${pointer}.${key}`);
  }
}
scan(warm);
const stableData = (entry) => JSON.stringify(entry, (key, value) => key === "generatedAt" || key === "servedAt" ? undefined : value);
const allSame = concurrent.every((entry) => stableData(entry) === stableData(concurrent[0]));
const oneCallEach = sourceNames.every((name) => calls[name] === 1);
const results = {
  generatedAt: new Date().toISOString(),
  methodology: "Deterministic local nine-source harness; no production or external endpoint contacted.",
  iterations: { concurrentColdRequests: concurrent.length, warmRequests: 1 },
  latencyMs: { coldConcurrentBatch: Number(coldMs.toFixed(3)), warm: Number(warmMs.toFixed(3)) },
  payload: {
    bytes: payloadBytes,
    priorMeasuredBytes: priorBytes,
    reductionPercent: Number(((1 - payloadBytes / priorBytes) * 100).toFixed(2)),
  },
  sourceCalls: calls,
  assertions: {
    oneUnderlyingCallPerSourceDuringConcurrentColdBatch: oneCallEach,
    concurrentSourceDataAndCacheMetadataIdentical: allSame,
    forbiddenPersonalizedOrSensitiveKeys: foundForbidden,
    itemCount: Object.keys(warm.items).length,
    responseUnder16KiB: payloadBytes < 16_384,
  },
  sample: warm,
};
await fs.writeFile(path.join(here, "phase3b-evidence-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
if (!oneCallEach || !allSame || foundForbidden.length || Object.keys(warm.items).length !== 9 || payloadBytes >= 16_384) process.exitCode = 1;
