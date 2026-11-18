# Vanity Grinder Audit (§3, §4)

Audited 2026-08-08 by running the tool and observing it, not by reading about
it.

---

## 1. The premise correction

§3 says *"Audit all existing vanity-generator code before modifying it"* and §4
says *"Preserve working grinder functionality. Do not rewrite functioning
software simply for style."*

**There is no such code, and that is the best possible finding.**

Searching the repository for `grind`/`vanity` returns four hits, all unrelated
English (`// vanity domains printed beside them`, `// grind — the last 25
points`, `missing perms / vanity URL`). Both banked keys were produced by
**Anza's `solana-keygen`**.

This matters because of the failure §23 alludes to. In 2022 the Ethereum vanity
tool **Profanity** seeded from 32 bits of entropy; every address it ever
produced was brute-forceable and roughly **$3.3M was drained**. That happened
*because* a project used a custom generator.

Using the official CLI is the mitigation, not a gap. **We should not write a
key generator, and this audit recommends never doing so.**

## 2. The twelve §3 questions

Answered empirically — a throwaway grind was run and observed, then destroyed.

| # | Question | Answer |
|---|---|---|
| 1 | Implementation | `solana-keygen 4.1.1 (client:Agave)` — Anza's official CLI |
| 2 | CPU or GPU | **CPU only.** It will not use a GPU under any flag. |
| 3 | Keys/sec | **~253,000** measured, 15.5 of 16 cores (laptop i7-13620H) |
| 4 | Matching | `--starts-with P:N`, `--ends-with S:N`, `--starts-and-ends-with P:S:N` |
| 5 | Case | **Case-sensitive by default.** `--ignore-case` relaxes it — see §5. |
| 6 | Threads | `--num-threads N`, defaults to core count |
| 7 | Results | Writes `<pubkey>.json` into the **current working directory**, mode **`600`** — the tool sets restrictive permissions itself |
| 8 | Keys in logs | **No.** Output is only `Wrote keypair to <pubkey>.json`. The secret never reaches stdout. |
| 9 | Secrets committed | **No.** Verified: no keypair material in git, and `.gitignore` covers the filename shape |
| 10 | Network | **None.** No SSL/TLS libraries linked; the binary needs no network and the search is pure local compute |
| 11 | Safe to stop | **Yes.** SIGTERM ends it cleanly. There is no partial state to corrupt — an unfinished search has produced nothing, and a finished one has already written its file. |
| 12 | Re-derivation | **Yes, and we do it.** `solana-keygen pubkey <file>` derives the address from the key material rather than trusting the filename |

### On question 7 — the filename is the danger

`solana-keygen grind` names its output after the **pubkey it found**. So a live
mint private key lands in the tree as an ordinary-looking file like
`WhPApnQQ…aNCUNT.json`, matching no generic secret pattern.

This is why `.gitignore` ignores the **directory** rather than a filename shape,
and why `src/scripts/scan-secrets.js` carries a rule specifically for
`<base58>.json`. A generic secret scanner would not catch it.

### On question 12 — never trust the filename

Both banked keys were verified by deriving the pubkey **from the file**:

```
13CrW3Tc2mCxyxYo86qQTcPGUYqrGbYiFF4TpvX3CUNT   ✓ filename verified   44 chars
WhPApnQQXf33cJsfboHAijwQqSmfhLAudeBm4aNCUNT    ✓ filename verified   43 chars
```

`npm run vanity -- results` does this check every time. A filename is metadata;
a mismatch would mean the file had been swapped.

## 3. Secret storage — a deliberate deviation from §3

§3 proposes:

```
vanity/
    public/   addresses.json, benchmarks.json, jobs.json
    secrets/  [keypair files]
```

**We do not put secrets in `vanity/secrets/`, and should not.**

This repository sits on `/mnt/c` — WSL's **v9fs** mount — where **`chmod` is a
no-op**. `chmod 600` reports `777`. An in-repo secrets directory would be
world-readable while *appearing* protected, which is worse than an obviously
unprotected one.

Keys therefore live at **`~/winlew-vanity/`** on the Linux filesystem, where
`700`/`600` are real, and **outside the repository entirely** — so no
`.gitignore` mistake can expose them. This satisfies §3's separation
requirement more strongly than the layout it proposes.

Verified: directory `700`, files `600`, and neither address appears anywhere
under `src/public/`.

