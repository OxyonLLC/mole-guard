// The sprint report (§68) is the document someone reads to decide whether to
// approve mainnet. Its counts and claims are the kind of thing that is true on
// the day it is written and quietly false a month later.
//
// So the falsifiable parts are checked against the repository.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");
const report = read("docs/cunt/CUNT-SPRINT-RESULTS.md");

test("§68's 22 sections are all present", () => {
  const sections = [...report.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepEqual(
    sections,
    Array.from({ length: 22 }, (_, i) => i + 1),
    "§68 specifies 22 numbered sections, in order"
  );
});

test("the counts it reports are true", () => {
  const docs = readdirSync(resolve(repoRoot, "docs/cunt")).filter(
    (f) => f.endsWith(".md") && !f.includes("SPRINT-RESULTS")
  );
  const modules = readdirSync(resolve(repoRoot, "src/cunt")).filter((f) => f.endsWith(".js"));
  const testFiles = [
    ...readdirSync(resolve(repoRoot, "test/cunt")).map((f) => `test/cunt/${f}`),
    ...readdirSync(resolve(repoRoot, "test/ci")).map((f) => `test/ci/${f}`),
  ].filter((f) => f.endsWith(".mjs"));
  const testCount = testFiles.reduce((n, f) => n + (read(f).match(/^test\(/gm) || []).length, 0);

  assert.ok(report.includes(`**${docs.length} documents**`), `report must say ${docs.length} documents`);
  assert.ok(report.includes(`**${modules.length} modules**`), `report must say ${modules.length} modules`);
  assert.ok(report.includes(`**${testCount} tests**`), `report must say ${testCount} tests`);
});

test("it does not claim anything was deployed", () => {
  // The single most important property of this document. If the sprint ever
  // does deploy, this test should be deleted deliberately, not edited around.
  const manifest = JSON.parse(read("cunt-project.json"));
  assert.equal(manifest.status.deployment_status, "NOT_DEPLOYED");
  assert.match(report, /Nothing was deployed\. No token exists\. Zero mainnet transactions\./);
  assert.match(report, /\*\*STOP\.\*\*/, "§61 Phase I requires the report to end by stopping");
  assert.ok(
    !/we deployed|now live on mainnet|mint created/i.test(report),
    "the report must not describe a deployment"
  );
});

test("it does not call the internal review an audit", () => {
  // §38. The report is exactly where this mistake would be made, because
  // "security findings" invites the word.
  const claimsAudit = /(?:third[- ]party|external|independent)\s+audit\s+(?:complete|done|passed)/i;
  assert.ok(!claimsAudit.test(report), "no third-party audit has happened");
  assert.match(report, /independent review/i, "it must name the independent review as outstanding");
});

test("the findings it leads with are the ones that contradict the spec", () => {
  // §68 asks for an executive summary. The useful version says what was WRONG,
  // not what was produced — four premises this sprint overturned.
  for (const finding of [
    /no vanity grinder to audit/i,
    /47 years/i,
    /does not exist on Solana|split-key/i,
    /[Uu]pgrade authority dominates/,
  ]) {
    assert.match(report, finding, `the summary must carry the finding: ${finding}`);
  }
});
