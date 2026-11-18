#!/usr/bin/env node
// Dependency audit gate (§57). Run by CI and locally via `npm run audit:gate`.
//
// WHY THIS EXISTS INSTEAD OF `npm audit --audit-level=high`:
//
// This project cannot reach zero high advisories, and not through neglect.
// Every remaining one is in the Solana/Bonfida chain, and npm's suggested
// "fix" for each is a DOWNGRADE wearing a major-version label:
//
//     @solana/spl-token          0.4.14  ->  0.1.8     (npm calls this a fix)
//     @solana/web3.js            1.98.4  ->  0.0.3
//     @bonfida/spl-name-service  3.0.16  ->  0.1.25
//
// `npm audit fix --force` would apply exactly that and break the entire
// project while reporting a security improvement. This is npm's known
// behaviour when no forward fix exists: it offers the newest version without
// the advisory, which can be an ancient one.
//
// So `--audit-level=high` would be permanently red, and `--audit-level=
// critical` is permanently green — including for a NEW high advisory in some
// package added next month, which is the thing a gate should actually catch.
//
// This gate fails on any advisory at or above the threshold that is not on the
// ACCEPTED list below. Each acceptance carries a reason and a review date, so
// "we know about it" is written down rather than implied by an absent alarm.

import { execSync } from "node:child_process";

const THRESHOLD = process.env.AUDIT_THRESHOLD || "high";
const ORDER = ["info", "low", "moderate", "high", "critical"];
const atOrAbove = (sev) => ORDER.indexOf(sev) >= ORDER.indexOf(THRESHOLD);

// Advisories reviewed and accepted, with the reason each cannot be fixed.
// Reviewed 2026-08-08 — see docs/cunt/CUNT-DEPENDENCY-REVIEW.md.
//
// An entry here is a decision, not a suppression: removing the reason should
// mean removing the entry. Anything NOT listed fails the build.
const ACCEPTED = {
  "@solana/spl-token": "No forward fix. npm suggests 0.1.8, a downgrade from 0.4.14 that would break every token operation. Direct dependency, 15 files.",
  "@solana/buffer-layout-utils": "Transitive under @solana/spl-token; same downgrade-only situation.",
  "bigint-buffer": "Transitive under @solana/buffer-layout-utils. Buffer overflow in toBigIntLE. Highest-attention item in the review — see CUNT-SECURITY-MODEL.md §3.2.",
  "@bonfida/spl-name-service": "No forward fix. npm suggests 0.1.25, a downgrade from 3.0.16. Used for SNS (.sol) resolution in 5 files.",
};

