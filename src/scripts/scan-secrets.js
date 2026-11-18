#!/usr/bin/env node
// Secret scanner (§56). Runs in CI on every push, and locally via
// `npm run scan:secrets`.
//
// THIS TOOL NEVER PRINTS A SECRET. §56: "CI must never print secrets." A
// scanner that echoes what it found in a public build log has published the
// thing it was meant to protect. Findings report file, line and pattern name
// only — never the matched text.
//
// Why a bespoke scanner rather than a third-party action:
//
//   1. A GitHub Action is itself a supply-chain dependency, running with
//      repository credentials. §57 asks us to audit dependencies; adding an
//      unaudited one to the job that guards secrets is the wrong trade.
//   2. The highest-value pattern here is project-specific. `solana-keygen
//      grind` names its output after the PUBKEY it found, so a live mint key
//      lands in the tree as an ordinary-looking file like
//      `WhPApnQQ…aNCUNT.json`, matching no generic secret pattern at all.
//
// False positives were the design problem, not detection. This repo vendors
// bundled third-party JS containing numeric tables — RIPEMD-160 permutation
// constants read exactly like a byte array. Those paths are skipped, and the
// keypair check requires the EXACT shape of a Solana keypair rather than
// "looks numeric".

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

// Bundled/vendored builds we neither wrote nor can meaningfully review.
const SKIP_PATHS = [
  /^src\/public\/assets\/index-[A-Za-z0-9_-]{6,}\.js$/,
  /^src\/public\/geoagora\//,
  /^src\/public\/wallet\//,
  /^package-lock\.json$/,
  /^src\/scripts\/scan-secrets\.js$/, // this file describes the patterns it hunts
];

const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".apk", ".zip", ".woff", ".woff2", ".ttf", ".mp3", ".mp4", ".pdf"]);

const MAX_BYTES = 2 * 1024 * 1024;

