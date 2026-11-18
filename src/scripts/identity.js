#!/usr/bin/env node
// Look at, and repair, the USER > ACCOUNT(S) > WALLET tree — `npm run identity`.
//
//   npm run identity -- show <accountId|wallet>    who is this, and what do they hold
//   npm run identity -- merge <idA> <idB>          these two accounts are one person
//   npm run identity -- unmerge <absorbedId>       undo one merge
//   npm run identity -- list                       every merge on record
//
// WHY A SCRIPT EXISTS AT ALL. The site merges accounts by itself whenever
// somebody proves both doors — an OAuth round trip, or a signature from a wallet
// that is already verified elsewhere. That covers everyone who can still sign
// in. It does not cover the accounts that were already split before the USER
// layer existed and whose owner cannot conveniently re-authenticate each half,
// and it does not cover support: "my two logins are two accounts, join them".
//
// MERGE IS NOT FREE OF CONSEQUENCE, so read `show` for BOTH ids first. Joining
// two people who are not the same person gives one of them the other's wallets
// and their payout address. There is an `unmerge`, and it puts the alias back
// but cannot un-fold the wallet records — so the order is look, then merge.
//
// RUN IT WHERE THE DATA IS. Same rule as every other tool here: the serving
// machine holds the live stores (and Mongo). Merging on a dev checkout merges
// a stale copy and the result is overwritten or, worse, pushed back out.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(ROOT, ".env") });
process.chdir(path.join(ROOT, "src"));

const { resolveAccountId, listAccountIdsForUser, listMerges, unlinkAccount, accountRank } =
  await import("../mole/userAccounts.js");
const { mergeAccounts } = await import("../mole/accountMerge.js");
const { getLinkedWalletRecord, listVerifiedWallets, getPayoutWallet, findLinkedProfileByWallet } =
  await import("../mole/walletLink.js");
const { listSyncedIdentities, canBePaid } = await import("../mole/syncedIdentities.js");

const [command, ...args] = process.argv.slice(2);

function fmtTs(seconds) {
  const n = Number(seconds || 0);
  return n > 0 ? new Date(n * 1000).toISOString().slice(0, 16).replace("T", " ") : "—";
}

/** Accept either an account id or a wallet address, because the person asking
 *  for help usually has the address in front of them, not the id. */
function asAccountId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (listAccountIdsForUser(raw).length > 1 || resolveAccountId(raw) !== raw) return resolveAccountId(raw);
  const byWallet = findLinkedProfileByWallet(raw);
  return byWallet?.discordUserId || raw;
}

function show(input) {
  const accountId = asAccountId(input);
  if (!accountId) return usage("show needs an account id or a wallet address");

  const userId = resolveAccountId(accountId);
  const accounts = listAccountIdsForUser(userId);
  const record = getLinkedWalletRecord(userId);
  const verified = listVerifiedWallets(record);
  const payout = getPayoutWallet(record);
  const history = Array.isArray(record?.wallet_history) ? record.wallet_history : [];

  console.log(`\nUSER    ${userId}${userId !== String(input).trim() ? `   (asked about ${String(input).trim()})` : ""}`);
  console.log(`        payable: ${canBePaid(userId) ? "yes" : "NO — no social identity synced"}`);

  console.log(`\nACCOUNTS (${accounts.length})`);
  for (const id of accounts) {
    console.log(`  ${id === userId ? "*" : " "} ${id}${id === userId ? "  (survivor)" : "  (merged in)"}`);
  }

  const identities = listSyncedIdentities(userId);
  console.log(`\nIDENTITIES (${identities.length})`);
  if (!identities.length) console.log("    none synced");
  for (const entry of identities) {
    console.log(`    ${entry.provider}${entry.handle ? ` @${entry.handle}` : ""}`);
  }

  console.log(`\nWALLETS — ${verified.length} verified, ${history.length} known`);
  for (const entry of verified) {
    const mark = entry.wallet === payout ? "PAID" : "    ";
    console.log(`  ${mark}  ${entry.wallet}   verified ${fmtTs(entry.verified_at)}  expires ${fmtTs(entry.expires_at)}`);
  }
  for (const address of history) {
    if (verified.some((entry) => entry.wallet === address)) continue;
    console.log(`        ${address}   known, verification lapsed — re-sign to re-verify`);
  }
  console.log(`\nPAYOUT  ${payout || "— none (verify a wallet)"}\n`);
}

function merge(a, b) {
  if (!a || !b) return usage("merge needs two account ids");
  const left = asAccountId(a);
  const right = asAccountId(b);
  if (resolveAccountId(left) === resolveAccountId(right)) {
    console.log(`Already one user: ${resolveAccountId(left)}`);
    return;
  }
  console.log(`Merging  ${left}  +  ${right}`);
  console.log(`Survivor will be the higher-ranked id (discord ${accountRank(left)} vs ${accountRank(right)}).`);
  const result = mergeAccounts({ a: left, b: right, reason: "admin-cli" });
  console.log(`\n✅ user ${result.userId}, absorbed ${result.absorbed || "—"}`);
  console.log(`   ${result.wallets.verifiedCount} verified wallet(s), payout -> ${result.wallets.payoutWallet || "none"}`);
  show(result.userId);
}

function unmerge(id) {
  if (!id) return usage("unmerge needs the absorbed account id");
  const removed = unlinkAccount(String(id).trim());
  console.log(removed
    ? `✅ ${id} is its own account again. Its wallets stayed on the record they were folded into — move or re-verify them by hand.`
    : `Nothing to undo: ${id} is not recorded as merged into anything.`);
}

function list() {
  const merges = listMerges();
  const rows = Object.entries(merges);
  if (!rows.length) return console.log("No accounts have been merged.");
  console.log(`${rows.length} merge(s):`);
  for (const [absorbed, into] of rows) console.log(`  ${absorbed}  ->  ${into}`);
}

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.log(`Usage:
  npm run identity -- show <accountId|wallet>
  npm run identity -- merge <idA> <idB>
  npm run identity -- unmerge <absorbedId>
  npm run identity -- list`);
  process.exitCode = message ? 1 : 0;
}

switch (command) {
  case "show": show(args[0]); break;
  case "merge": merge(args[0], args[1]); break;
  case "unmerge": unmerge(args[0]); break;
  case "list": list(); break;
  default: usage(command ? `Unknown command: ${command}` : "");
}
