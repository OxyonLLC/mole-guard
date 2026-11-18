// Every process that writes a managed file must flush before it exits.
//
// THE BUG, found 2026-08-16 on the first live hodl:pay.
//
// All three storage layers write local disk synchronously and push to Mongo on
// a background promise chain. Nothing awaited that chain. So a process that
// wrote and then called process.exit() dropped the push, and the write reached
// local disk only.
//
// That is not merely backup drift. refreshManagedJson()/refreshManagedFile() in
// the faucet and mole layers write Mongo's payload back OVER the local file. So
// the stale copy actively overwrites the correct one, and the write is gone.
// Observed: hodl:pay recorded a chunk paid, and the next run re-read
// "submitted, pending" from Mongo.
//
// The worst shape is a crash between submitting a transfer and confirming it —
// the next run sees no signature and sends a SECOND transaction. That is why
// hodl:pay flushes inside save() rather than only at exit.
//
// These are source-level pins, the same approach as hodlPayOrdering.test.mjs:
// what is being asserted is that a call exists on a path, which cannot be
// exercised without a Mongo instance and real signals.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("all three storage layers expose a flush", () => {
  const layers = [
    ["src/mole/storage.js", "flushManagedWrites"],
    ["src/faucet/storage.js", "flushManagedWrites"],
    ["src/quiz/storage.js", "flushManagedQuizWrites"],
  ];

  for (const [file, fnName] of layers) {
    test(`${file} exports one, and it awaits the queued persists`, () => {
      const src = read(file);
      const declaration = `async function ${fnName}()`;
      const at = src.indexOf(declaration);
      assert.ok(at > 0, `${file} has no ${declaration} — a write there is lost on exit`);
      // It must await the CHAINS, not just resolve. A flush that awaits nothing
      // silences the problem instead of fixing it, and every caller would pass.
      const body = src.slice(at, at + 300);
      assert.match(body, /persistChains\.values\(\)/,
        `${file}'s flush does not await the persist chains`);
      assert.match(body, /await /, `${file}'s flush does not await anything`);
    });
  }

  test("quiz's flush is actually exported, not just defined", () => {
    // It is CommonJS — defining it without adding it to module.exports would
    // leave every caller importing undefined, and `await undefined()` throws.
    const src = read("src/quiz/storage.js");
    const exports_ = src.slice(src.indexOf("module.exports = {"));
    assert.match(exports_, /flushManagedQuizWrites/);
  });
});

describe("the long-lived processes flush on their way out", () => {
  // pm2 restarts these routinely, and the owner restarts them by hand often.
  test("the faucet bot flushes in shutdown()", () => {
    const src = read("src/faucet/bot.js");
    const fn = src.slice(src.indexOf("async function shutdown(signal)"), src.indexOf("process.on('SIGTERM'"));
    assert.match(fn, /await flushManagedWrites\(\)/,
      "a faucet claim written just before a restart can be erased by that restart");
    assert.ok(fn.indexOf("flushManagedWrites") < fn.indexOf("process.exit"),
      "the flush must run before the exit");
  });

  test("the quiz payout worker flushes on both signals", () => {
    const src = read("src/quiz/payout-worker.js");
    assert.match(src, /async function shutdown\(\)/);
    const fn = src.slice(src.indexOf("async function shutdown()"), src.indexOf("process.on('SIGINT'"));
    assert.match(fn, /await flushManagedQuizWrites\(\)/);
    // Both signals must reach it. pm2 sends SIGTERM; Ctrl-C sends SIGINT.
    assert.match(src, /process\.on\('SIGINT', shutdown\)/);
    assert.match(src, /process\.on\('SIGTERM', shutdown\)/);
  });

  test("the web/bot process has a shutdown handler at all", () => {
    // It had none — SIGTERM killed it instantly, dropping every queued persist
    // for sessions, governance votes and wallet links.
    const src = read("src/index.js");
    assert.match(src, /process\.on\('SIGTERM'/);
    assert.match(src, /process\.on\('SIGINT'/);
    // It writes through BOTH layers: mole/web.js imports faucet/service.js and
    // faucet/eligibility.js, so flushing only mole would still lose writes.
    assert.match(src, /flushManagedWrites\(\)/);
    assert.match(src, /flushFaucetWrites\(\)/);
  });
});

describe("the short-lived scripts flush before exiting", () => {
  const scripts = [
    ["src/scripts/hodl-pay.js", /flushManagedWrites/],
    ["src/scripts/hodl-epoch.js", /flushManagedWrites/],
    ["src/scripts/quiz-cadence.js", /flushManagedQuizWrites/],
  ];

  for (const [file, call] of scripts) {
    test(`${file} flushes on BOTH the success and failure paths`, () => {
      const src = read(file);
      const calls = src.match(new RegExp(call.source, "g")) || [];
      // import + success + failure. Fewer means a path was missed, and the
      // failure path is the one that matters most: a run that crashed after
      // submitting is exactly the run whose write must survive.
      assert.ok(calls.length >= 3,
        `${file} references the flush ${calls.length} times; expected an import plus both exit paths`);
    });
  }
});

describe("what the sweep deliberately left alone", () => {
  test("clean-airdrop-list writes raw files, so it has no queued persist", () => {
    // It bypasses the managed layer entirely and tells the operator to restart
    // the faucet so bootstrapFile() pushes the result. Adding a flush there
    // would be cargo-culting — there is nothing queued to flush.
    const src = read("src/scripts/clean-airdrop-list.js");
    assert.ok(!/writeManagedJson/.test(src), "it now uses the managed layer and needs a flush");
    assert.match(src, /Restart the faucet so bootstrapFile\(\)/);
  });

  test("faucet-reconcile writes through claimStore, which is plain fs", () => {
    const store = read("src/faucet/claimStore.js");
    assert.ok(!/writeManagedJson|queuePersist/.test(store),
      "claimStore now uses the managed layer — faucet-reconcile needs a flush before exit");
  });
});
