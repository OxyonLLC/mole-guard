// /verify/ is opened from Discord as /verify/?session=<token>. That token is a
// bearer credential: anyone holding it inside its 15-minute life can complete a
// wallet link and point the account's faucet and payout wallets at their own
// address (walletLink.js buildVerifiedWalletRecord). It must never be handed to
// a third party.
//
// It was. Until 2026-08-05 the desktop handoff drew its QR code by setting
// img.src to api.qrserver.com with the full verify URL — token included — in
// the query string. It fired automatically on every desktop load, including for
// visitors who never expanded that section, because an <img> fetches whether or
// not its <details> is open. Confirmed in a real browser before removal.
//
// phantom.app / solflare.com / geowallet are allowed below: those receive the
// URL only when the user clicks a handoff button, and handing the page to the
// wallet you are verifying with IS the feature. An unrelated service rendering
// a picture is not.
//
// 2026-08-10: that allowance was doing more work than it looked. "Handing the
// page to the wallet" is the feature; handing it the CREDENTIAL is not, and
// those were the same act only because the URL carried both. The desktop
// hand-off now builds its link from window.location.origin and passes a
// hand-off id redeemed by a six-digit code that never leaves the desktop
// screen, so Phantom and Solflare receive a location and nothing else. See
// src/mole/webHandoff.js.
//
// The MOBILE path leaked the same way and worse: wallet-auth.js is loaded by
// 56 pages and its wallet picker can open a wallet browser from any of them, so
// `target = window.location.href` shipped the token from any page reached by a
// Discord link. Now closed too, with the honest caveat that a same-device
// hand-off has no second screen and therefore no pairing code — see
// HANDOFF_MODES.DIRECT in src/mole/webHandoff.js. DIRECT turns a session token
// good for hours into a single-use id good for two minutes; that is a large
// improvement and it is NOT equivalent to the desktop flow.
//
// The root cause of both was the same and is worth naming: all three
// build*BrowseUrl() helpers took `url = currentBrowseUrl()` as a DEFAULT
// ARGUMENT, so any call written without an argument silently shipped the
// current URL. The default is gone and the parameter is required, which is what
// makes the leak impossible by omission rather than by vigilance.
//
// Still open, tracked as register #28: the flow reads the session only from the
// query string, so ?session= cannot simply be stripped from the URL after
// pickup. That is the change that would remove the whole class.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const linkJs = readFileSync(resolve(repoRoot, "src/public/verify/link.js"), "utf8");
const verifyHtml = readFileSync(resolve(repoRoot, "src/public/verify/index.html"), "utf8");

// Wallet vendors the handoff legitimately opens, on explicit user action.
const ALLOWED_HOSTS = new Set([
  "phantom.app",
  "solflare.com",
  "geowallet.app",
  "www.geowallet.app",
]);

/**
 * Source with comments removed. These tests must judge CODE, not prose — the
 * comment left where the QR used to be deliberately quotes the removed
 * api.qrserver.com line so the next reader knows what not to reinstate, and
 * that record must not itself trip the check.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * The body of one named function, by brace matching.
 *
 * Written after a guard in this file passed while checking nothing. It used
 * `/function buildWalletTarget\(\)\s*\{[\s\S]*?new URL\(…origin\)/` — and
 * `[\s\S]*?` is unbounded, so when the real call was sabotaged the regex simply
 * scanned on and matched an identical expression in a LATER function. The
 * assertion was green and vacuous. Slice the body first, then assert inside it.
 */
function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found — the file changed shape`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `no body found for ${signature}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${signature}`);
}

/** Hosts referenced by absolute URLs in a source file, comments excluded. */
function referencedHosts(source) {
  return [
    ...new Set(
      [...codeOnly(source).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1].toLowerCase())
    ),
  ];
}

test("link.js contacts no third party beyond the wallet vendors it hands off to", () => {
  const unexpected = referencedHosts(linkJs).filter((h) => !ALLOWED_HOSTS.has(h));
  assert.deepEqual(
    unexpected,
    [],
    `/verify/ builds URLs for unexpected hosts: ${unexpected.join(", ")}. The page URL carries ` +
      `?session=<token>; sending it anywhere but the user's own wallet leaks a credential.`
  );
});

