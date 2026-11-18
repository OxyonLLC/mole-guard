// Signer-set verification (§18, §50). The checks here exist because each one
// fails SILENTLY in production — you find out the day you try to spend.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  inspectAddress, verifySignerSet, lossMatrix, proofChallenge, verifyPossession,
  editDistance, suspectedSharedSite, RESERVED_ADDRESSES, offchainEnvelope,
} from "../../src/cunt/multisigVerify.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8"));
const codes = (r) => r.issues.map((i) => i.code);

test("an off-curve address is caught — it is a PDA that can never sign", () => {
  // THE silent one. A PDA has no private key. Put one in a 2-of-3 and you have
  // not made a weaker 2-of-3, you have made a 2-of-2 with no recovery.
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("seed")], new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"));
  const r = inspectAddress(pda.toBase58());
  assert.equal(r.onCurve, false);
  assert.ok(codes(r).includes("OFF_CURVE"));
  assert.equal(r.valid, false);
  assert.match(r.issues.find((i) => i.code === "OFF_CURVE").message, /2-of-2 with no recovery/);

  // and a real keypair passes
  assert.equal(inspectAddress(Keypair.generate().publicKey.toBase58()).valid, true);
});

test("mangled pastes are rejected before they reach a transaction", () => {
  const good = Keypair.generate().publicKey.toBase58();
  assert.ok(codes(inspectAddress("")).includes("EMPTY"));
  assert.ok(codes(inspectAddress("0OIl-not-base58")).includes("NOT_BASE58"));
  assert.ok(codes(inspectAddress(good.slice(0, 20))).includes("WRONG_LENGTH"), "a truncated paste must not pass");
});

test("the banked leading-zero address survives a base58 round-trip", () => {
  // 13Cr...CUNT begins with '1', which is a literal 0x00 byte. Any base58
  // implementation that routes through a BigInt drops it and produces a
  // DIFFERENT 43-char address. This asserts ours does not.
  const addr = manifest.vanity_targets.community.address;
  const r = inspectAddress(addr);
  assert.equal(r.bytes, 32);
  assert.equal(bs58.decode(addr)[0], 0, "a leading '1' must decode to a zero byte");
  assert.equal(bs58.encode(bs58.decode(addr)), addr, "round-trip must be lossless");
  assert.ok(!codes(r).includes("ROUNDTRIP"));
});

test("program addresses and the incinerator are never valid signers", () => {
  for (const [address, label] of RESERVED_ADDRESSES) {
    const r = inspectAddress(address);
    assert.ok(codes(r).includes("RESERVED") || codes(r).includes("OFF_CURVE"), `${label} must be rejected`);
    assert.equal(r.valid, false);
  }
});

test("a ground vanity address warns — it cannot live on a hardware wallet", () => {
  const r = inspectAddress(manifest.vanity_targets.weekly.address);
  assert.ok(codes(r).includes("VANITY"));
  assert.match(r.issues.find((i) => i.code === "VANITY").message, /hardware wallet/i);
});

test("m-of-m is rejected: no recovery is worse than the theft it prevents", () => {
  const two = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const { findings } = verifySignerSet(two, { m: 2 });
  const f = findings.find((x) => x.code === "NO_RECOVERY");
  assert.ok(f, "2-of-2 must be rejected");
  assert.match(f.message, /frozen permanently/i);

  const three = [...two, Keypair.generate().publicKey.toBase58()];
  assert.deepEqual(verifySignerSet(three, { m: 2 }).findings, [], "a clean 2-of-3 has no findings");
});

