import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = await fs.readFile(path.join(here, "phase3b-preview", "adapters.js"), "utf8");
let fetchCount = 0;
let requestedUrl = null;
const now = new Date().toISOString();
const items = Object.fromEntries(["price", "burn", "transparency", "modules", "quiz", "faucet", "governance", "events", "health"].map((name) => [name, {
  state: "live", sourceAt: now, cachedAt: now, expiresAt: now, servedAt: now, evidence: "/",
}]));
const context = {
  window: {
    location: { hostname: "preview.local", origin: "http://preview.local" },
    WINLEW_3B_API_BASE: "http://preview.local",
  },
  URL, URLSearchParams, AbortController, Date, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    fetchCount += 1;
    requestedUrl = String(url);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    return { ok: true, status: 200, json: async () => ({ ok: true, schemaVersion: 1, generatedAt: now, items }) };
  },
};
vm.runInNewContext(source, context, { filename: "phase3b-preview/adapters.js" });
const names = Object.keys(context.window.WinLEW3AData.sources);
const results = await Promise.all(names.map((name) => context.window.WinLEW3AData.read(name)));
assert.equal(names.length, 9);
assert.equal(fetchCount, 1);
assert.equal(requestedUrl, "http://preview.local/api/homepage/summary");
assert.equal(results.every((result) => result.ok), true);
const evidence = {
  generatedAt: new Date().toISOString(),
  methodology: "Local VM execution of the packaged browser adapter with a mocked same-origin fetch; not a browser-engine result.",
  logicalReads: names.length,
  fetchCount,
  requestedUrl,
  directLegacySourceRequests: 0,
  allItemsResolved: true,
};
await fs.writeFile(path.join(here, "phase3b-adapter-evidence-results.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
