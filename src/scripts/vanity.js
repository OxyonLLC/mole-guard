#!/usr/bin/env node
// Vanity search tooling (§4). `npm run vanity -- <command>`
//
//   vanity estimate --prefix wen --suffix CUNT [--keys-per-sec N] [--ignore-case]
//   vanity start    --prefix wen --suffix CUNT --confirm
//   vanity status
//   vanity stop
//   vanity results
//
// §4: "DO NOT automatically begin long-running searches without approval."
// `start` therefore refuses without an explicit --confirm, and prints the full
// probabilistic estimate first so the person typing it knows what they are
// committing to.
//
// This is a WRAPPER, not a grinder. The search itself is Anza's
// `solana-keygen grind` — audited in docs/cunt/CUNT-VANITY-GRINDER-AUDIT.md.
// We deliberately do not implement key generation: the 2022 Profanity disaster
// (~$3.3M drained) happened because a project wrote its own.
//
// SECRETS: this tool never reads, prints or copies a keypair file. `results`
// reports public addresses only, read from filenames and then RE-DERIVED from
// the file to confirm the filename was not edited.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { estimate, leadingCharPenalty, ALPHABET } from "../cunt/vanityEstimate.js";

// Secrets live OUTSIDE the repo, on the Linux filesystem. §3 proposes
// vanity/secrets/ inside the tree; that is unsafe here because this repo sits on
// /mnt/c where chmod is a no-op — `chmod 600` reports 777. See the audit doc.
const SECRET_DIR = process.env.VANITY_DIR || join(homedir(), "winlew-vanity");
const JOB_FILE = join(SECRET_DIR, ".vanity-job.json");
const LOG_FILE = join(SECRET_DIR, "grind.log");

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1] ?? true;
};
const has = (name) => args.includes(`--${name}`);

function openLog() {
  mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  return openSync(LOG_FILE, "a");
}

