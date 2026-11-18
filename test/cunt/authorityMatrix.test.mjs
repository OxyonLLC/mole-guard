// $CUNT authority matrix (spec §49) — "this will expose hidden trust
// assumptions."
//
// A matrix like this is worth exactly as much as its accuracy. The failure mode
// is not that someone writes a wrong row on purpose; it is that a row quietly
// stops matching what was decided, and the document keeps asserting a safety
// property nobody still has. So the properties that make the design safe are
// asserted here rather than trusted to prose.
//
// The rows that must never soften are the §37 ones: there must be no
// instruction that empties the Tuesday vault and none that edits claim history.
// §16 is explicit that no human key may drain the vault — which means the
// correct design is not "multisig-gated" but ABSENT.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8"));
const doc = readFileSync(resolve(repoRoot, "docs/cunt/CUNT-AUTHORITY-MATRIX.md"), "utf8");

const MATRIX = manifest.authority_matrix;
const VOCAB = Object.keys(manifest.$authority_vocabulary.holders);
const row = (id) => MATRIX.find((r) => r.id === id);

test("the matrix parsed sanely", () => {
  // Guard the guard — an empty parse would make every assertion below vacuous.
  assert.ok(Array.isArray(MATRIX) && MATRIX.length >= 15, `only ${MATRIX?.length} rows parsed`);
  assert.ok(VOCAB.length >= 5, "authority vocabulary missing");
});

test("every row uses the fixed vocabulary and real booleans", () => {
  // Free text in these fields drifts into meaninglessness — "the team", "us",
  // "TBD" — and then the matrix stops being checkable.
  const bad = [];
  for (const r of MATRIX) {
    for (const f of ["current", "future"]) {
      if (!VOCAB.includes(r[f])) bad.push(`${r.id}.${f} = "${r[f]}" is not in the vocabulary`);
    }
    for (const f of ["can_be_revoked", "should_be_revoked", "multisig", "program_controlled", "publicly_verifiable"]) {
      if (typeof r[f] !== "boolean") bad.push(`${r.id}.${f} is not a boolean`);
    }
    if (!r.action || !r.notes) bad.push(`${r.id} is missing action or notes`);
  }
  assert.deepEqual(bad, [], bad.join("\n  "));
});

test("row ids are unique", () => {
  const ids = MATRIX.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate row id — one silently shadows the other");
});

// ── §37 / §16: the capabilities that must simply not exist ──────────────────
test("§16/§37 — nobody can withdraw from the Tuesday vault", () => {
  const r = row("withdraw_tuesday_vault");
  assert.ok(r, "the vault-withdrawal row is missing — it must be present and say NOBODY");
  assert.equal(
    r.future,
    "NOBODY",
    `Vault withdrawal is assigned to "${r.future}". §16: "Humans should not possess a private key ` +
      `capable of arbitrarily emptying the Tuesday reward vault." MULTISIG is not good enough — ` +
      `the instruction must not exist.`
  );
});

test("§37 — nobody can edit claim history", () => {
  const r = row("override_claim_history");
  assert.ok(r, "the claim-history row is missing");
  assert.equal(
    r.future,
    "NOBODY",
    "Proof of Tuesday is worthless if claim history is editable. §37 names override_claim_history() " +
      "as a function that must not exist."
  );
});

test("funding the vault is allowed, and is the only vault direction that is", () => {
  // Asymmetry is deliberate: adding can only ever increase what participants
  // can claim. If this ever becomes NOBODY the vault can never be topped up;
  // if withdrawal ever becomes anything but NOBODY the protection is gone.
  assert.notEqual(row("fund_tuesday_vault").future, "NOBODY", "the vault must remain fundable");
  assert.equal(row("withdraw_tuesday_vault").future, "NOBODY");
});

// ── §20 / §21: token authorities ────────────────────────────────────────────
test("§20/§21 — mint and freeze authorities end up held by nobody", () => {
  for (const id of ["mint_new_tokens", "freeze_token_account"]) {
    const r = row(id);
    assert.equal(r.future, "NOBODY", `${id} must end at NOBODY`);
    assert.equal(r.can_be_revoked, true, `${id} must be revocable`);
    assert.equal(r.should_be_revoked, true, `${id} must be marked as should-be-revoked`);
  }
});

test("the manifest's authorities block agrees with the matrix", () => {
  // Two places state the same fact, so they are pinned to each other. §48 names
  // "authorities" as a manifest field and §49 wants the full table; the risk is
  // one being updated and not the other.
  assert.equal(manifest.authorities.mint_authority.policy, "REVOKE_AFTER_GENESIS");
  assert.equal(manifest.authorities.freeze_authority.policy, "NEVER_SET");
  for (const key of ["mint_authority", "freeze_authority", "program_upgrade_authority"]) {
    assert.equal(
      manifest.authorities[key].revoked,
      false,
      `${key}.revoked is true, but nothing may be revoked during this sprint (§20/§21/§50).`
    );
  }
});

