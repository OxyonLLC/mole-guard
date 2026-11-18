// The identity-age gate. Every branch here decides whether a real person gets
// to verify, so the failure modes matter in both directions: too loose and the
// gate is decoration, too strict and it locks out honest members during a
// Discord outage.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCORD_EPOCH_MS,
  IDENTITY_REASONS,
  accountCreatedAtMs,
  ageInDays,
  evaluateIdentityAge,
  explainIdentityRefusal,
} from "../../src/mole/identityAge.js";

const DAY = 86400000;
const GATE = { enabled: true, minAccountAgeDays: 30, minGuildDays: 7, requireScreening: true };

/** Build a snowflake whose encoded creation time is `atMs`. */
function snowflakeFor(atMs) {
  return String((BigInt(atMs) - BigInt(DISCORD_EPOCH_MS)) << 22n);
}

test("snowflake decoding matches Discord's own documented example", () => {
  // From Discord's API docs: 175928847299117063 was created 2016-04-30T11:18:25.796Z.
  assert.equal(
    new Date(accountCreatedAtMs("175928847299117063")).toISOString(),
    "2016-04-30T11:18:25.796Z"
  );
});

test("a modern 19-digit snowflake decodes to its exact creation time", () => {
  // The trap this pins down: `Number(id) >> 22` coerces to int32, so a 19-digit
  // snowflake wraps and yields ~DISCORD_EPOCH + a few hundred ms — a garbage
  // value that still looks like a date, and that would make EVERY account read
  // as ~11 years old and sail through any threshold.
  //
  // Asserting the exact expected value is what catches that; an earlier version
  // of this test used assert.notEqual against the broken expression, which
  // passed no matter how the function was implemented. Verified by mutation.
  assert.equal(accountCreatedAtMs("1486000000000000000"), 1774360408544);
  assert.equal(new Date(1774360408544).toISOString(), "2026-03-24T13:53:28.544Z");

  // The int32 result, spelled out, so the failure message is unambiguous.
  assert.notEqual(1774360408544, (Number("1486000000000000000") >> 22) + DISCORD_EPOCH_MS);

  // And the builder used by the rest of this file round-trips.
  assert.equal(accountCreatedAtMs(snowflakeFor(1700000000000)), 1700000000000);
});

test("non-snowflake ids are 'not applicable', never a silent pass", () => {
  // Our own provisional wallet ids look like `wallet:<sha256>`.
  assert.equal(accountCreatedAtMs("wallet:deadbeef"), null);
  const r = evaluateIdentityAge({ discordUserId: "wallet:deadbeef", gate: GATE });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "not_a_discord_id", "must report WHY it passed, so callers cannot read this as a verified identity");
});

test("an account younger than the threshold is refused", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 3 * DAY),
    guildFacts: { inGuild: true, joinedAtMs: now - 3 * DAY, pending: false },
    now,
    gate: GATE,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, IDENTITY_REASONS.ACCOUNT_TOO_NEW);
  assert.equal(r.actual, 3);
  assert.equal(r.required, 30);
});

test("account age is checked before any guild lookup, so a fresh account cannot be waved through by a Discord outage", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 1 * DAY),
    guildFacts: null, // lookup unavailable
    now,
    gate: GATE,
  });
  assert.equal(r.ok, false, "the un-spoofable, no-API check must still refuse when the API-dependent one cannot run");
  assert.equal(r.reason, IDENTITY_REASONS.ACCOUNT_TOO_NEW);
});

test("an aged account passes when the guild lookup is unavailable — and says so", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: null,
    now,
    gate: GATE,
  });
  assert.equal(r.ok, true, "fail open on OUR outage, matching walletBans.js's cluster-walk precedent");
  assert.equal(r.degraded, "guild_lookup_unavailable");
  assert.ok(!r.checksRun.includes("guild_membership_age"), "must not claim to have run a check it skipped");
});

test("too-new guild membership is refused even with an aged account", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: { inGuild: true, joinedAtMs: now - 2 * DAY, pending: false },
    now,
    gate: GATE,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, IDENTITY_REASONS.GUILD_TOO_NEW);
  assert.equal(r.actual, 2);
});

test("a missing joined_at degrades instead of reading as 'joined just now'", () => {
  // Discord occasionally returns a member object without joined_at. Treating a
  // missing field as age zero would refuse the longest-standing members in the
  // server — the exact opposite of who this gate is for.
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: { inGuild: true, joinedAtMs: null, pending: false },
    now,
    gate: GATE,
  });
  assert.equal(r.ok, true);
  assert.equal(r.degraded, "joined_at_missing");
});

test("pending membership screening is refused; absent screening is not", () => {
  const now = Date.now();
  const aged = snowflakeFor(now - 400 * DAY);
  const joined = now - 100 * DAY;

  const pending = evaluateIdentityAge({
    discordUserId: aged, now, gate: GATE,
    guildFacts: { inGuild: true, joinedAtMs: joined, pending: true },
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.reason, IDENTITY_REASONS.SCREENING_PENDING);

  // Guilds without membership screening omit `pending` entirely. That means
  // "no screening to fail", not "pending".
  const noScreening = evaluateIdentityAge({
    discordUserId: aged, now, gate: GATE,
    guildFacts: { inGuild: true, joinedAtMs: joined, pending: false },
  });
  assert.equal(noScreening.ok, true);
});

test("a non-member is refused, and that is distinct from a failed lookup", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: { inGuild: false, joinedAtMs: null, pending: false },
    now,
    gate: GATE,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, IDENTITY_REASONS.NOT_IN_GUILD);
});