const fmtSeconds = (s) => {
  if (s < 60) return `${s.toFixed(1)} seconds`;
  if (s < 3600) return `${(s / 60).toFixed(1)} minutes`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} hours`;
  if (s < 86400 * 365) return `${(s / 86400).toFixed(1)} days`;
  return `${(s / 86400 / 365).toFixed(1)} years`;
};

function printEstimate(e) {
  console.log(`\n  pattern        ${e.prefix || "(none)"}…${e.suffix || "(none)"}`);
  console.log(`  case           ${e.caseSensitive ? "SENSITIVE" : "insensitive (--ignore-case)"}`);
  console.log(`  constrained    ${e.constrainedChars} base58 characters`);
  if (e.prefix) {
    console.log(
      `  leading char   '${e.prefix[0]}' occurs 1 in ${(1 / e.leadingCharProbability).toFixed(0)} pubkeys` +
        `  (${leadingCharPenalty(e.prefix[0]).toFixed(1)}x rarer than the best-case character)`
    );
  }
  console.log(`  search space   1 in ${Math.round(e.expectedKeys).toLocaleString()}`);
  console.log(`  measured rate  ${e.keysPerSecond.toLocaleString()} keys/sec`);
  console.log(`\n  EXPECTED TIME  ${fmtSeconds(e.expectedSeconds)}   (mean)`);
  console.log(`  MEDIAN         ${fmtSeconds(e.medianSeconds)}   (50/50 point)`);
  console.log(`\n  This is a MEMORYLESS process. Keys already searched buy no progress`);
  console.log(`  toward the next hit, so "expected" is an average, not a deadline:\n`);
  for (const b of e.byMultiple) {
    const bar = "#".repeat(Math.round(b.probability * 30)).padEnd(30, "·");
    console.log(
      `    by ${String(b.multiple).padStart(4)}x expected (${fmtSeconds(b.seconds).padEnd(14)}) ${bar} ${(b.probability * 100).toFixed(1)}%`
    );
  }
  console.log(
    `\n  So there is a ${((1 - e.byMultiple.find((b) => b.multiple === 1).probability) * 100).toFixed(0)}% chance it is STILL RUNNING at the expected time,`
  );
  console.log(`  and a ${((1 - e.byMultiple.find((b) => b.multiple === 3).probability) * 100).toFixed(1)}% chance it is still running at 3x that.\n`);
}

function requirePattern() {
  const prefix = String(flag("prefix", "") || "");
  const suffix = String(flag("suffix", "") || "");
  if (!prefix && !suffix) {
    console.error("  need --prefix and/or --suffix");
    process.exit(2);
  }
  for (const ch of prefix + suffix) {
    if (!ALPHABET.includes(ch)) {
      console.error(`  "${ch}" is not a base58 character. 0, O, I and l do not exist in base58.`);
      process.exit(2);
    }
  }
  return { prefix, suffix, ignoreCase: has("ignore-case") };
}

function readJob() {
  return existsSync(JOB_FILE) ? JSON.parse(readFileSync(JOB_FILE, "utf8")) : null;
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

switch (cmd) {
  case "estimate": {
    const pattern = requirePattern();
    const kps = Number(flag("keys-per-sec", 253000));
    printEstimate(estimate({ ...pattern, keysPerSecond: kps }));
    console.log(`  Rate defaults to 253,000/sec (measured: laptop i7-13620H, 16 cores).`);
    console.log(`  MEASURE IT on the machine that will run the search — pass --keys-per-sec.\n`);
    break;
  }

  case "start": {
    const pattern = requirePattern();
    const kps = Number(flag("keys-per-sec", 253000));
    const e = estimate({ ...pattern, keysPerSecond: kps });
    printEstimate(e);

    if (!has("confirm")) {
      console.log("  §4 requires approval before a long search begins.");
      console.log("  Re-run with --confirm if the numbers above are acceptable.\n");
      process.exit(1);
    }
    const running = readJob();
    if (running && alive(running.pid)) {
      console.error(`  a grind is already running (pid ${running.pid}). Use \`vanity status\` or \`vanity stop\`.`);
      process.exit(1);
    }

    mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
    const threads = String(flag("threads", "16"));
    const spec = pattern.prefix && pattern.suffix
      ? ["--starts-and-ends-with", `${pattern.prefix}:${pattern.suffix}:1`]
      : pattern.prefix
        ? ["--starts-with", `${pattern.prefix}:1`]
        : ["--ends-with", `${pattern.suffix}:1`];
    if (pattern.ignoreCase) spec.push("--ignore-case");

    const child = spawn("solana-keygen", ["grind", ...spec, "--num-threads", threads], {
      cwd: SECRET_DIR,
      detached: true,
      stdio: ["ignore", openLog(), openLog()],
    });
    child.unref();

    writeFileSync(
      JOB_FILE,
      JSON.stringify({ pid: child.pid, ...pattern, keysPerSecond: kps, expectedKeys: e.expectedKeys, startedAt: new Date().toISOString() }, null, 2)
    );
    console.log(`  started (pid ${child.pid}), output -> ${LOG_FILE}`);
    console.log(`  it survives this terminal closing. \`vanity status\` to check.\n`);
    break;
  }

  case "status": {
    const job = readJob();
    if (!job) {
      console.log("  no grind has been started");
      break;
    }
    const up = alive(job.pid);
    const elapsed = (Date.now() - Date.parse(job.startedAt)) / 1000;
    console.log(`\n  pattern    ${job.prefix || ""}…${job.suffix || ""}`);
    console.log(`  pid        ${job.pid}  ${up ? "RUNNING" : "not running"}`);
    console.log(`  elapsed    ${fmtSeconds(elapsed)}`);
    const searched = elapsed * job.keysPerSecond;
    const frac = searched / job.expectedKeys;
    console.log(`  searched   ~${Math.round(searched).toLocaleString()} keys  (${frac.toFixed(2)}x expected)`);
    console.log(`  P(a search this long or longer, given no hit): ${(Math.exp(-frac) * 100).toFixed(1)}%`);
    console.log(`\n  Elapsed time buys NOTHING. The chance of a hit in the next hour is the`);
    console.log(`  same as it was in the first hour. Running long is not "due".\n`);
    break;
  }

  case "stop": {
    const job = readJob();
    if (!job || !alive(job.pid)) {
      console.log("  nothing running");
      if (job) unlinkSync(JOB_FILE);
      break;
    }
    process.kill(job.pid, "SIGTERM");
    unlinkSync(JOB_FILE);
    console.log(`  stopped pid ${job.pid}. Any keypair already written is kept.`);
    break;
  }

  case "results": {
    if (!existsSync(SECRET_DIR)) {
      console.log("  no results directory");
      break;
    }
    const files = readdirSync(SECRET_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("."));
    if (!files.length) {
      console.log("  no keypairs found yet");
      break;
    }
    console.log(`\n  ${files.length} keypair(s) in ${SECRET_DIR}\n`);
    for (const f of files) {
      const claimed = f.replace(/\.json$/, "");
      let derived = "?";
      try {
        derived = execFileSync("solana-keygen", ["pubkey", join(SECRET_DIR, f)], { encoding: "utf8" }).trim();
      } catch {
        derived = "(could not derive)";
      }
      // §3: never trust the filename. Re-derive and compare.
      console.log(`    ${derived}  ${derived === claimed ? "✓ filename verified" : "✗ FILENAME DOES NOT MATCH KEY"}`);
      console.log(`      ${derived.length} chars`);
    }
    console.log(`\n  Public addresses only. Private key material is never read or printed.\n`);
    break;
  }

  default:
    console.log(`
  vanity estimate --prefix wen --suffix CUNT [--keys-per-sec N] [--ignore-case]
  vanity start    --prefix wen --suffix CUNT --confirm [--threads 16]
  vanity status
  vanity stop
  vanity results

  Secrets directory: ${SECRET_DIR}  (outside the repo, on the Linux filesystem)
`);
    process.exit(cmd ? 2 : 0);
}
