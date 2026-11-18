// The GeoHackers verify relay must serve the verify client's fallback copy as
// JavaScript, and only that copy.
//
// R2, 2026-11-12. When the oxyon.io copy of the ~3 MB verify client cannot load,
// the bot's page loads <relay>/verify/client-<hex16> as a module script with SRI.
// The relay relabelled that response text/html and, with X-Content-Type-Options:
// nosniff, browsers refuse an HTML-typed module, so the fallback never ran and
// members saw "Loading verification…" forever.
//
// Text guard, like proxyErrorDisclosure.test.mjs: php is not guaranteed where
// `npm test` runs. The behaviour itself was executed against php 8.3 (real client
// bytes, wrong-hash body, HTML body, stale hash, session page, /health).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(repoRoot, "src/public/xl1/verify/api-proxy.php"), "utf8");
const code = source
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");

test("the client fallback path is recognised by exact shape", () => {
  assert.match(code, /preg_match\('#\^\/verify\/client-\(\[0-9a-f\]\{16\}\)\$#', \$pathInfo, \$vcm\)/);
});

test("JavaScript is served only after the body's SHA-256 matches the name", () => {
  const branch = code.slice(code.indexOf("} elseif ($verifyClientHash !== '') {"));
  assert.ok(branch.length > 0, "client fallback branch missing");
  const jsAt = branch.indexOf("header('Content-Type: text/javascript; charset=utf-8')");
  const checkAt = branch.indexOf("strncmp(hash('sha256', $responseBody), $verifyClientHash, 16) === 0");
  const statusAt = branch.indexOf("$statusCode === 200 && $isScript");
  assert.ok(checkAt > 0 && statusAt > 0 && jsAt > checkAt, "hash and status checks must precede the JS content type");
});

test("text/javascript appears nowhere else in the relay", () => {
  const uses = code.match(/text\/javascript; charset=utf-8/g) ?? [];
  assert.equal(uses.length, 1);
});

test("a refused or missing client is never cacheable", () => {
  const branch = code.slice(code.indexOf("} elseif ($verifyClientHash !== '') {"));
  const tail = branch.slice(branch.indexOf("echo $responseBody;\n        exit;"));
  assert.match(tail.slice(0, tail.indexOf("} elseif")), /Cache-Control: no-store/);
  assert.doesNotMatch(code, /immutable/);
});

test("the general verify-page allowlist is unchanged (no script types)", () => {
  assert.match(code, /if \(!preg_match\('#\^\(\?:text\/html\|text\/plain\|application\/json\)\\b#i', \$upstreamType\)\)/);
});
