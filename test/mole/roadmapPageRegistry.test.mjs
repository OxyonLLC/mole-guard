// The public /roadmap/ page is static and makes zero API calls, so nothing
// stops it drifting away from the module registry that is supposed to be
// canonical. Every failure below is one this page actually shipped with, found
// during the 2026-08-05 audit:
//
//   • "17 of 23 Platform Modules Live" — the registry has held 24 entries since
//     its first commit, so the total was never right.
//   • "WinLEW Website v3.3.3" — true when written on 2026-07-19, false a week
//     later at v3.3.4, false again at v3.3.5.
//   • Cross-Chain Bridge, Governance, Mobile App Beta and Platform v2 were all
//     absent from the page while carrying real state in the registry.
//
// modulesData.js already fails loudly if the Bridge's *retention decision* is
// reversed in code. This file extends that guard to the public surface: a
// promise kept only in a data file, on a page no visitor can see it on, is not
// kept.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { MODULES, MODULE_STATUSES, ROADMAP_PHASES } from "../../src/mole/modulesData.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const roadmapPath = resolve(repoRoot, "src/public/roadmap/index.html");
const html = readFileSync(roadmapPath, "utf8");

// Strip HTML comments before matching. The page carries audit rationale in
// comments that legitimately quotes the old wrong strings ("17 of 23",
// "v3.3.3"); matching raw HTML would let a comment satisfy a test about
// rendered content, which is exactly backwards.
const visible = html.replace(/<!--[\s\S]*?-->/g, "");

// <style> and <script> BODIES are not visible text. Stripping only tags leaves
// their contents behind, which silently defeats these tests: a CSS comment
// mentioning "Cross-Chain Bridge" was enough to satisfy the retention check
// even after the actual card had been deleted from the page. Drop those blocks
// wholesale before extracting rendered text.
const text = visible
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/\s+/g, " ");

test("roadmap module count matches the registry", () => {
  const live = MODULES.filter((m) => m.status === MODULE_STATUSES.LIVE).length;
  const total = MODULES.length;
  assert.ok(
    text.includes(`${live} of ${total} Platform Modules Live`),
    `Roadmap page must state "${live} of ${total} Platform Modules Live". ` +
      `Registry currently has ${live} live of ${total} total.`
  );
});

test("roadmap page hardcodes no release version", () => {
  // A static page cannot keep a version current. If one reappears, this fails
  // rather than waiting for someone to notice months later.
  const match = visible.match(/v\d+\.\d+\.\d+/);
  assert.equal(
    match,
    null,
    `Roadmap page hardcodes version "${match?.[0]}". It makes no API calls, so it ` +
      `cannot keep that current — describe the milestone without the number.`
  );
});

test("Cross-Chain Bridge stays visible on the public roadmap", () => {
  // Mirror of the 2026-07-12 retention decision guarded in
  // validateModulesRegistry(). Deferred means still-on-the-roadmap.
  const bridge = MODULES.find((m) => m.id === "cross-chain-bridge");
  assert.ok(bridge, "cross-chain-bridge must exist in the registry");
  assert.equal(bridge.status, MODULE_STATUSES.DEFERRED);

  assert.ok(
    text.includes("Cross-Chain Bridge"),
    "Cross-Chain Bridge is retained-but-deferred in the registry and must appear " +
      "on the public roadmap. Removing it from the page silently reverses that decision."
  );
  assert.ok(
    /Deferred/.test(text),
    "The page must carry a Deferred status so the Bridge is not shown as research or planned work."
  );
});

test("every Phase 4 and Phase 5 roadmap item appears on the page", () => {
  // These are the two phases still carrying non-complete state, so they are the
  // ones where an omission actually misleads.
  const missing = [];
  for (const phase of ROADMAP_PHASES.filter((p) => p.phase >= 4)) {
    for (const item of phase.items) {
      // Ongoing programme labels are prose, not card titles — match the module
      // they point at instead where one exists.
      const module = item.moduleId ? MODULES.find((m) => m.id === item.moduleId) : null;
      const candidates = [item.label, module?.title].filter(Boolean);
      if (!candidates.some((c) => text.includes(c))) {
        missing.push(`Phase ${phase.phase}: ${item.label}`);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Roadmap items with live/deferred/not-started state are missing from /roadmap/: ${missing.join(", ")}`
  );
});

test("no roadmap card claims a status the legend does not define", () => {
  const defined = new Set([
    "complete",
    "progress",
    "planned",
    "research",
    "deferred",
    "partnership",
    "future",
  ]);
  const used = new Set([...visible.matchAll(/data-status="([^"]+)"/g)].map((m) => m[1]));
  const undefinedStatuses = [...used].filter((s) => !defined.has(s));
  assert.deepEqual(
    undefinedStatuses,
    [],
    `Cards use statuses with no legend entry or filter button: ${undefinedStatuses.join(", ")}`
  );

  // And every legend/filter status must actually be used by a card, or the
  // filter renders an empty page.
  const unused = [...defined].filter((s) => !used.has(s));
  assert.deepEqual(unused, [], `Filter statuses with no matching card: ${unused.join(", ")}`);
});
