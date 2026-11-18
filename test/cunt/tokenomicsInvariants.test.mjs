// $CUNT accounting invariants (spec §42) plus the self-review checks of §63.
//
// cunt-project.json is the canonical manifest (§48). docs/cunt/CUNT-TOKENOMICS.md
// explains it. §27 requires ONE SOURCE OF TRUTH — so rather than trusting that
// the two stay in step, this file fails the build when they disagree.
//
// Why this exists before any token does: the failure these guard against is
// documentation drift, and drift is cheapest to prevent while there is only one
// document. WinLEW already learned this the expensive way — /transparency/ spent
// weeks under-reporting locked supply by 7M because a lock was added as a
// component and the paragraph below it was never updated.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8"));
const doc = readFileSync(resolve(repoRoot, "docs/cunt/CUNT-TOKENOMICS.md"), "utf8");
// Markdown hard-wraps prose and bolds phrases, so a literal match fails on
// formatting rather than content. This has now bitten several doc tests in this
// sprint: normalise emphasis and whitespace before matching ANY prose. Raw
// `doc` is kept for structural checks like table rows.
const prose = (t) => t.replace(/^[ \t]*>[ \t]?/gm, "").replace(/[*`_]/g, "").replace(/\s+/g, " ");

const { community, team, market_liquidity: market } = manifest.allocations;
const TOTAL = manifest.supply.total;

// Grouped form as the docs render it: 800000000 -> "800,000,000"
const grouped = (n) => n.toLocaleString("en-US");

test("the manifest parsed sanely", () => {
  // Guard the guard. If this shape check is wrong, every assertion below could
  // pass against undefined and the invariants would be enforcing nothing.
  assert.ok(Number.isFinite(TOTAL) && TOTAL > 0, "supply.total missing");
  for (const [name, bucket] of Object.entries(manifest.allocations)) {
    assert.ok(Number.isFinite(bucket.amount), `allocation ${name} has no numeric amount`);
    assert.ok(Number.isFinite(bucket.percent), `allocation ${name} has no numeric percent`);
  }
  assert.equal(manifest.community_releases.length, 4, "expected 4 community release stages");
});

// ── §42 INVARIANT 1 ─────────────────────────────────────────────────────────
test("INVARIANT 1 — community + team + market = total supply", () => {
  const sum = community.amount + team.amount + market.amount;
  assert.equal(
    sum,
    TOTAL,
    `Allocations sum to ${grouped(sum)}, not ${grouped(TOTAL)}. ` +
      `No code path may allocate 1,000,000,001.`
  );
  assert.equal(community.percent + team.percent + market.percent, 100);
});

// ── §42 INVARIANT 2 ─────────────────────────────────────────────────────────
test("INVARIANT 2 — team can never exceed 100M", () => {
  assert.ok(team.amount <= 100_000_000, `team allocation is ${grouped(team.amount)}`);
  const tranches = manifest.team_vesting.tranches.reduce((a, t) => a + t.amount, 0);
  assert.equal(
    tranches,
    manifest.team_vesting.total,
    `team tranches sum to ${grouped(tranches)} but team_vesting.total is ${grouped(manifest.team_vesting.total)}`
  );
  assert.equal(
    manifest.team_vesting.total,
    team.amount,
    "team vesting total must equal the team allocation — a second team pot is exactly what §6 forbids"
  );
});

// ── §42 INVARIANT 3 ─────────────────────────────────────────────────────────
test("INVARIANT 3 — community releases never exceed 800M, and sum to it exactly", () => {
  const stages = manifest.community_releases;
  const sum = stages.reduce((a, s) => a + s.amount, 0);
  assert.ok(sum <= community.amount, `releases sum to ${grouped(sum)}, over the community bucket`);
  assert.equal(sum, community.amount, `releases sum to ${grouped(sum)}, not ${grouped(community.amount)}`);

  // Cumulative column must actually be cumulative — a stale number here would
  // publish a wrong "remaining reserve" on the transparency page later.
  let running = 0;
  for (const s of stages) {
    running += s.amount;
    assert.equal(s.cumulative, running, `stage ${s.stage} claims cumulative ${grouped(s.cumulative)}, should be ${grouped(running)}`);
  }
  assert.equal(running, community.amount, "final cumulative must retire the community bucket exactly");
});

// ── §42 INVARIANT 4 ─────────────────────────────────────────────────────────
test("INVARIANT 4 — market allocation never exceeds 100M", () => {
  assert.ok(market.amount <= 100_000_000, `market allocation is ${grouped(market.amount)}`);
});

// ── §63 self-review ─────────────────────────────────────────────────────────
test("§63 — community releases are not drawn from the market/liquidity bucket", () => {
  // "Did you accidentally describe 300M Community distribution as
  // Market/Liquidity? Fix it." The stages must retire the community bucket and
  // leave market untouched.
  const sum = manifest.community_releases.reduce((a, s) => a + s.amount, 0);
  assert.notEqual(sum, market.amount, "release schedule appears to be sized to the market bucket");
  assert.equal(
    community.amount + team.amount + market.amount - sum,
    team.amount + market.amount,
    "releasing the full community schedule must leave team and market exactly intact"
  );
});

test("§63 — no second team-controlled reserve was invented", () => {
  const known = new Set(["community", "team", "market_liquidity"]);
  const extra = Object.keys(manifest.allocations).filter((k) => !known.has(k));
  assert.deepEqual(extra, [], `unexpected allocation buckets: ${extra.join(", ")}`);
});

// ── §42 INVARIANT 7 (disclosure half) ───────────────────────────────────────
test("INVARIANT 7 — every reserved vanity address is disclosed as project-controlled", () => {
  const disclosed = new Set(manifest.project_controlled_addresses.map((a) => a.address));
  for (const [key, t] of Object.entries(manifest.vanity_targets)) {
    if (!t.address) continue; // still SEARCHING
    assert.ok(
      disclosed.has(t.address),
      `vanity target "${key}" holds ${t.address} but it is absent from project_controlled_addresses. ` +
        `Undisclosed project addresses are what §43 calls fake decentralization.`
    );
  }
});

test("the mint address stays null until a real mint exists", () => {
  // §2A: never publish a placeholder address. A non-null value here while
  // deployment_status is NOT_DEPLOYED would mean someone wrote a guess into the
  // one file everything else reads.
  if (manifest.status.deployment_status === "NOT_DEPLOYED") {
    assert.equal(manifest.vanity_targets.mint.address, null, "mint address must be null before deployment");
  }
});

test("no secret material in the manifest", () => {
  // The manifest is intended to be publishable. A keypair byte array or a
  // private key would be a §63 CRITICAL failure.
  const raw = readFileSync(resolve(repoRoot, "cunt-project.json"), "utf8");
  assert.ok(!/\[\s*(\d{1,3}\s*,\s*){31,}/.test(raw), "byte-array secret shape found in the manifest");
  assert.ok(!/[1-9A-HJ-NP-Za-km-z]{60,}/.test(raw), "long base58 string (private-key shaped) found in the manifest");
});

test("reserved vanity addresses actually match their advertised patterns", () => {
  // A pattern typo would put a wrong address on the transparency page under a
  // label claiming it is the Weekly/Community identity.
  for (const [key, t] of Object.entries(manifest.vanity_targets)) {
    if (!t.address) continue;
    const [prefix, suffix] = t.pattern.split("...");
    if (prefix) assert.ok(t.address.startsWith(prefix), `${key}: ${t.address} does not start with "${prefix}"`);
    if (suffix) assert.ok(t.address.endsWith(suffix), `${key}: ${t.address} does not end with "${suffix}"`);
  }
});

// ── §27 one source of truth ─────────────────────────────────────────────────
test("CUNT-TOKENOMICS.md agrees with the manifest", () => {
  // Every canonical figure must appear in the doc in grouped form, and the doc
  // must not state a total that contradicts the manifest.
  for (const [name, bucket] of Object.entries(manifest.allocations)) {
    assert.ok(
      doc.includes(grouped(bucket.amount)),
      `The doc never states the ${name} allocation (${grouped(bucket.amount)}).`
    );
  }
  assert.ok(doc.includes(grouped(TOTAL)), `The doc never states the total supply (${grouped(TOTAL)}).`);

  for (const s of manifest.community_releases) {
    assert.ok(
      doc.includes(grouped(s.cumulative)),
      `The doc never states the ${s.stage} cumulative (${grouped(s.cumulative)}).`
    );
  }

  assert.ok(
    doc.includes(`${community.percent}%`),
    `The doc does not state the community share as ${community.percent}%.`
  );

  // "90%" must not survive as a LIVE claim — but the change-history section is
  // required to say the old model made it 90%, and that is correct past tense.
  // So the history subsection is excluded rather than the whole check weakened.
  // (First written without this exclusion, and it failed on this document's own
  // history section — which is the guard working, not a reason to delete it.)
  const live = doc.replace(/### What changed, and why[\s\S]*?(?=\n## )/, " ");
  assert.ok(
    !/\b90%/.test(live),
    "The doc claims a 90% community share outside the change-history section. That was the " +
      "pre-2026-08-08 model, where the third bucket was a community-owned protocol lock."
  );
});

test("the allocation change is recorded, per §55", () => {
  // §55 wants future investigators to see what changed, when, and why. The
  // third bucket changed meaning on 2026-08-08 and that must not be quietly
  // absorbed.
  assert.ok(Array.isArray(manifest.$allocation_history), "manifest must keep $allocation_history");
  assert.ok(
    manifest.$allocation_history.length >= 2,
    "the protocol_locked -> market_liquidity change must be recorded"
  );
  assert.ok(/what changed|What changed/.test(doc), "the doc must explain the change too");
});

test("the doc's custody claim tracks the manifest, and never runs ahead of it", () => {
  // How the 800M is held is a tokenomics fact, not just a security one, so the
  // doc states it — which means it can drift. It must match the manifest, and
  // it must never imply the multisig exists when it does not.
  const c = manifest.vanity_targets.community;
  assert.equal(c.custody, "MULTISIG_OWNED_TOKEN_ACCOUNT");
  assert.match(doc, /token account owned by a 2-of-3/i, "the end state must be stated");

  // The two costs must travel with the decision. A token account is
  // mint-specific and is not an ATA; both change what that address can be used
  // for, and both are easy to omit because they are inconvenient.
  assert.match(doc, /mint-specific/i);
  assert.match(doc, /not an ATA/i);

  // And the honest present tense: the multisig account does not exist, so
  // custody TODAY is still a single key.
  if (manifest.multisig.status !== "CREATED") {
    assert.match(prose(doc), /does not exist yet/i,
      "while no multisig exists the doc must say so, not describe the end state as current");
    // Check the treasury's own table ROW rather than guessing at column
    // adjacency — the header and the value sit on different lines.
    const row = doc.split("\n").find((l) => l.startsWith("|") && l.includes(manifest.vanity_targets.community.address));
    assert.ok(row, "the treasury must appear in the project-controlled table");
    assert.match(row, /single key/i, "its 'custody today' cell must still read single key");
  }
});

test("the burn mechanism needs no address and no key", () => {
  // Recorded here because "we burned it" is a supply claim, and a burn WALLET
  // does not reduce supply — WinLEW learned that the expensive way.
  assert.equal(manifest.burn.burn_address_required, false);
  assert.equal(manifest.burn.keys_required, 0);
  assert.match(prose(doc), /no burn address, and no key for one/i);
  assert.match(prose(doc), /still part of total supply/i,
    "the doc must say why a burn wallet is not a burn");

  // §52: a mechanism must never read as a commitment.
  assert.match(prose(doc), /No burn amount, schedule or commitment exists/i);
});
