// The vanity-service threat model rests on one structural fact about Solana
// keys, and its entire recommendation follows from it:
//
//   The importable private half of a Solana keypair is a 32-byte SEED, and the
//   signing scalar is a one-way hash of that seed.
//
// That is why split-key vanity generation — the construction that makes paid
// vanity services safe on Bitcoin — does not transfer here. On secp256k1 the
// private key IS the scalar, so a user's secret `a` and a service's offset `b`
// combine into a usable key `a+b` that the service never learns. On Ed25519 the
// combined scalar has no corresponding seed, so no standard wallet can import
// the result.
//
// If that ever stops being true — a new key format, a wallet that imports raw
// scalars — the threat model's conclusion should be revisited rather than
// silently inherited. These tests fail loudly in that case.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const doc = readFileSync(resolve(repoRoot, "docs/cunt/CUNT-VANITY-SERVICE-THREAT-MODEL.md"), "utf8");

test("a Solana secret key is a 32-byte seed plus its public key", () => {
  const kp = Keypair.generate();
  assert.equal(kp.secretKey.length, 64, "Solana secretKey must be 64 bytes");
  const seed = kp.secretKey.slice(0, 32);
  const tail = kp.secretKey.slice(32);
  assert.ok(
    Buffer.from(tail).equals(Buffer.from(kp.publicKey.toBytes())),
    "the last 32 bytes must be the public key — so only the first 32 are secret"
  );
  // The public key is fully determined by the seed. That is what makes the seed
  // "the private half" for import purposes.
  assert.ok(Keypair.fromSeed(seed).publicKey.equals(kp.publicKey));
});

test("the signing scalar is derived from the seed by hashing — one-way", () => {
  // nacl derives the same public key from the seed, confirming the standard
  // Ed25519 construction: scalar = clamp(SHA-512(seed)[0..32]).
  const kp = Keypair.generate();
  const seed = kp.secretKey.slice(0, 32);
  const nk = nacl.sign.keyPair.fromSeed(seed);
  assert.ok(Buffer.from(nk.publicKey).equals(Buffer.from(kp.publicKey.toBytes())));

  // Two seeds differing in one bit give unrelated public keys — the avalanche
  // that makes the derivation non-invertible.
  const other = Uint8Array.from(seed);
  other[0] ^= 0x01;
  const nk2 = nacl.sign.keyPair.fromSeed(other);
  assert.ok(!Buffer.from(nk2.publicKey).equals(Buffer.from(nk.publicKey)));
});

test("wallets import seeds, so a raw combined scalar is not a usable product", () => {
  // Keypair.fromSeed accepts exactly 32 bytes. There is no fromScalar. A
  // split-key result would be a scalar, which this API cannot express — which
  // is the practical form of the finding.
  assert.throws(() => Keypair.fromSeed(new Uint8Array(31)), "31 bytes must be rejected");
  assert.throws(() => Keypair.fromSeed(new Uint8Array(64)), "64 bytes must be rejected");
  assert.ok(Keypair.fromSeed(new Uint8Array(32)), "exactly 32 bytes is the only accepted form");
  assert.equal(typeof Keypair.fromSeed, "function");
  assert.equal(Keypair.fromScalar, undefined, "if this ever exists, revisit the threat model");
});

test("the threat model states the finding and its consequence", () => {
  // The document's value is the conclusion, not the prose around it. If someone
  // softens it into "be careful with keys", this fails.
  assert.match(doc, /does not work on Solana/i, "must state that split-key generation fails here");
  assert.match(
    doc,
    /If we perform the computation, we hold the key/i,
    "must state the inherent custody consequence — it is the whole finding"
  );
  assert.match(doc, /RECOMMENDED NOT TO BUILD AS DESCRIBED/, "the recommendation must remain unambiguous");
  // Operator retention must be classed as inherent, not as a mitigable risk.
  assert.match(doc, /inherent \*property\*|inherent property/i);
});

test("no endpoint anywhere accepts a private key", () => {
  // The recommended design's load-bearing property: there is no route that
  // could receive key material. Asserted against the real server so it cannot
  // drift in later.
  const web = readFileSync(resolve(repoRoot, "src/mole/web.js"), "utf8");
  const suspicious = [
    /app\.(post|put)\([^)]*vanity/i,
    /req\.body\.(secretKey|privateKey|seed|keypair)\b/i,
  ];
  for (const re of suspicious) {
    assert.ok(!re.test(web), `web.js appears to accept key material: ${re}`);
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

test("subject src/mole/web.js is present and substantial", () => {
  const src = readFileSync(resolve(repoRoot, "src/mole/web.js"), "utf8");
  assert.ok(src.length > 500, "src/mole/web.js is empty or near-empty — every \"must not contain\" assertion about it would pass vacuously.");
  assert.ok(src.includes('app.get'), "src/mole/web.js no longer contains 'app.get' — the subject changed shape, so the absence checks below prove nothing.");
  assert.ok(src.includes('app.post'), "src/mole/web.js no longer contains 'app.post' — the subject changed shape, so the absence checks below prove nothing.");
});
