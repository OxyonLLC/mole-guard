// The API proxy must refuse fast when the backend is down.
//
// 2026-08-15: winlew.co became unreachable — static files and FTP included —
// while the backend behind the tunnel answered in 0.3s throughout. On shared
// hosting the account gets a small number of concurrent worker processes, and
// every API call parks one in api-proxy.php until curl returns. With the tunnel
// not answering, each request held a worker for the full timeout; enough of
// them and the account has nothing left, at which point the host stops serving
// the whole site. The owner saw it directly: stop the bot, the website dies.
//
// The breaker converts that into "the API returns errors for 30 seconds".
//
// Written in JS, like proxyErrorDisclosure.test.mjs, because php is not
// guaranteed in every environment `npm test` runs in and a guard that silently
// skips is not a guard. The logic itself was verified by executing the real
// functions under php-cli, and end-to-end with curl_* shimmed: an open breaker
// never reaches curl_init.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROXY = resolve(repoRoot, "src/public/verify/api-proxy.php");
const src = readFileSync(PROXY, "utf8");

describe("the breaker short-circuits before any socket is opened", () => {
  test("the open check precedes curl_init", () => {
    // The entire value is in NOT opening a connection. If this check ever moves
    // below curl_init, the breaker still returns 503 but the worker is already
    // held — which is the cost it exists to avoid.
    const check = src.indexOf("winlew_breaker_is_open(time())");
    const init = src.indexOf("curl_init(");
    assert.ok(check > 0, "breaker check missing");
    assert.ok(init > 0, "curl_init missing");
    assert.ok(check < init, "the breaker check must run BEFORE curl_init, or it holds a worker anyway");
  });

  test("the open branch exits rather than falling through", () => {
    const branch = src.slice(src.indexOf("if (winlew_breaker_is_open(time()))"), src.indexOf("$ch = curl_init"));
    assert.match(branch, /http_response_code\(503\)/);
    assert.match(branch, /Retry-After/);
    assert.match(branch, /\bexit;/);
  });

  test("it never discloses the backend host", () => {
    // Same rule as register #26: the 503 body is a fixed string.
    const branch = src.slice(src.indexOf("if (winlew_breaker_is_open(time()))"), src.indexOf("$ch = curl_init"));
    assert.ok(!/\$target/.test(branch), "the breaker response references the target URL");
    assert.match(branch, /backend_unavailable/);
  });
});

describe("what trips it, and what must not", () => {
  test("a connection failure counts", () => {
    const failBranch = src.slice(src.indexOf("if ($response === false)"), src.indexOf("$headerSize ="));
    assert.match(failBranch, /winlew_breaker_record_failure/);
  });

  test("only gateway statuses count, never a 4xx", () => {
    // A 401 or a 404 is the application answering correctly. Counting those
    // would open the breaker during normal operation — signed-out users alone
    // would take the API down.
    const idx = src.indexOf("$statusCode === 502");
    assert.ok(idx > 0, "gateway-status handling missing");
    // The whole if/else, not a fixed slice — the branch grew when gateway
    // bodies stopped being relayed, and a fixed length silently cut the else
    // arm off, which is how this guard broke without the rule changing.
    const end = src.indexOf("winlew_breaker_record_success", idx);
    assert.ok(end > idx, "the success arm no longer follows the gateway check");
    const condition = src.slice(idx, src.indexOf("{", idx));
    assert.match(condition, /502/);
    assert.match(condition, /503/);
    assert.match(condition, /504/);
    assert.ok(!/40\d/.test(condition), "a 4xx must not trip the breaker");
  });

  test("a gateway error body is never relayed to the browser", () => {
    // Observed live 2026-08-15: with the bot not listening, ngrok answered with
    // its own branded HTML — ERR_NGROK_8012, naming localhost:8787 and the
    // tunnel host — and this file echoed it straight through under a JSON
    // content type. Register #26 covered the curl-failure branch but not a
    // successful response carrying somebody else's error page.
    const i = src.indexOf("$statusCode === 502");
    const block = src.slice(i, src.indexOf("} else {", i));
    assert.ok(!/echo \$responseBody/.test(block), "a gateway error body is relayed to the client");
    assert.match(block, /backend_unavailable/);
    assert.match(block, /\bexit;/);
    assert.ok(!/\$target/.test(block), "the gateway response references the backend URL");
  });

  test("a success resets the count", () => {
    assert.match(src, /function winlew_breaker_record_success/);
    assert.match(src, /if \(\$state\['failures'\] !== 0 \|\| \$state\['openedAt'\] !== 0\)/);
  });
});

describe("the breaker can never take the site down itself", () => {
  test("every state read is error-tolerant", () => {
    const read = src.slice(src.indexOf("function winlew_breaker_read"), src.indexOf("function winlew_breaker_write"));
    // Unreadable, missing or malformed state must all mean "closed", i.e. the
    // request proceeds exactly as before. A breaker that fails the other way
    // takes the API offline for a reason nobody can see.
    assert.match(read, /is_file\(\$path\)/);
    assert.match(read, /@file_get_contents/);
    assert.match(read, /!is_array\(\$data\)/);
    assert.equal((read.match(/'failures' => 0, 'openedAt' => 0/g) || []).length, 3,
      "each failure path must return the closed state");
  });

  test("writes never block a request", () => {
    const write = src.slice(src.indexOf("function winlew_breaker_write"), src.indexOf("function winlew_breaker_is_open"));
    assert.match(write, /LOCK_EX \| LOCK_NB/, "a blocking lock would cost the very worker this protects");
    assert.match(write, /@fopen/);
  });

  test("an unwritable temp dir disables it rather than failing", () => {
    const p = src.slice(src.indexOf("function winlew_breaker_path"), src.indexOf("function winlew_breaker_read"));
    assert.match(p, /is_writable\(\$dir\)/);
    assert.match(p, /return null/);
  });

  test("thresholds are sane", () => {
    const threshold = Number(src.match(/WINLEW_BREAKER_THRESHOLD',\s*(\d+)/)[1]);
    const cooldown = Number(src.match(/WINLEW_BREAKER_COOLDOWN_SEC',\s*(\d+)/)[1]);
    assert.ok(threshold >= 2 && threshold <= 10, `threshold ${threshold} — 1 would trip on a single blip`);
    assert.ok(cooldown >= 10 && cooldown <= 300, `cooldown ${cooldown}s — too short thrashes, too long hides recovery`);
  });
});