test("a one-character typo is caught, not accepted as a third key", () => {
  // Base58 drops 0/O/I/l to prevent confusion, and people still transpose.
  // Two addresses differing by one char are one address and a mistake.
  const a = Keypair.generate().publicKey.toBase58();
  const typo = a.slice(0, -1) + (a.at(-1) === "a" ? "b" : "a");
  assert.equal(editDistance(a, typo), 1);
  const { findings } = verifySignerSet([a, typo, Keypair.generate().publicKey.toBase58()], { m: 2 });
  assert.ok(findings.some((f) => f.code === "NEAR_DUPLICATE"));

  const dup = [a, a, Keypair.generate().publicKey.toBase58()];
  assert.ok(verifySignerSet(dup, { m: 2 }).findings.some((f) => f.code === "DUPLICATE"));
});

test("proof-of-possession verifies the real key and rejects any other", () => {
  // Skipping this is how a ceremony ends holding a key nobody can use.
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();
  const nonce = "0123456789abcdef";
  const message = proofChallenge({ address, nonce });
  const sign = (k, m) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), k.secretKey));

  assert.equal(verifyPossession({ address, message, signature: sign(kp, message) }).ok, true);
  assert.equal(verifyPossession({ address, message, signature: sign(Keypair.generate(), message) }).ok, false);

  // The nonce binds the signature to THIS ceremony — an old one cannot be replayed.
  const other = proofChallenge({ address, nonce: "ffffffffffffffff" });
  assert.equal(verifyPossession({ address, message: other, signature: sign(kp, message) }).ok, false);
  assert.equal(verifyPossession({ address, message, signature: "not-base58-0OIl" }).ok, false);
  assert.match(verifyPossession({ address, message, signature: bs58.encode(Buffer.alloc(10)) }).reason, /64/);
});

test("both challenge forms bind the same facts, and neither accepts a foreign signature", () => {
  // Ledger's off-chain signing takes restricted ASCII, so a newline can be
  // refused outright. The one-line form exists for that, and must be exactly as
  // strong — same address, same nonce, just a different separator.
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();
  const nonce = "a1b2c3d4";
  const sign = (m) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));

  const multi = proofChallenge({ address, nonce });
  const one = proofChallenge({ address, nonce, oneline: true });
  assert.notEqual(multi, one, "the two forms must differ, or the flag does nothing");
  assert.ok(!one.includes("\n"), "the one-line form must contain no newline");
  for (const form of [multi, one]) {
    assert.ok(form.includes(address) && form.includes(nonce), "both forms must bind address and nonce");
    assert.equal(verifyPossession({ address, message: form, signature: sign(form) }).ok, true);
  }

  // A signature over one form must NOT verify against the other — the CLI
  // retries the alternate deliberately; it must not silently pass here.
  assert.equal(verifyPossession({ address, message: multi, signature: sign(one) }).ok, false);
  // And neither form accepts a different key or a different nonce.
  assert.equal(verifyPossession({ address, message: one, signature: sign(proofChallenge({ address, nonce: "ffff", oneline: true })) }).ok, false);
});

test("loss and compromise are different questions and need different arithmetic", () => {
  // A backup makes loss LESS likely (both copies must go) and theft MORE likely
  // (either copy will do). Computing only one of them is the common mistake.
  const signers = [
    { id: "A", device: "ledger", location: "house", backup_location: "vault" },
    { id: "B", device: "trezor", location: "office" },
    { id: "C", device: "steel", location: "vault" },
  ];
  const { scenarios } = lossMatrix(signers, 2);
  const vault = scenarios.find((s) => s.scenario.includes("vault"));

  // A's device is elsewhere, so a vault fire does NOT destroy A -- only C.
  assert.deepEqual(vault.lost, ["C"], "loss requires BOTH copies gone");
  // But a vault breach exposes A's backup AND C -- that is the threshold.
  assert.deepEqual(vault.exposed, ["A", "C"], "compromise requires EITHER copy");
  assert.equal(vault.can_still_sign, true);
  assert.equal(vault.attacker_has_threshold, true, "two exposed keys meet a threshold of 2");
  assert.equal(vault.fatal, true, "survivable loss plus sufficient exposure is still fatal");
});

