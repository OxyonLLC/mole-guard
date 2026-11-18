// An owner-gated card must hide its whole card, not just its contents.
//
// /verify/profile.html hides owner-only content with a single sweep:
//   document.querySelectorAll(".ownerOnly").forEach(el => el.classList.toggle("hidden", publicView))
//
// So where the class sits decides what disappears. On the panel, the card goes.
// On the <details> inside it, the summary and content go and the .card.panel
// wrapper remains — an empty 50px rounded box with no heading, which is what a
// visitor saw on the public profile until 2026-08-13.
//
// Reproduced before fixing: forcing publicView left exactly one empty visible
// card, detailsQuizRecent.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(repoRoot, "src/public/verify/profile.html"), "utf8")
  // The fix's own comment explains the bug using the old markup; judge the
  // markup, not the prose about it.
  .replace(/<!--[\s\S]*?-->/g, " ");

// Each `<div class="card panel …">` and everything up to the next one.
function panels() {
  const out = [];
  const starts = [...html.matchAll(/<div class="card panel[^"]*"/g)].map((m) => m.index);
  starts.forEach((pos, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    const chunk = html.slice(pos, end);
    const head = chunk.slice(0, chunk.indexOf(">") + 1);
    const summary = chunk.match(/<summary[^>]*>(.*?)<\/summary>/s);
    out.push({
      head,
      chunk,
      panelIsOwnerOnly: head.includes("ownerOnly"),
      title: summary ? summary[1].replace(/<[^>]+>/g, "").trim() : "(no summary)",
    });
  });
  return out;
}

test("the panels this guards are still there", () => {
  const all = panels();
  assert.ok(all.length >= 14, `only found ${all.length} card panels`);
  assert.ok(all.some((p) => p.panelIsOwnerOnly), "no owner-gated panel found — has the pattern changed?");
});

describe("owner-gated cards hide the whole card", () => {
  test("no <details> carries ownerOnly while its panel does not", () => {
    const offenders = panels()
      .filter((p) => !p.panelIsOwnerOnly && /<details[^>]*\bownerOnly\b/.test(p.chunk))
      .map((p) => p.title);
    assert.deepEqual(
      offenders,
      [],
      "these cards hide their contents but leave an empty card shell on the public profile — " +
        `move ownerOnly up to the .card.panel: ${offenders.join(", ")}`,
    );
  });

  test("no <summary> is individually owner-gated", () => {
    // Same failure in a different shape: hiding only the heading leaves a card
    // whose body renders under no title.
    const offenders = panels()
      .filter((p) => /<summary[^>]*\bownerOnly\b/.test(p.chunk))
      .map((p) => p.title);
    assert.deepEqual(offenders, [], `owner-gated summary leaves an untitled card: ${offenders.join(", ")}`);
  });
});
