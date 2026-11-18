// Multisig design (§18). The design is sound; the ways it gets quietly ruined
// are all small edits, so those are what get asserted.
//
// The specific risk here is a claim, not a bug. A 2-of-3 where one person holds
// every key protects against key loss and device compromise — genuinely useful
// — but NOT against that person. Publishing it as "distributed control" would
// be the manufactured decentralisation §43 forbids, and it is an easy sentence
// to write by accident.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInitializeMultisigInstruction, decodeInitializeMultisigInstruction, MULTISIG_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { lossMatrix, suspectedSharedSite } from "../../src/cunt/multisigVerify.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8"));
// Strip blockquote markers BEFORE collapsing whitespace: a hard-wrapped `>`
// quote otherwise leaves a stray "> " in the middle of a sentence, and the
// match fails on formatting rather than content.
const prose = (t) => t.replace(/^[ \t]*>[ \t]?/gm, "").replace(/[*`_]/g, "").replace(/\s+/g, " ");
const doc = prose(readFileSync(resolve(repoRoot, "docs/cunt/CUNT-MULTISIG-DESIGN.md"), "utf8"));
const ms = manifest.multisig;

test("a 2-of-3 SPL multisig is expressible, and the threshold encodes correctly", () => {
  // Offline proof — no funds, no network. If SPL Token ever changes this, the
  // design's foundation moves and we should find out from a test.
  const account = Keypair.generate().publicKey;
  const signers = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
  const ix = createInitializeMultisigInstruction(account, signers, 2);
  assert.ok(ix.programId.equals(TOKEN_PROGRAM_ID), "must be native SPL Token, not an external program");
  const decoded = decodeInitializeMultisigInstruction({ ...ix, programId: TOKEN_PROGRAM_ID });
  assert.equal(decoded.data.m, 2, "threshold must encode as 2");
  assert.equal(decoded.keys.signers.length, 3);
  assert.equal(MULTISIG_SIZE, ms.token_authorities.account_bytes, "manifest records the real account size");
});

test("2-of-2 is never the recommendation", () => {
  // A 2-of-2 has no recovery: lose either key and the treasury is frozen
  // forever. That is a worse failure than the one being defended against.
  assert.equal(ms.threshold, "2-of-3");
  assert.match(doc, /2-of-2 has no recovery/i, "the doc must say why 2-of-2 is rejected");
});

test("no signer key may live on the serving machine or reuse a system wallet", () => {
  // The original proposal was "we could use the system wallets". Those keys sit
  // on the machine running the bots, so reusing one gives an attacker who
  // compromises it two signatures — a 2-of-3 becomes a 1-of-1.
  assert.ok(ms.$hard_rule, "the hard rule must be recorded in the manifest");
  assert.match(ms.$hard_rule, /serving machine/i);
  assert.match(ms.$hard_rule, /system\/automation wallet|system wallet/i);
  assert.match(doc, /must not live on the serving machine/i);
  for (const s of ms.signers) {
    assert.ok(s.storage, `signer ${s.id} must record where its key lives`);
    assert.ok(
      !/serving machine|same machine/i.test(s.storage),
      `signer ${s.id} is stored on the serving machine`
    );
  }
});

test("the key-security vs governance distinction is recorded, not blurred", () => {
  // The whole point. If this disappears, the project can accidentally claim
  // distributed control it does not have.
  assert.ok(ms.$disclosure_requirement, "the disclosure requirement must be in the manifest");
  assert.match(ms.$disclosure_requirement, /not against the owner/i);
  assert.match(doc, /N keys, one human, one decision/i, "the doc must state the limitation plainly");
  assert.match(doc, /key-security multisig/i);
});

test("enforcement claims are backed by a recorded proof", () => {
  // This originally asserted enforcement_proven === false, and it FAILED the
  // moment the proof was actually run — which is the test working, not
  // breaking. What matters is not the value but that the value and its
  // evidence agree, and that proving the MECHANISM is never mistaken for
  // having configured our own multisig.
  if (ms.enforcement_proven) {
    assert.match(
      ms.$enforcement_note,
      /MissingRequiredSignature/,
      "a proof must record WHY the M-1 attempt was rejected — a generic failure proves nothing"
    );
    assert.match(ms.$enforcement_note, /WHAT IS NOT PROVEN/i, "it must state the limits of the proof");
    assert.ok(ms.$proof_environment, "record where it was proven — local validator and devnet are not the same claim");
  } else {
    assert.match(ms.$enforcement_note, /faucet|429|403|not yet/i, "record WHY it is unproven, not just that it is");
  }

  // Either way, the gate item cannot be done while our own multisig does not
  // exist on any network. Proving SPL Token enforces is not the same as having
  // three real keys on three devices.
  const gate = manifest.mainnet_gate.items.find((i) => i.id === "multisig_tested");
  assert.notEqual(gate.status, "done", "no multisig has been created with real keys");
  if (ms.enforcement_proven) {
    assert.equal(gate.status, "partial", "mechanism proven but not configured — that is 'partial'");
  }
});

test("the key count stays derived from the authority matrix, not from intuition", () => {
  // The instinct is one wallet per role, which would be 18. PDAs and revocation
  // delete most of the list; if this number ever drifts upward, something has
  // been added that should have been a PDA or revoked.
  const inv = ms.key_inventory;
  assert.equal(inv.secrets_held_forever, 4);
  assert.equal(inv.secrets.length, 4);
  assert.equal(inv.discarded_after_initialization.length, 3);

  const rows = manifest.authority_matrix.rows || manifest.authority_matrix;
  const futures = rows.map((r) => r.future);
  assert.equal(futures.filter((f) => f === "NOBODY").length, 4);
  assert.equal(futures.filter((f) => f === "PROGRAM_PDA").length, 4);
  // Every MULTISIG row is served by the SAME 2-of-3 — that is why 7 rows cost 3 keys.
  assert.ok(futures.filter((f) => f === "MULTISIG").length >= 7);
  assert.match(inv.$same_signers_both_multisigs, /3 phrases, not 6/i);
});

test("the one-seed shortcut is written down as forbidden", () => {
  // Deriving 3 signers from 1 phrase at different paths produces addresses that
  // look unrelated on-chain. That is what makes it feel safe, and it is a 1-of-1.
  assert.match(ms.key_inventory.$one_seed_warning, /NEVER derive/i);
  assert.match(ms.key_inventory.$one_seed_warning, /single seed phrase/i);
  assert.match(ms.key_inventory.$generation_rule, /generated ON the device/i);
  assert.match(ms.key_inventory.$winlew_keys_excluded, /No WinLEW key/i);
});

test("the vanity suffix is recorded as a mnemonic, never as authentication", () => {
  // 58^4 = 11,316,496 keys ≈ 45 seconds. Publishing "ends in CUNT = official"
  // would build a phishing kit and price it at under a minute.
  const n = manifest.naming;
  assert.match(n.$vanity_is_not_authentication, /44\.7 seconds|45 seconds/);
  assert.match(n.$vanity_is_not_authentication, /phishing kit/i);
  assert.match(n.$vanity_is_not_authentication, /mnemonic/i);
  // A domain is weaker than an address, not stronger — it can be re-pointed.
  assert.match(n.$mutability_caveat, /re-pointed|repointed/i);
  assert.match(n.$rule, /Domains are LABELS, not wallets/i);
  assert.match(n.$multisig_is_not_a_wallet, /NO private key/i);
});

test("the burn needs no address and no key", () => {
  assert.equal(manifest.burn.burn_address_required, false);
  assert.equal(manifest.burn.keys_required, 0);
  assert.match(manifest.burn.mechanism, /spl_token::burn/);
  assert.match(manifest.burn.$why_no_burn_wallet, /still part of total supply/i);
  // Recording a mechanism must never read as a scheduled commitment (§52).
  assert.match(manifest.burn.$not_yet_scheduled, /No burn amount, schedule or commitment exists/i);
});

test("the community vanity address is custodied so its key stops mattering", () => {
  const c = manifest.vanity_targets.community;
  assert.equal(c.custody, "MULTISIG_OWNED_TOKEN_ACCOUNT");
  assert.notEqual(c.custody, "SINGLE_KEY", "single-key custody of a ground vanity key was the MEDIUM finding");
  assert.equal(c.role_finalized, true);
  // The finding is closed by evidence, not by assertion.
  assert.match(c.$custody_resolution, /owner does not match/, "record WHY the vanity key cannot spend");
  assert.match(c.$custody_resolution, /MissingRequiredSignature/);
  // And the tradeoffs must survive alongside the decision.
  assert.ok(c.$caveats.some((x) => /MINT-SPECIFIC/i.test(x)), "a token account holds one mint only");
  assert.ok(c.$caveats.some((x) => /NOT an ATA/i.test(x)));
});

test("the ceremony runbook forbids generating the keys anywhere but the devices", () => {
  const ceremony = prose(readFileSync(resolve(repoRoot, "docs/cunt/CUNT-KEY-CEREMONY.md"), "utf8"));
  assert.match(ceremony, /Never all on one machine, even temporarily/i);
  assert.match(ceremony, /nobody generates these for you/i);
  assert.match(ceremony, /blast radius, not a room/i);
  // The asymmetry that makes the matrix worth running at all.
  assert.match(ceremony, /Every backup you add makes loss less likely and theft more likely/i);
  assert.match(ceremony, /A backup that has never been restored is a hope/i);
  // And it must not read as permission to go to mainnet.
  assert.match(ceremony, /remain behind the §61 approval gate/i);
});

test("the declared placement plan has no single point of failure", () => {
  // The plan is now enforced, not just written down. Move a signer into a
  // location that already holds one and this fails — which is the point: the
  // first arrangement the owner proposed measured 3 keys at one location and
  // two single points of failure, and looked completely reasonable.
  const m = Number(String(ms.threshold).split("-")[0]);
  const { measurements } = lossMatrix(ms.signers, m);
  assert.deepEqual(measurements.single_points_of_failure, []);
  assert.ok(
    measurements.max_keys_at_one_location < m,
    `${measurements.max_keys_at_one_location} keys share a location with a threshold of ${m} — one burglary reaches it`
  );
  assert.equal(measurements.distinct_locations, 3, "three keys need three blast radii");
  assert.equal(measurements.redundancy, 1);

  // Locations must not be two names for one building.
  assert.deepEqual(suspectedSharedSite(ms.signers.flatMap((s) => [s.location, s.backup_location])), []);
});

test("a sound plan is never recorded as a built configuration", () => {
  // The matrix reads placement only, so a plan and a finished ceremony measure
  // identically. Nothing may imply the keys exist while they do not.
  const anyAddress = ms.signers.some((s) => s.address);
  if (!anyAddress) {
    assert.equal(ms.placement_status, "DECLARED_PLAN");
    assert.ok(ms.signers.every((s) => s.possession_proven === false));
    assert.ok(ms.signers.every((s) => !s.plate_restored), "an untested recovery must keep `plan` failing");
    assert.match(ms.$placement_status_note, /No key has been generated/i);
  } else {
    // Keys existing is NOT the multisig existing. This is the sentence the
    // whole sprint is arranged to stop anyone writing by accident.
    assert.equal(ms.placement_status, "REALISED");
    assert.match(ms.$placement_status_note, /MULTISIG ITSELF STILL DOES NOT EXIST/i);
  }
  // Either way, and this never relaxes until the §61 gate is passed.
  assert.equal(ms.status, "DESIGNED_NOT_CREATED");
  assert.equal(manifest.status.mainnet_approved, false);
});

test("the excluded machines and the cloud-account trap stay recorded", () => {
  // Each of these was a real candidate. The reasons are the value, not the list.
  assert.match(ms.$placement_rationale, /serving PC|serving machine/i);
  assert.match(ms.$placement_rationale, /gaming PC/i);
  assert.match(ms.$placement_rationale, /chmod is a no-op/i);
  assert.match(
    ms.$placement_rationale,
    /never exports it/i,
    "why a Ledger beats the phone plan must be stated, not assumed"
  );

  // The finding a device count cannot show, kept because it is why the phone
  // plan was rejected: independent hardware behind one password is one key.
  assert.match(ms.$cloud_backup_warning, /ONE key, not several/i);
  assert.match(ms.$cloud_backup_warning, /EITHER copy while loss needs BOTH/i);

  // Vendor concentration cannot be engineered away at m=2, n=3 — any vendor
  // holding 2 devices has the threshold, so avoiding it entirely would need 3
  // vendors. What CAN be guaranteed is that a remote software compromise never
  // reaches all three: at least one key must have no live device at all.
  // phrase_only is an EXPLICIT field, not inferred from an empty wallet_app.
  // C has a wallet_app (Phantom) because something had to generate the seed —
  // it is wiped afterwards and the key exists only as steel. "Generated by" and
  // "lives on" are different facts; inferring one from the other broke the
  // moment the generator changed.
  const coldOnly = ms.signers.filter((s) => s.phrase_only === true && s.online === false);
  assert.ok(
    coldOnly.length >= 1,
    "at least one signer must be phrase-only — no live device, no firmware, no update channel"
  );
  assert.match(ms.$phrase_only_rule, /cannot be inferred from an empty wallet_app/i);
  for (const s of ms.signers) {
    assert.equal(typeof s.phrase_only, "boolean", `signer ${s.id} must declare phrase_only explicitly`);
  }
  assert.ok(ms.signers.every((s) => s.online === false), "no signer's seed may touch a networked system");
  assert.match(ms.$vendor_concentration, /ACCEPTED RISK/i, "the trade must be named, not hidden");
  assert.match(ms.$vendor_concentration, /PHRASE ONLY/i);
  // A Ledger-generated seed is BIP39, so the phrase outlives the vendor.
  assert.match(ms.$software_diversity, /vendor-neutral/i);
  // Hardware upgrades the key that signs, not the one that sits in a drawer.
  assert.match(ms.$hardware_wallet_placement, /replaces A or B — NOT C/i);

  // Phrases are keys too.
  assert.match(ms.$phrase_placement, /not pooled at home/i);
  // C's generator changed (Ledger 3 has funds and must not be wiped), so assert
  // the invariant rather than the tool: whatever generated it, the device does
  // not keep the key and the steel is verified by reading FROM the steel.
  assert.match(ms.$signer_c_generation, /GENERATOR, not the key/i);
  assert.match(ms.$signer_c_generation, /wiped afterwards/i);
  assert.match(ms.$signer_c_verification, /READING FROM IT, not from the phone/i);
  assert.match(ms.$signer_c_verification, /prompt:\/\//);
  // The path trap that bit signer A must be carried into C's instructions.
  assert.match(ms.$signer_c_verification, /m\/44'\/501'\/0'\/0'/);
});

test("the chain knows three public keys and a number — nothing else", () => {
  // Answers "how would the system know these are the sigs": InitializeMultisig
  // writes the signer PUBKEYS into the account itself. Every placement decision
  // in this manifest is off-chain policy the chain cannot enforce, and saying
  // so plainly is the difference between a security model and a vibe.
  assert.match(ms.$how_the_chain_knows, /355-byte/);
  assert.match(ms.$how_the_chain_knows, /11 signer slots/i);
  assert.match(ms.$how_the_chain_knows, /MissingRequiredSignature/);
  assert.match(ms.$how_the_chain_knows, /off-chain policy the chain cannot enforce/i);
});

test("the signer set is immutable, which makes possession a precondition", () => {
  // PROVEN: re-initializing to swap a key fails with 'account or token already
  // in use' (0x6). So a key that cannot sign is a PERMANENT dead slot, and a
  // 2-of-3 with a dead slot is a 2-of-2 with no recovery.
  assert.match(ms.$signer_set_is_immutable, /PROVEN/);
  assert.match(ms.$signer_set_is_immutable, /already in use/i);
  assert.match(ms.$signer_set_is_immutable, /0x6/);
  assert.match(ms.$signer_set_is_immutable, /creating a NEW multisig/i);
  // The ceremony must therefore prove possession for EVERY signer before the
  // multisig is created. This originally asserted nothing was proven yet, which
  // started failing the moment the ceremony made progress — the invariant is
  // not "nothing is proven", it is "creation waits until all three are".
  const proven = ms.signers.filter((s) => s.possession_proven);
  if (ms.status !== "DESIGNED_NOT_CREATED") {
    assert.equal(proven.length, ms.signers.length, "a multisig may not exist until every signer has proven possession");
  }
  for (const s of proven) {
    assert.ok(s.address, `signer ${s.id} claims proven possession without an address`);
    assert.ok(s.derivation_path, `signer ${s.id} claims proven possession without a derivation path`);
    assert.match(s.possession_proof, /PROVEN/, `signer ${s.id} must record HOW it was proven`);
  }
});

test("an address is never recorded without its derivation path", () => {
  // Found on the first real signer: one Ledger showed C9FQV…k171x in Ledger
  // Live and C5se…G4P2 in Phantom. Both real, same seed, different path. An
  // address alone is therefore ambiguous, and "signer A" meaning two different
  // addresses depending on which app was open is how a dead slot gets created
  // in a set that can never be changed.
  assert.match(ms.$derivation_path_rule, /m\/44'\/501'\/0'/);
  assert.match(ms.$derivation_path_rule, /usb:\/\/ledger\?key=0\/0/);
  assert.match(ms.$derivation_path_rule, /neither app is wrong/i);
  assert.match(ms.$path_choice_guidance, /device itself displays/i);

  for (const s of ms.signers) {
    assert.ok("derivation_path" in s, `signer ${s.id} must carry a derivation_path field`);
    if (s.address) {
      assert.ok(s.derivation_path, `signer ${s.id} has an address but no derivation path — that pair is ambiguous`);
    }
  }
});

test("no two signers may live on the same physical device", () => {
  // The failure this catches is invisible from the addresses. Clicking "Add
  // account" in Ledger Live gives you the next account index on the SAME seed,
  // producing two unrelated-looking pubkeys that one recovery phrase unlocks.
  // At a threshold of 2 that is the whole treasury behind one phrase — and no
  // amount of checking public keys can detect it. The device identifier can.
  assert.match(ms.$device_id_rule, /ONE SEED/);
  assert.match(ms.$device_id_rule, /invisible from the addresses/i);

  const ids = ms.signers.map((s) => s.device_id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "two signers report the same device_id — that is one seed, not two keys");

  // A hardware signer that has proven possession must have been identified.
  for (const s of ms.signers) {
    if (s.possession_proven && /ledger/i.test(s.device || "")) {
      assert.ok(s.device_id, `signer ${s.id} proved possession but its physical device was never identified`);
    }
  }
});

test("the three locations are resolved and each is a real blast radius", () => {
  const locations = ms.signers.map((s) => s.location);
  assert.deepEqual([...new Set(locations)].sort(), ["bank-deposit-box", "daughters-house", "home"]);
  assert.match(ms.$offsite_locations_unconfirmed, /RESOLVED/);
  // The rejected attempt must stay recorded — it is the reason the bank box exists.
  assert.match(ms.$offsite_locations_unconfirmed, /two locations cannot hold three keys/i);
  // And the safe must not be mistaken for fire protection.
  assert.match(ms.$offsite_locations_unconfirmed, /burglary resistance, not fire protection/i);
});

test("recovery is tracked per plate, because one date overstates it", () => {
  // `last_recovery_test` as a single project-wide date printed "recovery tested
  // 0 days ago" in green while TWO of three plates had never been restored.
  // The untested ones are the easiest to skip precisely because their devices
  // still work — which is the failure §59 describes.
  assert.match(ms.$plate_restored_rule, /OVERSTATES/i);
  for (const s of ms.signers) {
    assert.ok("plate_restored" in s, `signer ${s.id} must track its own plate`);
  }
  const restored = ms.signers.filter((s) => s.plate_restored);
  assert.ok(restored.length >= 1, "at least C's plate was restored during the ceremony");

  // A plate restored means that key's phrase derived the expected address, so
  // it cannot be claimed for a signer with no address.
  for (const s of restored) {
    assert.ok(s.address, `signer ${s.id} claims a restored plate but has no address to have derived`);
  }

  // The ceremony being COMPLETE must never imply recovery is complete.
  if (ms.ceremony_status === "COMPLETE") {
    assert.match(ms.$ceremony_status_note, /What is NOT complete/i);
    assert.match(ms.$ceremony_status_note, /never been restored/i);
  }
});

test("no document claims the multisig makes an action accountable to anyone", () => {
  // The §43 risk is not one sentence in one file. "register_participant is
  // multisig-gated" reads to almost everyone as "two people must agree" — and
  // with independent_signers: 0 it is one person signing twice. The weekly
  // protocol is where that misreading is most tempting, because it would make
  // the sybil story sound stronger than it is.
  const weekly = prose(readFileSync(resolve(repoRoot, "docs/cunt/CUNT-WEEKLY-PROTOCOL.md"), "utf8"));
  assert.equal(ms.independent_signers, 0, "if this ever changes, the text below must be rewritten deliberately");
  assert.match(weekly, /means less than it sounds/i, "the registration authority's limit must be stated");
  assert.match(weekly, /one decision, made twice/i);
  assert.match(weekly, /hard to steal — not that admissions are reviewed/i);

  // And the contrast that makes it non-obvious: funding the vault IS safe
  // regardless of who holds the keys, because that instruction only moves
  // tokens in. Same multisig, very different value.
  assert.match(weekly, /regardless of who holds the keys/i);
});

test("token authorities and general-purpose needs are kept separate", () => {
  // SPL native multisig only authorises SPL Token instructions. It cannot
  // approve a program upgrade or manage an LP position. Conflating the two
  // would leave the most powerful authority — upgrade — silently uncovered.
  assert.equal(ms.general_purpose.verified, false, "no general-purpose multisig has been reviewed");
  assert.ok(
    ms.general_purpose.covers.includes("program upgrade authority"),
    "upgrade authority must be assigned to the general-purpose multisig, not the SPL one"
  );
  assert.ok(
    !ms.token_authorities.covers.includes("program upgrade authority"),
    "SPL native multisig cannot authorise a program upgrade"
  );
});
