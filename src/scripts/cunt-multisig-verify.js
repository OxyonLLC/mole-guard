#!/usr/bin/env node
// Multisig signer verification. `npm run cunt:multisig-verify -- <command>`
//
//   check <A> <B> <C> [--threshold 2]   structural + reuse checks on three pubkeys
//   challenge <ADDRESS> [--nonce N]     print the message a device must sign
//   possession <ADDRESS> --nonce N --signature S
//   plan [--file cunt-project.json]     loss/compromise matrix + measurements
//
// THIS TOOL NEVER TOUCHES A PRIVATE KEY. Every input is a public address or a
// signature. It also never signs, sends, or broadcasts anything — it cannot
// create the multisig, by design, because the sprint is halted at the mainnet
// gate. It tells you whether what came off your three devices is sound.
//
// Generation happens ON THE DEVICES. A hardware wallet makes its seed inside
// the device and never exports it; a script that generates it for you throws
// away the only property the device has. See docs/cunt/CUNT-KEY-CEREMONY.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  inspectAddress, verifySignerSet, lossMatrix, proofChallenge, verifyPossession, suspectedSharedSite,
} from "../cunt/multisigVerify.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? dflt : args[i + 1];
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1]?.startsWith("--")));

const C = { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const say = (s = "") => console.log(s);
const mark = { fail: `${C.r}FAIL${C.x}`, warn: `${C.y}WARN${C.x}`, pass: `${C.g}PASS${C.x}` };

let exitCode = 0;
const fail = () => { exitCode = 1; };

/**
 * Is this address already known to WinLEW? A git grep is exactly what caught a
 * faucet claimant being proposed as a $CUNT authority — the address was sitting
 * in src/faucet/faucet_claims.json.
 */
function repoReuse(address) {
  try {
    const out = execFileSync("git", ["grep", "-l", "--", address], { cwd: REPO, encoding: "utf8" });
    // Our OWN records of this signer are not reuse. Once an address is declared
    // in the manifest it necessarily appears there, in the ceremony doc and in
    // the signing page's default — re-checking it must not then report the
    // project's own paperwork as a WinLEW collision.
    const ours = new Set(["cunt-project.json", "docs/cunt/CUNT-KEY-CEREMONY.md", "tools/sign-challenge.html"]);
    return out.split("\n").filter(Boolean).filter((f) => !ours.has(f) && !f.startsWith("test/"));
  } catch {
    return []; // git grep exits 1 when there are no matches
  }
}

/** Is this address already a declared signer? Reported, not treated as reuse. */
function declaredSigner(address) {
  try {
    const manifest = JSON.parse(readFileSync(join(REPO, "cunt-project.json"), "utf8"));
    return (manifest.multisig?.signers || []).find((s) => s.address === address) || null;
  } catch {
    return null;
  }
}

/** Banked vanity keys live outside the repo; their filenames are the addresses. */
function bankedVanity() {
  const dir = process.env.VANITY_DIR || join(homedir(), "winlew-vanity");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

function checkCommand() {
  const addresses = positional;
  const m = Number(flag("threshold", 2));
  if (addresses.length < 1) {
    say("usage: cunt:multisig-verify check <A> [B] [C] [--threshold 2]");
    say(`${C.d}One address at a time is fine — the ceremony is sequential.`);
    say("Public addresses only. Never paste a seed phrase or a private key into this tool." + C.x);
    process.exit(2);
  }

  // The runbook is explicit that keys are made one device at a time, so a
  // single address must be checkable. Set-level checks need a set and are
  // skipped rather than faked.
  const partial = addresses.length < 3;
  say(`\n${C.b}SIGNER${addresses.length > 1 ? " SET" : ""}${C.x}  ${partial ? `${addresses.length} of 3 declared` : `${m}-of-${addresses.length}`}\n`);

  const banked = bankedVanity();
  for (const [i, raw] of addresses.entries()) {
    const r = inspectAddress(raw);
    const id = String.fromCharCode(65 + i);
    say(`${C.b}${id}${C.x}  ${r.address}`);
    say(`    ${C.d}${r.chars} chars, ${r.bytes ?? "?"} bytes, ${r.onCurve === null ? "curve unknown" : r.onCurve ? "on-curve" : "OFF-CURVE"}${C.x}`);
    for (const issue of r.issues) {
      say(`    ${mark[issue.level]}  ${issue.message}`);
      if (issue.level === "fail") fail();
    }

    const hits = repoReuse(r.address);
    if (hits.length) {
      fail();
      say(`    ${mark.fail}  already used by WinLEW — appears in ${hits.length} tracked file(s):`);
      for (const h of hits.slice(0, 4)) say(`            ${h}`);
      say(`    ${C.d}        key linkage is permanent. Use a new key and a .sol alias for the branding.${C.x}`);
    }
    if (banked.includes(r.address)) {
      fail();
      say(`    ${mark.fail}  this is a banked vanity keypair — a software keyfile, not a device key`);
    }
    if (!r.issues.length && !hits.length && !banked.includes(r.address)) {
      say(`    ${mark.pass}  structurally sound, not reused`);
    }
    const declared = declaredSigner(r.address);
    if (declared) {
      say(`    ${C.d}declared as signer ${declared.id}${declared.derivation_path ? ` at ${declared.derivation_path}` : ""}` +
          `${declared.possession_proven ? `, ${C.g}possession proven${C.x}${C.d}` : `, ${C.y}possession NOT proven${C.x}${C.d}`}${C.x}`);
      if (!declared.derivation_path) {
        fail();
        say(`    ${mark.fail}  recorded without a derivation path — one Ledger yields different addresses per path`);
      }
    }
    say();
  }

  if (addresses.length >= 2) {
    // Threshold arithmetic only means something once the set is complete —
    // checking 2-of-2 against a half-declared 2-of-3 would be a false alarm.
    const { findings } = verifySignerSet(addresses, { m: partial ? addresses.length : m });
    say(`${C.b}SET${C.x}`);
    const real = partial ? findings.filter((f) => f.code !== "NO_RECOVERY" && f.code !== "TOO_FEW") : findings;
    if (!real.length) say(`    ${mark.pass}  distinct, no typos${partial ? "" : ", threshold arithmetic sound"}`);
    for (const f of real) {
      say(`    ${mark[f.level]}  ${f.message}`);
      if (f.level === "fail") fail();
    }
  }

  if (partial) {
    const remaining = 3 - addresses.length;
    say(`${C.y}  ${remaining} signer${remaining > 1 ? "s" : ""} still to declare.${C.x}`);
    say(`  ${C.d}Duplicate and typo checks only compare what is present, and the${C.x}`);
    say(`  ${C.d}threshold cannot be judged until all three are here.${C.x}`);
  }

  say(`\n${C.d}Structure is only half of it. Prove this device can SIGN before going further —${C.x}`);
  say(`${C.d}the signer set is immutable once created, so an unusable key is permanent:${C.x}`);
  say(`${C.d}  npm run cunt:multisig-verify -- challenge ${addresses[0]}${C.x}\n`);
}

function challengeCommand() {
  const address = positional[0];
  if (!address) { say("usage: cunt:multisig-verify challenge <ADDRESS> [--nonce N] [--oneline]"); process.exit(2); }
  const nonce = flag("nonce") || randomBytes(16).toString("hex");
  const oneline = args.includes("--oneline");
  const message = proofChallenge({ address, nonce, oneline });
  say(`\n${C.b}Sign this exact message on the device holding ${address}${C.x}`);
  say(`${C.d}Phantom (works with a Ledger attached): Settings → Sign Message`);
  say(`Ledger via CLI: solana sign-offchain-message -k usb://ledger "<message>"${C.x}\n`);
  say("─".repeat(64));
  say(message);
  say("─".repeat(64));
  say(`\nThen verify it:\n  npm run cunt:multisig-verify -- possession ${address} --nonce ${nonce}${oneline ? " --oneline" : ""} --signature <SIG>\n`);
  if (!oneline) {
    say(`${C.d}If the Ledger refuses this message, re-run with --oneline. Its off-chain`);
    say(`signing accepts restricted ASCII, and a newline can push the message into`);
    say(`a UTF-8 format the Solana app rejects. Neither form is weaker.${C.x}\n`);
  }
  say(`${C.d}Keep the nonce — it binds the signature to this ceremony so an old one cannot be replayed.${C.x}\n`);
}

function possessionCommand() {
  const address = positional[0];
  const nonce = flag("nonce");
  const signature = flag("signature");
  if (!address || !nonce || !signature) {
    say("usage: cunt:multisig-verify possession <ADDRESS> --nonce N --signature S [--oneline]");
    process.exit(2);
  }
  // A signature is over exact bytes, so try both forms rather than fail on a
  // format mismatch and send someone hunting for a non-existent key problem.
  const oneline = args.includes("--oneline");
  let message = proofChallenge({ address, nonce, oneline });
  let r = verifyPossession({ address, message, signature });
  if (!r.ok) {
    const alt = proofChallenge({ address, nonce, oneline: !oneline });
    const altResult = verifyPossession({ address, message: alt, signature });
    if (altResult.ok) {
      say(`\n  ${mark.warn}  signature matches the ${oneline ? "multi-line" : "one-line"} form, not the ${oneline ? "one-line" : "multi-line"} one`);
      say(`  ${C.d}Accepted — it binds the same address and nonce.${C.x}`);
      message = alt;
      r = altResult;
    }
  }
  if (r.ok) {
    say(`\n  ${mark.pass}  ${address}`);
    say(`  ${C.d}the device holding this key signed the challenge — it can sign for real${C.x}`);
    say(`  ${C.d}encoding: ${r.encoding} — ${r.$note}${C.x}\n`);
  } else {
    fail();
    say(`\n  ${mark.fail}  ${address}`);
    say(`  ${r.reason}\n`);
  }
}

function planCommand() {
  const file = flag("file", join(REPO, "cunt-project.json"));
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const ms = manifest.multisig || {};
  const signers = ms.signers || [];
  const m = Number(flag("threshold", String(ms.threshold || "2-of-3").split("-")[0]));

  const missing = signers.filter((s) => !s.location || !s.device);
  if (missing.length) {
    say(`\n${C.y}Cannot measure yet.${C.x} These signers declare no device/location: ${missing.map((s) => s.id).join(", ")}`);
    say(`\nAdd to each signer in ${file}:`);
    say(`${C.d}  "device": "ledger-nano-x", "location": "home-office",${C.x}`);
    say(`${C.d}  "backup_location": "bank-vault",   // omit if there is no backup${C.x}`);
    say(`${C.d}  "online": false                    // true if the key or its backup ever touches a network${C.x}\n`);
    process.exit(2);
  }

  const { scenarios, measurements } = lossMatrix(signers, m);

  // A sound PLAN and a built ARRANGEMENT measure identically here — the matrix
  // only reads placement. Without this banner a green result on a manifest full
  // of nulls reads as "the ceremony is done".
  const unbuilt = signers.filter((s) => !s.address);
  if (unbuilt.length) {
    say(`\n${C.y}${C.b}  MEASURING A PLAN, NOT A CONFIGURATION${C.x}`);
    say(`  ${C.d}No address recorded for ${unbuilt.map((s) => s.id).join(", ")} — ${unbuilt.length === signers.length ? "no key exists yet" : "some keys do not exist yet"}.`);
    say(`  Everything below measures where the keys are INTENDED to live.${C.x}`);
  }

  say(`\n${C.b}MEASUREMENTS${C.x}\n`);
  const rows = [
    ["signers / threshold", `${measurements.signers} / ${measurements.threshold}`],
    ["keys you can lose and still spend", measurements.redundancy],
    ["losses until frozen forever", measurements.losses_until_frozen],
    ["keys an attacker needs", measurements.keys_attacker_needs],
    ["distinct locations", measurements.distinct_locations],
    ["distinct devices", measurements.distinct_devices],
    ["MOST KEYS AT ONE LOCATION", measurements.max_keys_at_one_location],
    ["keys with online exposure", measurements.keys_with_online_exposure],
  ];
  for (const [k, v] of rows) say(`  ${String(k).padEnd(36)} ${C.b}${v}${C.x}`);

  if (measurements.max_keys_at_one_location >= m) {
    fail();
    say(`\n  ${mark.fail}  ${measurements.max_keys_at_one_location} keys share one location, and the threshold is ${m}.`);
    say(`        ${C.d}One burglary reaches the threshold. One fire takes recovery.${C.x}`);
  }

  say(`\n${C.b}SCENARIOS${C.x}\n`);
  say(`  ${"scenario".padEnd(40)} ${"lost".padEnd(6)} ${"left".padEnd(5)} ${"sign?".padEnd(6)} stolen?`);
  say(`  ${"─".repeat(70)}`);
  for (const s of scenarios) {
    const sign = s.can_still_sign ? `${C.g}yes${C.x}   ` : `${C.r}NO${C.x}    `;
    const steal = s.attacker_has_threshold ? `${C.r}YES${C.x}` : `${C.g}no${C.x}`;
    say(`  ${s.scenario.slice(0, 39).padEnd(40)} ${String(s.lost.length).padEnd(6)} ${String(s.surviving).padEnd(5)} ${sign} ${steal}`);
    if (s.fatal) fail();
  }

  const shared = suspectedSharedSite(signers.flatMap((s) => [s.location, s.backup_location]));
  if (shared.length) {
    say(`\n  ${mark.warn}  these names may be ONE blast radius, which the matrix above assumed were separate:`);
    for (const g of shared) say(`        "${g.site}…" → ${g.locations.join(", ")}`);
    say(`        ${C.d}If one fire or one burglary reaches both, rename them to the same location and re-run.${C.x}`);
  }

  if (measurements.single_points_of_failure.length) {
    say(`\n  ${mark.fail}  ${measurements.single_points_of_failure.length} single point(s) of failure.`);
    say(`        ${C.d}A ${m}-of-${measurements.signers} with a single point of failure is a 1-of-1 against that event.${C.x}`);
    for (const s of measurements.single_points_of_failure) say(`        · ${s}`);
  } else {
    say(`\n  ${mark.pass}  no single location or device is fatal to signing or to theft`);
  }

  // PER SIGNER, not one project-wide date. A single "tested 0 days ago" reads
  // as all three when it may mean one — and the untested ones are precisely the
  // plates nobody has a reason to doubt, because their devices still work.
  say(`\n${C.b}RECOVERY${C.x}\n`);
  const untested = [];
  for (const s of signers) {
    const when = s.plate_restored ?? null;
    if (!when) {
      untested.push(s.id);
      say(`  ${mark.fail}  ${s.id}  plate NEVER restored`);
      continue;
    }
    const days = Math.floor((Date.now() - Date.parse(when)) / 86400000);
    if (days > 180) say(`  ${mark.warn}  ${s.id}  restored ${days} days ago — past the 180-day re-test`);
    else say(`  ${mark.pass}  ${s.id}  restored ${days} days ago`);
  }
  if (untested.length) {
    fail();
    say(`\n  ${mark.fail}  ${untested.length} of ${signers.length} plates never restored (${untested.join(", ")}).`);
    say(`        ${C.d}A backup that has never been restored is a hope. These are the easiest`);
    say(`        ones to skip, because their devices still work — which is the point of §59.${C.x}`);
  }
  say();
}

const commands = { check: checkCommand, challenge: challengeCommand, possession: possessionCommand, plan: planCommand };

if (!cmd || !commands[cmd]) {
  say(`
${C.b}cunt:multisig-verify${C.x} — check a signer set without ever touching a private key

  check <A> <B> <C> [--threshold 2]   structural + reuse checks on three pubkeys
  challenge <ADDRESS> [--nonce N]     print the message a device must sign
  possession <ADDRESS> --nonce N --signature S
  plan [--file cunt-project.json]     loss/compromise matrix + measurements

${C.d}Generation happens on the devices, never here. This tool cannot sign,
send, or create anything — it only verifies.${C.x}
`);
  process.exit(cmd ? 2 : 0);
}

commands[cmd]();
process.exit(exitCode);
