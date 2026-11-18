// /profile/?wallet=… must reach the dashboard WITH the wallet.
//
// THE EVIDENCE THIS WAS BUILT ON, because two earlier attempts were made on a
// theory and both were wrong:
//
// The static stub at src/public/profile/index.html contains an inline script
// that builds `/verify/profile.html + location.search`. That script is correct
// and has never run. The site sends `script-src 'self'`, so Chromium refuses
// it outright — "Executing inline script violates the following Content
// Security Policy directive 'script-src 'self''" — and the <meta
// http-equiv="refresh"> beneath it has been performing every redirect. A meta
// refresh carries a fixed URL and cannot forward a query string.
//
// The tell was timing: the browser navigated ~1s after load (the meta delay),
// not instantly (the script). Reordering the tags and delaying the meta both
// changed nothing, because the script was never executing at all.
//
// So the redirect is server-side, and registered BEFORE express.static —
// otherwise the stub file answers first and the route never runs, which is the
// second thing this test guards.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = readFileSync(resolve(repoRoot, "src/mole/web.js"), "utf8");

describe("stub redirects preserve their query", () => {
  const tableAt = web.indexOf("const STUB_REDIRECTS = {");
  const table = web.slice(tableAt, web.indexOf("};", tableAt));

  test("every stub whose script tried to keep a query is covered", () => {
    // These are the 11 files under src/public containing `location.search` —
    // the ones that INTENDED to forward a query and never could, because CSP
    // refused the inline script. If a new stub is written the same way, add it
    // here; its script will not run either.
    for (const stub of [
      "/profile", "/profile/", "/profile.html",
      "/discord-index.html",
      "/privacy.html", "/privacy-mole.html", "/privacy-utility.html", "/privacy-watchdog.html",
      "/terms.html", "/terms-mole.html", "/terms-utility.html", "/terms-watchdog.html",
    ]) {
      assert.ok(table.includes(`"${stub}"`), `${stub} must redirect server-side`);
    }
  });

  test("targets are same-origin paths, never absolute URLs", () => {
    // A stub table is a redirect table. An absolute URL in it would be an open
    // redirect with the site's own trust behind it.
    const targets = [...table.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(targets.length >= 12, `expected the full table, found ${targets.length}`);
    for (const t of targets) {
      assert.ok(t.startsWith("/") && !t.startsWith("//"), `${t} must be a same-origin path`);
      assert.ok(!t.includes(":"), `${t} must carry no scheme`);
    }
  });

  test("the whole query is forwarded, not an allowlist", () => {
    const block = web.slice(tableAt, tableAt + 2200);
    assert.match(block, /new URLSearchParams\(req\.query\)/,
      "dropping unknown params is how this bug started; forward everything");
    assert.match(block, /\$\{qs \? `\?\$\{qs\}` : ""\}/,
      "and no stray ? when there is no query");
  });

  test("it is registered BEFORE express.static, or the stub files win", () => {
    // Verified against a running server: with the route after static, the
    // response was 200 (the stub) rather than 302 (the redirect).
    const staticAt = web.indexOf("express.static(PUBLIC_DIR");
    assert.ok(tableAt !== -1 && staticAt !== -1);
    assert.ok(tableAt < staticAt, "a static file registered first answers first, and the redirect never runs");
  });

  test("stubs with nothing to carry are deliberately NOT redirected", () => {
    // /geoagora/ and /geohackers/ stubs exist as a raw-app-path lockdown, and
    // the rest have a fixed destination their meta refresh reaches correctly.
    // Widening this table to them would be churn against a bug they do not
    // have — and would touch a security control for no reason.
    for (const untouched of ["/geoagora.html", "/health.html", "/verify.html", "/landing.html"]) {
      assert.ok(!table.includes(`"${untouched}"`), `${untouched} has no query to preserve`);
    }
  });
});

describe("the CSP that caused this is still in force", () => {
  test("inline scripts are refused site-wide", () => {
    // If this ever relaxes to 'unsafe-inline', the stubs' own scripts would
    // start working and there would be two mechanisms racing. Better to know.
    // Read from the real directive rather than guessed at: an earlier version
    // of this assertion invented a shape and failed for the wrong reason.
    const line = web.split("\n").find((l) => l.includes("scriptSrc:"));
    assert.ok(line, "scriptSrc must exist in the helmet config");
    assert.match(line, /"'self'"/, "script-src 'self' is what blocks the stub scripts");
    assert.ok(!line.includes("unsafe-inline"),
      "inline scripts must stay refused — the redirect no longer depends on one, and re-allowing them is a real relaxation");
  });
});
