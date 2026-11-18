// Regression guard for the Discord help surfaces (!help, !navigation,
// !commands, !modhelp) in src/shared/command-inventory.js.
//
// Written 2026-07-31 after two real drift bugs shipped unnoticed:
//   1. buildNavigationMessage() was hand-listed and had silently dropped the
//      ENTIRE "Links & Public Wallets" group — 15 working commands (!links,
//      !buy, !swap, !pages, !rugcheck, !rpc, !xwallet, !devwallet, …) were
//      invisible in !navigation while being listed in !commands.
//   2. New governance slash commands existed in Discord but no help surface
//      mentioned them.
// The parsing here reads the REAL dispatch switch in src/faucet/bot.js, so
// the inventory is checked against what the bot actually answers to, not
// against a second hand-maintained list that could drift the same way.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCommandInventory,
  buildHelpOverview,
  buildNavigationMessage,
  buildCommandsCatalog,
  buildModHelp,
} from '../../src/shared/command-inventory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_FILE = path.resolve(__dirname, '..', '..', 'src', 'faucet', 'bot.js');

// Discord rejects any message body over 2000 characters. !commands is sent
// via replyInChunks() so it's exempt; the others are single message.reply()
// calls and would throw at runtime — invisible until someone types them.
const DISCORD_MESSAGE_LIMIT = 2000;

function realPrefixCommands() {
  const src = fs.readFileSync(BOT_FILE, 'utf8');
  const cases = [...src.matchAll(/^ {6}case '([a-z0-9-]+)':/gm)].map((m) => m[1]);
  // commandAliases = { drip: 'faucet', nav: 'navigation', … } — an alias is
  // a real, typeable command even though it has no case of its own.
  const aliasBlock = src.match(/const commandAliases = \{([\s\S]*?)\};/);
  const aliases = aliasBlock
    ? [...aliasBlock[1].matchAll(/^\s*([a-z0-9]+)\s*:/gm)].map((m) => m[1])
    : [];
  return { cases: new Set(cases), aliases: new Set(aliases) };
}

function inventoryCommands() {
  const primaries = new Set();
  const all = new Set();
  for (const group of getCommandInventory().prefixGroups) {
    for (const entry of group.entries) {
      primaries.add(entry.primary);
      all.add(entry.primary);
      for (const alias of entry.aliases || []) all.add(alias);
    }
  }
  return { primaries, all };
}

describe('command inventory mirrors the real bot dispatch', () => {
  test('every command the bot answers to is documented in the inventory', () => {
    const { cases, aliases } = realPrefixCommands();
    const { all } = inventoryCommands();
    const undocumented = [...cases, ...aliases].filter((cmd) => !all.has(cmd)).sort();
    assert.deepEqual(
      undocumented,
      [],
      `these commands work in Discord but appear in no help surface: ${undocumented.join(', ')}`
    );
  });

  test('every inventory entry resolves to a real case or alias (no phantom commands)', () => {
    const { cases, aliases } = realPrefixCommands();
    const { all } = inventoryCommands();
    const phantom = [...all].filter((cmd) => !cases.has(cmd) && !aliases.has(cmd)).sort();
    assert.deepEqual(
      phantom,
      [],
      `these are advertised in help but the bot has no handler for them: ${phantom.join(', ')}`
    );
  });

  test('!navigation lists every prefix group, including Links & Public Wallets', () => {
    const nav = buildNavigationMessage({ prefix: '!' });
    for (const group of getCommandInventory().prefixGroups) {
      assert.ok(nav.includes(group.title), `!navigation is missing the "${group.title}" group`);
      for (const entry of group.entries) {
        assert.ok(nav.includes(`\`!${entry.primary}\``), `!navigation is missing !${entry.primary}`);
      }
    }
  });

  test('!commands catalog lists every primary prefix command', () => {
    const catalog = buildCommandsCatalog({ prefix: '!' });
    const { primaries } = inventoryCommands();
    for (const cmd of primaries) {
      // Entries render with their usage string (`!register <wallet-or-domain>`),
      // so match the command token followed by a space or the closing backtick.
      assert.ok(
        new RegExp(`\`!${cmd}[\` ]`).test(catalog),
        `!commands is missing !${cmd}`
      );
    }
  });
});

describe('help surfaces stay sendable and current', () => {
  // buildCommandsCatalog and buildModHelp are deliberately excluded — bot.js
  // sends both through replyInChunks(), so they may exceed the single-message
  // limit. modhelp moved into this group on 2026-08-15: four new admin commands
  // took it to 2067 chars, and the honest fix for a list that only grows is to
  // chunk it rather than to keep shortening the descriptions.
  for (const [name, build] of [
    ['!help', buildHelpOverview],
    ['!navigation', buildNavigationMessage],
  ]) {
    test(`${name} fits in one Discord message`, () => {
      const out = build({ prefix: '!', tokenSymbol: 'WinLEW', dripAmount: 1500 });
      assert.ok(
        out.length <= DISCORD_MESSAGE_LIMIT,
        `${name} is ${out.length} chars — over Discord's ${DISCORD_MESSAGE_LIMIT} limit, the reply would throw`
      );
    });
  }

  test('!modhelp is chunked, and every chunk is sendable', () => {
    // It is allowed to be long, but replyInChunks splits on newlines — so a
    // single LINE over the limit would still throw. That is the real constraint
    // once a message is chunked.
    const out = buildModHelp({ prefix: '!' });
    const longest = out.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
    assert.ok(longest <= DISCORD_MESSAGE_LIMIT,
      `!modhelp has a ${longest}-char line — replyInChunks splits on newlines, so this one would still throw`);
  });

  test('bot.js actually sends !modhelp through replyInChunks', () => {
    // The length limit was lifted on the promise that it is chunked. If that
    // send path regresses to message.reply(), the limit has to come back.
    const bot = fs.readFileSync(new URL('../../src/faucet/bot.js', import.meta.url), 'utf8');
    const modhelp = bot.slice(bot.indexOf("case 'modhelp'"), bot.indexOf("case 'reverse'"));
    assert.match(modhelp, /replyInChunks\(message, buildModHelp/);
  });

  test('governance commands are discoverable from !help, !navigation, and !commands', () => {
    // Discord is the primary governance surface — a member who can't find
    // /mole vote from help effectively has no vote.
    for (const [name, build] of [
      ['!help', buildHelpOverview],
      ['!navigation', buildNavigationMessage],
      ['!commands', buildCommandsCatalog],
    ]) {
      const out = build({ prefix: '!', tokenSymbol: 'WinLEW', dripAmount: 1500 });
      for (const cmd of ['/mole vote', '/mole proposals', '/mole propose']) {
        assert.ok(out.includes(cmd), `${name} never mentions ${cmd}`);
      }
    }
  });

  test('!help points at wallet verification, the source of the free vote', () => {
    const help = buildHelpOverview({ prefix: '!', tokenSymbol: 'WinLEW', dripAmount: 1500 });
    assert.ok(/mole-link|\/mole link/.test(help), '!help never tells anyone how to verify');
    assert.ok(/free .*vote/i.test(help), '!help never explains that verifying earns a free vote');
  });
});
