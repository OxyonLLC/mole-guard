// Where social posts go, and — more importantly — what happens when they
// cannot be delivered.
//
// The bug this pins: the tweet loop used to `continue` past every tweet when no
// webhook was configured, then advance lastTweetId anyway. Announcements were
// marked as seen without ever being posted, permanently lost, with the watcher
// reporting nothing wrong. Adding a second destination (a channel id that can
// be mistyped, deleted, or lack permissions) makes that failure far more likely
// to happen for real.
//
// bot.js boots a Discord client on import, so these assert against the source
// rather than executing it — the same approach navRouteCoverage.test.mjs and
// botPagesMirrorsNav.test.mjs already take for that file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bot = readFileSync(resolve(repoRoot, "src/faucet/bot.js"), "utf8");
const envExample = readFileSync(resolve(repoRoot, ".env.example"), "utf8");

/** Comments quote the old broken pattern to explain it; match code only. */
const code = bot
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

test("tweets are routed through postSocialUpdate, not straight at the general webhook", () => {
  assert.match(code, /async function postSocialUpdate\(/, "the routing helper must exist");
  assert.match(code, /postSocialUpdate\(\s*\n?\s*`🆕 New Tweet/, "the tweet loop must use it");
});

test("the social channel is preferred and the webhook is the fallback", () => {
  const fn = code.slice(code.indexOf("async function postSocialUpdate"), code.indexOf("async function postSocialUpdate") + 1400);
  assert.match(fn, /SOCIAL_POSTS_CHANNEL_ID/, "must read the channel id");
  assert.ok(
    fn.indexOf("channels.fetch") < fn.indexOf("generalWebhook"),
    "the channel must be tried BEFORE the webhook, or the whole point is lost"
  );
  assert.match(fn, /generalWebhook/, "the webhook must remain as a fallback so existing deploys keep working");
});

test("postSocialUpdate reports whether delivery actually happened", () => {
  const fn = code.slice(code.indexOf("async function postSocialUpdate"), code.indexOf("async function postSocialUpdate") + 1400);
  assert.match(fn, /return true;/, "must report success");
  assert.match(fn, /return false;/, "must report failure — a caller cannot check a void");
});

// The delivery loop, located by the ordered batch it iterates. Kept as a helper
// so the next rename breaks ONE line rather than every test that reads it —
// this block previously pinned "for (const tweet of newTweets", and renaming
// that variable made three assertions pass against an empty string instead of
// failing loudly.
function deliveryLoop() {
  const at = code.indexOf("for (const tweet of ordered)");
  assert.notEqual(at, -1, "the delivery loop must be findable — if this fails, update the marker here, not the assertions below");
  return code.slice(at, code.indexOf("} catch (e) {", at));
}

test("the marker never advances past a tweet that was not delivered", () => {
  // If this regresses, undelivered announcements are marked seen and never
  // retried — they vanish, and nothing reports it.
  const loop = deliveryLoop();
  assert.match(loop, /if \(failed\)/, "delivery failure must be branched on");
  const advance = loop.indexOf("newestId: tweets[0].id");
  const guard = loop.indexOf("if (failed)");
  assert.ok(guard !== -1 && advance > guard, "jumping to the newest tweet must only happen in the success branch");
});

test("the marker DOES advance to whatever was delivered — no repeats", () => {
  // The opposite bug, and the one reported from Discord: leaving the marker
  // untouched after a partial delivery reposted the already-delivered tweets
  // on every tick until the failing one succeeded.
  const loop = deliveryLoop();
  assert.match(loop, /lastDeliveredId = tweet\.id/, "the last successful delivery must be tracked");
  assert.match(loop, /nextTweetMarker\(\{ lastDeliveredId, failed: true/, "a partial delivery must still move the marker forward");
});

test("a failed delivery stops the batch rather than skipping past it", () => {
  // Continuing would deliver tweet 3 while tweet 2 was lost, and then either
  // order is wrong or one is dropped. Stop, advance to what landed, retry.
  const loop = deliveryLoop();
  assert.match(loop, /else \{ failed = true; break; \}/, "must break out of the loop on the first failure");
});

test("the batch is sorted oldest-first before delivery", () => {
  // The marker can only move past a tweet once everything before it has landed,
  // so the sequence has to be genuinely ascending.
  assert.match(code, /const ordered = oldestFirst\(announceable\(newTweets\)\)/, "ordering must be explicit, not inherited from the API");
});

test("old tweets are filtered out before delivery (a stale marker must not re-announce them)", () => {
  assert.match(code, /announceable\(newTweets\)/, "the relay must drop tweets too old to announce");
});

test("the channel id is documented with the bot-permission requirement", () => {
  assert.match(envExample, /SOCIAL_POSTS_CHANNEL_ID=/, ".env.example must document the variable");
  const block = envExample.slice(envExample.indexOf("SOCIAL_POSTS_CHANNEL_ID="), envExample.indexOf("SOCIAL_POSTS_CHANNEL_ID=") + 700);
  assert.match(block, /permission|see and send/i, "a channel id the bot cannot post in is the likeliest misconfiguration");
  assert.match(block, /GENERAL_WEBHOOK_URL/, "the fallback behaviour must be stated");
});
