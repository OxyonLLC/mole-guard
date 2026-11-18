# Deploy 2026-08-30 — faucet payout hardening + two fixture records deleted

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

---

## Are you the machine this is for?

This asks for a restart and concerns the LIVE identity store. It belongs to the
machine that SERVES winlew.co and runs the bots.

```bash
pm2 list                      # the winlew processes run here?
git remote -v                 # LewSales/mole-gaurd
```

If that is not you, stop here.

---

## Already done, by the dev machine, directly to Mongo

Two fixture records were **deleted** from `mole_linked_wallets` (the managed
`linked_wallets.json` store) on 2026-08-30:

| account id | wallet it held |
|---|---|
| `111` | `D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz` — a **real user's** wallet |
| `222` | `AX7cMx4GMxwNt72ZqztYh9zqkZspvdxgVAmTBYcHNVhk` — no claims |

Both were test fixtures (`source: "migrated-single-wallet"`, identical
`verified_at`), with no entries in `account_merges`, no faucet claims and no
locks. `111` was the damaging one: it held a real user's wallet as its
`verified` **and** payout address, so `findLinkedProfileByWallet()` attributed
that wallet to an account that cannot exist. All 21 claims on it belong to
`478228146139693085`.

Done with a targeted `$unset` on `payload.111` / `payload.222` so no other
record was rewritten. Verified: the three real accounts are untouched, and the
wallet now resolves to `478228146139693085`.

## You must do — 1. Restart, or the deletion comes back

**This is the part that matters.** `src/mole/storage.js` caches managed files
in-process at boot. Your running web/bot processes still hold a boot-time copy
of `linked_wallets.json` that **still contains `111` and `222`**. The next time
anything writes that store — someone running `/mole link`, for instance —
`queuePersist()` pushes that whole cached payload back to Mongo and the two
fixtures **reappear**.

```bash
pm2 restart all               # or at minimum the mole/web process
```

`bootstrapManagedFile()` prefers Mongo's payload when one exists, so a restart
adopts the cleaned data and rewrites the local mirror. Until you restart, treat
every `/mole link` as able to undo this.

The faucet itself is fine either way — `src/faucet/eligibility.js` already calls
`refreshManagedFile('linked_wallets.json')` on its own checks.

Confirm afterwards:

```bash
npm run faucet:trace -- D8oJSdqoYk6heQsf36217mDm3Yf95umjnXaJiLYA5ZEz --no-chain
# USER should read 478228146139693085, NOT 111
```

## You must do — 2. Nothing yet for the code

The faucet hardening described below is **still uncommitted on the dev
machine**. Do not go looking for it in `git pull` — it is not there yet. This
section is here so you know what is coming and why a later pull changes payout
behaviour.

- `findDuplicatePaidClaim()` — a second, independent check immediately before
  the treasury moves, in BOTH payout paths. Blocks a repeat payout inside a
  cooldown even when the reservation lock is missing.
- `releaseReservationAdministratively()` now **refuses** to release a claim that
  carries a signature, unless called with `{ force: true }` (only
  `npm run faucet:reconcile` does). Expect more claims to sit in a kept-cooldown
  state needing `faucet:reconcile` rather than silently freeing themselves.
- A `requestId` replay is now scoped to the calling account. Previously,
  presenting somebody else's requestId returned THEIR claim and its transaction
  signature — and the Discord adapter uses the public `message.id` as that key.

## Rollback

The pre-deletion snapshot of the whole `linked_wallets` document is on the dev
machine. Both deleted records are also reproduced in full in the session
transcript. To restore, re-add the two keys under `payload` on the `_id:
"global"` document in `mole_linked_wallets` — but do not, unless the owner asks:
`111` holding a live user's wallet is the bug, not the state to return to.
