// Phase 4F-R: Quiz, faucet-storage and linked-wallet-mirror isolation.
//
// Every override is pointed at a fresh disposable directory before imports.
// The external audit wrapper fingerprints protected files before and after.
// The temp root is removed at the end. Production defaults (overrides unset)
// are checked against the historical hardcoded locations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
assert.equal(process.env.WINLEW_TEST_ISOLATED, "1", "run through the isolated audit wrapper");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "winlew-quiz-isolation-"));
const dirs = {
  data: path.join(tempRoot, "data"),
  quiz: path.join(tempRoot, "quiz"),
  faucet: path.join(tempRoot, "faucet"),
  linkedSrc: path.join(tempRoot, "linked-src"),
  linkedRoot: path.join(tempRoot, "linked-root"),
};

process.env.MONGO_ENABLED = "false";
delete process.env.MONGO_URI;
process.env.DATA_DIR = dirs.data;
process.env.QUIZ_DATA_DIR = dirs.quiz;
process.env.FAUCET_DATA_DIR = dirs.faucet;
process.env.LINKED_WALLETS_DIRS = [dirs.linkedSrc, dirs.linkedRoot].join(path.delimiter);
process.env.DISCORD_TOKEN = "phase4fr-local-only";
process.env.DISCORD_CLIENT_ID = "phase4fr-local-only";
process.env.DISCORD_CLIENT_SECRET = "phase4fr-local-only";
process.env.DISCORD_REDIRECT_URI = "http://127.0.0.1/phase4fr-callback";
process.env.WINLEW_MINT = "phase4fr-local-only";

const quizStorage = require("../../src/quiz/storage.js");
const quizDb = require("../../src/quiz/db.js");
const recentHistory = require("../../src/quiz/recent-history.js");
const quizWallets = require("../../src/quiz/wallets.js");
const faucetStorage = await import("../../src/faucet/storage.js");
const faucetState = await import("../../src/faucet/state.js");
const walletLink = await import("../../src/mole/walletLink.js");

test.after(() => {
  assert.ok(tempRoot.startsWith(os.tmpdir()), "cleanup target must stay inside the OS temp directory");
  fs.rmSync(tempRoot, { recursive: true, force: true });
  assert.equal(fs.existsSync(tempRoot), false);
});

test("quiz db.json, its lock and recent_questions.json live in QUIZ_DATA_DIR", () => {
  assert.equal(quizStorage.quizDataDir(), path.resolve(dirs.quiz));
  quizDb.addPoints("phase4fr-quiz-a", 100);
  assert.equal(quizDb.getUser("phase4fr-quiz-a").points, 100);
  recentHistory.rememberQuestion("phase4fr-channel", "q-1");
  assert.ok(fs.existsSync(path.join(dirs.quiz, "db.json")));
  assert.ok(fs.existsSync(path.join(dirs.quiz, "recent_questions.json")));
  assert.equal(fs.existsSync(path.join(dirs.quiz, "db.json.lock")), false, "the lock is released after a mutation");
  const stored = JSON.parse(fs.readFileSync(path.join(dirs.quiz, "db.json"), "utf8"));
  assert.equal(stored.users["phase4fr-quiz-a"].points, 100, "schema and record shape are unchanged");
});

test("quiz wallet lookup reads only the overridden faucet and mirror files", () => {
  fs.mkdirSync(dirs.faucet, { recursive: true });
  fs.mkdirSync(dirs.linkedSrc, { recursive: true });
  fs.writeFileSync(path.join(dirs.faucet, "wallet_links.json"), JSON.stringify({
    version: 1, links: { "phase4fr-w": { address: "FaucetAddr", updatedAt: 1000 } },
  }));
  fs.writeFileSync(path.join(dirs.linkedSrc, "linked_wallets.json"), JSON.stringify({
    "phase4fr-w": { wallet: "MirrorAddr", updatedAt: 2000 },
  }));
  const picked = quizWallets.getLinkedWallet("phase4fr-w");
  assert.equal(picked.address, "MirrorAddr", "newest candidate wins, as before");
  assert.equal(picked.source, "mole-src-data");
  assert.equal(quizWallets.getLinkedWallet("someone-not-in-temp"), null, "no real member wallet is visible");
});

test("faucet storage reads and writes FAUCET_DATA_DIR", () => {
  faucetStorage.writeManagedJson("ip_bans.json", { phase4fr: true });
  assert.ok(fs.existsSync(path.join(dirs.faucet, "ip_bans.json")));
  assert.deepEqual(faucetStorage.loadManagedJson("ip_bans.json", {}), { phase4fr: true });
  assert.equal(faucetState.resolveDataPath("x.json"), path.join(path.resolve(dirs.faucet), "x.json"));
});

test("linked-wallet mirrors are written only under the overrides", () => {
  walletLink.syncAllLinkedWalletMirrors();
  assert.ok(fs.existsSync(path.join(dirs.linkedSrc, "linked_wallets.json")));
  assert.ok(fs.existsSync(path.join(dirs.linkedRoot, "linked_wallets.json")));
  assert.ok(fs.existsSync(path.join(dirs.faucet, "wallet_links.json")));
});

test("with overrides unset, every path resolves to its historical production location", () => {
  const saved = { q: process.env.QUIZ_DATA_DIR, f: process.env.FAUCET_DATA_DIR };
  delete process.env.QUIZ_DATA_DIR;
  delete process.env.FAUCET_DATA_DIR;
  try {
    assert.equal(quizStorage.quizDataDir(), path.join(repoRoot, "src", "quiz", "data"));
    assert.equal(faucetState.resolveDataPath("wallet_links.json"), path.join(repoRoot, "src", "faucet", "wallet_links.json"));
  } finally {
    process.env.QUIZ_DATA_DIR = saved.q;
    process.env.FAUCET_DATA_DIR = saved.f;
  }
});
