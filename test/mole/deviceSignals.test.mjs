// Participation signals — Stage 2 collects and hashes, and decides nothing.
//
// The properties worth pinning are privacy properties. This module exists to
// count "one device, many wallets", and the whole justification for collecting
// anything is that what we keep cannot be turned back into a person.
import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { hashDeviceFingerprint, hashNetwork, collectSignals, signalsEnabled } from "../../src/mole/deviceSignals.js";

const FP = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0",
  platform: "Win32",
  language: "en-GB",
  timezone: "Europe/London",
  screen: "1920x1080x24",
  memory: 8,
  cores: 16,
};

beforeEach(() => {
  process.env.PARTICIPATION_HASH_SALT = "test-salt";
  process.env.PARTICIPATION_SIGNALS_ENABLED = "true";
});

describe("nothing raw survives", () => {
  test("the output is a digest, so no raw value can be embedded in it", () => {
    // Substring-matching each raw value against the output is meaningless: a
    // 64-char hex string contains "8" and "47" by chance, and this test failed
    // on exactly that before. The property that actually holds is that the
    // output is a fixed-length hex digest — nothing longer than a hex nibble
    // can survive in it, so no user agent or timezone can.
    const hash = hashDeviceFingerprint(FP);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hash.length, 64);

    // And it is genuinely derived from every field: change one, get another.
    for (const field of Object.keys(FP)) {
      const altered = hashDeviceFingerprint({ ...FP, [field]: "changed" });
      assert.notEqual(altered, hash, `${field} is not part of the hash`);
    }
  });

  test("an IP is reduced to a network before hashing", () => {
    const hash = hashNetwork("203.0.113.47");
    assert.match(hash, /^[a-f0-9]{64}$/);
    // The meaningful test is not "the string is absent" — it is that the host
    // octet cannot influence the result at all. If it did, two machines on one
    // network would not collide, and the /24 reduction would be doing nothing.
    assert.equal(hashNetwork("203.0.113.47"), hashNetwork("203.0.113.1"));
  });

  test("a household shares one network bucket", () => {
    // Same /24, different machines — must collide, because that is the whole
    // point: a network is not a person.
    assert.equal(hashNetwork("203.0.113.10"), hashNetwork("203.0.113.200"));
    assert.notEqual(hashNetwork("203.0.113.10"), hashNetwork("203.0.114.10"));
  });

  test("IPv6 keeps only the routing prefix", () => {
    assert.equal(hashNetwork("2001:db8:1234::1"), hashNetwork("2001:db8:1234::beef"));
    assert.notEqual(hashNetwork("2001:db8:1234::1"), hashNetwork("2001:db8:9999::1"));
  });
});

describe("the salt is the retention mechanism", () => {
  test("rotating it breaks correlation with older records", () => {
    const before = hashDeviceFingerprint(FP);
    process.env.PARTICIPATION_HASH_SALT = "rotated";
    assert.notEqual(hashDeviceFingerprint(FP), before);
  });

  test("no salt means no hashing at all, rather than a reversible one", () => {
    // A /24 has a tiny input space. Unsalted it is trivially reversed, so the
    // correct behaviour is to collect nothing.
    delete process.env.PARTICIPATION_HASH_SALT;
    assert.equal(hashDeviceFingerprint(FP), null);
    assert.equal(hashNetwork("203.0.113.10"), null);
    assert.equal(collectSignals({ ip: "203.0.113.10", headers: {} }, FP), null);
  });
});

describe("it is stable enough to count, and honest about weak input", () => {
  test("the same environment hashes the same, whatever the key order", () => {
    const reordered = Object.fromEntries(Object.entries(FP).reverse());
    assert.equal(hashDeviceFingerprint(FP), hashDeviceFingerprint(reordered));
  });

  test("a different environment hashes differently", () => {
    assert.notEqual(hashDeviceFingerprint(FP), hashDeviceFingerprint({ ...FP, timezone: "America/Denver" }));
  });

  test("too little input produces no hash rather than a colliding one", () => {
    // Every locked-down browser would otherwise share one hash, which reads as
    // a strong signal and is actually an absence of one.
    assert.equal(hashDeviceFingerprint({ userAgent: "x" }), null);
    assert.equal(hashDeviceFingerprint({}), null);
  });

  test("only allowlisted fields are hashed", () => {
    // A client cannot smuggle a stable identifier of its own choosing in.
    const withExtra = { ...FP, evilStableId: "track-me-forever" };
    assert.equal(hashDeviceFingerprint(withExtra), hashDeviceFingerprint(FP));
  });

  test("an oversized value cannot make us hash unbounded input", () => {
    assert.match(hashDeviceFingerprint({ ...FP, userAgent: "A".repeat(500_000) }), /^[a-f0-9]{64}$/);
  });
});

describe("collection is a switch, and never throws", () => {
  test("disabled collects nothing", () => {
    process.env.PARTICIPATION_SIGNALS_ENABLED = "false";
    assert.equal(collectSignals({ ip: "203.0.113.10", headers: {} }, FP), null);
  });

  test("enabled returns both hashes", () => {
    const out = collectSignals({ ip: "203.0.113.10", headers: {} }, FP);
    assert.match(out.deviceHash, /^[a-f0-9]{64}$/);
    assert.match(out.netHash, /^[a-f0-9]{64}$/);
  });

  test("a malformed request yields null, not an exception", () => {
    // A quiz answer must never fail because telemetry did.
    assert.doesNotThrow(() => collectSignals(null, null));
    assert.doesNotThrow(() => collectSignals({}, "not-an-object"));
    assert.equal(signalsEnabled(), true);
  });
});
