# Vanity grind — handoff to the GPU machine

Written 2026-08-07 on the laptop (i7-13620H, 16 cores). Pull this on the GPU box
and continue from here. Everything below was measured on this machine, not
estimated, unless it says "est.".

---

# ▶ Tonight's job (added 2026-08-13) — read this before the rest

**You are the GPU box. Grind `Wen…CUNT`. That is the entire scope.**

Everything below this section is still accurate and was measured, not estimated.
This section exists because the situation around the grind changed after it was
written, and two of those changes matter to you.

## 1. The $CUNT sprint is HALTED — grinding is the exception, not an opening

`docs/cunt/CUNT-MAINNET-GATE.md` records **final human approval: not given**.
Do not create a mint, deploy anything, touch an authority, or mark a gate item
done, whatever the other `docs/cunt/` files describe. They describe a plan that
is deliberately stopped.

Grinding is allowed because it writes a keypair to a local disk and touches no
chain. If the grind succeeds, **bank the key and stop.** Report the public
address here. Nothing else.

## 2. The "same session" rule below cannot be followed, and that is a decision

The security section further down says:

> Grind → create the mint → in the same session. The gap IS the vulnerability.

You cannot do that, because minting is gated and the owner said on 2026-08-08
that $CUNT is **not going live for a few months**. So the key will sit unminted
for an unknown period. Read the rule correctly rather than ignoring it:

**The gap is only exploitable if the key is derivable or leaks.** Profanity was
drained because it seeded from 32 bits of entropy — every address it produced
was brute-forceable, gap or no gap. A key from a from-source grinder using the
system CSPRNG is not guessable, and a months-long gap costs nothing on its own.

What the gap does mean is that **the key is a live secret for that whole period**,
not a scratch file:

- build the grinder **from source** — never a prebuilt binary from a link
- keep it on the **Linux filesystem**, `chmod 600`. `chmod` is a no-op under
  `/mnt/c` (9p/DrvFs reports `555` for `400`) — a key stored there is readable
- **never** commit it, paste it, or put it in `A.i-Talks/`
- never fund it or reuse it — it signs one transaction in its life

If you are not confident the grinder's entropy source is sound, say so and stop.
A key nobody trusts is worse than no key: `WhPApnQQ…aNCUNT` is already banked and
nothing is blocked without `Wen…CUNT`.

## 3. Benchmark before committing to a long run

The ~1.5–3 day GPU estimate below is derived from core count, **not measured**.
Time a short throwaway pattern first and check the rate against it. The
leading-character correction is easy to get wrong in exactly the way that made
the first laptop benchmark 21× too optimistic — the arithmetic is in the
"Expected times" section.

## 4. What to report back

Add a dated file to `A.i-Talks/` with: measured keys/sec, whether the grind was
started, and — if it finished — the **public address only**, plus confirmation
that the pubkey was derived **from the keypair file** rather than read off the
filename, and that the address does not already exist on-chain. Both checks are
described below and both were done for the two already banked.

---

## Goal

A Solana **token mint address** for the community meme token $CUNT.

| Target | Status |
|---|---|
| `…CUNT` (suffix only) | **DONE** — banked |
| `W…CUNT` | **DONE 2026-08-08** — banked, took 24h on CPU |
| `Wen…CUNT` | the real goal — still not feasible on CPU |

## Already banked — do not re-grind either of these

Both are PUBLIC addresses, safe to write down. The keypair files live on the
**laptop** at `~/winlew-vanity/` (ext4, dir 700, files 600) and are NOT in the
repo and must never be.

```
13CrW3Tc2mCxyxYo86qQTcPGUYqrGbYiFF4TpvX3CUNT     …CUNT      44 chars
WhPApnQQXf33cJsfboHAijwQqSmfhLAudeBm4aNCUNT      W…CUNT     43 chars
```

Both verified the same way: pubkey **derived from the file**, not read off the
filename, then pattern-checked case-sensitively. Both confirmed to **not exist
on-chain** — zero lamports, zero transactions — so they are free to mint.

`W…CUNT` took 20.9 billion keys over 24 hours, **1.94× the expected count** —
the unluckiest ~14%. Nothing was wrong; that is just the tail of a geometric
distribution.

> **The 43-character length is the leading-character theory confirming itself.**
> `W` can only be the first character of a 43-digit pubkey, which is exactly why
> it carries a 17× penalty. A prefix in the `2`–`H` range would have found the
> same shape of address in roughly 40 minutes instead of 24 hours.

**Do not copy the keypair files to another machine unless you intend to mint
from there.** See the timing note at the bottom — moving a mint key around early
only widens the window.

## The numbers that matter

Measured on the laptop: **~253,000 keys/sec** across 15.5 of 16 cores.

**Base58 leading-character bias is the thing that makes this hard.** Solana
pubkeys are 32 bytes, and base58 length boundaries mean the first character is
NOT uniform:

| Leading char | Probability | vs uniform |
|---|---|---|
| `2`–`H` | 1 in 17 | 3.4× **more** common |
| `J` | 1 in 70 | ~uniform |
| `K`–`z` (includes **`W`**) | 1 in 982 | **17× rarer** |

So `W…CUNT` is not 58⁵. It is 58⁴ ÷ P(W) = **11.1 billion** expected keys.
And `Wen…CUNT` is 58⁶ ÷ P(W) = **37.4 trillion**.

