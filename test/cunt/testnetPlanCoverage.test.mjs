// The testnet plan divides §40's mechanics into two lists: what is already
// proven off-chain, and what only devnet can reach. That division is the
// document's whole value — it decides where scarce devnet effort goes.
//
// It is also a claim that rots silently. If someone deletes a test, the plan
// keeps saying "already proven" and devnet time gets spent on the wrong things
// (or worse, not spent at all). So the claims are checked against the tests
// that are supposed to back them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

const plan = read("docs/cunt/CUNT-TESTNET-PLAN.md");
const model = read("src/cunt/epoch.js");

// Match against TEST NAMES, not raw file contents. The first version searched
// the whole file, so renaming a test still passed — the phrase survived in the
// header comment describing what the file covers. A guard that a comment can
// satisfy is not a guard.
const testNames = (path) =>
  [...read(path).matchAll(/^\s*test\(\s*["'`]([^"'`]+)/gm)].map((m) => m[1]);

const protocolTests = testNames("test/cunt/weeklyProtocol.test.mjs").join("\n");
const simulatorTests = testNames("test/cunt/simulators.test.mjs").join("\n");

test("every mechanic the plan calls 'already tested' really is", () => {
  // Each entry: the plan's claim, and a phrase that must appear in a test name.
  const claims = [
    ["Tuesday claim", /claim/i, protocolTests],
    ["double claim", /cannot claim twice|ALREADY_CLAIMED|replay/i, protocolTests],
    ["claim after closing", /late claims|AFTER_WINDOW/i, protocolTests],
    ["claim before opening", /early claims|BEFORE_WINDOW/i, protocolTests],
    ["exhausted vault", /budget|VAULT_INSUFFICIENT/i, protocolTests],
    ["finalize", /finaliz/i, protocolTests],
    ["overflow/underflow", /overflow|underflow/i, protocolTests],
    ["clock boundaries", /boundaries|clock/i, protocolTests],
    ["duplicate registration", /duplicate registration/i, protocolTests],
    ["sybil gate", /SYBIL|registered/i, protocolTests],
    ["release triggers", /trigger/i, simulatorTests],
  ];
  const missing = claims.filter(([, re, src]) => !re.test(src)).map(([name]) => name);
  assert.deepEqual(
    missing,
    [],
    `The testnet plan claims these are already tested off-chain, but no matching test exists: ${missing.join(", ")}. ` +
      `Either restore the test or move the row into the "only provable on-chain" table.`
  );
});

test("the plan does not claim to have tested what cannot be tested off-chain", () => {
  // The second table exists because a JavaScript model has no mints, no
  // signatures and no accounts. If the model ever grows a fake version of one,
  // it would produce false confidence — the worst outcome for a security doc.
  for (const impossible of ["is_signer", "TOKEN_PROGRAM_ID", "getAccountInfo", "Connection"]) {
    assert.ok(
      !model.includes(impossible),
      `src/cunt/epoch.js references ${impossible} — the reference model must stay pure and off-chain. ` +
        `Simulating on-chain checks produces confidence the model cannot justify.`
    );
  }
});

test("the plan's exit criteria demand demonstrated failures, not happy paths", () => {
  // A devnet campaign that only exercises the good path proves very little.
  // Each of these is the load-bearing form of a criterion.
  for (const [what, re] of [
    ["failed mint attempt", /failed mint attempt/i],
    ["failed freeze attempt", /failed freeze attempt/i],
    ["failed M−1 multisig attempt", /failed M[−-]1 attempt/i],
    ["attacks executed, not reasoned about", /executed and rejected/i],
  ]) {
    assert.match(plan, re, `exit criteria must require a ${what}`);
  }
});

test("the plan records that devnet is not mainnet", () => {
  // Measured 2026-08-08: devnet 4.2.0-rc.0, mainnet 4.1.0. Devnet runs a
  // release candidate AHEAD of mainnet, so it can accept what mainnet rejects.
  // A plan that omits this invites "it worked on devnet" as an argument.
  assert.match(plan, /4\.2\.0-rc\.0/, "must record the devnet version actually observed");
  assert.match(plan, /4\.1\.0/, "must record the mainnet version for comparison");
  assert.match(
    plan,
    /proves a program is \*\*wrong\*\*.*cannot prove it is \*\*right\*\*/is,
    "must state what a passing devnet run does and does not establish"
  );
});

test("no mainnet deployment is planned in this sprint", () => {
  // §40 is explicit. If this document ever describes a mainnet step, the sprint
  // has exceeded its authorisation.
  assert.match(plan, /No mainnet deployment during this sprint/i);
  assert.ok(
    !/deploy to mainnet|mainnet deploy(ment)? (steps|sequence)/i.test(plan),
    "the testnet plan must not contain a mainnet deployment procedure — that is CUNT-MAINNET-GATE.md, gated on approval"
  );
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

test("subject src/cunt/epoch.js is present and substantial", () => {
  const src = readFileSync(resolve(repoRoot, "src/cunt/epoch.js"), "utf8");
  assert.ok(src.length > 500, "src/cunt/epoch.js is empty or near-empty — every \"must not contain\" assertion about it would pass vacuously.");
  assert.ok(src.includes('export'), "src/cunt/epoch.js no longer contains 'export' — the subject changed shape, so the absence checks below prove nothing.");
});
