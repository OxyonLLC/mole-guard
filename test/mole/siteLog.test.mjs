// The site activity log — a Discord record of what happens on the website.
//
// Its reason for existing (owner, 2026-08-14): Discord has eyes on it, so abuse
// there is witnessed. The website has nobody watching. These tests pin the three
// rules that make such a log safe to have at all, because a log that leaks a
// credential is worse than no log.
import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { logSiteEvent, _resetSiteLogThrottle, DEFAULT_SITE_LOG_CHANNEL_ID, SOURCES, isDiscordId } from "../../src/mole/siteLog.js";

const SESSION = "V1StGXR8_Z5jdHi6B-myT";
const WALLET = "D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ";

let sent;
const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetSiteLogThrottle();
  sent = [];
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 204, text: async () => "" };
  };
  process.env.SITE_LOG_WEBHOOK_URL = "https://discord.com/api/webhooks/1/test";
});

test.after(() => { globalThis.fetch = realFetch; delete process.env.SITE_LOG_WEBHOOK_URL; });

describe("rule 1 — it never carries a secret", () => {
  test("a wallet is masked, never printed in full", async () => {
    await logSiteEvent({ type: "t1", title: "Faucet claim", wallet: WALLET });
    const content = sent[0].body.content;
    assert.ok(!content.includes(WALLET), "the full wallet address was posted");
    assert.match(content, /D6d5…FRkZ/, `expected a masked wallet, got: ${content}`);
  });

  test("nothing a caller passes is sent unless it is an explicit field", async () => {
    // The shape matters: logSiteEvent takes named fields, never a request body.
    // A caller cannot accidentally splat `req.body` — containing a session — in.
    await logSiteEvent({
      type: "t2", title: "Login", discordUserId: "123456789012345678",
      fields: { Status: "ok" },
      // deliberately passing junk that must be ignored
      session: SESSION, signature: "abc", body: { session: SESSION },
    });
    const content = sent[0].body.content;
    assert.ok(!content.includes(SESSION), "a session token reached the log");
    assert.ok(!content.includes("abc"), "a signature reached the log");
  });
});

describe("rule 2 — it never pings, and never leaks a vote", () => {
  test("mentions are suppressed", async () => {
    await logSiteEvent({ type: "t3", title: "x", discordUserId: "123456789012345678" });
    assert.deepEqual(sent[0].body.allowed_mentions, { parse: [] },
      "a channel that pings on every faucet claim gets muted, and a muted channel is not oversight");
  });

  test("no site-log call in web.js records how someone voted", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/mole/web.js", import.meta.url), "utf8");
    // Governance deliberately posts "a vote was cast" and nothing more. A
    // general activity log must not become the leak that undoes that.
    const calls = [...src.matchAll(/logSiteEvent\(\{[\s\S]{0,400}?\}\);/g)].map((m) => m[0]);
    assert.ok(calls.length > 0, "no logSiteEvent calls found — has the wiring been removed?");
    for (const call of calls) {
      assert.ok(!/\bchoice\b|\bvote:|voteChoice|\bapprove\b|\breject\b/i.test(call),
        `a site-log call appears to record a vote choice:\n${call}`);
    }
  });
});

describe("rule 3 — it never breaks the request", () => {
  test("a webhook failure is swallowed", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await assert.doesNotReject(() => logSiteEvent({ type: "t4", title: "x" }));
  });

  test("a thrown fetch is swallowed", async () => {
    globalThis.fetch = async () => { throw new Error("network down"); };
    await assert.doesNotReject(() => logSiteEvent({ type: "t5", title: "x" }));
  });

  test("unconfigured logging is inert, not an error", async () => {
    delete process.env.SITE_LOG_WEBHOOK_URL;
    globalThis.fetch = async () => { throw new Error("should not be called"); };
    await assert.doesNotReject(() => logSiteEvent({ type: "t6", title: "x" }));
  });
});

describe("throttling", () => {
  test("a burst is collapsed, and the suppression is disclosed", async () => {
    await logSiteEvent({ type: "burst", title: "Faucet claim" });
    for (let i = 0; i < 5; i += 1) await logSiteEvent({ type: "burst", title: "Faucet claim" });
    assert.equal(sent.length, 1, "a burst should not post six messages");

    // The count must resurface, or a script hammering an endpoint looks like
    // one quiet event instead of an attack.
    _resetSiteLogThrottle();
    await logSiteEvent({ type: "burst", title: "Faucet claim" });
    assert.equal(sent.length, 2);
  });

  test("different event types do not throttle each other", async () => {
    await logSiteEvent({ type: "a", title: "A" });
    await logSiteEvent({ type: "b", title: "B" });
    assert.equal(sent.length, 2);
  });
});

test("the nominated channel is recorded in code, not only in a chat message", () => {
  assert.equal(DEFAULT_SITE_LOG_CHANNEL_ID, "1350969543480180817");
});

