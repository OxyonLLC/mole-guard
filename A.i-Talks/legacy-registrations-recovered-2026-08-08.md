# Wallets recovered from the old PC's registration list (2026-08-08)

`src/faucet/_legacy/other pc/` was about to be deleted as dead weight. Before
deleting it, its `airdrops.json` was diffed against the current list — and it
held **157 wallets to the current 148**, with 13 present only in the legacy
copy.

**Seven of those 13 are valid Solana addresses that appear nowhere in the
current `airdrops.json` or `registrations.json`, are not project wallets, and
are not banned.** They are registrations made on the old machine that never
made it across. The folder has since been deleted; this file is the only
surviving record, which is why it exists.

## The seven

Checked on-chain 2026-08-08.

| Address | Exists | SOL | WinLEW | Last activity |
|---|---|---|---|---|
| `6hLxFtyEAmYeMJgsCGvHLu2KC8EuzyD17wbQB4gYpdHd` | yes | 0.2754 | **11,081,698.392365** | 2026-07-22 |
| `2yupCJfQKvDzUKoD2nXC5nYGGWG8aibjL5jpQZteJqSA` | yes | 0.0072 | 0 | 2026-08-08 |
| `HLF1yDgG8Re3rzGEN7MfqzVvqyvPDFmuAMbcjTaiU3k4` | yes | 0.0060 | 0 | 2026-08-06 |
| `5r7QPeKCpGQ294LpVcpEymSrJ21WJsfSdBrLPaSt3buE` | yes | 0.0015 | 0 | 2025-10-10 |
| `4paH4rL8g1rexK3eL6WY2ZTi1zhtUEkZSBYjaxJrhzMg` | no account | 0 | 0 | 2026-03-07 |
| `ET6tTHup5gAsFeTYxXBA72cSX6Cpyvk9o2qCYSmLDuiX` | no account | 0 | 0 | 2025-11-02 |
| `J2zpRTrJgmuZYV6SaW2Atoy2oPG5zsT5W7mHiFsSAvyM` | no account | 0 | 0 | **never** |

`6hLxFty…pdHd` is the one that matters. An 11M-token holder, active three
weeks ago, silently excluded from every airdrop the current list would drive.
Three others are live wallets, two of them used within the last two days.

`J2zpRTr…AvyM` has never appeared on-chain at all — almost certainly a
mistyped address, and it should NOT be paid.

## The other six (correctly absent — do not re-add)

| Entry | Why it is not in the current list |
|---|---|
| `GFxz42bib3o6kxmPgK95fMtBxRk16yaTvt5UBwC7EhAp` | X Faucet Reserve — project wallet |
| `D6d5byBxBcddovgQ2UPUMpPDpJukjyC7C4Hcg3v4FRkZ` | Developer Reserve — project wallet |
| `lewsales.sol` | an SNS name, not an address |
| `<HLF1yDgG8Re3rzGEN7MfqzVvqyvPDFmuAMbcjTaiU3k4>` | the angle brackets were pasted in — duplicate of the bare form above |
| `635373yry383i3y3y3i3u3u` | not a valid address |
| `!save` | someone typed the command name into the wallet field |

That last pair is a good argument for the input validation the current
`!register` path has and the old one did not.

## Decision taken — all seven were added (2026-08-08)

Owner's call: *"lets ensure those wallets are not skipped."* All seven were
appended to both `airdrops.json` and `registrations.json`, taking each list
from 148 to **155**. `npm run airdrop:clean` re-validated afterwards: 155 → 155
payable, both files agree, no project-owned address, no ban, no duplicate.

`J2zpRTr…AvyM` was included despite never appearing on-chain. **Solana
addresses carry no checksum**, so a mistyped address and a freshly generated
wallet that has never received anything are indistinguishable — there is no
test that separates them. Excluding it would have risked skipping a real
person, which is the exact failure being corrected here. The cost of being
wrong is one ATA rent (0.00203928 SOL) and the tokens sent to it.

## Original analysis — why this was a judgement call

These were **not** added automatically at first. Paying an airdrop
is money leaving the treasury, and this list mixes a major holder with a
never-seen address and two dead accounts. Options, per wallet:

1. **Add `6hLxFty…pdHd`** — the strongest case by far. A real holder with a
   real balance who registered and was lost in a machine migration.
2. **Add the three other live wallets** (`2yupCJf…`, `HLF1yDgG…`,
   `5r7QPeK…`) — they registered too; holding zero WinLEW is not
   disqualifying, since the whole point of an airdrop is reaching people who
   registered.
3. **Skip the three dead/never-seen ones** — `J2zpRTr…` in particular should
   never be paid.

If any are added, re-run `npm run airdrop:clean` afterwards to re-validate,
and remember the count in `test/mole/airdropListHygiene.test.mjs` and the
deploy runbook both reference **148**.

## How this was found

`git status` showed `src/faucet/_legacy/other pc/` as untracked. Since it was
untracked there was no git copy to recover from, so the contents were read
before deleting rather than after — four files, 56K, no secrets. The
`airdrops.json` inside it was the only thing carrying unique data.
