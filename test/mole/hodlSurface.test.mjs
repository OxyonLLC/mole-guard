// The HODL program's public surface: the /hodl/ page, the API payload and the
// Discord commands.
//
// HODL shipped with a page, a payout worker, a news article and a governance
// hook — and no Discord command at all, with nothing in !help mentioning it
// (owner spotted it, 2026-08-16). These guard the surface, not the engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LIMITS, DEFAULT_EPOCH_PARAMS } from "../../src/mole/hodlEpochs.js";
import { buildHelpOverview, buildCommandsCatalog, buildModHelp } from "../../src/shared/command-inventory.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");
const bot = read("src/faucet/bot.js");
const page = read("src/public/hodl/index.html");
const web = read("src/mole/web.js");
const str = (x) => String(Array.isArray(x) ? x.join("\n") : x);

test("the hodl command exists and is public", () => {
  assert.match(bot, /case 'hodl': \{/, "!hodl must exist");
  const block = bot.slice(bot.indexOf("case 'hodl': {"), bot.indexOf("case 'rewards': {"));
  // The explain/me paths must NOT be gated; only preview is.
  const beforeSub = block.slice(0, block.indexOf("if (sub === 'preview'"));
  assert.ok(!/MOD_ID_LIST/.test(beforeSub), "!hodl and !hodl me must be public");
  assert.match(block, /if \(sub === 'preview'[\s\S]{0,200}MOD_ID_LIST/, "!hodl preview must be moderator-only");
});

test("there is NO command that pays out", () => {
  // The one thing that stays on the CLI. hodl-pay.js defaults to a dry run,
  // requires --apply, requires a reconcile pass first, and its own header
  // records that this repo "has twice paid people twice". A chat command is one
  // typo or one compromised moderator account away from a third time, and that
  // mistake cannot be undone.
  const raw = bot.slice(bot.indexOf("case 'hodl': {"), bot.indexOf("case 'rewards': {"));
  // Strip comments. The block deliberately MENTIONS `npm run hodl:pay -- --apply`
  // — once in a comment explaining why paying stays on the CLI, and once in the
  // reply pointing a moderator at it. Naming the safe route is the opposite of
  // being able to take the unsafe one, so match capability, not prose.
  const block = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  for (const forbidden of ["loadTreasuryKeypair", "sendRawTransaction", "sendBundle", "Keypair", "signTransaction"]) {
    assert.ok(!block.includes(forbidden), `the hodl command must not be able to pay: found "${forbidden}"`);
  }
  // And it must not import anything that can send.
  assert.ok(!/import\(['"]\.\.\/scripts\/hodl-pay/.test(block), "must not import the payout script");
  assert.ok(!/sub === 'pay'|sub === 'run'/.test(block), "no pay/run subcommand may exist");
});

test("!hodl me shows only the caller's own payouts", () => {
  const block = bot.slice(bot.indexOf("case 'hodl': {"), bot.indexOf("case 'rewards': {"));
  const me = block.slice(block.indexOf("sub === 'me'"), block.indexOf("sub === 'preview'"));
  assert.match(me, /String\(a\.discordUserId\) === String\(message\.author\.id\)/,
    "must filter to the author — reading someone else's payout history is not a public command");
  assert.ok(!/mentions/.test(me), "!hodl me must not accept a target user");
});

test("the commands are discoverable in the right places", () => {
  assert.ok(str(buildHelpOverview()).includes("!hodl"), "!help must mention HODL");
  assert.ok(str(buildCommandsCatalog()).includes("hodl [me]"), "!commands must show the subcommand form");
  assert.ok(str(buildModHelp()).includes("hodl preview"), "!modhelp must list the admin subcommand");
  assert.ok(!str(buildHelpOverview()).includes("hodl preview"), "the public overview must not advertise a mod command");
});

test("the API publishes the limits governance cannot raise", () => {
  const route = web.slice(web.indexOf('app.get("/api/hodl/status"'), web.indexOf('app.get("/api/quiz/leaderboard"'));
  for (const field of ["maxWeeklyPool", "maxPerParticipantWeek", "maxPovBonusMultiplier", "povBonusTiers", "payoutDayName", "nextPayoutAt", "lifetimeDistributed"]) {
    assert.ok(route.includes(field), `/api/hodl/status must expose ${field}`);
  }
  // Served even with no active epoch — someone reading between epochs still
  // needs to know the rules.
  assert.match(route, /active: false[\s\S]{0,120}limits/, "limits must be served when no epoch is active");
});

test("the page reads limits from the API, never hardcoded", () => {
  // Hardcoding would let the page drift from hodlEpochs.js silently, which is
  // the failure lockListCoverage.test.mjs exists for elsewhere.
  assert.match(page, /d\.limits\.maxWeeklyPool/, "the page must render the API's limits");
  // Balance-rate epochs (E1 onward, owner policy 2026-11-13) never stack PoV
  // tiers, so the page must not advertise them.
  assert.ok(!/d\.povBonusTiers/.test(page), "the page must not render PoV bonus tiers");
  const numbers = [LIMITS.MAX_WEEKLY_POOL, LIMITS.MAX_PER_PARTICIPANT_WEEK, DEFAULT_EPOCH_PARAMS.weeklyPool];
  for (const n of numbers) {
    assert.ok(
      !new RegExp(`>\\s*${n.toLocaleString("en-US")}\\s*<`).test(page),
      `${n.toLocaleString("en-US")} appears hardcoded in the page — read it from /api/hodl/status instead`
    );
  }
});

test("snapshots marked testData never count as real payouts, and are labelled", () => {
  // The live store kept a fixture-shaped e1 "paid" week (users 111/222). It is
  // annotated, not deleted; every public total and receipt must skip it.
  const payouts = web.slice(web.indexOf('app.get("/api/hodl/payouts"'), web.indexOf('app.get("/api/hodl/status"'));
  assert.match(payouts, /\(s\.status === "paid" \|\| s\.status === "partial"\) && !s\.testData/);
  assert.match(payouts, /testRecords/);
  assert.match(payouts, /Test record, not a real payout/);
  const status = web.slice(web.indexOf('app.get("/api/hodl/status"'), web.indexOf('app.get("/api/quiz/leaderboard"'));
  assert.match(status, /listSnapshots\(epoch\.id\)\.filter\(\(s\) => !s\.testData\)/);
  assert.match(status, /&& !sn\.testData/);
});