test("nothing is deployed, so no authority may claim a live holder", () => {
  if (manifest.status.deployment_status !== "NOT_DEPLOYED") return;
  for (const key of Object.keys(manifest.authorities)) {
    assert.equal(
      manifest.authorities[key].holder,
      null,
      `${key} names a holder while deployment_status is NOT_DEPLOYED.`
    );
  }
});

// ── §18: custody ────────────────────────────────────────────────────────────
test("§18 — the community treasury does not stay on a single key", () => {
  const r = row("move_community_treasury");
  assert.equal(r.current, "OWNER_SINGLE_KEY", "current state should be recorded honestly, not aspirationally");
  assert.notEqual(
    r.future,
    "OWNER_SINGLE_KEY",
    "§18 requires migration to multisig or program-enforced custody before the treasury holds value."
  );
  assert.equal(r.multisig, true);
});

// ── §50: the row that dominates every other row ─────────────────────────────
test("§50 — upgrade authority is recorded as dominating, not as one row among many", () => {
  const r = row("upgrade_program");
  assert.ok(r, "upgrade_program row missing");
  assert.equal(r.should_be_revoked, true, "the §50 lifecycle ends in restricted/immutable");
  assert.match(
    r.notes,
    /STRICTLY MORE POWERFUL/,
    "the upgrade row must state that it outranks every program_controlled guarantee"
  );
  // And the document must not quietly present PDA rows as absolute.
  assert.match(
    doc,
    /guarantee about (the bytecode deployed right now|\*the bytecode)/i,
    "The doc must say that program_controlled guarantees are guarantees about the CURRENT bytecode. " +
      "Without upgrade authority spelled out, every safety claim here is overstated."
  );
});

// ── §29: the bot must never be authoritative ────────────────────────────────
test("§29 — the bot is not publicly verifiable and therefore not authoritative", () => {
  const r = row("operate_bot");
  assert.equal(r.publicly_verifiable, false, "a bot's behaviour is not on-chain-verifiable; say so");
  assert.equal(r.program_controlled, false);
  assert.match(r.notes, /no treasury key|hold no treasury key/i, "§29: the bot must hold no treasury key");
});

// ── §27: one source of truth ────────────────────────────────────────────────
test("the doc covers exactly the rows in the matrix", () => {
  // Prose-to-prose matching was tried first and was the wrong tool: it compared
  // shortened table labels against manifest wording and failed on phrasing
  // rather than substance, and "Mint new $CUNT" has no content words long
  // enough to match on at all.
  //
  // So coverage is explicit instead. The doc carries an HTML comment listing
  // the row ids it explains (invisible when rendered), and it must equal the
  // manifest exactly — in both directions. A capability added to the manifest
  // without being documented fails here, and so does a stale id left behind
  // after a row is removed.
  const marker = doc.match(/authority-matrix-rows:([\s\S]*?)\n\n/);
  assert.ok(marker, "CUNT-AUTHORITY-MATRIX.md is missing its authority-matrix-rows coverage marker");

  const documented = new Set(marker[1].split(",").map((s) => s.trim()).filter(Boolean));
  const actual = new Set(MATRIX.map((r) => r.id));

  const undocumented = [...actual].filter((id) => !documented.has(id));
  const stale = [...documented].filter((id) => !actual.has(id));

  assert.deepEqual(
    undocumented,
    [],
    `These capabilities exist in cunt-project.json but are not documented: ${undocumented.join(", ")}. ` +
      `A capability nobody documented is a capability nobody reviewed.`
  );
  assert.deepEqual(stale, [], `The doc claims to cover rows that no longer exist: ${stale.join(", ")}`);
});

test("the doc's headline counts match the matrix", () => {
  // §4 of the doc states how many actions sit in each state today. Those are
  // exactly the numbers a reader will quote, so they must be derived-true.
  const counts = {};
  for (const r of MATRIX) counts[r.current] = (counts[r.current] || 0) + 1;
  for (const [state, n] of Object.entries(counts)) {
    assert.ok(
      new RegExp(`\`${state}\`[^|]*\\|\\s*${n}\\s*\\|`).test(doc) || doc.includes(`| \`${state}\` | ${n} |`),
      `The doc's "where the trust sits" table does not say ${state} = ${n}.`
    );
  }
});

test("the four must-be-impossible actions are listed in the doc", () => {
  const nobody = MATRIX.filter((r) => r.future === "NOBODY");
  assert.ok(nobody.length >= 4, `only ${nobody.length} actions are targeted at NOBODY`);
  for (const r of nobody) {
    assert.ok(doc.includes(r.id), `"${r.action}" (${r.id}) must be covered by the doc`);
  }
  // And the doc must actually frame them as impossible for us too, not merely
  // list them — "including us" is the whole claim.
  assert.match(doc, /impossible \*\*for everyone, including us\*\*|impossible for everyone/i);
});