test("a disabled gate passes everything, explicitly", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 1 * DAY),
    now,
    gate: { ...GATE, enabled: false },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "gate_disabled");
});

test("a zero threshold disables that check without disabling the gate", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 1 * DAY),
    guildFacts: { inGuild: true, joinedAtMs: now - 1 * DAY, pending: false },
    now,
    gate: { enabled: true, minAccountAgeDays: 0, minGuildDays: 0, requireScreening: false },
  });
  assert.equal(r.ok, true);
});

test("refusals explain what is required and when they will qualify", () => {
  const msg = explainIdentityRefusal({
    ok: false, reason: IDENTITY_REASONS.ACCOUNT_TOO_NEW, required: 30, actual: 3,
  });
  assert.match(msg, /30/);
  assert.match(msg, /27 day/, "must tell them when they qualify — a bare denial reads as a bug and generates support load");
  assert.equal(explainIdentityRefusal({ ok: true }), null);
});

test("ageInDays floors and never goes negative", () => {
  const now = Date.now();
  assert.equal(ageInDays(now - 2.9 * DAY, now), 2);
  assert.equal(ageInDays(now + 5 * DAY, now), 0, "a clock skew must not produce a negative age that passes every threshold");
});

// ── Holder bypass (2026-08-20) ────────────────────────────────────────────
//
// The owner's rule: "First one is allowed; as long as they own X amount."
// X is 100,000 WinLEW. These tests pin what the bypass may and may not waive,
// because every one of these branches decides whether someone's money moves.

const HOLDER_GATE = { ...GATE, minGuildDays: 3, firstWalletMinBalance: 100000 };

/** In the server, joined moments ago — the exact shape that refused a real
 *  person on 2026-08-19 (required 7, actual 0). */
function joinedToday(now) {
  return { inGuild: true, pending: false, joinedAtMs: now - 1000 };
}

test("a first wallet holding the minimum skips the membership wait", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: joinedToday(now),
    now,
    gate: HOLDER_GATE,
    holder: { isFirstWallet: true, balance: 100000 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.bypassed, "holder_first_wallet");
  assert.equal(r.waived, IDENTITY_REASONS.GUILD_TOO_NEW, "the log must say what was waived, not just that it passed");
});

test("one token short is still short", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: joinedToday(now),
    now,
    gate: HOLDER_GATE,
    holder: { isFirstWallet: true, balance: 99999 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.details.holderBypass, "below_minimum");
  assert.match(explainIdentityRefusal(r, HOLDER_GATE), /99,999/, "tell them how close they were");
});

test("the bypass is for the FIRST wallet only — a second one waits", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: joinedToday(now),
    now,
    gate: HOLDER_GATE,
    holder: { isFirstWallet: false, balance: 900_000_000 },
  });
  assert.equal(r.ok, false, "otherwise one rich wallet verifies an unlimited number of identities' extra wallets");
  assert.equal(r.reason, IDENTITY_REASONS.GUILD_TOO_NEW);
});

test("an unreadable balance is not a qualifying balance", () => {
  const now = Date.now();
  for (const balance of [null, undefined, NaN]) {
    const r = evaluateIdentityAge({
      discordUserId: snowflakeFor(now - 400 * DAY),
      guildFacts: joinedToday(now),
      now,
      gate: HOLDER_GATE,
      holder: { isFirstWallet: true, balance },
    });
    assert.equal(r.ok, false, `balance ${String(balance)} must not pass — an RPC failure must never grant a bypass`);
    assert.equal(r.details.holderBypass, "balance_unavailable");
  }
});

test("the bypass waives waiting, never membership or screening", () => {
  const now = Date.now();
  const holder = { isFirstWallet: true, balance: 5_000_000 };
  const id = snowflakeFor(now - 400 * DAY);

  const notMember = evaluateIdentityAge({
    discordUserId: id, guildFacts: { inGuild: false, pending: false, joinedAtMs: null }, now, gate: HOLDER_GATE, holder,
  });
  assert.equal(notMember.ok, false);
  assert.equal(notMember.reason, IDENTITY_REASONS.NOT_IN_GUILD, "holding tokens is not membership");

  const pending = evaluateIdentityAge({
    discordUserId: id, guildFacts: { inGuild: true, pending: true, joinedAtMs: now - 90 * DAY }, now, gate: HOLDER_GATE, holder,
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.reason, IDENTITY_REASONS.SCREENING_PENDING, "accepting the rules is free, so buying past it buys nothing");
});

test("a brand-new Discord account can still buy its way in — deliberately", () => {
  // Stated rather than hidden: with the bypass on, account age is waived too,
  // so the price of an identity is the token balance and not the calendar.
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 1 * DAY),
    guildFacts: joinedToday(now),
    now,
    gate: HOLDER_GATE,
    holder: { isFirstWallet: true, balance: 250000 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.waived, IDENTITY_REASONS.ACCOUNT_TOO_NEW);
});

test("firstWalletMinBalance = 0 disables the bypass without disabling the gate", () => {
  const now = Date.now();
  const r = evaluateIdentityAge({
    discordUserId: snowflakeFor(now - 400 * DAY),
    guildFacts: joinedToday(now),
    now,
    gate: { ...HOLDER_GATE, firstWalletMinBalance: 0 },
    holder: { isFirstWallet: true, balance: 900_000_000 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, IDENTITY_REASONS.GUILD_TOO_NEW);
});
