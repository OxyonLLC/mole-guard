# Restore Drill — signers A and B (§59)

**Written 2026-08-13.** The one FAIL standing between the current state and
creating the multisig. Allow an hour, and do it with the plates physically in
front of you.

```
$ npm run cunt:multisig-verify plan

RECOVERY
  FAIL  A  plate NEVER restored
  FAIL  B  plate NEVER restored
  PASS  C  restored 5 days ago
```

## Why now, and not after

**The multisig account does not exist yet.** That is the entire reason this is
worth an evening.

There is no add-signer, remove-signer or replace-signer instruction — proven by
trying it (`Error: account or token already in use`). Once the multisig is
created the signer list is frozen for its lifetime, and a key that turns out not
to be recoverable becomes a **permanent dead slot**: a 2-of-3 with a dead slot is
a 2-of-2 with no recovery.

So a plate that fails tonight costs a rewrite. The same plate failing after the
treasury is funded costs the treasury. Nothing about the drill changes; only the
price of a bad result does.

**This is also the safest possible moment to test.** Unlike C — whose plate is
the only copy that will exist — A and B still have working Ledgers. You are
checking a spare while holding the original.

## What the drill proves, and what it does not

It proves the **words on the steel** derive the address recorded for that signer.
That is all, and it is the thing nobody has checked.

It does **not** re-prove possession — that was done at the ceremony and is
recorded as `possession_proof`. Signing from the Ledger would prove the *Ledger*
holds the key and say nothing about the plate. Reading from the steel tests the
artifact that matters, which is the same reasoning C's verification used.

---

## Before you start

- [ ] Both steel plates in hand. **B's lives at `daughters-house`** — collect it
      first or do B on a separate trip. Do not do this half-remembered.
- [ ] A machine with `solana-keygen` (`solana-keygen --version`; tested against
      4.1.1).
- [ ] Nobody reading over your shoulder, no camera in the room, no screen share.

**There is a second prompt.** After the 24 words, `solana-keygen` asks for an
optional BIP39 passphrase:

> *If this seed phrase has an associated passphrase, enter it now. Otherwise,
> press ENTER to continue.*

Press **Enter** unless you set one at the ceremony. None is recorded, so you
almost certainly did not. This is flagged because meeting an unexpected prompt
mid-drill, with a steel plate in hand, is how people start improvising.

**The tradeoff, stated rather than hidden:** the phrase passes through this
computer once. `prompt://` reads it interactively and writes nothing to disk, but
it is in that machine's memory for the duration. The ceremony accepted this for C
for the same reason it applies here — the alternative is an unverified plate, and
an unverified plate is worse.

Prefer a machine that does not hold funds. Close other applications. Clear the
terminal scrollback afterwards.

**Never:**

- type the words into a browser, a wallet extension, a note app, or a chat
- photograph the plate — not "just to check a word later"
- read the words off the Ledger, off a photo, or off an old sheet. **Off the
  steel, or the drill proves nothing.**
- commit anything from this drill. No file in this repo ever holds a word.

---

## Get the expected addresses

Do not work from an address written down somewhere. Print them from the manifest,
which is the only place they live:

```bash
node -e "for (const s of require('./cunt-project.json').multisig.signers) \
  console.log(s.id, s.address, s.derivation_path, s.keypair_uri)"
```

That is deliberate rather than fussy. A signer address can change — the failure
branch at the bottom of this file describes exactly when — and an address copied
into a runbook would keep showing the old one long after the manifest moved on.
A test (`test/cunt/multisigVerify.test.mjs`) enforces that these addresses appear
in the manifest and nowhere else, which is why this file prints them instead of
repeating them.

## Signer A — `ledger-1`, plate at `home`

Type the 24 words **from the plate** when prompted:

```bash
solana-keygen pubkey "prompt://?key=0"
```

It must print exactly the address the manifest lists for `A`.

> **Use `?key=0`, not `?key=0/0`.** A and B were generated on Ledger and their
> recorded `derivation_path` is `m/44'/501'/0'` — the Ledger Live path. C is the
> odd one out at `m/44'/501'/0'/0'` because it came from Phantom.
>
> This is the trap that once made one physical Ledger show two different
> addresses, and it is the most likely reason a good plate looks bad tonight. If
> `?key=0` does not match, **try `?key=0/0` before concluding anything** — a
> match there means the plate is fine and the recorded path is wrong, which is a
> manifest correction, not a key problem.
>
> Demonstrated on 2026-08-13 with the public BIP39 test vector
> (`abandon abandon … about`), so the size of the trap is not theoretical:
>
> ```
> prompt://?key=0     ->  GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL
> prompt://?key=0/0   ->  HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk
> ```
>
> Same phrase, two entirely valid, entirely different Solana addresses. Neither
> is "wrong". A plate that derives the wrong one of these looks exactly like a
> plate with a misread word, which is why the path is checked first.

## Signer B — `ledger-2`, plate at `daughters-house`

```bash
solana-keygen pubkey "prompt://?key=0"
```

Must match the manifest's address for `B`. Same path, same trap, same rule.

---

## If it matches

Record it. The tool reads **`plate_restored`** per signer — not the
project-level `last_recovery_test`, which is a different field and setting it
will not clear the FAIL.

In `cunt-project.json`, on that signer's entry:

```json
"plate_restored": "2026-08-13"
```

Then:

```bash
npm run cunt:multisig-verify plan
```

All three lines should read PASS. Re-test every 180 days — the tool warns past
that, per signer, because one fresh date must never read as three.

## If it does not match

Work through it in this order, and **do not record anything**:

1. **Try `?key=0/0`.** If that matches, the plate is good and the manifest's
   `derivation_path` for that signer is wrong. Fix the manifest, record the
   restore, done.
2. **Re-read the plate.** Character confusion in stamped steel is ordinary —
   check the words that differ only in their first four letters, and confirm the
   word order.
3. **If it still does not match, the plate is wrong**, and you have found it at
   the only time it is cheap.

A wrong plate cannot be repaired from the Ledger — a Ledger will not reveal its
seed. The two real options:

- **Re-write from the original recovery sheet**, if one exists, then re-run this
  drill against it.
- **Re-initialize that Ledger with a fresh seed**, write a new plate, verify it
  here, and update that signer's `address`, `possession_proof` and
  `plate_restored` in the manifest. Cheap now; impossible once the multisig
  exists.

**Check whether that Ledger holds funds before wiping it.** Ledger 3 does, which
is why C was generated on a phone instead. Do not repeat that discovery on a
funded device.

Either way: **stop and re-run the ceremony's possession check** for the new
address before it goes anywhere near a multisig. A public key that cannot sign is
the permanent dead slot this whole file exists to prevent.

---

## One thing the drill will not tell you

A's plate is stored at `home` and A's Ledger is at `home`. B's plate is at
`daughters-house` and so is B's Ledger. One fire takes both copies of that
signer.

That is survivable by design — 2-of-3 across three locations means losing one
location loses one signer, and `plan` reports PASS on exactly that scenario. It
is worth knowing rather than discovering: the plates are protection against
device failure and mistakes, **not** against losing the building.

## After both pass

The recovery gate is clear and creating the multisig becomes the next step. That
is a **mainnet action** and remains gated on the owner's explicit approval —
`docs/cunt/CUNT-MAINNET-GATE.md` §61 records final human approval as not given,
and creating the account is only worth doing when the treasury it protects is
close behind it.
