# Dependency Review (§57)

Reviewed 2026-08-08. Closes the second HIGH in `CUNT-SECURITY-MODEL.md`.

**Result (npm's tree): 26 advisories → 11**, high **12 → 4**, remainder accepted
in writing and gate-enforced.

> **⚠ Read §6 first.** That headline describes the tree **npm** installs. This
> project declares **yarn** as its package manager, and the two lockfiles resolve
> materially different trees. The first pass of this review measured and fixed
> the wrong one.

---

## 1. The finding that matters

> **`npm audit fix --force` would break this project while reporting a security
> improvement.**

For the Solana and Bonfida packages there is no forward fix, so npm offers the
newest version *without* the advisory — which is an ancient one:

| Package | Installed | npm's "fix" | |
|---|---|---|---|
| `@solana/spl-token` | 0.4.14 | **0.1.8** | downgrade |
| `@solana/web3.js` | 1.98.4 | **0.0.3** | downgrade |
| `@bonfida/spl-name-service` | 3.0.16 | **0.1.25** | downgrade |
| `node-cron` | 3.0.3 | 4.6.0 | genuine upgrade |

npm labels all four `isSemVerMajor`, which reads as "a big but legitimate
upgrade". Three of them are the opposite. Running `--force` here would take
`@solana/web3.js` from 1.98.4 to **0.0.3** and destroy every chain interaction
in the project.

This is exactly what §57 means by *"do not blindly upgrade during
security-sensitive work"*, and it is the single most important thing in this
document.

## 2. What was fixed

### Removed: `axios` — an unused direct dependency carrying a high advisory

Imported **nowhere** in our source (verified excluding vendored bundles, which
we do not build), and required by nothing else — it sat directly under the root
in `npm ls`. It carried a high advisory (NO_PROXY hostname normalisation
bypass).

§57 asks us to avoid unnecessary dependencies. This is the cleanest possible
form of that: an advisory removed by deleting a package nobody used.

### Applied: non-breaking patches

`npm audit fix` **without `--force`**, so only in-range updates were taken.
That resolved: `brace-expansion`, `form-data`, `http-proxy-middleware`,
`lodash`, `nanoid`, `undici`, `ws`, `@discordjs/rest`, `body-parser`,
`discord.js`, `express`, `follow-redirects`, `morgan`, `qs`.

**Verified: 951/951 tests pass afterwards.**

### Caught: the fix silently disabled 90 tests

`npm audit fix` bumped `playwright` 1.61.1 → 1.62.1, which invalidated the
installed Chromium. The browser e2e suite is written to **skip** rather than
fail when the browser is missing, so the suite went from **951 passing** to
**861 passing + 90 skipped** — and reported success.

Nothing failed, so nothing drew attention to it. Two fixes:

- CI now runs `npx playwright install --with-deps chromium`.
- The e2e suite **throws instead of skipping when `process.env.CI` is set**.
  Skipping locally is a kindness to contributors without a browser; skipping in
  CI is a silent loss of 90 assertions. Verified: `CI=1` with no browser exits
  1, a local run with no browser still exits 0.

## 3. Direct dependencies

19 direct, all confirmed in use except `axios` (removed).

| Package | Version | Purpose | Files |
|---|---|---|---|
| `@solana/web3.js` | ^1.98.4 | all chain interaction | 31 |
| `discord.js` | ^14.25.1 | the bots | 19 |
| `@solana/spl-token` | ^0.4.14 | token accounts, transfers | 15 |
| `zod` | ^3.23.8 | config and input validation | 12 |
| `node-fetch` | ^3.3.2 | HTTP to price/market APIs | 8 |
| `express` | ^4.19.2 | the web/API server | 7 |
| `nanoid` | ^5.0.7 | session and id generation | 7 |
| `@bonfida/spl-name-service` | ^3.0.16 | SNS (.sol) resolution | 5 |
| `node-cron` | ^3.0.3 | scheduled jobs | 4 |
| `helmet` / `morgan` | ^7.1.0 / ^1.10.0 | HTTP headers, request logging | 3 each |
| `twitter-api-v2` | ^1.20.0 | X integration | 3 |
| `mongodb` | ^6.17.0 | managed-file mirror | 2 |
| `bs58` | ^5.0.0 | base58 encode/decode | 2 |
| `http-proxy-middleware` | ^3.0.3 | dev/public proxy | 2 |
| `tweetnacl` | ^1.0.3 | signature verification | 1 |
| `@anthropic-ai/sdk` | ^0.92.0 | watchdog + Forge | 1 |
| `dotenv` | ^17.4.2 | config loading | 50 |

**Pinning:** all are caret ranges, which is how `npm ci` + a committed
`package-lock.json` is meant to work — the lockfile is the pin, and it is
committed. §57's "pin important production versions" is satisfied by the
lockfile rather than by rewriting ranges, which would only move the problem
and make security patches harder to take.

## 4. Accepted advisories

Four high, all in one dependency chain, all with no forward fix. Enforced by
`src/scripts/audit-gate.js`.

| Package | Why accepted |
|---|---|
| `@solana/spl-token` | Direct, 15 files. Fix is a downgrade to 0.1.8. |
| `@solana/buffer-layout-utils` | Transitive under the above; same situation. |
| **`bigint-buffer`** | Buffer overflow in `toBigIntLE`. Transitive under buffer-layout-utils, and `buffer-layout-utils/bigint.js` is what decodes u64 token amounts — so it is in the live path on every balance parse. **The highest-attention item here.** |
| `@bonfida/spl-name-service` | Direct, 5 files. Fix is a downgrade to 0.1.25. |

Seven moderates remain in the same chain plus `node-cron`/`uuid`, below the
gate threshold.

### `bigint-buffer` — the one to watch

It is the only accepted advisory that is both **memory-unsafe in kind** and
**on a hot path**. The mitigating facts, honestly stated:

- The overflow is reached through `toBigIntLE` on attacker-influenced buffer
  lengths. Our calls decode account data returned by an RPC node we choose.
- A malicious or compromised RPC is therefore the realistic attack path — which
  is worth noting because RPC choice is currently a single provider.

It should be re-checked whenever `@solana/spl-token` publishes, since a fixed
upstream is the only real resolution.

## 5. The gate

`npm run audit:gate` — fails on any advisory at **high or above** that is not
on an explicit `ACCEPTED` list, each entry carrying a written reason.

Plain `--audit-level=high` is unusable here (permanently red, for something
nobody can act on) and `--audit-level=critical` is too loose (a new high in a
future package would pass silently). The gate is the useful middle: **known
problems documented, new problems blocked.**

It also warns when an acceptance no longer matches any advisory, so the list
cannot rot into a set of suppressions nobody remembers.

Verified both ways: removing `bigint-buffer` from the list fails the build with
a specific message; adding a fictional package produces a stale-acceptance
warning.

## 6. Two lockfiles — and yarn is the real one

**Evidence, not preference:**

- `.yarnrc.yml` is **tracked**, and `.yarn/` exists — Yarn Berry artifacts that
  only appear from real use.
- `package.json` declares `"packageManager": "yarn@4.12.0"`.
- Commit `25e159c` added `playwright` and updated **`yarn.lock` only**.
  `package-lock.json` has not been touched by a dependency change since the
  initial commit.

So **yarn is what this project actually uses**, and `package-lock.json` is the
stale artifact. This review reached for npm by default and measured the wrong
tree; the CI written earlier the same day uses `npm ci` for the same reason.
Neither was a considered decision.

### The trees genuinely differ

`yarn npm audit --recursive` on the tree yarn installs: **34 advisories — 1
critical, 12 high, 18 moderate, 3 low.** Very different from npm's 11.

The critical is `tar@7.5.13` (decompression DoS), pulled via
`node-gyp@12.3.0` — and **`tar` does not appear in `package-lock.json` at
all**. Yarn resolves build tooling npm's tree never installs.

Worth keeping in proportion: `node-gyp`/`tar` is **build-time** tooling, so a
decompression DoS there is far less serious than a runtime issue. It is
reported because it demonstrates the divergence, not because it is urgent.

*(Note: `yarn npm audit` without `--recursive` checks direct dependencies only
and reported "clean". That narrower default is worth knowing — it is a
reassuring number that does not mean what it appears to.)*

## 7. The original framing of this problem

`package.json` declares:

```json
"packageManager": "yarn@4.12.0+sha512..."
```

...yet **both** `package-lock.json` and `yarn.lock` are committed, and CI (and
this review) used `npm`.

That is not merely untidy. `npm remove axios` and `npm audit fix` updated
`package-lock.json` only — **`yarn.lock` still listed `axios` and the
unpatched versions.** Anyone installing with yarn, which is what the project
declares, would have restored the vulnerable tree, and the fix would have
looked applied while not being applied.

### The correction

The first attempt at this ran `yarn install --mode=update-lockfile`, which
removed `axios` from `yarn.lock` — and that was reported here as the lockfiles
being back in sync. **They were not.** Only the removal carried across; the
version patches did not, because `npm audit fix` had bumped packages within
their ranges and yarn had independently resolved older in-range versions.

Spot-checking showed the disagreement plainly:

| Package | package-lock | yarn.lock (before fix) |
|---|---|---|
| `playwright` | 1.62.1 | 1.61.1 |
| `discord.js` | 14.27.0 | 14.25.1 |
| `nanoid` | 5.1.16 | **5.1.7** (vulnerable) |
| `http-proxy-middleware` | 3.0.7 | **3.0.5** (vulnerable) |

So the security patches existed only in the lockfile the project does **not**
declare. Corrected by re-resolving **within the existing ranges**:

```
yarn up "nanoid@^5.0.7" "http-proxy-middleware@^3.0.3" "morgan@^1.10.0" --mode=update-lockfile
```

The range constraint matters. A bare `yarn up nanoid http-proxy-middleware`
took **major** versions (nanoid 5→6, http-proxy-middleware 3→4) and rewrote the
ranges in `package.json` — untested majors, and exactly what §57 forbids. That
was reverted. Both lockfiles now agree on all three packages.

> A related trap: plain `npm install` **rewrites `yarn.lock` wholesale into
> Yarn v1 format** — a 4,520-line reformat that appeared in this review's
> working tree and was reverted. If you use npm here, check `git status` for
> yarn.lock before committing.

**Open decision, not made here:** which package manager is authoritative. The
current state works but has two sources of truth that must be updated in
lockstep by hand, and nothing enforces that. Three coherent options:

1. **npm** — delete `yarn.lock`, drop the `packageManager` field. Matches CI as
   written today.
2. **yarn** — delete `package-lock.json`, change CI to `yarn install
   --immutable`. Matches what `packageManager` declares.
3. **Keep both** — add a CI check that they agree. More machinery than either
   alternative and no benefit that either lacks.

This is a real risk while unresolved, because it is invisible: the failure mode
is a security patch that silently applies to only half the project.

## 8. Follow-ups

1. **`node-cron` 3.0.3 → 4.6.0** is the one genuine forward upgrade available.
   Deliberately **not** taken here — §57 warns against upgrading during
   security-sensitive work, and a major bump to the scheduler that drives
   payouts deserves its own change with its own testing.
2. **Re-check the Solana chain** whenever `@solana/spl-token` publishes.
   Upstream is the only real fix.
3. **RPC diversity** would reduce the realistic attack surface for
   `bigint-buffer`.
4. **No linter is installed**, so §56's static-analysis requirement is still
   unmet. Separate decision.
5. **Resolve the two-lockfile ambiguity** (§6). Needs an owner decision.
