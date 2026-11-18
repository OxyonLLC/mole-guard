// A restart must never un-ban anyone.
//
// Found 2026-08-15, with the live ban list already emptied. bootstrapFile()
// decides local-vs-remote with isMeaningful(), which counts keys on the TOP
// level object. wallet_bans.json is `{ version: 1, bans: {} }` — so an empty
// ban list has a key, looked "meaningful", and was pushed over a populated
// remote. A machine whose local wallet_bans.json had never been written wiped
// every ban in Mongo just by booting.
//
// src/faucet/storage.js's own comment on that file says it: "This one IS a
// source of truth and must be backed up: losing it silently un-bans everyone."
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// storage.js opens a Mongo client on import, so the predicate is lifted out
// rather than imported — the logic under test is pure and self-contained.
const SRC = readFileSync(new URL("../../src/faucet/storage.js", import.meta.url), "utf8");

function load() {
  const meaningful = SRC.match(/function isMeaningful[\s\S]*?\n}/)?.[0];
  const has = SRC.match(/function hasRecords[\s\S]*?\n}/)?.[0];
  const files = SRC.match(/const MANAGED_FILES = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(meaningful && has && files, "storage.js structure changed — this test's parser needs updating");
  // eslint-disable-next-line no-new-func
  return new Function(`${files}\n${meaningful}\n${has}\nreturn { hasRecords, isMeaningful, MANAGED_FILES };`)();
}

describe("an empty wrapper must not count as content", () => {
  const { hasRecords } = load();

  test("an empty ban list has no records", () => {
    assert.equal(hasRecords("wallet_bans.json", { version: 1, bans: {} }), false,
      "an empty ban list still looks like content — it will overwrite the live one on boot");
  });

  test("a populated ban list does", () => {
    assert.equal(hasRecords("wallet_bans.json", { version: 1, bans: { W: { reason: "x" } } }), true);
  });

  test("the same holds for wallet links, which has the same shape", () => {
    assert.equal(hasRecords("wallet_links.json", { version: 1, links: {} }), false);
    assert.equal(hasRecords("wallet_links.json", { version: 1, links: { u: "W" } }), true);
  });

  test("bare-map files still work without an accessor", () => {
    // registrations.json, airdrops.json and friends are plain objects; they
    // must not regress into always-empty just because they declare no accessor.
    assert.equal(hasRecords("registrations.json", {}), false);
    assert.equal(hasRecords("registrations.json", { u: "W" }), true);
    assert.equal(hasRecords("faucet_claims.json", { id: {} }), true);
  });

  test("null and undefined are not records", () => {
    assert.equal(hasRecords("wallet_bans.json", null), false);
    assert.equal(hasRecords("wallet_bans.json", undefined), false);
    // A payload missing its container entirely is empty, not content.
    assert.equal(hasRecords("wallet_bans.json", { version: 1 }), false);
  });

  test("an unknown file falls back to the whole payload", () => {
    assert.equal(hasRecords("not_managed.json", { a: 1 }), true);
    assert.equal(hasRecords("not_managed.json", {}), false);
  });
});

describe("the boot path uses it", () => {
  test("bootstrapFile compares records, not wrappers", () => {
    // The bug was entirely in which predicate this one branch used, so pin it.
    assert.match(SRC, /const localHas = hasRecords\(name, localValue\)/);
    assert.match(SRC, /const remoteHas = hasRecords\(name, remoteValue\)/);
    assert.ok(!/if \(!isMeaningful\(localValue\) && isMeaningful\(remoteValue\)\)/.test(SRC),
      "bootstrapFile is still deciding local-vs-remote with isMeaningful()");
  });

  test("wallet_bans.json declares where its records live", () => {
    // Without this accessor the fix silently does nothing for the one file
    // whose loss un-bans everybody.
    const { MANAGED_FILES } = load();
    assert.equal(typeof MANAGED_FILES["wallet_bans.json"].records, "function");
    assert.deepEqual(MANAGED_FILES["wallet_bans.json"].records({ bans: { a: 1 } }), { a: 1 });
  });
});
