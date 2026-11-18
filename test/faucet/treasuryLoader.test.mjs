// src/faucet/keypair.js: the treasury keypair loader. (This file is NOT named
// *keypair*: the ignore rule would hide it.) These tests use ONLY
// keypairs generated here (Keypair.generate()); no real key is read or needed.
//
// The source module was missing from git until 2026-11-12: the `**/*keypair*`
// ignore rule meant for key FILES also swallowed it, so a fresh clone could not
// load the payout path. These tests also pin that the narrowed rule still hides
// every key file.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { Keypair } from "@solana/web3.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "src/faucet/keypair.js");
let n = 0;
// The module caches the keypair, so each test gets a fresh module instance.
const fresh = () => import(`${pathToFileURL(modulePath).href}?t=${++n}`);

function dummyKeyFile() {
  const dir = mkdtempSync(join(tmpdir(), "kp-test-"));
  const kp = Keypair.generate();
  const file = join(dir, "dummy-keypair.json");
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return { dir, file, kp };
}

test("loads a generated dummy keypair from an absolute path", async () => {
  const { dir, file, kp } = dummyKeyFile();
  try {
    const { loadTreasuryKeypair } = await fresh();
    assert.equal(loadTreasuryKeypair(file).publicKey.toBase58(), kp.publicKey.toBase58());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("resolves a relative path against the working directory", async () => {
  const { dir, kp } = dummyKeyFile();
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const { loadTreasuryKeypair } = await fresh();
    assert.equal(loadTreasuryKeypair("./dummy-keypair.json").publicKey.toBase58(), kp.publicKey.toBase58());
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); }
});

test("caches the first keypair for the life of the process", async () => {
  const a = dummyKeyFile(); const b = dummyKeyFile();
  try {
    const { loadTreasuryKeypair } = await fresh();
    const first = loadTreasuryKeypair(a.file);
    assert.equal(loadTreasuryKeypair(b.file), first);
  } finally { rmSync(a.dir, { recursive: true, force: true }); rmSync(b.dir, { recursive: true, force: true }); }
});

test("a malformed key file never echoes its contents in the error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kp-bad-"));
  try {
    const secretish = Array.from(Keypair.generate().secretKey);
    const cases = {
      truncated: JSON.stringify(secretish).slice(0, 90) + "XYZMARKER",
      base58: "XYZMARKER4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw9",
      shortArray: JSON.stringify(secretish.slice(0, 32)),
      outOfRange: JSON.stringify([...secretish.slice(0, 63), 999]),
    };
    for (const [name, body] of Object.entries(cases)) {
      const f = join(dir, `${name}.json`);
      writeFileSync(f, body);
      const { loadTreasuryKeypair } = await fresh();
      assert.throws(() => loadTreasuryKeypair(f), (e) => {
        assert.match(e.message, /contents not shown/, name);
        assert.doesNotMatch(e.message, /XYZMARKER|\d{1,3},\d{1,3},\d{1,3}/, `${name}: message leaks file content: ${e.message}`);
        return true;
      });
    }
    const { loadTreasuryKeypair } = await fresh();
    assert.throws(() => loadTreasuryKeypair(join(dir, "missing.json")), /could not be read \(ENOENT\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("importing the module reads nothing (no import-time key access)", async () => {
  const mod = await fresh();
  assert.deepEqual(Object.keys(mod), ["loadTreasuryKeypair"]);
});

test("the module source holds no key material", () => {
  const src = readFileSync(modulePath, "utf8");
  assert.doesNotMatch(src, /[1-9A-HJ-NP-Za-km-z]{80,}/, "base58 secret-shaped string");
  assert.doesNotMatch(src, /\[\s*(\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/, "byte array");
  assert.doesNotMatch(src, /\b[0-9a-fA-F]{64,}\b/, "hex secret-shaped string");
  assert.doesNotMatch(src, /PRIVATE KEY/, "PEM block");
});

test("the secret scanner waives only the loader's NAME, never its content or other paths", () => {
  // A throwaway repo with dummy files; the real scanner runs against it.
  const dir = mkdtempSync(join(tmpdir(), "scan-test-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    const put = (p, body) => { const f = join(dir, p); execFileSync(process.execPath, ["-e", `require('fs').mkdirSync(require('path').dirname(${JSON.stringify(f)}),{recursive:true})`]); writeFileSync(f, body); };
    put("src/faucet/keypair.js", readFileSync(modulePath, "utf8"));
    put("src/faucet/bot-keypair.json", "[]\n");
    put("src/other/keypair.js", "export {}\n");
    git("add", "-A", "-f");
    const run = () => { try { execFileSync(process.execPath, [resolve(repoRoot, "src/scripts/scan-secrets.js")], { cwd: dir, stdio: "pipe" }); return ""; } catch (e) { return String(e.stdout); } };
    let out = run();
    assert.match(out, /src\/faucet\/bot-keypair\.json/, "a key FILE is still flagged");
    assert.match(out, /src\/other\/keypair\.js/, "the same name elsewhere is still flagged");
    assert.doesNotMatch(out, /\n\s+src\/faucet\/keypair\.js\n/, "the clean loader source is not flagged");
    // Content rules still apply to the exempted path: a dummy key array in it is caught.
    const dummy = Array.from(Keypair.generate().secretKey).join(",");
    put("src/faucet/keypair.js", `export const k = [${dummy}];\n`);
    git("rm", "-q", "--cached", "src/faucet/bot-keypair.json", "src/other/keypair.js");
    git("add", "-A", "-f", "src/faucet/keypair.js");
    out = run();
    assert.match(out, /src\/faucet\/keypair\.js/, "key material inside the exempted file is still a finding");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the narrowed ignore rule still hides every key file", () => {
  const ignored = (p) => { try { execFileSync("git", ["check-ignore", "-q", p], { cwd: repoRoot }); return true; } catch { return false; } };
  for (const p of ["src/faucet/bot-keypair.json", "src/faucet/keypair.json", "keypair.json", "src/faucet/treasury-keypair.json",
    "src/other/keypair.js", "src/faucet/keypair.js.bak"]) {
    assert.ok(ignored(p), `${p} must stay git-ignored`);
  }
  assert.ok(!ignored("src/faucet/keypair.js"), "the loader source itself is tracked");
});
