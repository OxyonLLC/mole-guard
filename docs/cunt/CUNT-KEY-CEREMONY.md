# Key Ceremony (§18, §50, §59)

**Status: NOT PERFORMED.** No key exists. This is the procedure, not a record.

Four secrets, three devices, one afternoon. Everything here is verifiable by a
tool that never sees a private key: `npm run cunt:multisig-verify`.

---

## 0. The rule the whole ceremony exists to protect

> **Each key is generated ON the device that will hold it. Never all on one
> machine, even temporarily.**

A 2-of-3 whose three keys were born in one process, on one laptop, in one
sitting has never once existed as a 2-of-3. For the length of that window it
was a 1-of-1, and the window is the part attackers care about.

This is also why **nobody generates these for you** — not a script, not an
agent, not GeoWallet. A hardware wallet creates its seed *inside the device*
and never exports it. If a phrase is generated elsewhere and typed in, the
device's only real property has been thrown away before it was used once.

`src/scripts/cunt-multisig-verify.js` is enforced read-only by a test: it may
not reference `Keypair.generate`, `secretKey`, `sendTransaction` or
`createMultisig`. It cannot create your keys even by accident.

## 1. What you are making

| # | Key | Where it is generated | Kept |
|---|---|---|---|
| 1 | **Signer A** | on the hardware wallet | forever |
| 2 | **Signer B** | on a second, separate device | forever |
| 3 | **Signer C** | third device, or `solana-keygen new` on an offline machine | forever |
| 4 | **Hot wallet** | anywhere; trivial balance | rotatable |

Plus three keypairs that are **created and then irrelevant** — the mint, the
multisig account, and the treasury token account. Their private keys stop being
able to authorise anything the moment the account is initialised, which is why
vanity addresses are safe *there* and nowhere else.

**Three phrases, not six.** The same three signers serve both the SPL native
multisig and the general-purpose one. With `independent_signers: 0`, separate
signer sets buy nothing against the real threat.

### The shortcut that ruins it

**Do not derive the three signers from one seed phrase at different derivation
paths.** The addresses look unrelated on-chain, which is exactly what makes it
feel safe. One phrase compromised is all three keys, and the on-chain evidence
will never tell you they were related.

GeoWallet's `wallet-core` is single-seed by design (`m/44'/501'/0'/0'`) — the
right architecture for a user wallet, the wrong one for a 2-of-3. Its crypto is
sound (`@scure/bip39`, `@noble/curves`, key material zeroed after use); it is
the *shape* that doesn't fit, not the quality.

## 1a. The declared plan (2026-08-09)

Dry-run through `plan` **before any key exists**, which is the only cheap time
to find out an arrangement is wrong.

| | Key lives as | Location | Seed touches a network? |
|---|---|---|---|
| **A** | **Ledger 1** + steel phrase | home | no |
| **B** | **Ledger 2** + steel phrase | daughter's house | no |
| **C** | **steel phrase only** — Ledger 3 generates it, then the device is wiped | **bank deposit box** | no |

Owner inventory: this PC, the serving PC, a child's gaming PC, ~6 phones, and
**three Ledgers**.

### Three Ledgers replaced the phone plan, and solved "I can't generate offline"

A Ledger generates its seed **inside the secure element and never exports it**.
That *is* offline generation — it removes the need for the live-USB workaround
entirely. All three seeds have `online: false`, where the phone plan had two
exposed.

### The two locations that didn't work

The first attempt was **home + the home safe + daughter's house**, and it failed
the matrix outright:

```
  "safe" destroyed or breached      lost 2   left 1   sign? NO   stolen? YES
```

**Two locations cannot hold three keys when the threshold is 2.** Whichever
place holds two both hands a burglar the threshold and takes recovery if lost.
That's arithmetic, not a preference — the bank box is what resolves it.

Worth knowing why the safe wasn't enough on its own: **steel handles fire,
separation handles theft.** A steel plate survives a house fire regardless —
fires peak around 1100 °C and steel goes well past that — so a safe buys
burglary resistance, not fire protection, and only if it's bolted down.

### The tradeoff being accepted

Three Ledgers means **one vendor, one firmware, one update channel** — the same
concentration that ruled out two phones running the same wallet app.