// ── Source tags, refusals and the contradiction Jim spotted ──────────────────
//
// Feedback 2026-08-15. Two asks: tell the sources apart, and make these usable
// as "true debug logs" — his words, and the correction to his own earlier
// suggestion of showing claim totals. Totals are a dashboard; a debug log is
// the line that explains why something did not happen.
describe("Jim's feedback: sources, refusals, and honest identity", () => {

  test("a wallet-only session is never rendered as an empty user", async () => {
    // Screenshotted: "User: —" printed directly above "Linked: known Discord
    // account". A log that contradicts itself in two adjacent lines is worse
    // than one that says less.
    await logSiteEvent({
      type: "wallet_login", source: SOURCES.WALLET, title: "Wallet signed in",
      discordUserId: "wallet:9fbAbc123", wallet: "E5fMM4dki9Xj1p5RoEH97jXTWWyYUT7FUavufUnTape3",
    });
    const body = sent.map((x) => x.body.content).join('\n');
    assert.ok(!/User: —/.test(body), "a synthetic wallet id rendered as an empty user");
    assert.match(body, /wallet-only session/);
    assert.ok(!/<@wallet:/.test(body), "a non-snowflake was rendered as a mention");
  });

  test("isDiscordId separates real accounts from wallet profiles", () => {
    assert.equal(isDiscordId("478228146139693085"), true);
    assert.equal(isDiscordId("wallet:9fbAbc"), false);
    assert.equal(isDiscordId("guest:abc"), false);
    assert.equal(isDiscordId(""), false);
    assert.equal(isDiscordId(null), false);
  });

  test("each source is tagged so the channel can be scanned", async () => {
    for (const source of [SOURCES.FAUCET, SOURCES.QUIZ, SOURCES.GAMES]) {
      _resetSiteLogThrottle();
      sent.length = 0;
      await logSiteEvent({ type: `t_${source}`, source, title: "x" });
      assert.match(sent.map((x) => x.body.content).join(''), new RegExp(`\\[${source}\\]`), `${source} events carry no tag`);
    }
  });

  test("a refusal is marked, not dressed up as a success", async () => {
    await logSiteEvent({
      type: "faucet_claim", source: SOURCES.FAUCET, outcome: "refused",
      title: "Faucet claim refused (website)", fields: { Reason: "`cooldown`" },
    });
    const body = sent.map((x) => x.body.content).join('');
    assert.match(body, /⛔/);
    assert.match(body, /cooldown/);
  });

  test("a burst of successes cannot suppress the refusal among them", async () => {
    // The throttle keys on type AND outcome. Keyed on type alone, a stream of
    // working claims would swallow the one that failed — the only line anybody
    // reading this channel actually needs.
    await logSiteEvent({ type: "faucet_claim", source: SOURCES.FAUCET, title: "ok 1" });
      await logSiteEvent({ type: "faucet_claim", source: SOURCES.FAUCET, title: "ok 2" });
      await logSiteEvent({ type: "faucet_claim", source: SOURCES.FAUCET, outcome: "refused", title: "refused!" });
    assert.match(sent.map((x) => x.body.content).join('\n'), /refused!/, "the refusal was throttled away behind the successes");
  });

  test("routine cooldown refusals are dropped, interesting ones are kept", () => {
    // Owner's call once the volume was visible: cooldown fires every time
    // anyone taps claim twice — the system working, not a fault. At real volume
    // it buries the refusals that mean something.
    const web = fs.readFileSync(new URL("../../src/mole/web.js", import.meta.url), "utf8");
    const set = web.match(/const ROUTINE_REFUSALS = new Set\(\[([^\]]*)\]\)/);
    assert.ok(set, "ROUTINE_REFUSALS missing — cooldown noise is back in the channel");
    assert.match(set[1], /"cooldown"/);

    // The guard must be a filter on the routine set, not a blanket disable.
    assert.match(web, /if \(!ROUTINE_REFUSALS\.has\(String\(result\.reason \|\| ""\)\)\) void logSiteEvent\(/);

    // These are the ones somebody will actually ask about. If any of them ends
    // up in the routine set, the log has stopped answering "why did this fail".
    for (const reason of ["wallet_banned", "linked_to_banned", "below_holder_minimum", "verification_required", "reconciling"]) {
      assert.ok(!set[1].includes(`"${reason}"`), `${reason} was silenced — that is a refusal worth seeing`);
    }
  });

  test("a refusal's title says refused, not requested", () => {
    // The icon said one thing and the words another — a skimmer reads the
    // words. Same defect as User/Linked disagreeing.
    const web = fs.readFileSync(new URL("../../src/mole/web.js", import.meta.url), "utf8");
    for (const pair of [
      [/Quiz redemption refused \(website\)/, "quiz refusal title"],
      [/Faucet claim refused \(website\)/, "faucet refusal title"],
    ]) {
      assert.match(web, pair[0], `${pair[1]} missing — a refusal is titled as a success`);
    }
  });

  test("every event carries a trace handle to quote in a bug report", async () => {
    await logSiteEvent({ type: "x", source: SOURCES.QUIZ, title: "y" });
    assert.match(sent.map((x) => x.body.content).join(''), /trace `[a-z0-9]{4,8}`/);
  });
});