test("two keys in one place makes a 2-of-3 a 1-of-1 against that place", () => {
  const bad = [
    { id: "A", device: "ledger", location: "home" },
    { id: "B", device: "trezor", location: "home" },
    { id: "C", device: "steel", location: "vault" },
  ];
  const { measurements } = lossMatrix(bad, 2);
  assert.equal(measurements.max_keys_at_one_location, 2);
  assert.ok(measurements.single_points_of_failure.length > 0);
  assert.equal(measurements.effective_threshold_against_worst_case, 1);

  const good = [
    { id: "A", device: "ledger", location: "house" },
    { id: "B", device: "trezor", location: "office" },
    { id: "C", device: "steel", location: "vault" },
  ];
  const m2 = lossMatrix(good, 2).measurements;
  assert.deepEqual(m2.single_points_of_failure, []);
  assert.equal(m2.max_keys_at_one_location, 1);
  assert.equal(m2.redundancy, 1);
  assert.equal(m2.losses_until_frozen, 2);
});

test("locations in one building are flagged as one blast radius", () => {
  // The matrix trusts the names. "home-office" and "home-safe" read as two
  // places and burn in one fire.
  const shared = suspectedSharedSite(["home-office", "home-safe", "bank-vault"]);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].site, "home");
  assert.deepEqual(suspectedSharedSite(["house", "office", "bank-vault"]), []);
});

