// The CI workflow guards the repository. These tests guard the workflow.
//
// A CI config is a privileged execution environment that runs on every push,
// and its dangerous properties are all invisible in a diff: a `permissions`
// line quietly removed, a marketplace action added, a `secrets.*` reference
// introduced "just for this one step". Each is a one-line change that reads as
// harmless and turns the job that protects secrets into a place they leak from.
//
// So the properties are asserted rather than trusted to review.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = resolve(repoRoot, ".github/workflows/ci.yml");

test("the CI workflow exists", () => {
  // §56 requires automated checks. This test failing means the top HIGH in
  // CUNT-SECURITY-MODEL.md has reopened.
  assert.ok(existsSync(workflowPath), ".github/workflows/ci.yml is missing — CI is the §56 requirement");
});

const wf = readFileSync(workflowPath, "utf8");
const code = wf.replace(/^\s*#.*$/gm, ""); // strip comments; they discuss what they forbid

test("least privilege — the workflow does not take write access", () => {
  assert.match(code, /permissions:\s*\n\s*contents:\s*read/, "top-level `permissions: contents: read` must be present");
  assert.ok(!/contents:\s*write/.test(code), "no job may request write access to the repository");
  assert.ok(!/permissions:\s*write-all/.test(code), "write-all is never acceptable here");
});

test("no job is handed a secret", () => {
  // These checks run on public code. A CI job that holds a credential is a
  // place a credential can leak from, and none of these steps needs one.
  assert.ok(
    !/\$\{\{\s*secrets\./.test(code),
    "a step references secrets.* — CI must not need a credential to test public code"
  );
});

test("only first-party actions are used", () => {
  // A marketplace action is a supply-chain dependency executing with repository
  // context. §57 asks us to audit dependencies; an unaudited one in the job
  // that guards secrets is the wrong trade.
  const uses = [...code.matchAll(/uses:\s*([^\s]+)/g)].map((m) => m[1]);
  const thirdParty = uses.filter((u) => !/^actions\/(checkout|setup-node)@v\d+$/.test(u));
  assert.deepEqual(
    thirdParty,
    [],
    `third-party or unpinned actions found: ${thirdParty.join(", ")}. Only actions/checkout and ` +
      `actions/setup-node, pinned to a major version, are allowed.`
  );
  assert.ok(uses.length > 0, "guard the guard — the parse must actually find actions");
});

test("the three §56 checks are all wired", () => {
  for (const [what, pattern] of [
    ["secret scan", /scan-secrets\.js/],
    ["test suite", /npm (test|run test:ci)\b/],
    ["dependency audit", /npm audit/],
  ]) {
    assert.match(code, pattern, `the ${what} is not run by CI`);
  }
});

test("CI runs every npm test file: in the Tests job or in the Isolated job", async () => {
  // test:ci = npm test's files minus the supervised stages the Isolated job
  // runs. If the patterns drifted, or a stage were excluded here but missing
  // from the matrix, CI could quietly stop running tests.
  const scripts = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).scripts;
  assert.equal(scripts["test:ci"], "node tools/ci/run-suite.mjs");
  const suite = await import("../../tools/ci/run-suite.mjs");
  const npmTestPatterns = scripts.test.split(/\s+/).filter((w) => !w.startsWith("-") && w !== "node");
  assert.deepEqual(suite.PATTERNS, npmTestPatterns, "run-suite patterns must equal npm test's");
  const matrix = (code.match(/stage:\s*\[([^\]]*)\]/) || [])[1]?.split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(matrix, suite.isolatedStages(), "the Isolated job matrix must run exactly tools/ci/isolated-stages.json");
  const all = new Set(suite.expand());
  for (const f of suite.excludedFiles()) assert.ok(all.has(f), `${f} is excluded from test:ci but npm test does not run it`);
  assert.match(code, /run\.cjs \$\{\{ matrix\.stage \}\}/, "the Isolated job must run the supervisor per stage");
  assert.match(code, /test-baseline\.mjs check/, "the known-failures gate must run after the suite");
});

test("the secret scanner runs without installing dependencies", () => {
  // The scan job deliberately has no `npm ci`: it must not be possible for a
  // malicious package install to compromise the job that looks for leaked keys.
  const scanJob = code.slice(code.indexOf("secrets:"), code.indexOf("test:"));
  assert.match(scanJob, /scan-secrets\.js/, "parse check — the scan job must be the one found");
  assert.ok(!/npm ci/.test(scanJob), "the secret-scan job must not install dependencies before scanning");
});

test("the scanner itself has no dependencies", () => {
  // Same property, enforced at the source. Any non-`node:` import would give
  // the scan job an install step and undo the test above.
  const src = readFileSync(resolve(repoRoot, "src/scripts/scan-secrets.js"), "utf8");
  const imports = [...src.matchAll(/^import\s+.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const external = imports.filter((i) => !i.startsWith("node:"));
  assert.deepEqual(external, [], `scan-secrets.js must import only node: builtins, found: ${external.join(", ")}`);
});

test("the scanner never prints matched text", () => {
  // §56: "CI must never print secrets." The reporting path must log the rule
  // and location only. This checks no console call interpolates a match.
  const src = readFileSync(resolve(repoRoot, "src/scripts/scan-secrets.js"), "utf8");
  const logs = [...src.matchAll(/console\.log\(([\s\S]{0,160}?)\);/g)].map((m) => m[1]);
  for (const l of logs) {
    assert.ok(
      !/\bm\[0\]|\.match\b|matchedText|f\.text|rule\.regex/.test(l),
      `a console.log appears to interpolate matched content: ${l.slice(0, 80)}`
    );
  }
  assert.ok(logs.length > 0, "guard the guard — console calls must actually be found");
});

test("the secret scanner is actually tracked in git", () => {
  // It very nearly was not. `.gitignore` carries `**/*secret*` to block secret
  // FILES, and that pattern also matched `scan-secrets.js` — the scanner
  // itself. CI would have failed on every push with "module not found", and
  // the cause would not have been obvious from the error.
  //
  // An explicit `!src/scripts/scan-secrets.js` negation fixes it; this test
  // makes sure a future tidy-up of .gitignore cannot silently undo it.
  const tracked = execSync("git ls-files src/scripts/scan-secrets.js", { cwd: repoRoot })
    .toString()
    .trim();
  assert.equal(
    tracked,
    "src/scripts/scan-secrets.js",
    "scan-secrets.js is not tracked — check the `**/*secret*` rule in .gitignore has its negation"
  );
});

test("npm is the only package manager — no second lockfile", () => {
  // Decided 2026-08-08. yarn.lock and package-lock.json both existed and
  // resolved DIFFERENT trees: nanoid 5.1.7 vs 5.1.16, http-proxy-middleware
  // 3.0.5 vs 3.0.7. Security patches landed in one and not the other, and
  // nothing surfaced the divergence — a dependency review measured the wrong
  // tree and reported it fixed.
  //
  // Two lockfiles is not untidiness, it is two sources of truth that must be
  // updated in lockstep by hand with nothing enforcing it.
  for (const stray of ["yarn.lock", ".yarnrc.yml", "pnpm-lock.yaml"]) {
    const tracked = execSync(`git ls-files ${stray}`, { cwd: repoRoot }).toString().trim();
    assert.equal(tracked, "", `${stray} is tracked. This project uses npm; a second lockfile means two trees.`);
  }
  assert.ok(
    existsSync(resolve(repoRoot, "package-lock.json")),
    "package-lock.json must exist — it is the single source of truth for the dependency tree"
  );
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  assert.ok(
    !pkg.packageManager || pkg.packageManager.startsWith("npm@"),
    `package.json declares packageManager "${pkg.packageManager}" — it must be npm or absent`
  );
});