/** Each finding reports WHERE and WHAT KIND. Never the matched text. */
const RULES = [
  {
    // Added 2026-08-16 after a live webhook URL was pasted into a chat and the
    // scanner would not have caught it in a file. A Discord webhook URL IS a
    // credential: possession alone lets anyone post as that webhook, in that
    // channel, with no further authentication and no rate limit worth the name.
    //
    // The token segment is 60+ chars, which is what separates a real one from
    // the obvious placeholders the test suite uses
    // (`/webhooks/1/test`, `/webhooks/123456789/fake-token-for-tests`).
    name: "discord-webhook-url",
    severity: "CRITICAL",
    hint: "a Discord webhook URL — possession is enough to post as it; rotate rather than delete",
    regex: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{17,20}\/[\w-]{60,}/g,
  },
  {
    name: "solana-keypair-array",
    severity: "CRITICAL",
    hint: "a 64-element byte array — the exact shape of a Solana secret key",
    // Exactly 64 comma-separated integers. Checked numerically below so that
    // crypto constant tables (values > 255) do not trip it.
    test(content) {
      const hits = [];
      const re = /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g;
      for (const m of content.matchAll(re)) {
        const nums = m[0].slice(1, -1).split(",").map((n) => Number(n.trim()));
        if (nums.length === 64 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
          hits.push(lineOf(content, m.index));
        }
      }
      return hits;
    },
  },
  {
    name: "pem-private-key",
    severity: "CRITICAL",
    hint: "PEM private key header",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "discord-bot-token",
    severity: "CRITICAL",
    hint: "a string shaped like a Discord bot token",
    regex: /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
  },
  // DELIBERATELY ABSENT: a "long base58 string" rule.
  //
  // The first version flagged any base58 run of 60+ characters as a possible
  // private key. It produced 219 findings on a clean repository, because a
  // Solana TRANSACTION SIGNATURE is also 64 bytes and therefore also ~88 base58
  // characters. Length cannot distinguish a secret key from a signature — they
  // are the same size — and this repo legitimately stores thousands of
  // signatures in burn, liquidity and contribution records.
  //
  // A scanner with 219 false positives is worse than no scanner, because it
  // trains everyone to ignore it. Base58 secrets are instead caught by
  // `assigned-secret` below, which keys on the variable name rather than the
  // shape, and by the filename rules, which catch the actual way a key lands
  // here (solana-keygen grind output).
  {
    name: "mnemonic-phrase",
    severity: "CRITICAL",
    hint: "a quoted list of 12/24 short lowercase words — BIP39 shape",
    // Must be a QUOTED list of 12/24 short lowercase words. The first version
    // only needed 12 lowercase words on a line mentioning "seed phrase", which
    // matched ordinary English prose explaining what a seed phrase is.
    test(content) {
      const hits = [];
      const re = /["'`](?:[a-z]{3,8}[ ]){11,23}[a-z]{3,8}["'`]/g;
      for (const m of content.matchAll(re)) hits.push(lineOf(content, m.index));
      return hits;
    },
  },
  {
    name: "assigned-secret",
    severity: "HIGH",
    hint: "a hardcoded value assigned to a secret-looking name",
    // Deliberately ignores process.env reads and empty/placeholder values.
    regex: /\b(?:private_?key|secret_?key|authtoken|auth_token|api_?key|bot_?token)\s*[:=]\s*["'][^"'\s]{16,}["']/gi,
  },
];

/** Filenames that are themselves the finding. */
const FILENAME_RULES = [
  {
    name: "grind-output-keypair",
    severity: "CRITICAL",
    hint: "a .json named after a base58 pubkey — the shape solana-keygen grind writes",
    test: (path) => /(?:^|\/)[1-9A-HJ-NP-Za-km-z]{32,44}\.json$/.test(path),
  },
  {
    name: "tracked-env-file",
    severity: "CRITICAL",
    hint: "an environment file is tracked in git",
    test: (path) => /(?:^|\/)\.env(?:\.[a-z]+)?$/.test(path) && !path.endsWith(".example"),
  },
  {
    name: "tracked-keypair-name",
    severity: "CRITICAL",
    hint: "a filename containing 'keypair' or 'wallet' is tracked",
    // One exact exemption: src/faucet/keypair.js is the loader SOURCE (it reads
    // the file named by BOT_KEYPAIR_PATH at call time). Only the NAME check is
    // waived — every content rule still scans it, and any other path containing
    // "keypair" (bot-keypair.json, a copy elsewhere, keypair.js.bak) is still
    // CRITICAL. Pinned by test/faucet/treasuryLoader.test.mjs.
    test: (path) => /keypair|(?:^|\/)wallet[^/]*\.json$/i.test(path) && !path.includes("wallet_links") && !path.includes("wallet_bans") && path !== "src/faucet/keypair.js",
  },
];

// Line lookup for a match offset.
//
// The obvious one-liner — `content.slice(0, index).split("\n").length` — copies
// the file and builds an array of every line BEFORE the match, once PER MATCH.
// That is quadratic in (file size x match count), so a file that legitimately
// trips a rule a few thousand times stops being a scan and becomes an
// out-of-memory abort. A scanner that dies is a scanner that reports nothing,
// which is the most dangerous way for a security check to fail.
//
// Instead: index the newline offsets ONCE per file, then binary search. The
// cache is keyed on string identity, so the rules below keep calling
// `lineOf(content, i)` exactly as they did and pay for the index only once.
let indexedContent = null;
let lineOffsets = [];

function buildLineOffsets(content) {
  const offsets = [0];
  for (let i = content.indexOf("\n"); i !== -1; i = content.indexOf("\n", i + 1)) offsets.push(i + 1);
  return offsets;
}

// Every content rule must declare EXACTLY ONE matcher, and the engine must be
// told loudly when one does not.
//
// This is not defensive padding. The discord-webhook-url rule spent its whole
// life declaring `pattern:` while the loop below read `rule.regex`, so it
// evaluated `content.matchAll(undefined)` — which JavaScript quietly turns into
// the empty regex /(?:)/g, matching at EVERY offset. The rule added because a
// live webhook leaked therefore never once looked for a webhook, and instead
// produced one finding per byte of every file scanned: 1.4 million findings,
// and an out-of-memory abort before any of them could be printed.
//
// A typo in a key name should not be able to do that. Validating the shape at
// load turns a silent catastrophe into a startup error naming the rule.
function assertRuleShapes(rules) {
  for (const rule of rules) {
    const hasTest = typeof rule.test === "function";
    const hasRegex = rule.regex instanceof RegExp;
    if (hasTest === hasRegex) {
      throw new Error(
        `rule "${rule.name}" must declare exactly one of test() or regex — ` +
          `found ${hasTest ? "both" : "neither"} (a misspelled key such as \`pattern\` reads as neither)`,
      );
    }
    if (hasRegex && !rule.regex.global) {
      throw new Error(`rule "${rule.name}" needs the g flag or matchAll will throw`);
    }
  }
}

function lineOf(content, index) {
  if (content !== indexedContent) {
    indexedContent = content;
    lineOffsets = buildLineOffsets(content);
  }
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// A finding can be acknowledged in place with a `secret-scan-ok: <rule>` marker
// on the flagged line or the three lines above it.
//
// Deliberately inline rather than a central allowlist file: a path+line
// allowlist goes stale the moment anyone edits above it, and then silently
// stops suppressing the thing it named while silently suppressing something
// else. A marker in the source travels with the code it excuses and has to be
// deleted by whoever removes the reason for it.
//
// It must name the specific rule. A blanket "ignore this file" would be a hole.
function acknowledged(lines, lineNo, ruleName) {
  const from = Math.max(0, lineNo - 4);
  return lines
    .slice(from, lineNo)
    .some((l) => new RegExp(`secret-scan-ok:\\s*${ruleName}\\b`).test(l));
}

function trackedFiles() {
  return execSync("git ls-files -z", { maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split("\0")
    .filter(Boolean);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  assertRuleShapes(RULES);

  const findings = [];
  let scanned = 0;
  let acknowledgedCount = 0;

  for (const path of trackedFiles()) {
    for (const rule of FILENAME_RULES) {
      if (rule.test(path)) findings.push({ path, line: 0, rule });
    }

    if (SKIP_PATHS.some((re) => re.test(path))) continue;
    if (SKIP_EXT.has(extname(path).toLowerCase())) continue;

    let content;
    try {
      if (statSync(path).size > MAX_BYTES) continue;
      content = readFileSync(path, "utf8");
    } catch {
      continue; // unreadable or binary
    }
    scanned++;

    const sourceLines = content.split("\n");
    for (const rule of RULES) {
      const lines = rule.test
        ? rule.test(content)
        : [...content.matchAll(rule.regex)].map((m) => lineOf(content, m.index));
      for (const line of lines) {
        if (acknowledged(sourceLines, line, rule.name)) {
          acknowledgedCount++;
          continue;
        }
        findings.push({ path, line, rule });
      }
    }
  }

  console.log(`  scanned ${scanned} tracked text files` + (acknowledgedCount ? `, ${acknowledgedCount} acknowledged in place` : ""));

  if (!findings.length) {
    console.log("  ✓ no secret-shaped content found");
    return 0;
  }

  // Report location and kind ONLY. Never the matched text.
  console.log(`\n  ✗ ${findings.length} finding(s):\n`);
  for (const f of findings) {
    const where = f.line ? `${f.path}:${f.line}` : f.path;
    console.log(`    [${f.rule.severity}] ${f.rule.name}`);
    console.log(`        ${where}`);
    console.log(`        ${f.rule.hint}`);
  }
  console.log(
    "\n  The matched text is deliberately not printed — a scanner that echoes a\n" +
      "  secret into a public build log has published the thing it guards.\n" +
      "  Open the file locally to inspect.\n"
  );
  if (verbose) console.log("  (--verbose still does not print secrets; it never will)");
  return 1;
}

// A scanner that fails must never LOOK like a scanner that passed. Exit codes
// are the only thing a CI step or a pre-commit hook reads: 0 clean, 1 findings,
// 2 the scan did not complete. Without the third, a crash mid-scan reports the
// same "nothing found" as a clean repo — and if the caller pipes this anywhere
// (`| tail`, `| tee`), the shell reports the PIPE's status and swallows the
// failure entirely. Use `set -o pipefail`, or read this process's status.
try {
  process.exit(main());
} catch (error) {
  console.error("\n  ✗ scan-secrets did not finish:", error?.message || error);
  console.error("  This is a FAILED scan, not a clean one. Nothing was cleared.\n");
  process.exit(2);
}