It can't be engineered away: at a threshold of 2, *any* vendor holding two
devices has the threshold, so avoiding it would need three different vendors.
The trade is taken deliberately, because a Ledger secure-element break has not
happened in the wild while phone wallets are drained routinely.

The free mitigation is applied: **C is phrase-only with its device wiped**, so
it has no firmware and no update channel at all. A remote software compromise
therefore cannot reach all three keys.

And a Ledger-generated seed is **BIP39** — the phrase is vendor-neutral even
though the device is not. If Ledger ships bad firmware or disappears, any
standard wallet restores it.

Owner inventory: this PC, the serving PC, a child's gaming PC, ~6 phones.

**Device count was never the constraint.** The first arrangement built from that
list — three keys, three devices, all at home, phones on one cloud account —
measured **3 keys at one location and two single points of failure**. The same
three keys, moved apart, measure clean. Nothing about the keys changed.

Excluded, and why:

| Machine | Reason |
|---|---|
| This PC | dev machine, and `/mnt/c` is v9fs where `chmod` is a no-op |
| The serving PC | `$hard_rule` — it runs the bots |
| The gaming PC | mods, trainers, installers: the highest-malware-exposure machine in a household |

The recovery phrases are keys too: **each phrase stays at its own device's
location**, never pooled in one drawer at home. Pooled, one breach exposes all
three; separated, any one location costs exactly one key, which a 2-of-3
survives.

> The rejected phone plan is kept in the manifest (`$cloud_backup_warning`)
> because its lesson outlives it: **six phones behind one Apple ID are one key.**
> A shared-cloud breach loses *zero* keys and still hands over the threshold —
> compromise takes **either** copy while loss needs **both**.

## 1b. How the chain knows these are the signers

Verified on a local validator, not described from memory. `InitializeMultisig`
writes the signer **public keys into the multisig account itself**:

```
multisig account : GcZSQ…4jtk        owned by: SPL Token program
size on chain    : 355 bytes
  m (threshold)  : 2
  n (signers)    : 3
  signer slots   :
     1  CriuQ1bGbS8q8s7VcJpZgTfWakuh8NtnPpuGDKzP11tM   <-- A
     2  3nGHpD9bMFeQj8cwdzjyApfWd3E7THaDnA4SVxvMVNL2   <-- B
     3  EebgVevAnfsrDJiTV6TreoSoa1gz8xWrHa8UGwsiDkX6   <-- C
     4  11111111111111111111111111111111   (empty)
     …  eight more empty slots
```

On every instruction the Token program reads that stored list, counts how many
of the transaction's signers appear in it, and rejects below `m` with
`MissingRequiredSignature`.

**The chain knows three public keys and a number.** It knows nothing about
Ledgers, safes, bank boxes or people — every placement decision in this document
is off-chain policy that the chain cannot enforce.

### The signer list can never be changed

Also proven, by trying it. Swapping one key by re-initializing the multisig:

```
Program log: Error: account or token already in use
Program ...failed: custom program error: 0x6
```

There is no add-signer, remove-signer or replace-signer instruction. **Rotating
a signer means creating a new multisig and transferring every authority to it.**

That is why §4's possession check is a *precondition*, not a formality: a public
key that can't sign becomes a **permanent dead slot**, and a 2-of-3 with a dead
slot is a 2-of-2 with no recovery.

## 1c. One Ledger, two addresses — record the derivation path

Found on the first real signer, and it would have quietly ruined the set.

The same physical Ledger showed:

| Tool | Address |
|---|---|
| **Ledger Live** ("Solana 1") | `C9FQVuWxxpiiecCkeC58n2cE9dX33rgoh6HQcFbk171x` |
| **Phantom** ("Ledger 1") | `C5seVdzeSGDsRueJZ5jiUS2qSx4YaBvtCGnesjXSG4P2` |

Neither app is wrong. They derive Solana differently:

```
Ledger Live   m/44'/501'/0'      →  usb://ledger?key=0
Phantom       m/44'/501'/0'/0'   →  usb://ledger?key=0/0
```

Both are genuine keys from the same seed, both recoverable from the same 24
words. **An address without its derivation path is ambiguous** — and "signer A"
meaning two different addresses depending on which app happened to be open is
exactly how a dead slot gets committed to a set that can never be changed.

