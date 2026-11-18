#!/usr/bin/env node
// Known-failures gate for CI.
//
//   node tools/ci/test-baseline.mjs check  <results.jsonl> [--base-baseline <file>]
//   node tools/ci/test-baseline.mjs propose <results.jsonl>   print a baseline for the current failures
//
// check fails (exit 1) when:
//   · a test fails that is not in test/known-failures.json        (a new regression)
//   · the baseline gained entries vs the base branch's copy, unless
//     BASELINE_EXPANSION_APPROVED=1 (CI sets that only for a PR carrying the
//     `baseline-expansion-approved` label)
//   · the results file is missing or empty (a crashed run must not pass)
//   · an entry has no reason
// It never hides output: every failure, known or new, is listed, and the full
// spec output is uploaded by CI. Known failures that now PASS are reported so
// they can be removed (the baseline is meant to shrink).
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const BASELINE_PATH = "test/known-failures.json";

export function readResults(text) {
  return String(text).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

export function loadBaseline(text) {
  const b = JSON.parse(text);
  if (!Array.isArray(b.entries)) throw new Error("baseline: entries[] missing");
  return b;
}

/** Pure: compare results with a baseline (and optionally the base branch's baseline). */
export function evaluate({ results, baseline, baseBaseline = null, expansionApproved = false }) {
  const problems = [];
  const known = new Map(baseline.entries.map((e) => [e.id, e]));
  for (const e of baseline.entries) if (!e.reason || !String(e.reason).trim()) problems.push(`baseline entry without a reason: ${e.id}`);
  const dupes = baseline.entries.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set(dupes)) problems.push(`duplicate baseline entry: ${id}`);

  if (!results.length) problems.push("no test results recorded (the run crashed or the reporter was not used)");
  const failing = results.filter((r) => r.status === "fail");
  const failingIds = new Set(failing.map((r) => r.id));
  const passingIds = new Set(results.filter((r) => r.status === "pass").map((r) => r.id));
  const fresh = failing.filter((r) => !known.has(r.id));
  const knownFailing = failing.filter((r) => known.has(r.id));
  const nowPassing = baseline.entries.filter((e) => passingIds.has(e.id) && !failingIds.has(e.id));
  const notSeen = baseline.entries.filter((e) => !passingIds.has(e.id) && !failingIds.has(e.id));
  for (const r of fresh) problems.push(`NEW failure: ${r.id}${r.error ? ` — ${r.error}` : ""}`);

  let added = [];
  if (baseBaseline) {
    const before = new Set(baseBaseline.entries.map((e) => e.id));
    added = baseline.entries.filter((e) => !before.has(e.id));
    if (added.length && !expansionApproved) {
      for (const e of added) problems.push(`baseline EXPANDED without approval: ${e.id}`);
    }
  }
  return {
    pass: problems.length === 0, problems,
    counts: { results: results.length, failing: failing.length, known: knownFailing.length, new: fresh.length,
      baseline: baseline.entries.length, nowPassing: nowPassing.length, notSeen: notSeen.length, added: added.length },
    fresh, knownFailing, nowPassing, notSeen, added,
  };
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, resultsFile] = process.argv.slice(2);
  const results = resultsFile && existsSync(resultsFile) ? readResults(readFileSync(resultsFile, "utf8")) : [];
  if (mode === "propose") {
    const failing = [...new Set(results.filter((r) => r.status === "fail").map((r) => r.id))].sort();
    const today = new Date().toISOString().slice(0, 10);
    console.log(JSON.stringify({ entries: failing.map((id) => ({ id, since: today, reason: "TODO" })) }, null, 2));
    process.exit(0);
  }
  if (mode !== "check") { console.error("usage: test-baseline.mjs check|propose <results.jsonl> [--base-baseline file]"); process.exit(2); }
  const baseline = loadBaseline(readFileSync(BASELINE_PATH, "utf8"));
  const basePath = arg("base-baseline");
  const baseBaseline = basePath && existsSync(basePath) && readFileSync(basePath, "utf8").trim() ? loadBaseline(readFileSync(basePath, "utf8")) : null;
  const r = evaluate({ results, baseline, baseBaseline, expansionApproved: process.env.BASELINE_EXPANSION_APPROVED === "1" });

  const c = r.counts;
  const lines = [
    `## Test baseline gate: ${r.pass ? "PASS" : "FAIL"}`,
    "",
    `| results | failing | known (baseline) | **new** | baseline size | known now passing | added to baseline |`,
    `|---|---|---|---|---|---|---|`,
    `| ${c.results} | ${c.failing} | ${c.known} | **${c.new}** | ${c.baseline} | ${c.nowPassing} | ${c.added} |`,
    "",
  ];
  if (r.problems.length) lines.push("### Problems", ...r.problems.map((p) => `- ${p}`), "");
  if (r.nowPassing.length) lines.push("### Known failures now passing (remove them from test/known-failures.json)", ...r.nowPassing.map((e) => `- ${e.id}`), "");
  if (r.added.length) lines.push(`### Baseline entries added in this change (${process.env.BASELINE_EXPANSION_APPROVED === "1" ? "approved by label" : "NOT approved"})`, ...r.added.map((e) => `- ${e.id}: ${e.reason}`), "");
  lines.push(`<details><summary>All ${c.known} known failures still failing</summary>`, "", ...r.knownFailing.map((x) => `- ${x.id}`), "", "</details>");
  const md = lines.join("\n");
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  for (const f of r.fresh) console.log(`::error title=New test failure::${f.id}${f.error ? ` — ${f.error}` : ""}`);
  for (const e of r.nowPassing) console.log(`::warning title=Known failure now passes::${e.id}`);
  process.exit(r.pass ? 0 : 1);
}
