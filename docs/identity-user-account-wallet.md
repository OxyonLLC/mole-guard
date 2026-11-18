# USER > ACCOUNT(S) > WALLET

The identity model, as of 2026-08-22.

```
USER            the person
 ├── ACCOUNT    a door they signed in through — Discord login, X login,
 │              or a wallet-rooted account minted before either was attached
 ├── ACCOUNT    (as many as they can prove)
 │
 └── WALLETS    every address they have signed with — as many as they like
      └── ONE of them receives payouts
```

Two sentences carry the whole thing:

* **A person may link as many wallets as they want.** Balances, eligibility and
  holdings are summed across every wallet whose verification is current.
* **Exactly one wallet receives money.** They choose which, on `/verify/`; the
  default is the most recently verified one.

## What was wrong before

`accountId` was the top of the tree. The account WAS the person. Two failures
followed from that one mistake, both reported from the live site:

1. **"ALREADY LINKED", with no way forward.** Syncing X to the Discord account
   was refused, because that X login already rooted an account of its own. The
   refusal was right about the fact and wrong about the conclusion — somebody
   who can authenticate both sides is one person holding two doors.
2. **Two claims inside one 24-hour cooldown.** The faucet checks every wallet
   the same person has verified, but "the same person" meant "the same account".
   The wallet on the Discord account and the wallet on the X account never saw
   each other, so both claimed.

## How they became one person

`src/mole/userAccounts.js` holds an alias map, absorbed → canonical:

```json
{ "x:9f2c8a1b": "248525967377694720", "wallet:1a4b7c9d": "248525967377694720" }
```

`resolveAccountId()` follows it; `listAccountIdsForUser()` sweeps it. Everything
that used to ask about an account now asks about the user.

The surviving id is the highest-ranked one — **Discord snowflake > X > wallet**
(`accountRank()`). A snowflake wins because it is the id the rest of the
codebase already speaks: the bot, the faucet's claim keys, the linked-role
metadata. Keeping it means those stores keep resolving without a rewrite.

### Merging is automatic, and it is proof-driven

A merge happens when somebody proves both doors in one request:

| Path | Proof held | Where |
|---|---|---|
| Discord OAuth sync | live session + completed Discord round trip | `web.js` discord callback |
| X OAuth sync | live session + completed X round trip | `web.js` x-oauth callback |
| Wallet connect | live session on a **proven** account + signature from a wallet already verified elsewhere | `web.js` `/api/hub/wallet-login` |

`src/scripts/identity.js` (`npm run identity`) does it by hand for support cases
and for accounts split before this layer existed.

`GET /api/account/providers` reports the model publicly (`identity.model`,
`identity.mergesOnProvedIdentity`), so a client can word its sync button as
"link it" rather than "this may be refused" — and so a deploy can be checked
with one unauthenticated curl.

**A merge never mints an identity — it removes one.** Two accounts that could
each claim once become one account that claims once. The direction the
anti-sybil rules care about is splitting, and nothing here splits.

### Order of operations: alias first, data second

The alias is what every read resolves through, so a crash after step one leaves
a user who is correctly one person with their records still in two places —
which `readUserRecord()` and `listLinkedProfiles()` assemble on the fly anyway.
A crash the other way round would leave two accounts each holding everything,
and one of those lists writes cheques.

## What resolves through the user layer

| Store / check | File | Why it must |
|---|---|---|
| Sessions | `sessions.js` | the single lever — dozens of routes read `s.discordUserId` |
| Wallet records | `walletLink.js` | one record per user, one payout wallet |
| Synced identities | `syncedIdentities.js` | `canBePaid()` must stay true through a merge |
| Profile prefs | `profilePrefs.js` | a profile must not empty itself on merge |
| Faucet cooldown | `faucet/eligibility.js` | **the double-claim fix** — every door is checked |
| Governance votes | `governanceStore.js` | one vote per person, not per door |
| Account bans | `faucet/userBans.js` | a ban must not be sheddable by merging |
| Payout gate | `services/payoutGate.js` | same, on the batch path |
| HODL participant list | `walletLink.js` `listLinkedProfiles()` | two rows for one person is two payouts |

The last three are the security-relevant ones. **Merging must never be a way to
shed a ban**, so every account id behind a person is checked and any one of them
being banned refuses the payment.

## Verified vs. known wallets

`wallet_history` holds every address a person ever linked. `verified_wallets`
holds the ones whose 91-day proof has not lapsed, each with its own clock. Only
the second set counts for balances, eligibility and payouts.

Lapsed wallets are **not** retroactively re-verified by a merge or a migration —
their proof is old, and inventing a timestamp would be inventing evidence.
Re-signing with the wallet costs one signature and produces a real one. Both the
profile page and `npm run identity -- show` now say which of the two a wallet is,
because a person with five wallets who is credited for one otherwise concludes
the site lost the other four.

## Undoing a merge

`npm run identity -- unmerge <absorbedId>` removes the alias. It cannot un-fold
the wallet records — this layer cannot know which address came from which side —
so those are moved or re-verified by hand. Look with `show` before you `merge`.
