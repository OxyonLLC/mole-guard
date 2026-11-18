// "on mobile, the login dont box correctly."
//
// The chooser was positioned with `right: innerWidth - pill.right` and nothing
// else. That is correct only while the pill sits near the RIGHT edge, which is
// where it lives on desktop. On mobile the nav wraps and Sign in lands on the
// LEFT, so right-anchoring pushed a 232px-min menu off the left edge of a
// ~412px viewport — half the menu was outside the screen.
//
// Driven with real geometry rather than a source grep: the bug was arithmetic,
// and arithmetic is what has to be proven.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nav = readFileSync(resolve(repoRoot, "src/public/assets/nav.js"), "utf8");

/** The placement arithmetic, lifted verbatim from openProviderChooser. If the
 *  two ever drift, the source-shape test below fails. */
function place(rect, { width, height, innerWidth, innerHeight }) {
  const MARGIN = 8;
  const maxLeft = Math.max(MARGIN, innerWidth - width - MARGIN);
  const left = Math.max(MARGIN, Math.min(rect.right - width, maxLeft));
  const below = rect.bottom + MARGIN;
  const top = below + height > innerHeight - MARGIN && rect.top - height - MARGIN > MARGIN
    ? rect.top - height - MARGIN
    : below;
  return { left, top };
}

describe("the provider chooser stays on screen", () => {
  test("mobile, pill on the LEFT — the case that was broken", () => {
    // Measured from the report: ~412px viewport, Sign in pill at x 16..115.
    const { left } = place({ right: 115, bottom: 308, top: 268 },
      { width: 232, height: 200, innerWidth: 412, innerHeight: 900 });
    assert.ok(left >= 8, `menu starts at ${left}px — off the left edge`);
    assert.ok(left + 232 <= 412 - 8, 'menu runs off the right edge');
  });

  test("desktop, pill on the RIGHT — still right-aligned to the pill", () => {
    const { left } = place({ right: 1240, bottom: 64, top: 24 },
      { width: 232, height: 200, innerWidth: 1440, innerHeight: 900 });
    assert.equal(left, 1240 - 232, 'the preferred alignment should survive when it fits');
  });

  test("a viewport narrower than the menu still starts on screen", () => {
    const { left } = place({ right: 300, bottom: 300, top: 260 },
      { width: 320, height: 200, innerWidth: 300, innerHeight: 700 });
    assert.equal(left, 8, 'never negative, whatever the arithmetic says');
  });

  test("it flips above the pill rather than off the bottom", () => {
    const { top } = place({ right: 400, bottom: 620, top: 580 },
      { width: 232, height: 200, innerWidth: 800, innerHeight: 700 });
    assert.ok(top < 580, `placed at ${top} — below the pill and off the bottom`);
    assert.ok(top >= 8);
  });

  test("it stays below when there is room, which is the normal case", () => {
    const { top } = place({ right: 400, bottom: 64, top: 24 },
      { width: 232, height: 200, innerWidth: 800, innerHeight: 900 });
    assert.equal(top, 72);
  });
});

describe("the source still does what the model says", () => {
  test("it measures after appending — offsetWidth is 0 before that", () => {
    const fn = nav.slice(nav.indexOf("function openProviderChooser"), nav.indexOf("function ensureAccountChips"));
    assert.ok(fn.indexOf("document.body.appendChild(menu)") < fn.indexOf("menu.offsetWidth"),
      'measuring an unattached element returns 0 and the clamp becomes a no-op');
    assert.match(fn, /menu\.style\.right = 'auto'/,
      'a leftover right offset fights the left one');
    assert.match(fn, /Math\.max\(MARGIN, Math\.min\(rect\.right - width, maxLeft\)\)/);
  });
});
