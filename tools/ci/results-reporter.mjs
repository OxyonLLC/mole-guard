// node:test reporter: one JSON line per finished test, keyed by file and the
// full name path ("suite > test"), so a failure can be matched against the
// known-failures baseline without depending on line numbers.
//
//   node --test --test-reporter=spec --test-reporter-destination=stdout \
//        --test-reporter=./tools/ci/results-reporter.mjs --test-reporter-destination=test-results.jsonl …
//
// The spec reporter still prints the complete human-readable output; this only
// adds a machine-readable copy.
import { relative } from "node:path";

const rel = (file) => (file ? relative(process.cwd(), file).replace(/\\/g, "/") : "(unknown)");

export default async function* resultsReporter(source) {
  const stacks = new Map(); // file -> names by nesting level
  for await (const event of source) {
    const d = event.data ?? {};
    if (event.type === "test:start") {
      const file = rel(d.file);
      const stack = stacks.get(file) ?? [];
      stack.length = d.nesting;
      stack[d.nesting] = d.name;
      stacks.set(file, stack);
      continue;
    }
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const file = rel(d.file);
    const stack = (stacks.get(file) ?? []).slice(0, d.nesting);
    const path = [...stack, d.name].join(" > ");
    const status = event.type === "test:fail" ? "fail" : d.skip !== undefined ? "skip" : d.todo !== undefined ? "todo" : "pass";
    const line = { id: `${file} :: ${path}`, file, status, nesting: d.nesting, suite: d.details?.type === "suite" };
    if (status === "fail") {
      const err = d.details?.error;
      line.error = String(err?.cause?.message ?? err?.message ?? err ?? "").split("\n")[0].slice(0, 300);
    }
    yield `${JSON.stringify(line)}\n`;
  }
}
