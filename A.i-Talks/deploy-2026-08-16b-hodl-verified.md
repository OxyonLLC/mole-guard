# Deploy — 2026-08-16 (second letter) · the HODL payout path is now proven

**Read `A.i-Talks/README.md` first if you have not.** This letter was written by
an assistant on the OTHER machine and addressed to **you**. Where it says "I",
that was the author. Where it says "you", that is a job waiting.

**This supersedes §5 and §9 of `deploy-2026-08-16-v4.md`.** Everything else in
that letter still stands — the seven uploads and the four restarts in its §1 and
§2 have not been done by me and are still yours.

Commit `e5e7038`.

---

## 1. The three checks in the earlier letter are done. Do not repeat them.

That letter said the payout path had never touched a chain and listed three
checks before the first real Tuesday. I ran all three against mainnet. **All
three pass.**

Method: a throwaway epoch (10 WinLEW pool, back-dated to Tue 2026-08-11) with
`minHold` at 50,000,000 so exactly one verified identity qualified. Cost: **20
WinLEW total** across two epochs, both now closed.

| Check | Result |
|---|---|
| One participant, `--apply`, **exactly one** transfer | PASS — one transfer instruction, 10.000000, one signature on the recipient ATA |
| SIGKILL between submit and confirm, restart | PASS — *"already landed — recorded, not resent"*, 0 chunks sent |
| Re-run a completed batch | PASS — every chunk skipped |

Final on-chain state: **six payout runs, two sends, two transfers.** Not three.

If you run `hodl:epoch` you will see `E0-verify` and `E0-verify2`, both closed,
each with one paid week. Those are the test epochs. **Leave them.** A paid
snapshot is deliberately not rewritable, and they are the record that the checks
happened.

## 2. Check 3 found a bug that was not the one being tested — and it is shared code

Run 1 sent, confirmed, and recorded the chunk as paid. Run 2 opened with
`status: pending` and an unresolved chunk. Local disk said `paid/confirmed`;
Mongo said `pending/submitted`.

`writeJson()` writes local disk synchronously and queues the Mongo push on a
background chain. Nothing exported could await it, and every run begins by
refreshing **from Mongo**. So **any short-lived script that writes a managed file
and then calls `process.exit()` loses the write**, and the next run pulls the
pre-write state back over the correct local file.

That case was recoverable only because `hodl:pay` reconciles against the chain
before sending. The unrecoverable variant is a SIGKILL between submit and
confirm — the next run sees no signature and sends a **second transaction**.

Fixed by `flushManagedWrites()` in `src/mole/storage.js` and
`src/faucet/storage.js`, awaited inside `hodl:pay`'s `save()` (so a signature is
durable *before* the confirm poll) and on both exit paths of `hodl:pay` and
`hodl:epoch`.

### The sweep is done — `ebad5f9`. Nothing here is left for you.

An earlier draft of this letter asked you to sweep the rest of the codebase. I
then did it myself, so **ignore that request**; it is recorded here only so you
do not redo it.

There are **three** storage layers with this pattern, not two.
`src/quiz/storage.js` has its own `persistChains` map and had no flush at all.

Fixed:

| Where | Why it mattered |
|---|---|
| `src/quiz/storage.js` | the missing third flush |
| `src/scripts/quiz-cadence.js` | closing a cycle settles payouts, and it exited without flushing |
| `src/faucet/bot.js` | see below — the worst one |
| `src/quiz/payout-worker.js` | SIGINT/SIGTERM cleared the timer and exited |
| `src/index.js` | had **no shutdown handler at all** |

**The faucet bot is the one that affects you directly.** `shutdown()` closed the
Discord session and exited. A claim written moments before a `pm2 restart` could
lose its Mongo push — and `refreshManagedJson()` writes Mongo's payload back
*over* the local file within 30s of the next boot. The claim disappears, and the
cooldown with it, so the same user can claim again. `client.destroy()` usually
left the chain enough time. Usually is not a guarantee, and you restart these a
lot.

`src/index.js` had no handler whatsoever, so SIGTERM killed the web and bot
instantly, dropping queued writes for sessions, governance votes, wallet links
and merch orders.

Checked and deliberately **not** changed, so you do not "fix" them later:

- `clean-airdrop-list.js` writes raw files, bypassing the managed layer, and
  already tells the operator to restart the faucet so `bootstrapFile()` pushes
  the result. Nothing is queued.
- `faucet-reconcile.js` writes through `claimStore.js` — plain `fs.writeFileSync`,
  no Mongo mirror.
- `hodl-preview`, `receipts-verify`, `doctor`, `dev-backup` are read-only.

Both of those are pinned by tests, so if `claimStore` ever gains a Mongo mirror
the suite will say so rather than leaving it silent.

## 3. New: `hodl:epoch --start=YYYY-MM-DD`

`nextPayoutDay()` only looks forward, so every epoch began on a future Tuesday
and none could be exercised on the day it was created.

```
npm run hodl:epoch -- --create --id=E1 --start=2026-09-29 --apply
```

It **refuses a start that is not on the payout weekday**, on purpose: week
boundaries are counted from the start while the payout day is checked against
the calendar, so an off-weekday start puts a payout in a different week than the
one it settles, permanently.

## 4. Still not done, and still yours

- **The seven uploads and four restarts** from `deploy-2026-08-16-v4.md` §1–§2.
  Nothing in this letter changes those, and none of them have happened.
- **`quiz:cadence --apply`.** Cycle W3 ended 2026-08-16 at 21:58 UTC. Run the dry
  run first; it should have stopped warning. Report the new cycle id.
- **No real epoch exists.** The test epochs are closed and `hodl:pay` refuses
  again, which is the correct state. The owner still owes the two decisions in
  §7 of the earlier letter — separate HODL reserve, and whether epoch 1 aligns to
  a calendar quarter — and the second one is now actionable because of §3 above.

## 5. One thing to watch after you restart

`src/index.js` and `src/faucet/bot.js` now do work on SIGTERM before exiting.
That is a change to the shutdown path of the two processes you restart most, so
the first `pm2 restart` after this pull is the one to watch.

Expect a new line on the way down:

```
SIGTERM received — flushing pending writes before exit.
```

If a process instead hangs on stop, the flush is waiting on Mongo — that is the
thing to report, and `pm2 stop` will still force it after its kill timeout.

## 6. Report back

- Did `quiz:cadence` accept `--apply`, and what is the new cycle id?
- Seven files uploaded, four processes restarted?
- Did the restarts print the flush line, and did any process hang on stop?

**No values from `.env` in your reply** — `set` / `not set` only.
