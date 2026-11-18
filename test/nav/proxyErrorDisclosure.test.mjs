// The API proxies must never hand curl's error text to the browser.
//
// Content-audit register #26. /verify/api-proxy.php echoed curl_error() in its
// 502 body, which names the backend tunnel host — so the private origin was
// published precisely when the tunnel was down and people were most likely to
// be looking. The /geoagora/ copies had already been fixed; this one had not,
// because the fix was written and deliberately reverted when no PHP parser was
// available to check a file that gates every API call on the site.
//
// This guard is written in JS on purpose. php-cli was installed on 2026-08-12
// and the fix was verified by executing the real failure branch, but php is not
// guaranteed to exist in every environment `npm test` runs in — a guard that
// silently skips is not a guard. Text is enough here: the rule is simply that
// curl_error's value may reach a log and nothing else.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicRoot = resolve(repoRoot, "src/public");

function phpFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...phpFiles(full));
    else if (entry.name.endsWith(".php")) out.push(full);
  }
  return out;
}

const files = phpFiles(publicRoot).map((file) => ({
  path: relative(repoRoot, file),
  source: readFileSync(file, "utf8"),
}));

test("the proxies this guards are actually present", () => {
  // Guard the guard: if the files move, every assertion below passes vacuously.
  const proxies = files.filter((f) => f.path.endsWith("api-proxy.php"));
  assert.ok(proxies.length >= 3, `only found ${proxies.length} api-proxy.php files`);
});

describe("no PHP proxy discloses curl's error text", () => {
  test("every curl_error() call feeds a log and nothing else", () => {
    const offenders = [];
    for (const { path, source } of files) {
      source.split("\n").forEach((line, i) => {
        if (!line.includes("curl_error(")) return;
        const trimmed = line.trim();
        // Comments explaining the rule are not violations of it.
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (line.includes("error_log(")) return;
        offenders.push(`${path}:${i + 1}: ${trimmed}`);
      });
    }
    assert.deepEqual(
      offenders,
      [],
      "curl_error() must only be passed to error_log(). Reaching a response body " +
        `publishes the backend host to any visitor:\n${offenders.join("\n")}`,
    );
  });

  test("no proxy emits a 'detail' field in an error body", () => {
    // The specific shape #26 shipped. Narrower than the rule above and kept
    // because it is the exact regression, not a paraphrase of it.
    const offenders = files
      .filter(({ source }) => /'detail'\s*=>/.test(source))
      .map(({ path }) => path);
    assert.deepEqual(
      offenders,
      [],
      `error responses must not carry a 'detail' field: ${offenders.join(", ")}`,
    );
  });
});
