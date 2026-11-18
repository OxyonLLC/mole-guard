// "No compatible Solana wallet was injected" — on a desktop PC, with wallets
// installed, right after an OAuth redirect.
//
// Wallet Standard registration is asynchronous: an extension announces itself
// with `wallet-standard:register-wallet` whenever its content script runs,
// which on a cold page load can land AFTER the visitor has clicked. Detection
// answered honestly for the instant it was asked and told the truth about the
// wrong moment. Same shape as the earlier "sometimes acts like im in incognito
// mode" report.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(repoRoot, "src/public/assets/wallet-auth.js"), "utf8");
const login = src.slice(src.indexOf("async function walletLogin"), src.indexOf("async function refreshWalletBalance"));
const wait = src.slice(src.indexOf("async function waitForWalletProviders"), src.indexOf("function describeWalletDetection"));
const help = src.slice(src.indexOf("function walletProviderHelp"), src.indexOf("function providerWalletAddress"));

describe("connect waits for a late-registering wallet", () => {
  test("it does not give up on the first look", () => {
    assert.match(login, /waitForWalletProviders\(\)/,
      'a single synchronous check races the extension and loses on a cold load');
  });

  test("the wait is bounded — a visitor with no wallet still gets an answer", () => {
    assert.match(wait, /timeoutMs = \d+/);
    assert.match(wait, /Date\.now\(\) < deadline/);
  });

  test("it polls rather than waiting on the event alone", () => {
    assert.match(wait, /getHubWalletProviders\(options\)/,
      'window.solana-style injections fire no registration event at all');
  });

  test("the button says what it is doing while it waits", () => {
    assert.match(login, /Looking for wallet…/,
      'a control that sits dead for a second reads as a broken click');
  });
});

describe("the failure message states evidence, not a guess", () => {
  test("it no longer opens by blaming Incognito", () => {
    assert.ok(!/If you are using Incognito, open chrome:\/\/extensions/.test(help),
      'that guess was wrong for a desktop report and sent the reader off for nothing');
  });

  test("a wallet that IS present but unusable is named", () => {
    assert.match(help, /describeWalletDetection\(\)/);
    assert.match(help, /connect \+ signMessage/,
      'naming the missing feature turns an unanswerable error into a fixable one');
  });

  test("reloading is offered first, because that is the actual remedy for the race", () => {
    assert.match(help, /Reload the page and try again/);
  });
});
