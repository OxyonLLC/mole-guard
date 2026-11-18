// The known-failures gate must fail on new failures, refuse silent baseline
// growth, and never pass a run that recorded nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, loadBaseline, BASELINE_PATH } from "../../tools/ci/test-baseline.mjs";

const r = (id, status = "fail") => ({ id, file: id.split(" :: ")[0], status });
const base = (...ids) => ({ entries: ids.map((id) => ({ id, reason: "known", since: "2026-11-12" })) });

test("a failure in the baseline passes; a new one fails", () => {
  const baseline = base("a.test.mjs :: x");
  assert.equal(evaluate({ results: [r("a.test.mjs :: x"), r("a.test.mjs :: y", "pass")], baseline }).pass, true);
  const bad = evaluate({ results: [r("a.test.mjs :: x"), r("a.test.mjs :: y")], baseline });
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.fresh.map((f) => f.id), ["a.test.mjs :: y"]);
});

test("an empty or missing results file never passes", () => {
  assert.equal(evaluate({ results: [], baseline: base() }).pass, false);
});

test("the baseline cannot grow without approval", () => {
  const results = [r("a :: x"), r("a :: y")];
  const grown = base("a :: x", "a :: y");
  assert.equal(evaluate({ results, baseline: grown, baseBaseline: base("a :: x") }).pass, false);
  assert.equal(evaluate({ results, baseline: grown, baseBaseline: base("a :: x"), expansionApproved: true }).pass, true);
});

test("shrinking the baseline needs no approval, and fixed tests are reported", () => {
  const out = evaluate({ results: [r("a :: x", "pass")], baseline: base("a :: x"), baseBaseline: base("a :: x", "a :: y") });
  assert.equal(out.pass, true);
  assert.deepEqual(out.nowPassing.map((e) => e.id), ["a :: x"]);
});

test("entries need a reason and must be unique", () => {
  const b = { entries: [{ id: "a :: x", reason: "" }, { id: "a :: x", reason: "r" }] };
  const out = evaluate({ results: [r("a :: x")], baseline: b });
  assert.equal(out.pass, false);
  assert.ok(out.problems.some((p) => /without a reason/.test(p)));
  assert.ok(out.problems.some((p) => /duplicate/.test(p)));
});

test("the committed baseline is well formed and every entry has a reason", () => {
  const b = loadBaseline(readFileSync(BASELINE_PATH, "utf8"));
  for (const e of b.entries) {
    assert.match(e.id, / :: /, e.id);
    assert.ok(e.reason && e.reason !== "TODO", `${e.id}: reason`);
    assert.match(e.since ?? "", /^\d{4}-\d{2}-\d{2}$/, `${e.id}: since`);
  }
});