> Lesson for any future vanity work: a prefix starting `2`–`H` is ~17× cheaper
> than one starting `K`–`z`. `W` is an expensive letter.

## Expected times

| Target | Laptop CPU (253k/s) | GTX 1660 (est. 150–300M/s) |
|---|---|---|
| `W…CUNT` | **took 24h — done** | ~1 minute |
| `Wen…CUNT` | **4.6 years** | **~1.5–3 days** |

The GPU is ~800× the laptop. `W…CUNT` cost a full day of pegged CPU here and
would have been a coffee break on the GPU — which is the whole argument for
doing `Wen…CUNT` there and not attempting it on a CPU at all.

**Benchmark before committing to a long run.** The 1660 figure is estimated from
core count and generation, not measured. Method used on the laptop: grind a short
throwaway pattern with a KNOWN expected count and time it, e.g.
`--starts-with abc:20`. Careful — `a` is in the rare group, so expected attempts
for that is 20 × 58³ ÷ (1/982), not 20 × 58³. Getting this wrong is what made the
first laptop benchmark 21× too low.

## Setup on this machine

```bash
# Solana CLI (installs to $HOME, no sudo)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana-keygen --version     # expect 4.1.1 or newer
```

`solana-keygen grind` is **CPU only** — it will not use the GPU. For `Wen…CUNT`
you need a CUDA vanity grinder, built from source (see security note).

**The only thing left to grind is `Wen…CUNT`.** The other two are done; if the
GPU work never happens, `WhPApnQQ…aNCUNT` is a perfectly good mint address and
nothing is blocked.

For reference, the CPU command that has been running:

```bash
solana-keygen grind --starts-and-ends-with W:CUNT:1 --num-threads 16
```

Flags confirmed present in 4.1.1: `--starts-with`, `--ends-with`,
`--starts-and-ends-with`, `--ignore-case`, `--num-threads`.

**`--ignore-case` is a trap here.** It matches any casing, so a hit looks like
`wEnB2q…CuNt`. Only 1 in 128 such hits reads as `Wen…CUNT`. It makes the search
~2,000× cheaper and usually gives you something you don't want.

## Things that will NOT help

- **More RAM.** The grind uses **3 MB**. Not 3 GB. It is pure compute — buying
  RAM changes the finish time by zero seconds.
- **More CPU cores.** Even 10 machines like the laptop is 168 days for
  `Wen…CUNT`. Only the GPU changes the class of problem.
- **VRAM size.** 6 GB is far more than enough; memory is not the constraint.

## Security — the one thing to get right

A GPU vanity grinder is third-party code generating a key you will use. In 2022
the Ethereum tool **Profanity** seeded from only 32 bits of entropy; every
address it ever produced was brute-forceable and ~$3.3M was drained.

This case is **less exposed** than that, for a specific reason: a *mint* keypair
only makes the address exist. Mint authority and freeze authority are separate
pubkeys chosen at creation — they are not the mint keypair. So a leaked mint key
cannot mint or freeze anything.

The real risk is **address squatting** in the window between generating the key
and creating the mint. If someone can derive the key in that gap, they create the
mint first and the address is theirs.

So:

1. **Build the grinder from source.** Do not run a prebuilt binary from a chat link.
2. **Grind → create the mint → in the same session.** The gap IS the
   vulnerability. Do not grind in September and mint in October.
3. **Never reuse the mint keypair for anything else.** Do not fund it, do not
   make it a wallet. It signs one transaction in its life.
4. `chmod 600` the keypair — and note **chmod does nothing under `/mnt/c`**
   (9p/DrvFs; `chmod 400` reports `555`). Keep keys on the Linux filesystem.

## Token decisions already made (2026-08-07)

Do not re-litigate these on the other machine:

- **Supply 1B**, split `100M team (10%) / 800M community (80%) / 100M
  protocol-locked (10%)`. The locked 100M is **community/protocol-owned, a
  permanent floor** — its lock beneficiary must NOT be a team wallet, because
  "10% team / 90% community" depends on that being verifiable on-chain.
- **Enforcement: Streamflow / Jupiter Lock**, not a custom Solana program. The
  project already runs both for $WinLEW.
- **Trigger: time-based.** Belly → Crawl → Run → Final Tuesday are names for
  dates, not conditions.
- Revoke mint authority at creation.
- The token is on **Solana**, not Base. The Base original (`0x555c…0804`) is
  retired; the page states that history rather than hiding it.

## Where the rest of the context lives

- Full plan: `~/.claude/plans/silly-singing-lerdorf.md` on the laptop (not in git)
- `/cunt/future/` page: `src/public/cunt/future/` — `noindex`, and `/cunt/` is a
  guard stub redirecting to `/no-thank-you/`. Live but unlisted on purpose; see
  `src/cunt/PAGE-NOTES.md` for the four things holding that up.
- Bot scaffold: `src/cunt/commands.js` — `CUNT_MINT` is `null` until minted;
  set it there and the Discord disclaimer updates itself
- Airdrop list: **155 payable** (`npm run airdrop:clean` to re-verify) — cleaned
  to 148 on 2026-08-07, then +7 registrations recovered from the old PC on
  2026-08-08
