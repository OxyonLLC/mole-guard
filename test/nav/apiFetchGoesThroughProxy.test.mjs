// On winlew.co there is NO direct route to the Node backend at /api/*.
// Apache 404s every one of them; only /verify/api-proxy.php (forwarding to
// the active ngrok tunnel) reaches Node. Confirmed live 2026-08-08:
//
//   GET https://winlew.co/api/price/status        -> 404
//   GET https://winlew.co/api/transparency/status -> 404
//   GET https://winlew.co/api/burn/status         -> 404
//   GET https://winlew.co/verify/api-proxy.php?path=/api/price/status -> 200
//
// A bare fetch("/api/...") therefore works in local/Docker testing, where
// Node serves /api itself, and fails ONLY in production. That is the worst
// possible failure shape, and it had already shipped four separate times:
// the landing page's price, burn and supply stats (all six figures on the
// "How to Buy" card were blank), /home/'s market snapshot, and the Forge's AI
// call. Nothing errored loudly — the widgets just showed "—".
//
// Every /api/ call from a served page must go through
// window.WinLEWAuth.hubApiUrl() / hubApiFetch(), which rewrite the path on
// the shared host and are a no-op locally.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = resolve(repoRoot, "src/public");

// Bundled third-party app builds we do not author and cannot meaningfully
// lint, plus scratch dirs. /wallet/ and /geoagora/ ship their own compiled
// bundles with their own API arrangements.
const SKIP_DIRS = new Set([".tmp-shots", ".tmp-audit", "log", "geoagora", "wallet", "node_modules"]);

function servedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(full);
        continue;
      }
      if (/\.(html|js)$/i.test(entry) && !/^index-[A-Za-z0-9_-]{6,}\.js$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(publicDir);
  return out;
}

test("no served page fetches /api/ directly", () => {
  // Matches fetch("/api/…"), fetch('/api/…') and fetch(`/api/…`) — a literal
  // absolute API path handed straight to fetch. Calls wrapped in api(),
  // hubApiUrl() or hubApiFetch() do not match, which is the point.
  const direct = /fetch\(\s*['"`]\/api\//;
  const offenders = [];

  for (const file of servedFiles()) {
    const rel = relative(repoRoot, file);
    // wallet-auth.js documents the rule in prose; legacy-app.js is dead code
    // referenced by no page (verified 2026-08-08) and is left as-is.
    if (rel.endsWith("assets/wallet-auth.js")) continue;
    if (rel.endsWith("mole-hub/js/legacy-app.js")) continue;

    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // Skip comment lines — several of them quote the broken pattern on
      // purpose to explain why it was wrong.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      if (direct.test(line)) offenders.push(`${rel}:${i + 1}  ${trimmed.slice(0, 90)}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "These fetch /api/ directly, which 404s on winlew.co and silently blanks the widget " +
      "(it works locally, so testing by hand will not catch it). Route through " +
      "window.WinLEWAuth.hubApiUrl():\n  " + offenders.join("\n  ")
  );
});

test("the pages that lost this bug still load wallet-auth.js", () => {
  // hubApiUrl() lives in wallet-auth.js. If a page stops loading it, every
  // call silently falls back to the bare /api/ path and 404s again — the
  // optional-chaining guards make that failure quiet rather than loud.
  for (const page of ["index.html", "home/index.html", "winlew-forge/index.html"]) {
    const src = readFileSync(resolve(publicDir, page), "utf8");
    assert.match(
      src,
      /<script src="\/assets\/wallet-auth\.js"><\/script>/,
      `${page} must load assets/wallet-auth.js — it provides hubApiUrl().`
    );
  }
});

test("/home/ defers its first stats load until scripts have parsed", () => {
  // /home/'s script block sits ~370 lines above its wallet-auth.js tag, so a
  // bare loadStats() at parse time runs before hubApiUrl() exists. The 30s
  // refresh interval then quietly repaired it, which is exactly why the bug
  // was hard to see: broken on load, fine half a minute later.
  const src = readFileSync(resolve(publicDir, "home/index.html"), "utf8");
  assert.match(
    src,
    /document\.addEventListener\("DOMContentLoaded",\s*\(\)\s*=>\s*loadStats\(\)\)/,
    "/home/ must defer the initial loadStats() to DOMContentLoaded so wallet-auth.js has loaded."
  );
});
