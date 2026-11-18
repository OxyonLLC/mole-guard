// The proxy's wildcard CORS header must stay scoped to the supply endpoints.
//
// WHY THIS IS PINNED. api-proxy.php forwards no upstream headers — it stamps
// its own Content-Type and Cache-Control on every response — so the Node
// backend's `Access-Control-Allow-Origin: *` on /api/supply/* never reached the
// caller. External listing services (Jupiter's verified.jup.ag review,
// CoinGecko, CMC) validate from a browser, and a browser cannot read a response
// with no CORS header. The proxy now sends one for those two paths.
//
// The danger is the obvious "fix" someone reaches for next: hoisting that
// header out of its branch so it applies to everything. That would let any
// origin read EVERY proxied API response, including authenticated ones. These
// two paths are safe to open because they are public, read-only, carry no
// credentials and expose a single number each. Nothing else is.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(repoRoot, "src/public/verify/api-proxy.php"), "utf8");

describe("api-proxy.php: wildcard CORS is scoped, not global", () => {
  test("the supply paths are matched exactly — no prefix, no trailing slash", () => {
    assert.match(source, /\$isPublicSupplyPath\s*=\s*\(bool\)\s*preg_match\(\s*'#\^\/api\/supply\/\(\?:circulating\|total\)\$#'/,
      'the pattern must be anchored at both ends, or /api/supply/circulating/../wallet/... could inherit CORS');
  });

  test("every Access-Control-Allow-Origin sits inside the supply branch", () => {
    const lines = source.split("\n");
    const corsLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /Access-Control-Allow-Origin/.test(line) && !/^\s*(\/\/|\*|#)/.test(line));

    assert.ok(corsLines.length > 0, 'the header must actually be sent somewhere');

    for (const { line, i } of corsLines) {
      // Walk back to the nearest guard and confirm it is the supply one.
      const preceding = lines.slice(Math.max(0, i - 12), i).join("\n");
      assert.match(preceding, /\$isPublicSupplyPath/,
        `unguarded CORS header at line ${i + 1}: ${line.trim()} — a global wildcard would expose every proxied API response`);
    }
  });

  test("non-supply responses keep no-store and JSON", () => {
    assert.match(source, /}\s*else\s*{\s*\n\s*header\('Content-Type: application\/json'\);\s*\n\s*header\('Cache-Control: no-store'\);/,
      'the previous behaviour must remain the default for every other path');
  });

  test("plain-text format is only honoured on a supply path", () => {
    assert.match(source, /\$wantsPlainText\s*=\s*\$isPublicSupplyPath/,
      'format=plain must not be able to change the Content-Type of any other proxied route');
  });
});
