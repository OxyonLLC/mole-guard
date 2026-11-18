#!/usr/bin/env node
// Take a point-in-time WinLEW holder snapshot — `npm run snapshot:holders`.
//
//   npm run snapshot:holders                 read-only; prints the summary
//   npm run snapshot:holders -- --write      persists the artifact under data/snapshots/
//   npm run snapshot:holders -- --json       machine-readable summary on stdout
//
// WHY THIS EXISTS. The community campaign's whole fairness argument rests on a
// starting snapshot: "determined on-chain against a starting snapshot" means
// nothing if the snapshot was a person reading an explorer once. Until this
// file, the only holder count this project ever took (75 holders, 2026-08-13)
// was done by hand and pasted into a comment in src/mole/eventsData.js. It
// could not be reproduced, re-run, or checked by anyone else.
//
// READ-ONLY BY CONSTRUCTION. This imports nothing that can sign or send. The
// worst a bug here can do is print or write the wrong numbers. --write only
// ever creates a new file; it never overwrites one, because a snapshot that
// can be silently retaken is not a snapshot.
//
// A SNAPSHOT CANNOT BE BACKDATED. getProgramAccounts answers "now" and has no
// as-of-slot rewind, and this repository has no archival indexer (the same
// limitation stated in src/mole/governanceSnapshot.js). The starting point is
// therefore whenever this is run — which is exactly why running it is the act
// that opens a campaign window, and why the slot it records is published.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const WINLEW_MINT = "DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump";
// The WinLEW/SOL Raydium pool's LP mint. Snapshotting THIS is how the campaign's
// liquidity route is measured: holding more LP at the close than at the open is
// exactly "added liquidity and kept it there", with no transaction walking.
const POOL_LP_MINT = "8y5pTux9v3tPYrZXoq6muPo7gaUmfD8bzSBVYJ1uEnm4";
const MINTS = new Map([["winlew", WINLEW_MINT], ["lp", POOL_LP_MINT]]);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// Deliberately NOT under data/ or any directory named snapshots/ — .gitignore
// excludes both, and a snapshot that lives on one laptop is not evidence of
// anything. These are write-once records that must survive this machine, so
// they go somewhere tracked. data/ additionally carries the managed-file pull
// hazard (see A.i-Talks), which is not a thing to park permanent records in.
const OUT_DIR = path.join(ROOT, "docs", "holder-snapshots");

// getProgramAccounts over a whole mint is heavy — far heavier than the 6s the
// site's own RPC helper allows for interactive reads. This is a deliberate,
// occasional, human-run job, so it waits rather than fails.
const RPC_TIMEOUT_MS = 120_000;

// Addresses that are the project rather than a participant. Kept as data, and
// NEVER silently dropped: every account is recorded, each one labelled, and the
// exclusion is a field on the row so anyone auditing the file can disagree with
// a call without having to re-fetch the chain. Sourced from the same constants
// already shown on /transparency/ (src/mole/contributions.js, burnEvents.js,
// communityLiquidity.js) — if those ever change, this map must follow.
const PROJECT_ADDRESSES = new Map([
  ["D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ", "Developer Reserve"],
  ["FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE", "Discord & Web Faucet Reserve"],
  ["EX5nxVKgRKaJVZLfDUinXie6HQ5GPhKwkZ419pRGaZ74", "Burn Wallet"],
  ["GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp", "X Faucet / Governance Vote Fund"],
  ["5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx", "Raydium WinLEW/SOL pool"],
  // Raydium AMM v4's shared vault authority — the on-chain owner of a pool's
  // token vaults. Present so the pool's own reserve is labelled as the pool
  // rather than appearing as the largest anonymous "holder" on the list.
  ["5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j", "Raydium AMM vault authority"],
]);

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

// Purely for readable output — an unknown program is still excluded, just
// printed by its id. Never used to DECIDE anything; the decision is only ever
// "is the owner the System Program or not".
const KNOWN_PROGRAMS = new Map([
  ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "PumpSwap AMM pool"],
  ["LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn", "token lock program"],
  ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "Raydium AMM v4 pool"],
  ["CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", "Raydium CLMM pool"],
  ["FarmqiPv5eAj3j1GMdMCMUGXqPUvmquZtMy86QH6rzhG", "Raydium farm"],
  // An owner that is itself a token account. The largest such holding here
  // (22,069,652.82) was checked directly on 2026-08-17: it is SELF-owned — its
  // authority is its own address, which no keypair controls — so those tokens
  // are stranded rather than held by anyone. Two smaller ones (7,013,300 and
  // 2,003,800) are presumed the same shape but were NOT individually verified.
  // Worth revisiting for CIRCULATING-SUPPLY-AUDIT.md, which counts them as held.
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "token-account-owned (stranded/nested)"],
]);

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const which = String(args.find((a) => !a.startsWith("--")) || "winlew").toLowerCase();
  const mint = MINTS.get(which);
  if (!mint) {
    throw new Error(`Unknown target "${which}". Use one of: ${[...MINTS.keys()].join(", ")}`);
  }
  return { write: flags.has("--write"), json: flags.has("--json"), which, mint };
}

