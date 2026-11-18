// Every slash command !commands advertises must actually be registered.
//
// The prefix-command sibling of this test (advertisedCommandsExist.test.mjs)
// checks the bot's own dispatcher. Slash commands are different: they exist in
// Discord only if a registration script has PUT them to the API, so an
// unregistered command does not appear in the picker at all and a user reading
// !commands is told about something they cannot type.
//
// This has already happened here — `/game hub` was documented while never
// having been registered.
//
// The two lists are at least neighbours rather than strangers: `src/mole/
// commands.js` exports both `commandInventory` (what !commands prints) and
// `commandData` (what gets registered), a few dozen lines apart, and
// `src/quiz/command-data.cjs` does the same for the quiz app. Adjacency is not
// agreement, though — nothing read one against the other until this test.
//
// Two registration targets, and they are not interchangeable:
//   npm run register:mole  -> src/mole/commands.js       (/mole, /game)
//   npm run register:quiz  -> src/quiz/command-data.cjs  (22 quiz commands)
//
// Audited 2026-08-13: both sides agree exactly, 9 and 22. This pins that.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { getCommandInventory } from "../../src/shared/command-inventory.js";
import { commandData as moleCommands } from "../../src/mole/commands.js";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { commandData: quizCommands } = require(resolve(repoRoot, "src/quiz/command-data.cjs"));

// `/geoagora …` is advertised but registered by the separate GeoAgora bot, not
// by anything in this repo — confirmed 2026-08-13: no local registration script
// mentions it, and the only reference here is a link builder in web.js. Listed
// explicitly so that "not registered locally" stays a recorded decision rather
// than looking like the same gap /game hub once was.
const REGISTERED_ELSEWHERE = new Set(["geoagora"]);

/** "/mole vote [x]" -> { name: "mole", sub: "vote" } */
function parseAdvertised(path) {
  const parts = String(path).replace(/^\//, "").split(/\s+/);
  const name = parts[0];
  const sub = parts[1] && /^[a-z][a-z0-9_-]*$/.test(parts[1]) ? parts[1] : null;
  return { name, sub };
}

const advertised = getCommandInventory()
  .slashGroups.flatMap((group) => group.entries.map((entry) => parseAdvertised(entry.path)))
  .filter((cmd) => !REGISTERED_ELSEWHERE.has(cmd.name));

// name -> Set of subcommand names (empty set = no subcommands)
const registered = new Map();
for (const cmd of [...moleCommands, ...quizCommands]) {
  const subs = (cmd.options || [])
    .filter((o) => o.type === 1 || o.type === 2) // SUB_COMMAND / SUB_COMMAND_GROUP
    .map((o) => o.name);
  registered.set(cmd.name, new Set(subs));
}

test("both sides parsed", () => {
  assert.ok(advertised.length >= 25, `only ${advertised.length} advertised slash commands`);
  assert.ok(registered.size >= 20, `only ${registered.size} registered top-level commands`);
});

describe("advertised slash commands are registered", () => {
  test("every advertised top-level command exists", () => {
    const missing = [...new Set(advertised.map((c) => c.name))]
      .filter((name) => !registered.has(name))
      .sort();
    assert.deepEqual(
      missing,
      [],
      `advertised in !commands but never registered, so they do not appear in Discord's ` +
        `command picker at all: ${missing.map((n) => `/${n}`).join(", ")}`,
    );
  });

  test("every advertised subcommand exists on its parent", () => {
    const missing = advertised
      .filter((c) => c.sub && registered.has(c.name) && !registered.get(c.name).has(c.sub))
      .map((c) => `/${c.name} ${c.sub}`)
      .sort();
    assert.deepEqual(
      missing,
      [],
      `advertised subcommands that their parent command does not define: ${missing.join(", ")}`,
    );
  });

  test("nothing registered is left undocumented", () => {
    // The reverse direction is worth asserting here, unlike for prefix
    // commands: these lists are both small and both hand-written, with no
    // unrelated labels to confuse. A registered-but-undocumented command is a
    // feature nobody is told about.
    const advertisedNames = new Set(advertised.map((c) => c.name));
    const undocumented = [...registered.keys()].filter((n) => !advertisedNames.has(n)).sort();
    assert.deepEqual(
      undocumented,
      [],
      `registered with Discord but absent from !commands: ${undocumented.map((n) => `/${n}`).join(", ")}`,
    );
  });
});
