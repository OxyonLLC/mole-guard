// Hand-uploaded winlew.co files must equal what is recorded as live.
//
// 2026-11-12: R2 went live on winlew.co while main still held the old relay, so
// any upload from main would have reverted it. This makes that drift a test
// failure: change a listed file and you must change its live entry with it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEntry, liveSha256, loadManifest } from "../../src/scripts/check-live-manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = loadManifest(repoRoot);

for (const [path, entry] of Object.entries(manifest.files)) {
  test(`${entry.htdocs} in the repo is the live release (${entry.release})`, () => {
    assert.ok(existsSync(resolve(repoRoot, path)), `${path} is listed but missing`);
    const r = checkEntry(path, entry, readFileSync(resolve(repoRoot, path)));
    assert.ok(r.ok, `${path} ${r.reason} (repo ${r.actual})`);
  });
}

test("every entry is well formed", () => {
  for (const [path, e] of Object.entries(manifest.files)) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/, path);
    assert.ok(e.htdocs && !e.htdocs.startsWith("/"), `${path}: htdocs path`);
    assert.ok(e.release && e.deployedUtc && e.rollback, `${path}: release, deployedUtc and rollback are required`);
    for (const h of Object.keys(e.superseded ?? {})) assert.notEqual(h, e.sha256, `${path}: live hash listed as superseded`);
  }
});

test("a superseded file is refused with the revert spelled out", () => {
  const [path, entry] = Object.entries(manifest.files)[0];
  const fake = { ...entry, sha256: "0".repeat(64), superseded: { [liveSha256(Buffer.from("x"))]: "test" } };
  const r = checkEntry(path, fake, Buffer.from("x"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /SUPERSEDED/);
  assert.match(r.reason, new RegExp(`revert ${entry.release.replace(/[()#]/g, "\\$&")}`));
});

test("CRLF checkouts hash the same as the uploaded LF bytes", () => {
  assert.equal(liveSha256(Buffer.from("a\r\nb\r\n")), liveSha256(Buffer.from("a\nb\n")));
});