So `derivation_path` is recorded next to `address` for every signer, and a test
refuses an address that arrives without one.

**Which to pick:** prefer the address the **device itself displays**. Not
aesthetics — recovery. In a disaster you will be restoring from steel and
confirming against the hardware, not against a browser extension. Both paths
are signable from the CLI, so the choice is free; recording it is not.

Confirm the mapping on your own device rather than trusting the table:

```powershell
solana-keygen pubkey "usb://ledger?key=0"
solana-keygen pubkey "usb://ledger?key=0/0"
```

### This is what the possession check is for

The signing page **refused to sign** because the connected account did not match
the expected signer. Without that refusal it would have produced a completely
valid signature — proving possession of a key that was not going into the
multisig. The check earned its place on its first real use.

## 1d. Signer C — the steel is the key, so the steel must be tested

A and B keep working devices. C does not: Ledger 3 generates the seed, the words
go to steel, the device is wiped. That is deliberate — it gives one key with no
firmware and no update channel, so a Ledger software problem cannot reach all
three.

It also means **the steel plate is the only copy in existence.** Get a word
wrong and wipe the device and the key is gone — and you would not find out until
you needed it, which is the day you are already having a bad time.

### Generated on a phone, not on Ledger 3

Ledger 3 **has funds on it** and must not be wiped for this. C is generated
instead in Phantom on an **Android phone that has never run a crypto wallet**.

That is a better answer than it looks. The phone is a *generator*, not the key —
it gets wiped afterwards and the steel goes to the bank box. And it means A and
B came off Ledger firmware while C came off an entirely different stack, so a
Ledger problem at generation time cannot have touched all three.

### The steel is verified by reading FROM it

1. Generate the seed in Phantom on the clean phone. Note the address it shows.
2. Write the 24 words to steel.
3. On Windows, type the words **from the plate** — not from the phone:
   ```powershell
   solana-keygen pubkey "prompt://?key=0/0"
   ```
   It must derive the address from step 1.
4. Sign the challenge with the same URI:
   ```powershell
   solana sign-offchain-message -k "prompt://?key=0/0" "<challenge>"
   ```
5. Wipe Phantom from the phone. The steel goes to the bank box.

**Steps 3 and 4 are one act, and that is the point.** Signing in Phantom would
prove the *phone* holds a key — it proves nothing about the plate, and the plate
is the only copy that will exist. Reading from the steel tests the artifact that
actually matters.

`prompt://` reads the phrase interactively and writes nothing to disk. The
tradeoff, stated rather than hidden: the phrase passes through the Windows
machine once. The alternative leaves the plate unverified, which is worse for a
key whose only copy *is* the plate.

**Watch the path.** Phantom derives `m/44'/501'/0'/0'` — that is
`prompt://?key=0/0`, not `?key=0`. It is the same trap that gave signer A two
different addresses. If `?key=0/0` does not match, try `?key=0`, and record
whichever one does.

Step 5 is also what sets `last_recovery_test` in the manifest — which is why
`plan` exits non-zero until it happens. §59: *a backup that has never been
restored is a hope.*

> Signing with C afterwards means a trip to the bank and restoring the phrase
> onto a device. That inconvenience is a feature: C exists for the day a
> laptop is gone, not for routine use. A and B are the working pair.

## 2. Before you touch a device

Decide where each key will live, and write it down as a **blast radius, not a
room**:

> If two spots burn in one fire, or fall to one burglary, they are **one
> location**. "home-office" and "home-safe" are one location. Call them both
> `home`.

The tool warns when two location names share a leading token, because that is
precisely how this gets written down wrong — and a setup that only fails once
you notice the two names mean one house is the setup most likely to be believed.

## 3. The ceremony

**One device at a time. Finish each before starting the next.**

1. Generate the key on the device. Record only the **public** address.
2. Write the recovery phrase on the medium it will live on. Not a photo, not a
   password manager, not a note-to-self.
3. Move to the next device. Do not have two phrases visible at once.

Then, from the repo:

```bash
npm run cunt:multisig-verify -- check <A> <B> <C>
```

This checks each address structurally and against the whole repository. What it
catches that a human reading three base58 strings will not:

