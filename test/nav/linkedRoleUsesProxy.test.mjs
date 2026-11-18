// /linked-role/* is a route on the NODE app, not a file on the static host.
//
// winlew.co serves src/public/ from shared hosting; the node app is reached
// through verify/api-proxy.php. So `href="/linked-role/mole"` renders a
// perfectly good-looking button that lands on the host's PAGE NOT FOUND. The
// Mole Hub's "Verify on Discord" shipped that way and the owner hit it live on
// 2026-08-21; /governance/ had the same link, and nav.js used it as its
// no-JavaScript fallback.
//
// Verified live at the time of the fix:
//   /linked-role/mole                        -> 404
//   /verify/api-proxy.php/linked-role/mole   -> 302 to discord.com/oauth2/authorize
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = resolve(repoRoot, "src/public");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(html|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("every linked-role link goes through the proxy", () => {
  test("no shipped page links straight at /linked-role/", () => {
    const offenders = [];
    for (const file of walk(publicDir)) {
      const text = readFileSync(file, "utf8");
      // Only real links. The proxied form contains the same substring, so the
      // match is anchored on the quote that starts the attribute value.
      if (/href=["']\/linked-role\//.test(text)) offenders.push(relative(repoRoot, file));
    }
    assert.deepEqual(offenders, [],
      "these link at a node-app route as if it were a file on the static host, which 404s: "
      + offenders.join(", "));
  });

  test("nav.js's no-JavaScript fallback is the proxied form too", () => {
    const nav = readFileSync(resolve(publicDir, "assets/nav.js"), "utf8");
    assert.match(nav, /'\/verify\/api-proxy\.php\/linked-role\/mole'/,
      "the fallback is the recovery route — a dead one is worse than none");
    assert.ok(!/:\s*'\/linked-role\/mole'/.test(nav));
  });
});
