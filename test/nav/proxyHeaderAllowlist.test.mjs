// The PHP proxies may forward exactly one header the browser sent.
//
// Content-audit register #28. The proxies build their outbound header list from
// scratch precisely so nothing the visitor sent is carried through — that is
// what stops a browser forging X-WinLEW-Proxy-Secret or X-WinLEW-Client-IP and
// minting its own rate-limit identity. X-WinLEW-Session is the single
// exception, and it is safe for a specific reason: it is a bearer credential
// the browser already holds and can already present as ?session=, so forwarding
// it grants no authority it did not have. It only moves the token out of URLs,
// and therefore out of the shared host's access log.
//
// That reasoning does NOT generalise. Any second header added to the forward
// path needs the same argument made from scratch, so this fails on a new one
// rather than letting the exception quietly become a policy.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = resolve(repoRoot, "src/public");

// Per-proxy, because these are different applications with different auth
// models and one shared list would be a lie about both.
//
// The /geoagora/ entries are pre-existing and were reviewed when this guard was
// written on 2026-08-12, not grandfathered to make it pass. Accept is content
// negotiation. Authorization is that app's own bearer credential and carries
// exactly the argument that justifies X-WinLEW-Session here: the browser
// already holds it and can already send it, so forwarding grants no new
// authority. Neither is CR/LF-validated, which is acceptable because PHP SAPIs
// reject header values containing CR/LF before they ever reach $_SERVER — the
// validation on the session header below is defence in depth and consistency
// with the proxy-secret check beside it, not a fix for a reachable hole.
const ALLOWED_INBOUND = new Map([
  ["src/public/verify/api-proxy.php", new Set(["HTTP_X_WINLEW_SESSION"])],
  ["src/public/geoagora/api-proxy.php", new Set(["HTTP_ACCEPT", "HTTP_AUTHORIZATION"])],
  ["src/public/geoagora/assets/api-proxy.php", new Set(["HTTP_ACCEPT", "HTTP_AUTHORIZATION"])],
]);

function phpFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...phpFiles(full));
    else if (entry.name.endsWith(".php")) out.push(full);
  }
  return out;
}

const proxies = phpFiles(publicRoot)
  .filter((f) => f.endsWith("api-proxy.php"))
  .map((file) => ({ path: relative(repoRoot, file), source: readFileSync(file, "utf8") }));

test("the proxies are where this test thinks they are", () => {
  assert.ok(proxies.length >= 3, `only found ${proxies.length} api-proxy.php files`);
});

describe("proxies forward only the allowlisted browser header", () => {
  test("no proxy reads an inbound header outside the allowlist", () => {
    const offenders = [];
    for (const { path, source } of proxies) {
      const allowed = ALLOWED_INBOUND.get(path);
      assert.ok(allowed, `${path} has no reviewed header allowlist — add one deliberately`);
      // $_SERVER['HTTP_*'] is PHP's view of what the CLIENT sent. Non-HTTP_
      // keys (REMOTE_ADDR, REQUEST_METHOD, PATH_INFO) are observed by the
      // server itself and are not browser claims, so they are out of scope.
      for (const m of source.matchAll(/\$_SERVER\s*\[\s*['"](HTTP_[A-Z0-9_]+)['"]\s*\]/g)) {
        if (!allowed.has(m[1])) offenders.push(`${path}: ${m[1]}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a proxy reads a browser-supplied header that is not allowlisted. Forwarding " +
        "one lets a visitor make a claim only the proxy is allowed to make:\n" +
        offenders.join("\n"),
    );
  });

  test("the session header is validated before it is forwarded", () => {
    // An unvalidated value containing CR/LF would inject additional header
    // lines into the request curl builds — including the very
    // X-WinLEW-Proxy-Secret this design refuses to accept from a browser.
    const forwarding = proxies.filter(({ source }) => source.includes("HTTP_X_WINLEW_SESSION"));
    assert.ok(forwarding.length >= 1, "no proxy forwards the session header — did it get removed?");
    for (const { path, source } of forwarding) {
      assert.match(
        source,
        /preg_match\(\s*'\/\^\[\\x21-\\x7e\]\{\d+,\d+\}\$\/'\s*,\s*\$sessionHeader\s*\)/,
        `${path} forwards X-WinLEW-Session without the printable-ASCII bounds check`,
      );
    }
  });
});
