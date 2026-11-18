// The public HODL wording must match the balance-rate rule E1 runs on (owner
// policy 2026-11-13), and the "next payout" the page shows must come from the
// same rule hodl-pay enforces. Owner decisions pinned here:
//   - no "no yield" / "no APY" claims and no annualised returns;
//   - Tuesday is a SCHEDULED day, not a guaranteed payment;
//   - static example figures are labelled as such, live figures say they are live;
//   - test records never appear as real payout history;
//   - the named reserve (diglew.sol) is the configured treasury FcEtZq…PPjE.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { nextPayoutDay, isPayoutDay, weekIndexFor, DEFAULT_BALANCE_RATES } from "../../src/mole/hodlEpochs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");
const page = read("src/public/hodl/index.html");
const moleLink = read("src/public/mole-link/index.html");
const article = read("src/public/news/hodl-rewards-opens/index.html");
const web = read("src/mole/web.js");
const status = web.slice(web.indexOf('app.get("/api/hodl/status"'), web.indexOf('app.get("/api/quiz/leaderboard"'));

// Local-calendar helpers, so these tests hold in any TZ the runner uses.
const local = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const DAY = 24 * 60 * 60 * 1000;
// E1's shape: starts at local midnight on a Tuesday, 13 weeks.
const START = local(2026, 11, 17);
const E1 = { id: "E1", startMs: START, endMs: START + 13 * 7 * DAY + 0, payoutDay: 2 };

describe("nextPayoutDay follows hodl-pay's rule", () => {
  test("before the epoch starts, the first payout is the start day (week 1)", () => {
    const next = nextPayoutDay(E1, local(2026, 11, 13, 6));
    assert.equal(next.date, "2026-11-17");
    assert.equal(next.atMs, START);
    assert.equal(next.weekIndex, 1);
  });

  test("on the payout day itself, today is the next payout until that week is paid", () => {
    const tuesdayEvening = local(2026, 11, 24, 23);
    assert.equal(isPayoutDay(E1, new Date(tuesdayEvening)), true);
    assert.equal(nextPayoutDay(E1, tuesdayEvening).date, "2026-11-24");
    const afterPaid = nextPayoutDay(E1, tuesdayEvening, { isWeekPaid: (w) => w === 2 });
    assert.equal(afterPaid.date, "2026-12-01");
    assert.equal(afterPaid.weekIndex, 3);
  });

  test("every returned day is one hodl-pay would accept", () => {
    for (let t = START - 3 * DAY; t < E1.endMs + 3 * DAY; t += 11 * 60 * 60 * 1000) {
      const next = nextPayoutDay(E1, t);
      if (!next) { assert.ok(t >= E1.endMs - 7 * DAY, `null too early at ${new Date(t).toString()}`); continue; }
      assert.equal(isPayoutDay(E1, new Date(next.atMs)), true, "must be the local payout weekday");
      assert.ok(next.atMs >= E1.startMs && next.atMs < E1.endMs, "must be inside the epoch");
      assert.equal(next.weekIndex, weekIndexFor(E1, next.atMs));
    }
  });

  test("nothing is scheduled at or after endMs (13 weeks = 13 payouts)", () => {
    const lastTuesday = START + 12 * 7 * DAY;
    assert.equal(nextPayoutDay(E1, lastTuesday + DAY), null);
    assert.equal(nextPayoutDay(E1, lastTuesday).weekIndex, 13);
  });

  test("bad epochs schedule nothing", () => {
    assert.equal(nextPayoutDay({}, Date.now()), null);
    assert.equal(nextPayoutDay({ startMs: 10, endMs: 5 }, 0), null);
  });
});

