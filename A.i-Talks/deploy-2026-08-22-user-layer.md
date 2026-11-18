# Deploy 2026-08-22 — USER > ACCOUNT(S) > WALLET

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

Supersedes the model described in `deploy-2026-08-20-identity-rules.md`. That
file said "one person, one account, many wallets". The owner corrected it on
2026-08-22, in these words:

> "Someone can LINK AS MANY WALLETS TO AN ACCOUNT AS POSSIBLE, the difference is
> only ONE OF THOSE WALLETS CAN RECIEVE A PAYOUT … USER > ACCOUNT(S) > WALLET"

An account is a **door**, not a person. A person may hold several.

Its uploads and its `.env` decisions still stand where they were never done —
this document does not cancel them, it only replaces the model.

---

## Are you the machine this is for?

This document asks for a restart and for wallet-record surgery. Both belong to
the machine that SERVES winlew.co and runs the bots. Check before acting:

```bash
pm2 list                      # the winlew processes run here?
git remote -v                 # LewSales/mole-gaurd
curl -s https://winlew.co/verify/api-proxy.php?path=/api/price/status | head -c 120
```

If the processes are not yours, stop at step 2 (the uploads are not yours
either) and leave the rest for whoever runs them.

---

## WHERE you are

One commit, pushed to `main`:

```
a54b1ed  fix(identity): an account is a door, not a person — USER > ACCOUNT(S) > WALLET
```

22 files, +1725 / −67. New: `src/mole/userAccounts.js`, `src/mole/accountMerge.js`,
`src/scripts/identity.js`, `docs/identity-user-account-wallet.md`, two test files.

**Read `docs/identity-user-account-wallet.md` before touching anything identity-
shaped.** It is the model, with the table of which store resolves through the
user layer and why each one has to.

---

## What was broken, in the owner's own report

1. **"ALREADY LINKED."** Syncing X onto their Discord account was refused, with
   nothing they could do about it.
2. **Two of their wallets claimed inside 24 hours** — "one is linked to my
   Discord and one is linked to my X". Two accounts, two cooldowns, one person.
3. **Five wallets they had linked showed as one.** The other four are still on
   the record; their 91-day verification had lapsed and nothing said so.

All three are the same root cause: `accountId` was treated as the person.

## What changed

* **"Already linked" now MERGES.** Proving both doors in one request — a live
  session plus a completed OAuth round trip, or plus a signature from a wallet
  already verified on the other account — joins the two accounts. It removes a
  claim slot rather than creating one, so the anti-sybil argument is unchanged.
* **The faucet cooldown checks every account the person holds**, not just the
  one the claim arrived through. This is the fix for the double claim.
* **Bans check every door too.** Merging must never be a way to shed a ban.
* **Governance dedupes votes at the user level.**
* **`/verify/` has a new card, "Which wallet gets paid"** — every verified wallet
  listed, one selected, changeable. The route existed since 2026-08-20; nothing
  in the UI had ever called it.
* **The wallet list now says which verifications are current** and which have
  lapsed, with the sentence that tells somebody what to do about it.
* Fixed on the way past: `saveProfilePrefs()` blanked display name, bio and
  avatar whenever it was called without them — which the wallet-connect path
  does on every connect.

`npm test` on the development machine: **1998 pass, 1 fail**. The failure is
`test/quiz/db-platform-stats.test.cjs` — "a real db.json must have existed" —
and it fails there because that checkout has no `src/quiz/db.json`. Confirmed
against a clean stash, so it predates this work. **Expect it to PASS on your
machine**; if it fails there too, that is a separate problem worth reporting.

---

## You must do

### 1. Snapshot the runtime data dirs FIRST, then pull

This has bitten before (`git pull` on the serving machine has destroyed
runtime-written registrations). The new store is `account_merges.json` and it
decides who is one person.

```bash
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
git log --oneline -1        # expect a54b1ed (or later)
npm test
```

### 2. Upload the changed static files

```
src/public/assets/nav.js
src/public/verify/profile.js
src/public/verify/profile.html
```

**Order does not matter here**, and that is deliberate: the new page calls
`/api/wallet/payout`, and an old backend answers 404, which the page treats as
"hide this card" rather than as an error. Uploading before the restart is safe;
so is after.

Prove the upload landed:

```bash
curl -s https://winlew.co/verify/profile.js | grep -c "renderPayoutWallet"
# 0 -> the old file is still up
# >0 -> the new one is live
```

### 3. Restart the Node app

Nothing above is in effect until it does. Until then the merge paths do not
exist, and "already linked" is still a dead end.

Prove the restart took:

```bash
curl -s "https://winlew.co/verify/api-proxy.php?path=/api/account/providers"
```

* running TODAY'S code → the JSON contains an `"identity"` object with
  `"model":"user>accounts>wallets"`
* running OLD code → no `identity` key at all, only `providers`

That endpoint needs no session, so this check is one command and needs nothing
from the owner.

### 4. Join the owner's own accounts

They have (at least) a Discord-rooted account and an X-rooted account, with
wallets on both. Two ways, either is fine:

* **They do it themselves** — sign in, go to `/verify/`, press Sync on the other
  provider. It merges now instead of refusing. **This is the better path**: it
  needs no ids from anybody and it proves itself, because the merge only happens
  if both doors authenticate.
* **You do it** — on the SERVING machine, where the live data is:

```bash
npm run identity -- show <their discord id>      # look first
npm run identity -- show <one of their wallets>  # a wallet works as the lookup too
npm run identity -- merge <idA> <idB>
npm run identity -- list                         # what is merged, after
```

`show` before `merge`, **always**. Merging two people who are not the same
person gives one of them the other's wallets and payout address. `unmerge` puts
the alias back but cannot un-fold the wallet records — this layer cannot know
which address came from which side.

The surviving id is the highest-ranked one: **Discord snowflake > x: > wallet:**.
That is not arbitrary — the bot, the faucet's claim keys and the linked-role
metadata all speak snowflakes, so keeping it means those stores keep resolving
without a rewrite.

### 5. Tell them about the lapsed wallets

Their older wallets are still linked and still theirs, but their 91-day
verification expired, so they do not count toward balances and cannot be chosen
for payouts. **One signature each on `/verify/` brings them back.** Nothing was
lost and nothing needs re-linking from scratch.

Do **not** try to fix this by marking old wallets verified in the store. That
invents evidence, and the narrow migration in `walletLink.js` avoids it on
purpose — a real signature costs one click and produces a real timestamp.

---

## What to watch afterwards

In the Discord site log:

* **`accounts_merged` (🧩)** — every merge, with which account survived, how many
  wallets the person ended up with, and which one gets paid. A burst of these
  against ONE account with DIFFERENT wallets is the shape of an attack, not of a
  person; the same warning already applies to `wallet_joined_account`.
* **`identity_sync_refused` (🚫)** — should become rare. It now means the merge
  itself could not be completed, not that the person hit a wall by design. If
  this keeps firing after the restart, something is wrong with the merge path
  and it is worth reporting back rather than telling people to try again.

## Report back with

1. `git log --oneline -1` on the serving machine.
2. `npm test` totals (and whether the quiz db.json test passed there).
3. The `identity.model` value from the `/api/account/providers` curl.
4. Whether the profile.js upload check returned 0 or more.
5. If you merged anything by hand: the output of `npm run identity -- list`.