test("the QR-by-third-party pattern is gone and stays gone", () => {
  assert.ok(!/qrserver|chart\.googleapis|quickchart|goqr/i.test(codeOnly(linkJs)),
    "link.js references a third-party QR renderer again — build any QR locally instead.");
  assert.ok(!/id=["']handoffQr["']/.test(codeOnly(verifyHtml)),
    "The handoffQr element is back. If a QR is restored it must be generated locally, " +
      "never by sending the session URL to another host.");
});

test("the handoff still offers the paths that actually work", () => {
  // The fix must not have quietly removed the working handoff.
  for (const id of ["handoffLink", "btnCopyHandoff", "btnOpenHandoffPhantom", "btnOpenHandoffSolflare"]) {
    assert.ok(verifyHtml.includes(id), `handoff control ${id} is missing from /verify/`);
  }
});

test("the desktop hand-off link is built from the origin, never the current URL", () => {
  // THE assertion for this fix. The old code used canonicalVerifyUrl(), which
  // preserves the query string — so the "verify link" was
  // /verify/?session=<live token>, and the Phantom/Solflare buttons put it in
  // the path of a request to those companies. Building from origin makes that
  // impossible by construction, whatever the current URL happens to hold.
  const code = codeOnly(linkJs);
  const body = functionBody(code, "function handoffUrlFor");
  assert.match(
    body,
    /new URL\("\/verify\/",\s*window\.location\.origin\)/,
    "handoffUrlFor() must construct from window.location.origin. If it ever reads " +
      "location.href or canonicalVerifyUrl(), whatever is in the query string — including " +
      "?session=<token> — ships to Phantom and Solflare."
  );
  assert.ok(
    !/location\.href/.test(body),
    "handoffUrlFor() reads the current URL."
  );

  for (const handler of ["btnCopyHandoff", "btnOpenHandoffPhantom", "btnOpenHandoffSolflare"]) {
    const region = code.slice(code.indexOf(`$("${handler}")`));
    const body = region.slice(0, region.indexOf("});") + 3);
    assert.ok(
      body.includes("handoffUrlFor("),
      `${handler} must send handoffUrlFor(...) — it is the only URL here guaranteed free of the session token.`
    );
    assert.ok(
      !body.includes("canonicalVerifyUrl(") && !body.includes("location.href"),
      `${handler} reads the current URL again. That is exactly how the session token leaked.`
    );
  }
});

test("the pairing code is never put in the hand-off link", () => {
  // A code that travels with the link is not a second factor, it is decoration.
  const code = codeOnly(linkJs);
  assert.ok(
    !/searchParams\.set\(\s*["'](c|code|pairingCode)["']/.test(code),
    "A pairing code is being added to a URL. The whole design rests on the code and the " +
      "link travelling by different routes."
  );
});

test("the page explains that the code, not the link, is the secret", () => {
  // The old copy said "Treat this link like a password", which was true and is
  // now misleading: the link is inert and the six digits are what matter. A
  // user told the wrong thing guards the wrong thing.
  assert.match(
    verifyHtml,
    /The code never leaves this screen/i,
    "The hand-off panel must tell the user the pairing code is the secret."
  );
  assert.ok(
    !/Treat this link like a password/i.test(verifyHtml),
    "Stale warning: the hand-off link no longer contains a session token, and saying it does " +
      "trains users to protect the wrong half of the exchange."
  );
});

// ── The mobile path ────────────────────────────────────────────────────────
// wallet-auth.js is loaded by 56 pages and its wallet picker can open a wallet
// browser from any of them, so `target = window.location.href` leaked the
// session token from any page reached by a Discord link — more often than the
// desktop panel ever did. These pin the replacement.
const walletAuthJs = readFileSync(resolve(repoRoot, "src/public/assets/wallet-auth.js"), "utf8");

test("the mobile wallet target is built from origin + pathname, never the full URL", () => {
  const code = codeOnly(walletAuthJs);
  const target = functionBody(code, "async function buildWalletTarget");
  assert.match(
    target,
    /new URL\(window\.location\.pathname,\s*window\.location\.origin\)/,
    "buildWalletTarget() must construct from origin + pathname. Reading location.href here " +
      "is what put a live session token into Phantom's and Solflare's access logs."
  );
  assert.ok(
    !/location\.href/.test(target),
    "buildWalletTarget() reads the current URL — that is the leak, exactly."
  );
  const opener = functionBody(code, "async function openMobileWalletBrowser");
  assert.ok(
    !/target\s*=\s*window\.location\.href/.test(opener),
    "openMobileWalletBrowser() assigns location.href to the wallet target again."
  );
});

test("a failed hand-off never falls back to the leaking URL", () => {
  // The tempting 'catch { target = location.href }' would restore the exact bug
  // at the exact moment something is already going wrong.
  const body = functionBody(codeOnly(walletAuthJs), "async function openMobileWalletBrowser");
  assert.ok(/return;/.test(body), "openMobileWalletBrowser() must bail out when the hand-off fails.");
  assert.ok(
    !/location\.href/.test(body.slice(0, body.indexOf("const walletUrl"))),
    "openMobileWalletBrowser() reads location.href before choosing a wallet URL — fail closed instead."
  );
});

test("no wallet-URL builder defaults to the current location", () => {
  // The original leak was a DEFAULT PARAMETER: all three builders in link.js
  // read `url = currentBrowseUrl()`, so any call written without an argument
  // silently shipped ?session=<token>. The parameter is now required in both
  // files, which makes the leak impossible by omission.
  for (const [name, source] of [["link.js", linkJs], ["wallet-auth.js", walletAuthJs]]) {
    const code = codeOnly(source);
    const defaults = [...code.matchAll(/function build(?:Phantom|Solflare|GeoWallet)BrowseUrl\(([^)]*)\)/g)]
      .map((m) => m[1].trim())
      .filter((arg) => arg.includes("="));
    assert.deepEqual(
      defaults,
      [],
      `${name} has a wallet-URL builder with a default argument (${defaults.join("; ")}). ` +
        "Require the caller to pass a target — a default is how the session token leaked."
    );
  }
  assert.ok(
    !/function currentBrowseUrl/.test(codeOnly(linkJs)),
    "currentBrowseUrl() is back. It existed only to be a leaking default."
  );
});

test("the site-wide claim never spends a hand-off it does not need", () => {
  const body = functionBody(codeOnly(walletAuthJs), "async function claimDirectHandoffFromUrl");
  assert.ok(
    /if \(getAuth\(\)\.session\) return;/.test(body),
    "claimDirectHandoffFromUrl() must bail when a session already exists — otherwise a reload " +
      "burns a hand-off, and hand-offs are single-use."
  );
});

test("the verify flow requests a signature and never a transaction", () => {
  // The page's headline safety claim: "it cannot move funds."
  for (const banned of ["signTransaction", "signAllTransactions", "sendTransaction", "signAndSendTransaction"]) {
    assert.ok(
      !linkJs.includes(banned),
      `link.js references ${banned}. /verify/ promises a signature-only flow that "cannot move funds".`
    );
  }
  assert.ok(linkJs.includes("signMessage"), "link.js should sign a message");
});
