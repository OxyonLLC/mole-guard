// Every command !commands advertises must actually dispatch to something.
//
// The catalog in src/shared/command-inventory.js and the dispatcher in
// src/faucet/bot.js are two hand-maintained lists. A command can be advertised
// into a Discord channel and simply not exist — the bot's switch falls through
// and the user gets nothing, with no error anywhere to notice.
//
// Checked by hand on 2026-08-13 and they agreed, but only after resolving a
// layer that is easy to miss: seven advertised commands (drip, save, menu, nav,
// socials, rpcstatus, endpoint) have no `case` of their own and are routed
// through bot.js's `commandAliases` map. A naive comparison reports all seven
// as broken. This test resolves aliases the way the bot does.
//
// Deliberately ONE-DIRECTIONAL. The reverse — a `case` nobody advertises — is
// not asserted, because bot.js contains several unrelated switch statements
// (faucet eligibility reasons like `wallet_banned` and `cooldown`, storage
// kinds like `legacy-registrations`) whose labels are indistinguishable from
// command labels by text alone. Asserting that direction would mean either a
// brittle brace-matching parser or a growing exclusion list, to catch a
// harmless condition: an unadvertised command is invisible, not broken.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { getCommandInventory } from "../../src/shared/command-inventory.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Comments stripped: bot.js documents commands in prose (`!drip pays the wallet
// saved to your account`), and matching that would let a comment satisfy a test
// about executable dispatch.
const botSource = readFileSync(resolve(repoRoot, "src/faucet/bot.js"), "utf8").replace(/\/\/.*/g, "");

/** `commandAliases` as the bot builds it: alias -> real command. */
function parseAliases() {
  const start = botSource.indexOf("const commandAliases = {");
  assert.notEqual(start, -1, "commandAliases not found — bot.js changed shape");
  const end = botSource.indexOf("};", start);
  const body = botSource.slice(start, end);
  const pairs = [...body.matchAll(/([a-z0-9_]+)\s*:\s*'([a-z0-9_]+)'/g)];
  assert.ok(pairs.length >= 5, `only parsed ${pairs.length} command aliases`);
  return new Map(pairs.map((m) => [m[1], m[2]]));
}

/** Every `case '...'` label from the dispatcher onward. */
function parseCaseLabels() {
  const start = botSource.indexOf("switch (normalizedCmd) {");
  assert.notEqual(start, -1, "the command dispatcher was not found in bot.js");
  const labels = [...botSource.slice(start).matchAll(/case '([a-z0-9_-]+)':/g)].map((m) => m[1]);
  assert.ok(labels.length >= 40, `only parsed ${labels.length} case labels`);
  return new Set(labels);
}

const aliases = parseAliases();
const cases = parseCaseLabels();
const advertised = getCommandInventory().prefixGroups.flatMap((group) =>
  group.entries.flatMap((entry) => [entry.primary, ...(entry.aliases || [])]),
);

test("both sides parsed", () => {
  assert.ok(advertised.length >= 50, `only ${advertised.length} advertised commands`);
});

describe("!commands advertises nothing that does not exist", () => {
  test("every advertised command resolves to a handler", () => {
    const broken = advertised.filter((cmd) => {
      const resolved = aliases.get(cmd) || cmd;
      return !cases.has(resolved);
    });
    assert.deepEqual(
      broken.sort(),
      [],
      `these commands are listed in !commands but dispatch to nothing — a user who runs one ` +
        `gets silence:\n  ${broken.join(", ")}`,
    );
  });

  test("every alias points at a command that exists", () => {
    // An alias to a deleted command breaks quietly in the same way, and is
    // easier to leave behind than the command itself.
    const dangling = [...aliases.entries()]
      .filter(([, target]) => !cases.has(target))
      .map(([alias, target]) => `${alias} -> ${target}`);
    assert.deepEqual(dangling, [], `commandAliases entries pointing at nothing: ${dangling.join(", ")}`);
  });
});