// Acceptances that EXPIRE. For advisories whose only fix is a major upgrade that
// needs its own reviewed change: the entry buys time for that change and fails
// the build again on its reviewBy date (UTC), so it cannot quietly become
// permanent. Never usable for a critical advisory.
const ACCEPTED_UNTIL = {
  // (zod was accepted until 2026-12-31 and removed when zod 4 landed.)
  // 2026-11-17: the picomatch ReDoS chain. No fixed version exists anywhere yet.
  picomatch: {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: the matcher behind the entries below. Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
  micromatch: {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: used by http-proxy-middleware to match its path filters, which src/mole/web.js defines (e.g. '/geoagora-api'); request paths are inputs, never patterns. Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
  "http-proxy-middleware": {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: direct dependency; its filters and pathRewrite rules are constants in src/mole/web.js. Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
  anymatch: {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: used by chokidar for file watching (development). Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
  chokidar: {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: file watcher used by nodemon (development). Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
  readdirp: {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: used by chokidar for file watching (development). Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
  nodemon: {
    reviewBy: "2027-01-31",
    reason:
      "GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 ReDoS through single-branch repeated extglobs, with NO patched release (first_patched_version null, published 2026-10-19). It needs an attacker-controlled glob PATTERN. Here every pattern is fixed in code: development restarter; never runs in the production pm2 processes; its watch globs are its own config. Re-check on reviewBy; upgrade as soon as a patched picomatch ships.",
  },
};

const todayUtc = new Date().toISOString().slice(0, 10);
const acceptedFor = (pkg, severity) => {
  if (severity === "critical") return null; // a critical advisory is never accepted
  if (pkg in ACCEPTED) return "accepted";
  const t = ACCEPTED_UNTIL[pkg];
  if (t && todayUtc <= t.reviewBy) return `accepted until ${t.reviewBy}`;
  return null;
};

// This repo has TWO dependency trees. src/faucet is its own package with its
// own node_modules, and pm2 runs the faucet with cwd=src/faucet, so THAT is the
// tree the money-handling process actually loads. Auditing only the root left
// it on unpatched lodash/undici/ws — found 2026-08-08 when the other machine's
// commit surfaced the nested package. Both are audited now.
const TREES = [
  { name: "root", cwd: "." },
  { name: "src/faucet", cwd: "src/faucet" },
];

function audit(cwd) {
  try {
    return JSON.parse(execSync("npm audit --json", { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString());
  } catch (err) {
    // npm audit exits non-zero when advisories exist; the JSON is still on
    // stdout and is what we actually want.
    if (err.stdout) return JSON.parse(err.stdout.toString());
    throw err;
  }
}

let entries = [];
let totals = {};
for (const tree of TREES) {
  let report;
  try {
    report = audit(tree.cwd);
  } catch {
    console.log(`  ${tree.name}: no package.json or audit unavailable — skipped`);
    continue;
  }
  const t = report.metadata?.vulnerabilities || {};
  for (const [k, v] of Object.entries(t)) totals[k] = (totals[k] || 0) + v;
  for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
    entries.push([`${name} (${tree.name})`, { ...v, _pkg: name }]);
  }
}

const gated = entries.filter(([, v]) => atOrAbove(v.severity));
const unaccepted = gated.filter(([, v]) => !acceptedFor(v._pkg, v.severity));
const accepted = gated.filter(([, v]) => acceptedFor(v._pkg, v.severity));

console.log(`  threshold: ${THRESHOLD} and above`);
console.log(`  totals: ${ORDER.map((s) => `${s}:${totals[s] ?? 0}`).join("  ")}`);

if (accepted.length) {
  console.log(`\n  accepted (${accepted.length}) — reviewed, no forward fix available:`);
  for (const [name, v] of accepted) console.log(`    · ${name} (${v.severity}) — ${acceptedFor(v._pkg, v.severity)}`);
}

const expired = Object.entries(ACCEPTED_UNTIL).filter(([, t]) => todayUtc > t.reviewBy);
if (expired.length) {
  console.log(`\n  ✗ ${expired.length} time-limited acceptance(s) past their review date:`);
  for (const [n, t] of expired) console.log(`    · ${n} (reviewBy ${t.reviewBy})`);
}

// An acceptance that no longer matches a real advisory is stale — it may be
// hiding a regression, or upstream may finally have shipped a fix worth taking.
const stale = [...Object.keys(ACCEPTED), ...Object.keys(ACCEPTED_UNTIL)].filter((n) => !entries.some(([, v]) => v._pkg === n));
if (stale.length) {
  console.log(`\n  ⚠ ${stale.length} acceptance(s) no longer match any advisory — remove them:`);
  for (const n of stale) console.log(`    · ${n}`);
}

if (!unaccepted.length) {
  console.log(`\n  ✓ no unaccepted advisories at ${THRESHOLD} or above`);
  process.exit(0);
}

console.log(`\n  ✗ ${unaccepted.length} unaccepted advisory(ies) at ${THRESHOLD} or above:\n`);
for (const [name, v] of unaccepted) {
  const fix = v.fixAvailable === true ? "patch available — run npm audit fix"
    : v.fixAvailable && v.fixAvailable.name
      ? `npm suggests ${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? " (MAJOR — check it is not a downgrade)" : ""}`
      : "no fix available";
  console.log(`    [${v.severity}] ${name}${v.isDirect ? "  [DIRECT]" : ""}`);
  console.log(`        ${fix}`);
}
console.log(
  "\n  Fix it, or add it to ACCEPTED in this file WITH A REASON.\n" +
    "  Do not run `npm audit fix --force` here — for the Solana packages npm's\n" +
    "  suggested fix is a downgrade that would break the project.\n"
);
process.exit(1);