describe("/api/hodl/status publishes the balance-rate terms", () => {
  test("uses the shared payout-day rule, not a UTC weekday guess", () => {
    assert.match(status, /nextPayoutDay\(epoch, now/);
    assert.ok(!/getUTCDay/.test(status), "the UTC-weekday computation must be gone");
    for (const field of ["nextPayoutDate", "payoutTimeZone", "balanceRates", "mode:", "maxRatePerWeek", "maxQualifyingBalance"]) {
      assert.ok(status.includes(field), `status must expose ${field}`);
    }
  });

  test("PoV tiers are not served for balance-rate epochs", () => {
    assert.match(status, /povBonusTiers: balanceRate \? \[\] : povBonusTiers/);
  });
});

describe("the /hodl/ page states the E1 rule", () => {
  const visible = page.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");

  test("old equal-share claims are gone", () => {
    for (const phrase of [/does not pay more/i, /equal measure/i, /same base share/i, /no yield/i, /no APY/i, /no interest/i, /Proof of Value bonus/i]) {
      assert.ok(!phrase.test(page), `page still says ${phrase}`);
    }
  });

  test("no annualised return is advertised", () => {
    assert.ok(!/\b(APY|APR)\b|per (year|annum)|annual(ly|ised|ized)?\b/i.test(visible), "no annualised figures");
  });

  test("Tuesday is scheduled, not promised", () => {
    assert.ok(!/Paid every Tuesday|Distributed every Tuesday/i.test(page));
    assert.match(visible, /Scheduled every Tuesday/);
    assert.match(visible, /scheduled day rather than a promise/);
  });

  test("states the rate range, the active-day sources and the window", () => {
    assert.match(visible, /0\.10%/);
    assert.match(visible, /0\.15%/);
    for (const src of [/faucet/i, /game reward/i, /web quiz/i, /\/mole checkin/]) assert.match(visible, src);
    assert.match(visible, /7 full UTC days before the snapshot day/);
    assert.match(visible, /snapshot day itself does not count/);
  });

  test("the static rate table matches the approved rates and is labelled static", () => {
    const rows = [...page.matchAll(/<tr><td>(\d)<\/td><td>([\d.]+)%<\/td>/g)];
    assert.equal(rows.length, 8);
    rows.forEach(([, days, pct], i) => {
      assert.equal(Number(days), i);
      assert.ok(Math.abs(Number(pct) / 100 - DEFAULT_BALANCE_RATES[i]) < 1e-12, `row ${i}`);
    });
    assert.match(page, /id="rateSource"><strong>Example figures:<\/strong> a static copy/);
    assert.match(page, /<strong>Live figures:<\/strong>/, "live data must announce itself");
    assert.match(page, /e\.mode === 'balance-rate' && r && r\.length === 8/, "live rows only from a balance-rate epoch");
  });

  test("quoted caps are replaced from the API when it answers", () => {
    assert.match(page, /data-hodl="maxPerParticipantWeek"/);
    assert.match(page, /data-hodl="maxQualifyingBalance"/);
    assert.match(page, /setLive\('maxPerParticipantWeek'/);
    assert.match(page, /setLive\('maxQualifyingBalance'/);
  });

  test("dates use the server's payout calendar", () => {
    assert.match(page, /tz = d\.payoutTimeZone/);
    assert.match(page, /timeZone: tz/);
  });

  test("test records never reach the payout history", () => {
    assert.ok(!/testRecords|testData/.test(page), "the page must not render test records");
  });

  test("names the configured reserve, and no 'not a financial product' assertion remains", () => {
    assert.match(page, /solscan\.io\/account\/FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE[^>]*>diglew\.sol</);
    assert.ok(!/not a financial product/i.test(page));
  });
});

describe("the other public pages agree", () => {
  test("/mole-link/ no longer promises equal shares", () => {
    assert.ok(!/same base share|does not pay more/i.test(moleLink));
    assert.match(moleLink, /0\.10% to 0\.15%/);
    assert.match(moleLink, /scheduled for <strong>each Tuesday<\/strong>/);
  });

  test("the launch article carries the E1 update note", () => {
    assert.match(article, /Update, November 2026:/);
    assert.match(article, /Proof of Value bonus described below no longer applies/);
  });
});