function rpcEndpoints() {
  const seen = new Set();
  return [process.env.SOLANA_RPC, process.env.SOLANA_RPC_FALLBACK, process.env.RPC_URL]
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("http") && !seen.has(u) && seen.add(u));
}

async function withTimeout(promise, label, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_after_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `run(connection)` against each configured endpoint in turn. Mirrors
 * src/mole/solana.js's failover, including its rule: rethrow the LAST error if
 * every endpoint fails, so a total failure can never be mistaken for an empty
 * holder set. An empty result here would silently produce a snapshot in which
 * nobody holds anything — the single worst way this could fail.
 */
async function withRpcFailover(label, run) {
  const endpoints = rpcEndpoints();
  if (!endpoints.length) {
    throw new Error("No RPC configured. Set SOLANA_RPC (or RPC_URL) in .env — the public endpoints rate-limit hard on getProgramAccounts.");
  }
  let lastError = null;
  for (let i = 0; i < endpoints.length; i += 1) {
    try {
      return await withTimeout(run(new Connection(endpoints[i], "confirmed")), label, RPC_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
      // Endpoint identity is never logged — these URLs carry provider tokens.
      console.warn(`[snapshot] ${label} failed on endpoint ${i + 1}/${endpoints.length}: ${error?.message || error}`);
    }
  }
  throw lastError || new Error(`rpc_failed:${label}`);
}

function formatAmount(raw, decimals) {
  const s = String(raw).padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${Number(whole).toLocaleString("en-US")}.${frac}` : Number(whole).toLocaleString("en-US");
}

async function main() {
  const { write, json, which, mint: mintAddress } = parseArgs(process.argv);
  const mint = new PublicKey(mintAddress);

  // The slot is read FIRST and recorded, so the published "as of" figure can
  // only ever be at or before the data — never a slot invented afterwards.
  const slot = await withRpcFailover("getSlot", (conn) => conn.getSlot());
  const takenAtIso = new Date().toISOString();

  const supply = await withRpcFailover("getTokenSupply", (conn) => conn.getTokenSupply(mint));
  const decimals = supply.value.decimals;
  const supplyRaw = BigInt(supply.value.amount);

  // dataSize 165 = an SPL token account; memcmp at offset 0 = its mint. This is
  // the same query behind the 2026-08-13 count of 75 holders / 226 accounts.
  const accounts = await withRpcFailover("getParsedProgramAccounts", (conn) =>
    conn.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mintAddress } }],
    }));

  // WHO OWNS EACH OWNER. A named exclusion list only catches addresses someone
  // thought of in advance, and the first real run proved that insufficient: the
  // largest "holder" of this mint by a wide margin is a PumpSwap pool vault,
  // which no hand-written list contained. So the rule is structural instead —
  // a token account owned by the System Program belongs to a person, and one
  // owned by any other program belongs to that program (a pool, a lock, an
  // escrow, an exchange PDA). This cannot miss a pool nobody remembered.
  const distinctOwners = [...new Set(accounts.map((e) => e.account.data.parsed.info.owner))];
  const ownerProgram = new Map();
  for (let i = 0; i < distinctOwners.length; i += 100) {
    const chunk = distinctOwners.slice(i, i + 100);
    const infos = await withRpcFailover("getMultipleAccounts", (conn) =>
      conn.getMultipleAccountsInfo(chunk.map((a) => new PublicKey(a))));
    infos.forEach((info, n) => {
      // A null account is an owner that holds tokens but has never been funded
      // as an account in its own right. Treated as a person: it is not evidence
      // of a program, and excluding on absence would drop real holders.
      ownerProgram.set(chunk[n], info ? info.owner.toBase58() : SYSTEM_PROGRAM_ID);
    });
  }

  const rows = accounts.map((entry) => {
    const info = entry.account.data.parsed.info;
    const owner = info.owner;
    const program = ownerProgram.get(owner) || SYSTEM_PROGRAM_ID;
    const named = PROJECT_ADDRESSES.get(owner) || PROJECT_ADDRESSES.get(entry.pubkey.toBase58()) || null;
    let programLabel =
      program === SYSTEM_PROGRAM_ID ? null : KNOWN_PROGRAMS.get(program) || `program-controlled (${program})`;
    // "System-owned means a person" is NOT sufficient, and assuming it let the
    // Raydium CPMM pool's own authority into the participant set on 2026-08-18.
    // A program-derived address with no data is ALSO owned by the System
    // Program, so the owner check alone cannot see it. What separates them is
    // the curve: a real wallet's address is a valid ed25519 point because a
    // private key produced it, while a PDA is off-curve by construction —
    // that is the whole reason PDAs exist. No key can ever sign for an
    // off-curve address, so it cannot be a participant.
    if (!programLabel && !PublicKey.isOnCurve(new PublicKey(owner))) {
      programLabel = "off-curve PDA (no key can sign for it)";
    }
    return {
      tokenAccount: entry.pubkey.toBase58(),
      owner,
      ownerProgram: program,
      amountRaw: String(info.tokenAmount.amount),
      label: named || programLabel,
      excluded: Boolean(named || programLabel),
    };
  });

  // THE COMPLETENESS PROOF. Every token account for a mint is enumerable, so
  // the balances must sum to the mint's own supply. If they do not, the
  // enumeration was truncated — and a truncated snapshot silently omits real
  // holders, which is the exact failure this whole exercise exists to prevent.
  // This is a hard stop, not a warning.
  const sumRaw = rows.reduce((acc, r) => acc + BigInt(r.amountRaw), 0n);
  const complete = sumRaw === supplyRaw;

  const holders = rows.filter((r) => BigInt(r.amountRaw) > 0n);
  const owners = new Map();
  for (const r of holders) {
    owners.set(r.owner, (owners.get(r.owner) || 0n) + BigInt(r.amountRaw));
  }
  const ownerLabel = new Map();
  for (const r of rows) if (r.label) ownerLabel.set(r.owner, r.label);
  const participantOwners = [...owners.keys()].filter((o) => !ownerLabel.has(o));

  const artifact = {
    kind: "winlew-holder-snapshot",
    version: 1,
    target: which,
    mint: mintAddress,
    slot,
    takenAtIso,
    decimals,
    supplyRaw: String(supplyRaw),
    sumOfBalancesRaw: String(sumRaw),
    complete,
    counts: {
      tokenAccounts: rows.length,
      emptyAccounts: rows.length - holders.length,
      nonEmptyAccounts: holders.length,
      distinctOwners: owners.size,
      distinctParticipantOwners: participantOwners.length,
    },
    // Sorted by address, not by balance: a canonical order means two people
    // running this independently produce byte-identical files, so the hash is
    // something anyone can reproduce rather than something we assert.
    accounts: rows.sort((a, b) => a.tokenAccount.localeCompare(b.tokenAccount)),
  };

  const body = `${JSON.stringify(artifact, null, 2)}\n`;
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");

  if (json) {
    console.log(JSON.stringify({ ...artifact, accounts: undefined, sha256 }, null, 2));
  } else {
    console.log(`\n${which} snapshot — slot ${slot}  ${takenAtIso}`);
    console.log(`  supply            ${formatAmount(supplyRaw, decimals)}`);
    console.log(`  sum of balances   ${formatAmount(sumRaw, decimals)}`);
    console.log(`  complete          ${complete ? "YES — sum matches supply exactly" : "NO"}`);
    console.log(`  token accounts    ${artifact.counts.tokenAccounts} (${artifact.counts.emptyAccounts} empty)`);
    console.log(`  holders           ${artifact.counts.nonEmptyAccounts} accounts / ${artifact.counts.distinctOwners} owners`);
    console.log(`  of those, people  ${artifact.counts.distinctParticipantOwners} (project addresses excluded)`);
    console.log(`  sha256            ${sha256}`);
    // The exclusion list is only as good as its coverage, and an address that
    // SHOULD be excluded looks exactly like a whale until someone checks. So
    // the largest unlabelled owners are printed every run: if a pool vault,
    // an exchange, or a reserve is hiding in the participant set, it will be
    // sitting at the top of this list rather than buried in a 229-row file.
    const top = [...owners.entries()]
      .filter(([o]) => !ownerLabel.has(o))
      .sort((a, b) => (b[1] > a[1] ? 1 : -1))
      .slice(0, 8);
    if (top.length) {
      console.log("\n  largest UNLABELLED owners — confirm none of these is a pool/reserve:");
      for (const [owner, amount] of top) {
        const pct = Number((amount * 10000n) / supplyRaw) / 100;
        console.log(`    ${formatAmount(amount, decimals).padStart(18)}  ${String(pct).padStart(5)}%  ${owner}`);
      }
    }
    const labelled = [...owners.entries()].filter(([o]) => ownerLabel.has(o));
    if (labelled.length) {
      console.log("\n  excluded as project-owned:");
      for (const [owner, amount] of labelled.sort((a, b) => (b[1] > a[1] ? 1 : -1))) {
        console.log(`    ${formatAmount(amount, decimals).padStart(18)}  ${ownerLabel.get(owner)}`);
      }
    }
  }

  if (!complete) {
    console.error("\nREFUSING TO WRITE: balances do not sum to supply, so the enumeration was incomplete.");
    console.error(`  short by ${formatAmount(supplyRaw - sumRaw, decimals)} — re-run; do not publish this.`);
    process.exit(1);
  }

  if (!write) {
    console.log("\nRead-only. Re-run with --write to persist this as the official snapshot.");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${which}-slot-${slot}.json`);
  if (fs.existsSync(file)) {
    console.error(`\nREFUSING TO OVERWRITE ${path.relative(ROOT, file)} — a snapshot is not something to retake.`);
    process.exit(1);
  }
  fs.writeFileSync(file, body);
  console.log(`\nwrote ${path.relative(ROOT, file)}`);
  console.log("\nPublish the SLOT and the SHA-256, not the file, until you have decided");
  console.log("whether to serve the full balance list. Both are enough for anyone to");
  console.log("re-run this and confirm they got the same thing.");
}

main().catch((error) => {
  console.error(`\nsnapshot failed: ${error?.message || error}`);
  process.exit(1);
});