test("signer addresses live only in the manifest, and nowhere else", () => {
  // This originally asserted no signer pubkey appeared ANYWHERE in the repo.
  // That conflated "public key" with "secret": InitializeMultisig writes all
  // three into an on-chain account anyone can read, so they are permanently
  // public the moment the multisig exists — and the rule would have forced the
  // ceremony to keep no record of itself. What is worth enforcing is that they
  // do not get scattered into code, docs or the website, where one would
  // eventually drift out of sync with the manifest.
  const grep = (needle) => {
    try {
      return execFileSync("git", ["grep", "-l", "--", needle], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch { return []; }
  };

  // Prove the search works first, so this cannot pass by being vacuous.
  assert.ok(grep(manifest.vanity_targets.community.address).length > 0, "the search itself must work");
  assert.deepEqual(grep(Keypair.generate().publicKey.toBase58()), [], "a random address must not match");

  // The manifest is the record; the ceremony doc explains the derivation-path
  // finding using this exact address; the signing page pre-fills it. Anywhere
  // else and it will eventually drift out of sync with the manifest.
  const allowed = new Set(["cunt-project.json", "docs/cunt/CUNT-KEY-CEREMONY.md", "tools/sign-challenge.html"]);
  for (const s of manifest.multisig.signers) {
    if (!s.address) continue;
    const stray = grep(s.address).filter((f) => !allowed.has(f));
    assert.deepEqual(stray, [], `signer ${s.id}'s address has leaked outside the manifest: ${stray.join(", ")}`);
    // Never on the website.
    assert.ok(!grep(s.address).some((f) => f.startsWith("src/public/")), `signer ${s.id}'s address is on the public site`);
    // An address is meaningless without the path that produced it.
    assert.ok(s.derivation_path, `signer ${s.id} has an address but no derivation path`);
  }

  // The relaxation above must not be read as relaxing what CAN'T be committed.
  // A word-based scan is useless here — the manifest's own notes say "seed
  // phrase" repeatedly, telling you not to commit one. Instead: whitelist the
  // fields a signer may carry, so adding `"seed"` or `"secret"` fails the build.
  // Actual secret SHAPES are scan-secrets' job, not a regex over prose.
  const allowedFields = new Set([
    "id", "holder", "storage", "wallet_app", "os", "address", "device", "location",
    "backup_location", "online", "possession_proven", "derivation_path", "keypair_uri", "possession_proof", "device_id", "phrase_only", "plate_restored",
  ]);
  for (const s of manifest.multisig.signers) {
    const unexpected = Object.keys(s).filter((k) => !allowedFields.has(k));
    assert.deepEqual(unexpected, [], `signer ${s.id} carries unexpected field(s): ${unexpected.join(", ")} — a new field is how key material gets in`);
  }
});

test("both signing encodings verify — raw and the Solana off-chain envelope", () => {
  // `solana sign-offchain-message` signs b"\xffsolana offchain" + version +
  // format + u16 length + message. Browser wallets sign the raw bytes. The
  // verifier knew only the raw form and REJECTED signer A's genuine Ledger
  // signature — a false negative that looks exactly like a broken device.
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();
  const message = proofChallenge({ address, nonce: "cafe1234", oneline: true });
  const sign = (bytes) => bs58.encode(nacl.sign.detached(bytes, kp.secretKey));

  const raw = verifyPossession({ address, message, signature: sign(new TextEncoder().encode(message)) });
  assert.equal(raw.ok, true);
  assert.equal(raw.encoding, "raw");

  for (const format of [0, 1, 2]) {
    const r = verifyPossession({ address, message, signature: sign(offchainEnvelope(message, format)) });
    assert.equal(r.ok, true, `off-chain envelope format ${format} must verify`);
    assert.equal(r.encoding, `offchain-v0-format-${format}`);
  }

  // The envelope layout is exact — a wrong length field or domain silently
  // breaks every CLI signature.
  const env = offchainEnvelope("hi", 0);
  assert.equal(new TextDecoder().decode(env.slice(1, 16)), "solana offchain");
  assert.equal(env[0], 0xff);
  assert.equal(env[16], 0, "version byte");
  assert.equal(env[17], 0, "format byte");
  assert.equal(env[18] | (env[19] << 8), 2, "u16 little-endian length");

  // And a foreign signature still fails in BOTH encodings.
  const other = Keypair.generate();
  const foreign = bs58.encode(nacl.sign.detached(offchainEnvelope(message, 0), other.secretKey));
  const bad = verifyPossession({ address, message, signature: foreign });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /either the raw or off-chain-envelope/i);
});

test("the verifier is wired up and cannot sign, send or create anything", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["cunt:multisig-verify"], "node src/scripts/cunt-multisig-verify.js");

  const src = readFileSync(resolve(repoRoot, "src/scripts/cunt-multisig-verify.js"), "utf8");
  for (const forbidden of ["sendTransaction", "sendAndConfirm", "createMultisig", "Keypair.generate", "secretKey", "fromSecretKey"]) {
    assert.ok(!src.includes(forbidden), `the verifier must not reference ${forbidden} — it is read-only by design`);
  }
});

// ── Guard the guard ─────────────────────────────────────────────────────────
// Added 2026-08-11 after a mutation sweep: blanking each file a guard claims to
// protect, and checking the guard goes red. Four test/subject pairs in this
// directory survived their subject being EMPTIED.
//
// The cause is structural, not sloppiness: an assertion of the form "this file
// must NOT contain X" is trivially satisfied by a file containing nothing. Such
// a test cannot tell "safe" from "deleted". Pairing every absence assertion
// with a presence assertion is what closes that hole.

test("subject src/scripts/cunt-multisig-verify.js is present and substantial", () => {
  const src = readFileSync(resolve(repoRoot, "src/scripts/cunt-multisig-verify.js"), "utf8");
  assert.ok(src.length > 500, "src/scripts/cunt-multisig-verify.js is empty or near-empty — every \"must not contain\" assertion about it would pass vacuously.");
  assert.ok(src.includes('possession'), "src/scripts/cunt-multisig-verify.js no longer contains 'possession' — the subject changed shape, so the absence checks below prove nothing.");
  assert.ok(src.includes('challenge'), "src/scripts/cunt-multisig-verify.js no longer contains 'challenge' — the subject changed shape, so the absence checks below prove nothing.");
});