## 4. The estimator — §4's real requirement

> §4: *"Expected time MUST be described probabilistically. Never imply '13 hours
> means it will finish within 13 hours.'"*

`npm run vanity -- estimate --prefix wen --suffix CUNT`

```
  leading char   'w' occurs 1 in 999 pubkeys  (59.0x rarer than the best case)
  search space   1 in 38,042,681,545,262
  measured rate  253,000 keys/sec

  EXPECTED TIME  4.8 years   (mean)
  MEDIAN         3.3 years   (50/50 point)

    by  0.5x expected (2.4 years )  ############··················  39.3%
    by    1x expected (4.8 years )  ###################···········  63.2%
    by    2x expected (9.5 years )  ##########################····  86.5%
    by    3x expected (14.3 years)  #############################·  95.0%
    by    5x expected (23.8 years)  ##############################  99.3%
```

**Reaching the "expected" time means a 37% chance of still searching.** The
median is only 0.69× the mean, and the tail never closes.

### Memorylessness

A grind is a geometric process. Keys already searched buy **no** progress
toward the next hit — `vanity status` says so explicitly, because "it's been
running 20 hours, it must be due" is the intuition that needs killing.

## 5. The base58 leading-character bias

The single most important technical fact, and the one an early estimate in this
project got **21× wrong** by assuming P(first char) = 1/58.

A pubkey is 32 random bytes, which base58-encode to **43 or 44 characters**
depending on magnitude. The two length classes reach *different* first
characters, so the leading character is wildly non-uniform:

| Leading character | Frequency | vs uniform (1/58) |
|---|---|---|
| `2`–`H` | 1 in **17** | 3.4× **more** common |
| `J` | ~1 in 70 | about uniform |
| `K`–`z` (includes `W`, `w`) | 1 in **999** | **17× rarer** |

Computed exactly with BigInt in `src/cunt/vanityEstimate.js` — the distribution
sums to `1.000000000` — not approximated.

**`W` can only ever lead a 43-character pubkey.** The banked
`WhPApnQQ…aNCUNT` is 43 characters. That is the arithmetic confirming itself
against a real key.

> **Lesson for any future vanity work:** a prefix starting `2`–`H` is roughly
> **59× cheaper** than one starting `K`–`z`, for the same length. `W` and `w`
> are expensive letters, and they cost the same as each other.

### Validated against a search that actually happened

| | |
|---|---|
| `W…CUNT` expected | **11,308,763,836** keys |
| Actually took | **20,900,000,000** keys, 24 hours |
| Ratio | **1.85× expected** |
| P(still running at that point) | **15.8%** |

Unlucky, not broken. A test pins this agreement, so a change to the model that
stopped reproducing the real search would fail the build.

## 6. The tooling

`npm run vanity -- <command>` — a **wrapper**, not a grinder.

| Command | Behaviour |
|---|---|
| `estimate` | the probabilistic output above |
| `start` | **refuses without `--confirm`** (§4), prints the estimate first, detaches so it survives the terminal closing, logs to `~/winlew-vanity/grind.log` |
| `status` | elapsed, keys searched, multiple of expected, and P(a search this long) |
| `stop` | SIGTERM; any keypair already written is kept |
| `results` | public addresses only, each **re-derived** from its file |

It never reads, prints or copies key material.

## 7. What remains

**`Wen…CUNT` / `wen…CUNT` is the only outstanding search** — the other two
identities are banked. At 253,000 keys/sec it is a **4.8-year** expected search;
on a GPU grinder it is days.

Owner decision 2026-08-08: **accept either case**, running both concurrently to
roughly halve wall-clock time.

Nothing is blocked by it. If the GPU work never happens,
`WhPApnQQ…aNCUNT` is a perfectly good mint address.

### If a GPU grinder is used

`solana-keygen` is CPU-only, so `Wen…CUNT` needs third-party CUDA software —
which reintroduces exactly the risk §1 avoided.

1. **Build from source.** Never run a prebuilt binary from a chat link.
2. **Benchmark before committing to a long run**, and remember the leading-char
   bias when choosing the benchmark pattern — that is what made the first
   estimate 21× too low.
3. **Grind → create the mint in the same session.** The gap between generating
   a key and using it is the squat window.
4. Keys on ext4, never `/mnt/c`.
