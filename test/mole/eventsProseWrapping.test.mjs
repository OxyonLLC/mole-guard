// Long unbreakable tokens in event prose, and why a page-level overflow check
// does not catch them.
//
// Reported 2026-08-16: /events/ was visibly broken on a phone — text sliced off
// at the right edge. A standard `documentElement.scrollWidth > innerWidth`
// check reported ZERO overflow, because `html { overflow-x: hidden }` CLIPS the
// excess rather than producing a scrollbar. The content was 451px wide inside a
// 326px card and simply lost the end of every line.
//
// The token was a 44-character Raydium pool address that I had put into the
// eligibility text earlier the same day. Two fixes, both kept: the prose no
// longer carries raw addresses (the Participate button links the pool), and the
// page wraps long tokens so the next one cannot clip either.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { EVENTS } from "../../src/mole/eventsData.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eventsPage = readFileSync(resolve(repoRoot, "src/public/events/index.html"), "utf8");

/** Fields rendered as escaped free text into a card. */
const PROSE_FIELDS = ["description", "eligibility", "rewards", "rules"];

/** Base58-ish run long enough to be an address or a signature. */
const LONG_TOKEN = /\b[1-9A-HJ-NP-Za-km-z]{32,}\b/;

test("no event's prose contains a raw address or signature", () => {
  // They belong in participationUrl or evidence[], where they become a link.
  // A 44-character string pasted into a sentence onboards nobody and is the
  // thing that broke the phone layout.
  const offenders = [];
  for (const event of EVENTS) {
    for (const field of PROSE_FIELDS) {
      const match = String(event[field] || "").match(LONG_TOKEN);
      if (match) offenders.push(`${event.id}.${field}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Raw addresses in event prose. Put them in participationUrl or evidence[] so they render as a " +
      "link, and let the card's Participate button do the work:\n  " + offenders.join("\n  ")
  );
});

test("the events page wraps long tokens instead of clipping them", () => {
  // Defence in depth for the field the test above cannot police — a long URL
  // someone writes into `rules`, for instance.
  assert.match(
    eventsPage,
    /\.card p[^{]*\{[^}]*overflow-wrap:\s*anywhere/,
    "/events/ must set overflow-wrap:anywhere on card prose. Without it an unbreakable token renders " +
      "wider than its card and is CLIPPED by html{overflow-x:hidden} — invisible to a page-level " +
      "overflow check, and very visible on a phone."
  );
});

test("the campaign event still links its pool somewhere clickable", () => {
  // Removing the address from the prose must not remove it from the page.
  const event = EVENTS.find((e) => e.id === "buy-hodl-or-lp-campaign-2026");
  assert.ok(event, "campaign event is missing");
  assert.match(
    String(event.participationUrl || ""),
    /raydium\.io\/liquidity/,
    "the pool must remain reachable via participationUrl, which renders as the Participate button"
  );
});
