# Deploy 2026-08-20 — one person, one account, many wallets

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

Follows `deploy-2026-08-19-news-giveaways.md`, which still stands: its uploads
are separate from these and are still owed if they have not been done.

---

## WHERE you are

Five commits, all one series:

```
ffc1e1f  identity: many wallets per person + holder bypass on the first one
4eedac3  faucet/dashboard: one claim per person; balances that count every wallet
9cb3c1d  governance/hodl: one vote per person; eligibility from the identity total
5a7f420  hub: a new wallet must sign in before it can connect
bfbbd0c  wallet: choose which of your wallets gets paid
```

```bash
# snapshot the runtime data dirs FIRST — this has bitten before
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
npm test        # expect 1751/1751 — that is what it returned here
```

---

## VERIFIED LIVE STATE — 2026-08-20, 15:53 UTC

Checked from the development machine against winlew.co, not assumed. Anyone can
re-run these.

**The static files are ALREADY UPLOADED.** Every file this deploy touches was
fetched from winlew.co and hashed against the local copy: `wallet-auth.js`,
`verify/profile.js`, `nav.js`, `sitemap.xml`, `/giveaways/`, all seven news
articles, both whitepaper copies. All byte-identical. Nothing to upload.

**The backend has NOT been restarted.** This is the one thing outstanding, and
it is provable in one call:

```bash
curl -s "https://winlew.co/verify/api-proxy.php?path=/api/wallet/payout"
# running TODAY'S code -> {"error":"session_expired"}   (401)
# running OLD code     -> {"error":"not_found"}         (404)   <- what it returns now
```

For contrast, `?path=/api/price/status` and `?path=/api/burn/status` both return
200 with fresh data, so the tunnel and the process are healthy. The process is
simply running code from before this series.

## You must do

### 1. Restart the Node app. That is the whole deploy.

Until it restarts, **none** of the rules below are in effect:

- the identity gate still demands **7 days**, so the 100,000 holder bypass does
  not exist and `@Markchad | Unifusion` still cannot verify
- one-claim-per-person, one-vote-per-person and the summed balances are all
  inert
- login-before-connect is off — new anonymous wallets still connect freely
- `/api/wallet/payout` 404s, though nothing calls it yet, so nothing is visibly
  broken

**The ordering warning in the original version of this file is now moot** and is
recorded here so nobody acts on it: it said to upload `wallet-auth.js` WITH the
restart, never after. What actually happened is the reverse — the static went up
first and the restart never came. That is the harmless direction: the new client
knows how to handle a `login_required` refusal, and the old server never sends
one.

### 2. Decide three settings BEFORE you restart, not after

All three take effect the moment the process comes up. None needs an `.env`
entry unless you disagree with the default.

| Setting | Default now | What it does |
|---|---|---|
| `IDENTITY_MIN_GUILD_DAYS` | **3** (was 7) | How long in the server before a wallet can be verified |
| `IDENTITY_FIRST_WALLET_MIN_BALANCE` | **100000** | A first wallet holding this much skips the wait entirely |
| `HUB_REQUIRE_LOGIN_BEFORE_CONNECT` | **true** | A wallet with no account behind it must sign in first |

The third is the one to think hardest about — see "What changes for people
already using the site" below.

### 3. Tell the person who was refused on 2026-08-19

`@Markchad | Unifusion` was refused with `guild_membership_too_new`, required 7,
actual 0 — the log line that started this work. **They are still refused right
now**, because the restart has not happened. Afterwards they have two ways in:
hold **100,000 WinLEW** in the wallet they are verifying, or wait **3 days**
instead of 7. They were already past the 30-day account-age check.

## The rules, as they now stand

**One person can hold many wallets.** Verifying a second wallet no longer
replaces the first — each address carries its own 91-day clock. Only the wallet
that was current at upgrade time is migrated; addresses sitting in
`wallet_history` are NOT retroactively counted as verified, because nobody
re-signed for them. Anyone who wants an old wallet back just verifies it again.

