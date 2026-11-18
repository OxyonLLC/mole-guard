// The mainnet gate (§60) is the only thing standing between this sprint and a
// live token. A checklist nobody enforces is a checklist, and a checklist a
// build enforces is a gate — this file is what makes it the second one.
//
// The failure it prevents is mundane and entirely plausible: someone flips
// `passed: true` because most of the list looks done, or sets
// deployment_status to DEPLOYED ahead of the paperwork. Both are one-line edits
// that read as progress.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8"));
const doc = readFileSync(resolve(repoRoot, "docs/cunt/CUNT-MAINNET-GATE.md"), "utf8");

const gate = manifest.mainnet_gate;
const VALID = new Set(["done", "partial", "todo", "blocked"]);

test("the gate parsed sanely", () => {
  // Guard the guard. An empty items array would make every check below vacuous
  // and the gate would pass by accident.
  assert.ok(Array.isArray(gate?.items), "mainnet_gate.items missing");
  assert.ok(gate.items.length >= 25, `§60 lists 25 items, manifest has ${gate.items.length}`);
  for (const i of gate.items) {
    assert.ok(i.id && i.what, "every item needs an id and a description");
    assert.ok(VALID.has(i.status), `"${i.id}" has status "${i.status}", not one of ${[...VALID].join("/")}`);
    assert.ok(i.note, `"${i.id}" has no note — an unexplained status is not reviewable`);
  }
});

test("ids are unique", () => {
  const ids = gate.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate gate item id — one silently shadows the other");
});

// ── The two that actually gate ──────────────────────────────────────────────
test("the gate cannot be marked passed while anything is incomplete", () => {
  const incomplete = gate.items.filter((i) => i.status !== "done");
  if (gate.passed) {
    assert.deepEqual(
      incomplete.map((i) => i.id),
      [],
      `mainnet_gate.passed is true, but these are not done: ${incomplete.map((i) => i.id).join(", ")}. ` +
        `§60: mainnet must not proceed until every item is complete.`
    );
  } else {
    assert.ok(incomplete.length > 0, "if everything is done, set passed: true deliberately — do not leave it false by accident");
  }
});

test("nothing may be deployed while the gate has not passed", () => {
  if (!gate.passed) {
    assert.equal(
      manifest.status.deployment_status,
      "NOT_DEPLOYED",
      "deployment_status left NOT_DEPLOYED is the whole point of an ungated project"
    );
    assert.equal(manifest.status.mainnet_approved, false);
    assert.equal(manifest.vanity_targets.mint.address, null, "a mint address means a mint exists — that is deployment");
  }
});

test("human approval is an item, and it is not done", () => {
  // §61 Phase I: "WAIT FOR HUMAN APPROVAL." If this is ever `done` without the
  // owner saying so, the sprint has approved itself.
  const approval = gate.items.find((i) => i.id === "human_approval");
  assert.ok(approval, "final human approval must be a gate item");
  if (!gate.passed) {
    assert.notEqual(approval.status, "done", "approval cannot be done while the gate has not passed");
  }
});

test("an internal review is never recorded as an audit", () => {
  // §38: "Never label an internal review as a third-party audit."
  const audit = gate.items.find((i) => i.id === "security_audit");
  const independent = gate.items.find((i) => i.id === "independent_review");
  assert.ok(audit && independent, "both must exist as separate items");
  assert.notEqual(
    independent.status,
    "done",
    "no independent review has happened; marking it done would be the §38 violation"
  );
  assert.match(audit.note, /NOT an audit|not an audit/i, "the internal review must say what it is not");
});

// Markdown formatting is not meaning. The doc writes `wen…CUNT` with backticks
// and **bolds** some items, so raw substring matching fails on presentation
// rather than substance — the same trap the authority-matrix guard hit. Strip
// formatting from BOTH sides instead of loosening the comparison.
const plain = (t) => t.replace(/[`*_]/g, "").replace(/\s+/g, " ");
const flatDoc = plain(doc);

test("the doc and the manifest agree on every item", () => {
  // The doc is what a person reads before deciding. If it can drift from the
  // manifest, someone approves against a stale checklist.
  for (const item of gate.items) {
    assert.ok(
      flatDoc.includes(plain(item.what)),
      `CUNT-MAINNET-GATE.md does not list "${item.what}" — the doc and the gate have diverged`
    );
  }
  const counts = { done: 0, partial: 0, todo: 0, blocked: 0 };
  for (const i of gate.items) counts[i.status]++;
  for (const [status, n] of Object.entries(counts)) {
    if (n === 0) continue;
    assert.ok(
      new RegExp(`\\b${n}\\b[^\\n]{0,40}${status}|${status}[^\\n]{0,40}\\b${n}\\b`, "i").test(flatDoc),
      `the doc's summary does not state ${n} ${status}`
    );
  }
});

test("blocked items name what blocks them", () => {
  // "blocked" without a reason is indistinguishable from "forgotten".
  for (const i of gate.items.filter((x) => x.status === "blocked")) {
    assert.ok(i.note.length > 20, `"${i.id}" is blocked but its note explains nothing`);
  }
});
