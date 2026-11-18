// Escalating IP bans: 6 months for a first offence, permanent for a second.
//
// These test decideIpOffence(), which is PURE. The first version of this file
// called recordIpOffence() and wrote test IPs into the tracked
// src/faucet/ip_bans.json — faucet storage resolves paths next to its own
// module and honours no data-dir env var, so the override looked right and did
// nothing. Nothing here touches disk.
//
// The structural property the escalation depends on — that strikes live
// OUTSIDE the ban record, because purgeExpired() deletes an expired ban — is
// asserted against the source below, since proving it at runtime would mean
// writing to the real store again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IP_OFFENCE_FIRST_BAN_MS,
  IP_OFFENCE_PERMANENT_AT_STRIKE,
  decideIpOffence,
} from "../../src/shared/ipDenylist.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(repoRoot, "src/shared/ipDenylist.js"), "utf8");

test("the policy is six months, then permanent", () => {
  assert.equal(IP_OFFENCE_FIRST_BAN_MS, 182 * 24 * 60 * 60 * 1000, "first offence is ~6 months");
  assert.equal(IP_OFFENCE_PERMANENT_AT_STRIKE, 2, "second offence is permanent");
});

test("a first offence expires; a second never does", () => {
  const first = decideIpOffence({ priorCount: 0 });
  assert.deepEqual(first, { strikeCount: 1, permanent: false, ttlMs: IP_OFFENCE_FIRST_BAN_MS });

  const second = decideIpOffence({ priorCount: 1 });
  assert.equal(second.strikeCount, 2);
  assert.equal(second.permanent, true);
  assert.equal(second.ttlMs, null, "a permanent ban must carry no expiry — null, not a huge number");
});

test("beyond the second offence it stays permanent", () => {
  for (const prior of [2, 5, 40]) {
    const r = decideIpOffence({ priorCount: prior });
    assert.equal(r.permanent, true, `prior=${prior} must stay permanent`);
    assert.equal(r.ttlMs, null);
  }
});

test("missing or nonsense prior counts are treated as a first offence, never as a repeat", () => {
  // Failing the other way would hand someone a permanent ban on their first
  // trip because a field was absent.
  for (const prior of [undefined, null, 0, -3, NaN, "not a number", {}]) {
    const r = decideIpOffence({ priorCount: prior });
    assert.equal(r.strikeCount, 1, `prior=${JSON.stringify(prior)} must read as a first offence`);
    assert.equal(r.permanent, false);
  }
  assert.equal(decideIpOffence().strikeCount, 1, "no argument at all is still a first offence");
});

test("a numeric string prior count still counts", () => {
  // Managed JSON round-trips through a file; a count arriving as "1" must not
  // silently reset someone to their first offence.
  assert.equal(decideIpOffence({ priorCount: "1" }).permanent, true);
});

// ── the structural property the escalation depends on ────────────────────────

test("strikes are stored outside the ban record", () => {
  // purgeExpired() DELETES a ban the moment it expires. If the strike count
  // lived on the ban, a six-month ban lapsing would erase the evidence of the
  // first offence and the repeat offender would get six months again —
  // escalation that quietly never escalates.
  assert.match(source, /state\.strikes\[address\]\s*=\s*\{/, "recordIpOffence must write to state.strikes");
  assert.match(
    source,
    /function purgeExpired[\s\S]{0,320}?delete state\.bans\[ip\]/,
    "purgeExpired must delete from bans (this is the behaviour strikes exist to survive)"
  );
  const purge = source.slice(source.indexOf("function purgeExpired"), source.indexOf("function activeBanRecord"));
  assert.ok(!/strikes/.test(purge), "purgeExpired must NEVER touch strikes — that would defeat the escalation");
});

test("lifting a ban does not clear the strike history", () => {
  // Forgiveness, not amnesia: a moderator unbanning someone on appeal must not
  // reset them to zero, or the escalation never fires for repeat offenders.
  const remove = source.slice(source.indexOf("export function removeIpBan"), source.indexOf("export function listIpBans"));
  assert.ok(remove.length > 0, "removeIpBan not found — update this guard rather than deleting it");
  assert.ok(!/strikes/.test(remove), "removeIpBan must not delete strikes");
});

test("the ban store keeps strikes when deciding whether a file has records", () => {
  // storage.js's hasRecords() decides whether a local file may overwrite the
  // remote copy. If it only counted `bans`, a file holding strikes but no
  // ACTIVE bans would look empty, and a remote copy could wipe the offence
  // history — resetting every repeat offender to their first strike.
  const storage = readFileSync(resolve(repoRoot, "src/faucet/storage.js"), "utf8");
  const spec = storage.slice(storage.indexOf("'ip_bans.json'"), storage.indexOf("'ip_bans.json'") + 700);
  assert.match(spec, /records:.*strikes/s, "ip_bans.json's records accessor must count strikes as well as bans");
});