**Money still goes to exactly one wallet**: their explicit choice
(`POST /api/wallet/payout`), else the one they most recently verified with.

**One claim per person, not per wallet.** The faucet resolves the identity from
the wallet, so claiming with wallet A then verifying wallet B and claiming again
is refused. The message says "another wallet on your account" rather than
naming the wallet — naming it teaches a prober what to avoid.

**One vote per person.** This one was a hole the multi-wallet change itself
opened: votes are keyed by wallet, which was one-per-person only while an
identity could hold one wallet. Three verified wallets would have been three
votes. A vote from the same account under a different wallet now replaces the
earlier one, keeping the original cast time.

**Eligibility is the person's total.** Governance thresholds, HODL minimums and
the LewCrew tiers are measured across every verified wallet. The dashboard shows
it too — this is the fix for "I have over 10m between the connected accounts but
it only shows what account is connected."

**HODL now checks every verified wallet against the ban list**, not just the one
being paid. Otherwise the cheapest bypass of the payout blocklist was to
nominate a different wallet you already own.

---

## What changes for people already using the site

**Nobody is logged out.** Sessions already issued keep working until they
expire. The login requirement applies to NEW connects only.

**No progress is lost.** An anonymous player who now signs in and links the same
wallet keeps their rewards — that merge is the `reassignClaims()` path
`/api/wallet/link` has always run.

**A wallet already linked to a Discord account still connects directly**, with
no OAuth round trip. The mobile app depends on that path; it is unchanged.

**What genuinely goes away** is anonymous wallet-only sign-in for new wallets.
That was a deliberate design — `web.js` has said since the hub shipped that
verification "is not a prerequisite for connecting or saving play" — and the
owner reversed it knowingly. If it proves too strict, set
`HUB_REQUIRE_LOGIN_BEFORE_CONNECT=false` rather than editing code.

---

## Known limit, stated rather than buried

The holder bypass can be **reused**. Tokens move: the same 100,000 can be sent
to a fresh wallet and used to pass the check again under a second Discord
account. So the price of an identity is "buy in and wait for a transfer", not
"buy in once per identity". Closing it needs holding DURATION, which needs a
historical-balance indexer this project does not have — the same limitation
`/governance/` already states publicly about its own snapshot rule.

Every grant is logged as `identity_gate_holder_bypass` with the balance and the
minimum, so the pattern is visible after the fact. **Watch that log line.** If
it appears repeatedly with similar balances across new accounts, that is the
reuse happening, and the answer is to raise
`IDENTITY_FIRST_WALLET_MIN_BALANCE` — not to remove the bypass, which would put
the original refusal back.

---

## Also in this pull: the community burns are now recorded

`ede144f` closes what the previous handoff left open. **Six community burns,
100,830.472170 WinLEW**, each with a signature, in a new `COMMUNITY_BURNS`
export in `src/mole/burnEvents.js`. They do NOT count toward the 100,000,000
target and a test enforces that.

**Live supply is 949,999,960.615828, not 950,000,000.** The difference is
exactly the two dust burns of 2026-08-18. Every present-tense claim of
950,000,000 has been corrected; the dated historical statements about the
August 1 burn were true and are left alone. The holder snapshots are unaffected
— at their slots the balances did sum to exactly 950,000,000, and a snapshot is
a statement about a slot.

The unexplained residual in `docs/burn-program.md` §7a moves from
**292,922.812516** to **192,131.724518**.

### The static files from that work are also already live

`/giveaways/` (with the burned-by-recipient row), all seven news articles, and
both whitepaper copies were verified byte-identical against winlew.co on
2026-08-20. `sitemap.xml` did not change — no new URLs. Nothing to upload.

They are generated by `npm run giveaways:build` and `npm run news:build`. The
committed copies are the reviewed ones; do not regenerate on the serving machine
to "refresh" them.

---

## Still open

Nothing from 2026-08-19 remains. The list of community burns is a **floor**, not
a total: only wallets this project could enumerate were scanned, so any
open-market buyer who burned is still invisible, and 192,131.724518 stays
unexplained. That is the honest end state, not a task.
