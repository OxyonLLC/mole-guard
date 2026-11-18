// The local signing page (tools/sign-challenge.html).
//
// Two things can go quietly wrong here and both are expensive:
//
//   1. The page gets moved or copied under src/public/, which would publish a
//      "sign this arbitrary message" prompt on winlew.co.
//   2. Its inline base58 encoder drifts. It is hand-written because the page
//      must load no external code, and the naive version emits a spurious '1'
//      for zero-valued input — producing a signature that fails to verify for
//      a reason that looks exactly like a broken key.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import bs58 from "bs58";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = resolve(repoRoot, "tools/sign-challenge.html");
const html = readFileSync(PAGE, "utf8");

test("the signing page is never served from the public site", () => {
  const publicDir = resolve(repoRoot, "src/public");
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const offenders = walk(publicDir).filter((p) => /sign-challenge/i.test(p));
  assert.deepEqual(offenders, [], "a wallet-signing prompt must not be reachable on winlew.co");
  assert.ok(existsSync(PAGE), "it belongs in tools/, served only by npm run cunt:sign-page");
});

test("the page loads no external code — a strict CSP is not what protects it here", () => {
  // It runs against a real wallet and a real key. Any remote script, style,
  // font or image is a supply chain for that.
  const external = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((u) => /^(https?:)?\/\//i.test(u));
  assert.deepEqual(external, [], `external resources referenced: ${external.join(", ")}`);
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(html), "the page must make no network calls");
  assert.match(html, /noindex/i);
});

test("the page's inline base58 encoder matches bs58, including the zero cases", () => {
  // Extracted from the page and fuzzed, so an edit to it fails the build rather
  // than producing signatures that mysteriously do not verify.
  const src = html.match(/function b58encode\(bytes\)\s*\{[\s\S]*?\n\}/);
  assert.ok(src, "b58encode must be findable in the page");
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  // eslint-disable-next-line no-new-func
  const b58encode = new Function("B58", `${src[0]}; return b58encode;`)(B58);

  // The exact cases the naive implementation gets wrong.
  assert.equal(b58encode(new Uint8Array([0])), bs58.encode(new Uint8Array([0])));
  assert.equal(b58encode(new Uint8Array([0, 0])), bs58.encode(new Uint8Array([0, 0])));
  assert.equal(b58encode(new Uint8Array(0)), "");

  let checked = 0;
  for (let t = 0; t < 3000; t++) {
    const len = [32, 64, 1, 2, 33][t % 5];
    const a = new Uint8Array(len);
    for (let i = 0; i < len; i++) a[i] = (Math.random() * 256) | 0;
    if (t % 7 === 0) a[0] = 0;
    if (t % 29 === 0 && len > 1) { a[0] = 0; a[1] = 0; }
    if (t % 101 === 0) a.fill(0);
    assert.equal(b58encode(a), bs58.encode(a));
    checked++;
  }
  assert.equal(checked, 3000);
});

test("the page refuses to sign with the wrong account", () => {
  // Signing with whatever happens to be connected would prove possession of a
  // key that is not going into the multisig — the one mistake this page could
  // make that looks like success.
  assert.match(html, /not the expected signer/i);
  assert.match(html, /\$\("sign"\)\.disabled = true/, "the sign button must be disabled on mismatch");
  // And it must state the Ledger fallback rather than leave a dead end.
  assert.match(html, /solana sign-offchain-message/);

  // A refusal that just says "wrong account" sends someone hunting for a device
  // sitting in front of them. The real cause, hit on the first signer, is that
  // one Ledger derives different addresses in different apps.
  assert.match(html, /derivation path/i, "the mismatch must explain the likeliest cause");
  assert.match(html, /m\/44'\/501'\/0'/, "it must show both paths concretely");
  assert.match(html, /usb:\/\/ledger\?key=0\/0/);
});

test("the server binds localhost only and serves exactly one file", () => {
  const server = readFileSync(resolve(repoRoot, "src/scripts/cunt-sign-page.js"), "utf8");
  // LAN binding must be OPT-IN. Serving on 0.0.0.0 by default would put the
  // page on every network the machine joins, forever, without anyone choosing it.
  assert.match(server, /const host = lan \? "0\.0\.0\.0" : "127\.0\.0\.1"/, "localhost must be the default");
  assert.match(server, /argv\.includes\("--lan"\)/, "LAN mode must require an explicit flag");
  assert.ok(!/req\.url/.test(server), "no path handling means no traversal surface");
  // And it must report the interface it actually bound, not a hardcoded claim —
  // the banner previously said "bound to 127.0.0.1" unconditionally.
  assert.ok(!/Bound to 127\.0\.0\.1|Local only: bound to 127/.test(server), "the banner must not hardcode the host");
  assert.match(server, /Bound to \$\{host\}/);
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["cunt:sign-page"], "node src/scripts/cunt-sign-page.js");
});

test("the signing page can never land on a port this project already uses", () => {
  // It originally defaulted to 8787, which IS the WinLEW site's port. Visiting
  // it with the site running served the site, which looks exactly like this
  // tool having been added to winlew.co. It had not been — but the number made
  // that indistinguishable, and a number you have to explain is a bug.
  const server = readFileSync(resolve(repoRoot, "src/scripts/cunt-sign-page.js"), "utf8");
  const config = readFileSync(resolve(repoRoot, "src/mole/config.js"), "utf8");
  const sitePort = config.match(/PORT:[^\n]*default\((\d+)\)/)?.[1];
  assert.ok(sitePort, "the site's default port must be findable, or this guard is blind");

  assert.ok(!new RegExp(`\\b${sitePort}\\b`).test(server.replace(/\/\/[^\n]*/g, "")),
    `the sign page must not hardcode the site's port (${sitePort}) outside a comment`);
  assert.match(server, /SIGN_PAGE_PORT \|\| 0/, "it must default to an OS-assigned port");
  assert.ok(!/process\.env\.PORT\b/.test(server),
    "PORT means the website in this repo — reading it would reintroduce the collision");
  // And it must report the port it actually got, not the one it asked for.
  assert.match(server, /server\.address\(\)\.port/);
});