| Check | Why it exists |
|---|---|
| **Off-curve** | An off-curve address is a **PDA with no private key**. It can never sign. A 2-of-3 containing one is really a **2-of-2 with no recovery** — and everything looks fine until the day you need the third key. |
| **Near-duplicate** | Two addresses differing by one character are one address and a typo. Base58 drops `0 O I l` to prevent this; people still transpose. |
| **Reuse** | A `git grep` of every candidate across the repo. This is what caught `FtYVF55…` sitting in `src/faucet/faucet_claims.json` as a faucet claimant. |
| **Round-trip** | A leading `1` is a literal `0x00` byte, and base58 routed through a BigInt silently drops it, producing a *different* address. |
| **m = n** | A 2-of-2 has no recovery. That failure is worse than the theft it prevents. |
| **Vanity** | A ground address is a software keyfile. It cannot live on a hardware wallet, which is the entire point of a signer key. |

## 4. Prove each device can actually sign

The step almost everyone skips, and the reason ceremonies end holding a key
nobody can use — discovered later, when it matters.

```bash
npm run cunt:multisig-verify -- challenge <ADDRESS>
# sign the printed message on that device (Phantom: Settings → Sign Message,
# or `solana sign-offchain-message`)
npm run cunt:multisig-verify -- possession <ADDRESS> --nonce <N> --signature <SIG>
```

The nonce binds the signature to *this* ceremony, so a signature captured
anywhere else cannot be replayed in. Set `possession_proven: true` in the
manifest only after this passes — **an address written down is not a key you
can use.**

## 5. Measure the arrangement, not just the keys

```bash
npm run cunt:multisig-verify -- plan
```

Fill in `device`, `location`, `backup_location` and `online` for each signer
first. The tool then answers **two different questions**, which is the part
that is usually collapsed into one:

- **Loss** — the place burns down. A key survives only if its backup is
  somewhere else (**AND**). Recovery needs `m` survivors.
- **Compromise** — the place is breached. A key is exposed if **either** its
  device or its backup is there (**OR**). Theft needs `m` exposures.

> **Every backup you add makes loss less likely and theft more likely.**

They are not the same arithmetic, and a setup can pass one while failing the
other. Worked example — three keys, three devices, three location names, which
reads as a textbook 2-of-3:

```
  A  ledger-nano-x   home-office   backup: home-safe
  B  ledger-nano-s   home-safe
  C  paper           bank-vault

  MOST KEYS AT ONE LOCATION            2

  scenario                              lost  left  sign?  stolen?
  "home-safe" destroyed or breached      1     2    yes    YES
```

Signing survives. **Theft does not** — A's backup and B's device are both in
the safe, so one burglary reaches the threshold of 2. And `home-office` and
`home-safe` are one building anyway, which the tool flags separately.

The headline measurement:

> **`MOST KEYS AT ONE LOCATION` ≥ `threshold` means you have a 1-of-1.**

## 6. Test recovery before anything is funded

§59, and `$recovery_test_rule` in the manifest:

> Restore each backup onto a clean device and confirm it derives the expected
> public key — **before** the treasury is funded, and again every **180 days**.

`plan` fails while `last_recovery_test` is null and warns once it is over 180
days old. **A backup that has never been restored is a hope.**

## 7. Then, and only then

1. Create the SPL multisig — mechanism already proven (`CUNT-MULTISIG-DESIGN.md` §4).
2. Create the treasury token account **at `13Cr…CUNT`**, `owner` = the multisig.
3. Discard the mint, multisig-account and treasury-account keypairs.
4. Publish the arrangement per §19 — including the disclosure that this is
   **key-security, not governance**: three keys, one holder, `independent_signers: 0`.

Steps 1–3 are **mainnet actions and remain behind the §61 approval gate.** The
ceremony in §3–6 creates keys and signs nothing on-chain; it can be done at any
time, and until it is, `multisig_tested` stays `partial`.

## 8. What never happens

- No key is generated on the serving machine, or on `/mnt/c` — **v9fs, where
  `chmod` is a no-op** and a file reporting `600` is really `777`. This is why
  the banked vanity keys live in `~/winlew-vanity/`.
- No WinLEW key is reused. Branding linkage is free and reversible; key linkage
  is permanent and takes both treasuries with one compromise.
- No signer public key is committed to this repo. A test asserts it, and proves
  its own detection works first so it cannot pass by being vacuous.
