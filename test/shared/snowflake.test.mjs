// Snowflake decoding, and the date it already caught.
//
// The value of this file is not the arithmetic — it is that a stored evidence
// URL can be turned back into a date and compared against the date the record
// claims. partnersData.js and eventsData.js both said the 2BRZ partnership was
// announced 2025-04-01 while citing an X post that decodes to April 2. The
// proof was inside the URL both records already held.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCORD_EPOCH_MS,
  X_EPOCH_MS,
  discordCreatedAtMs,
  xCreatedAtMs,
  xStatusCreatedAtMs,
  isoDateInZone,
} from "../../src/shared/snowflake.js";
import { EVENTS } from "../../src/mole/eventsData.js";
import { accountCreatedAtMs } from "../../src/mole/identityAge.js";

test("epochs are pinned", () => {
  // A wrong epoch shifts every derived date by years while still producing
  // plausible-looking output, so these are asserted rather than trusted.
  assert.equal(DISCORD_EPOCH_MS, 1420070400000, "Discord epoch = 2015-01-01T00:00:00Z");
  assert.equal(new Date(DISCORD_EPOCH_MS).toISOString(), "2015-01-01T00:00:00.000Z");
  assert.equal(X_EPOCH_MS, 1288834974657, "X epoch = 2010-11-04T01:42:54.657Z");
  assert.equal(new Date(X_EPOCH_MS).toISOString(), "2010-11-04T01:42:54.657Z");
});

test("Discord decoding matches Discord's documented example", () => {
  assert.equal(
    new Date(discordCreatedAtMs("175928847299117063")).toISOString(),
    "2016-04-30T11:18:25.796Z"
  );
});

test("the int32 trap is not present", () => {
  // `Number(id) >> 22` wraps and yields roughly "epoch + a few hundred ms" — a
  // garbage value that still looks like a date. Under the Discord epoch that
  // makes every account read as ~11 years old and pass any age gate.
  const id = "1486000000000000000";
  assert.equal(discordCreatedAtMs(id), 1774360408544);
  assert.notEqual(discordCreatedAtMs(id), (Number(id) >> 22) + DISCORD_EPOCH_MS);
});

test("identityAge still exposes the same API after the extraction", () => {
  // The verification gate calls accountCreatedAtMs(); moving the implementation
  // must not change what that returns.
  assert.equal(accountCreatedAtMs("175928847299117063"), discordCreatedAtMs("175928847299117063"));
  assert.equal(accountCreatedAtMs("not-a-snowflake"), null);
});

test("non-snowflakes decode to null on both platforms", () => {
  for (const bad of ["", null, undefined, "wallet:deadbeef", "12", "abcdefghijklmnop"]) {
    assert.equal(discordCreatedAtMs(bad), null, `discord: ${bad}`);
    assert.equal(xCreatedAtMs(bad), null, `x: ${bad}`);
  }
});

test("an X status id is extracted from real-world URL shapes", () => {
  const expected = 1743646726624; // 2025-04-03T02:18:46.624Z
  for (const url of [
    "https://x.com/LewSales/status/1907618750523736507",
    "https://twitter.com/LewSales/status/1907618750523736507",
    // The mobile share sheet appends tracking params — the owner's links have them.
    "https://x.com/LewSales/status/1907618750523736507?t=VzkxrkbFVexXVWAruFQuow&s=19",
  ]) {
    assert.equal(xStatusCreatedAtMs(url), expected, url);
  }
  assert.equal(xStatusCreatedAtMs("https://winlew.co/news/"), null, "a non-X URL is not an error");
});

test("timezone changes the calendar day, which is the whole point", () => {
  const ms = xStatusCreatedAtMs("https://x.com/LewSales/status/1907618750523736507");
  assert.equal(isoDateInZone(ms, "UTC"), "2025-04-03");
  assert.equal(isoDateInZone(ms, "America/Denver"), "2025-04-02");
  // Recording the UTC day would put the project's own announcements on dates
  // nobody involved would recognise.
});

test("the 2BRZ event's recorded date matches the evidence it cites", () => {
  // The regression guard. This is the check that was missing when 2025-04-01
  // was written into two files.
  const event = EVENTS.find((e) => e.id === "2brz-partnership-announcement-2025");
  assert.ok(event, "2BRZ announcement event is missing");

  const xLink = event.evidence.find((e) => /(?:twitter|x)\.com\/[^/]+\/status/.test(e.url));
  assert.ok(xLink, "the 2BRZ event must cite its X announcement");

  const derived = xStatusCreatedAtMs(xLink.url);
  assert.ok(derived, "the cited X URL must contain a decodable status id");
  assert.equal(
    new Date(event.startIso).getTime(),
    derived,
    `startIso (${event.startIso}) must equal the timestamp encoded in the evidence URL ` +
      `(${new Date(derived).toISOString()}). If they disagree, the record is wrong — the id cannot be.`
  );
});
