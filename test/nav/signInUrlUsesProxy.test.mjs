// The Sign in link must go through the API proxy.
//
// It shipped pointing straight at "/linked-role/mole?next=/", which returns 404
// on winlew.co: Apache serves none of the backend's routes there, and only
// /verify/api-proxy.php reaches Node. So the button rendered perfectly, looked
// real, and went nowhere — the same "there is nowhere to sign in" defect it was
// built to fix, wearing a disguise. Verified against production at the time:
// direct 404, proxied 302 to Discord.
//
// Nothing caught it because every existing proxy test covers /api/ paths, and
// this was the first non-/api backend route linked from the UI.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const walletAuth = readFileSync(resolve(repoRoot, "src/public/assets/wallet-auth.js"), "utf8");

describe("discordSignInUrl: routed through the proxy, not straight at the backend", () => {
  const fn = walletAuth.slice(
    walletAuth.indexOf("function discordSignInUrl"),
    walletAuth.indexOf("window.WinLEWAuth = {"),
  );

  test("the URL is built with hubApiUrl()", () => {
    assert.match(fn, /return\s+hubApiUrl\(/,
      'a bare /linked-role/ link 404s on the shared host — it must go through hubApiUrl()');
  });

  test("it never returns a raw backend path", () => {
    assert.ok(!/return\s+`\/linked-role/.test(fn),
      'returning the path directly is exactly the bug this file exists to prevent');
  });

  test("the nav button uses the shared builder rather than hardcoding a URL", () => {
    const nav = readFileSync(resolve(repoRoot, "src/public/assets/nav.js"), "utf8");
    const builder = nav.slice(nav.indexOf("function ensureSignInButton"), nav.indexOf("function ensureAccountChips"));
    assert.match(builder, /auth\.discordSignInUrl\(\)/,
      'one place builds this URL; a second copy is a second thing to get wrong');
    // The literal fallback is allowed ONLY as a last resort when wallet-auth.js
    // has not loaded — at which point nothing on the page works anyway.
    const fallbacks = builder.match(/'\/linked-role\/mole'/g) || [];
    assert.ok(fallbacks.length <= 1, 'at most one last-resort literal');
  });
});
