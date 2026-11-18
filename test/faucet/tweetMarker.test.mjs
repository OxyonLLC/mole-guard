// Where the "last tweet posted to Discord" marker moves to.
//
// Two failure modes, both of which have really happened in this project, and
// the fix for one caused the other:
//
//   LOST     — the marker advanced past tweets that were never delivered, so
//              announcements vanished permanently and nothing reported it.
//   REPEATED — the fix for that refused to advance at all after any failure,
//              so already-posted tweets were posted again every hour until the
//              failing one succeeded. Reported from Discord as "the bot sends
//              the same tweets".
//
// One rule avoids both: advance to the last tweet actually delivered, and no
// further. These tests exist so neither mode can come back quietly.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { announceable, nextTweetMarker, oldestFirst } from "../../src/faucet/tweetMarker.js";

describe("nextTweetMarker", () => {
  test("everything delivered — the marker jumps to the newest tweet", () => {
    const r = nextTweetMarker({ lastDeliveredId: "105", failed: false, newestId: "105", currentMarker: "100" });
    assert.equal(r.marker, "105");
    assert.equal(r.changed, true);
  });

  test("PARTIAL delivery advances only as far as delivery reached", () => {
    // Five new tweets, the fourth failed. 101-103 posted; the marker must move
    // to 103 so they are never posted twice, and must NOT reach 104 so the
    // failed one is still next up.
    const r = nextTweetMarker({ lastDeliveredId: "103", failed: true, newestId: "105", currentMarker: "100" });
    assert.equal(r.marker, "103", "must not stay at 100 — that reposts 101-103 every hour");
    assert.notEqual(r.marker, "105", "must not jump to the newest — that loses 104 and 105 forever");
    assert.equal(r.changed, true);
  });

  test("NOTHING delivered — the marker does not move at all", () => {
    const r = nextTweetMarker({ lastDeliveredId: null, failed: true, newestId: "105", currentMarker: "100" });
    assert.equal(r.marker, "100");
    assert.equal(r.changed, false, "no write, so a dead webhook cannot silently consume the backlog");
  });

  test("a first run with no prior marker still records what it delivered", () => {
    const r = nextTweetMarker({ lastDeliveredId: "103", failed: true, currentMarker: null });
    assert.equal(r.marker, "103");
    assert.equal(r.changed, true);
  });

  test("re-reporting the same marker is not a change — no pointless write", () => {
    const r = nextTweetMarker({ lastDeliveredId: "105", failed: false, newestId: "105", currentMarker: "105" });
    assert.equal(r.changed, false);
  });

  test("ids are compared as strings, so precision is never lost", () => {
    // Tweet ids exceed Number.MAX_SAFE_INTEGER. If this ever returns a Number,
    // the marker silently rounds and the comparison against it goes wrong.
    const r = nextTweetMarker({ lastDeliveredId: "2090644887066804646", failed: false, newestId: "2090644887066804646" });
    assert.equal(typeof r.marker, "string");
    assert.equal(r.marker, "2090644887066804646");
  });
});

describe("oldestFirst", () => {
  test("sorts ascending by id", () => {
    const out = oldestFirst([{ id: "105" }, { id: "101" }, { id: "103" }]);
    assert.deepEqual(out.map((t) => t.id), ["101", "103", "105"]);
  });

  test("handles ids beyond Number.MAX_SAFE_INTEGER", () => {
    // These two differ by 1 and both exceed 2^53. A numeric sort cannot tell
    // them apart, which would deliver them in the wrong order and let the
    // marker skip one.
    const a = "2090644887066804646";
    const b = "2090644887066804647";
    assert.ok(Number(a) === Number(b), "precondition: Number() cannot distinguish these");
    assert.deepEqual(oldestFirst([{ id: b }, { id: a }]).map((t) => t.id), [a, b]);
  });

  test("does not mutate its input", () => {
    const input = [{ id: "105" }, { id: "101" }];
    oldestFirst(input);
    assert.equal(input[0].id, "105", "the caller still needs its own ordering");
  });
});

describe("announceable", () => {
  const now = Date.parse("2026-10-23T20:00:00Z");
  const at = (h) => new Date(now - h * 3_600_000).toISOString();

  test("a stale marker never re-announces old tweets", () => {
    const tweets = [
      { id: "3", created_at: at(1) },
      { id: "2", created_at: at(24 * 3) },
      { id: "1", created_at: at(24 * 120) },
    ];
    assert.deepEqual(announceable(tweets, now).map((t) => t.id), ["3", "2"], "a two-day outage still announces");
  });

  test("a tweet without a readable date is not announced", () => {
    assert.deepEqual(announceable([{ id: "9" }, { id: "8", created_at: "nope" }], now), []);
  });

  test("exactly a week old still counts; a minute more does not", () => {
    assert.equal(announceable([{ id: "7", created_at: at(24 * 7) }], now).length, 1);
    assert.equal(announceable([{ id: "6", created_at: new Date(now - 7 * 86_400_000 - 60_000).toISOString() }], now).length, 0);
  });
});
