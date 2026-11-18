# WinLEW Final QA — Boss Review

**Date:** 2026-08-11 · **Scope:** `src/public/` and the server code that renders it
**Companion:** `WINLEW_FINAL_VERIFIED_FACTS.md` (facts re-derived from chain this pass)

---

# Executive Result

## PASS WITH MINOR CORRECTIONS

Awarded because every CRITICAL and HIGH item found was **fixed and verified**
during this pass, and the checks that could clear a suspicion did so on evidence
rather than assertion. What remains is LOW/MEDIUM and is listed openly below.

This is a narrower claim than "the site is perfect". It means: **a community
member, a developer, a blockchain researcher, a listing reviewer, a skeptic and
the owner can each read this site today without hitting a contradiction this
audit should have caught.**

### Why not a plain PASS

Three limits, stated rather than buried:

1. **Not every page was read end to end.** 118 HTML files. High-risk pages were
   read; the long tail was checked by targeted extraction, which finds numeric
   and structural contradictions but is weaker on semantic ones.
2. **Some external links cannot be verified from this environment.** Solscan,
   Coinbase and gmgn.ai block automated clients at the network level. DexScreener
   was confirmed good in a real browser; the others are recorded as *unverifiable
   here*, not as *working*.
3. **Two owner actions are outstanding** (below). Neither is a content error, but
   the site is not fully current until they are done.

---

# Previous Audit Review

| | |
|---|---|
| Previous `audit(public)` commits | 32 |
| Public files touched by that work | 118 |
| Register items inherited | 39 |
| Fact-register rows inherited | 55 (**none accepted without re-derivation**) |

**Classification of the previous work reviewed in this pass:**

| Verdict | Count | Notes |
|---|---|---|
| `APPROVED` | majority | See "What the previous audit got right" |
| `APPROVED WITH CORRECTION` | 3 | Burn wording, lock enumeration, vault cards |
| `INCORRECT` | 0 | No previous factual change was found to be wrong |
| `UNNECESSARY` | 0 | |
| `UNVERIFIED` | 2 | Launch date; `WEB_PROXY_SHARED_SECRET` on the live host |
| `INTRODUCED REGRESSION` | 0 | |

**The headline finding about the previous audit: it did not oversell, and its
guards work.** The single strongest piece of evidence is that its own test
(*"the tokenomics summary accounts for every Jupiter Lock"*) failed within
seconds of my adding a lock component without updating the prose. That test was
written after the same drift happened in August. It did its job on me.

## What the previous audit got right (`VERIFIED — NO CHANGE REQUIRED`)

- **No overclaiming anywhere.** Every "partnership" mention on `/xyo/` is a
  *disclaimer* ("not officially partnered with, sponsored by, or endorsed by
  XYO"; the FAQ asks the question and answers "No"). Every "guaranteed" on the
  site is a *negative* ("rewards not guaranteed value", "Planned ≠ guaranteed").
- **No "runs on XL1" claims.** Framing is consistently *building toward*,
  *experimentation*, *long-term goal*. Checked by sentence, not by keyword.
- **Active-market label is correct.** A suspected HIGH — that this week's Raydium
  deposits had made "PumpSwap is the active market" wrong — was **cleared on
  evidence**: PumpSwap holds 31.64 wSOL against Raydium's 5.65.
- **Roadmap vs modules is genuinely guarded.** 62 tests across three files,
  including drift-protection rejecting 11 specific tampering scenarios and
  named-truth assertions ("Governance is LIVE", "Cross-Chain Bridge is not
  marked complete").
- **`/burn/` is live-driven** and already separates *verified burned* from
  *awaiting burn*.
- **Redirect-stub hygiene**, canonical tags, and the sitemap are pinned by tests.

---

# Missed Issues (found by this audit)

| # | File / area | Issue | Severity | Correction |
|---|---|---|---|---|
| 1 | `src/mole/web.js` | A Jupiter Lock holding **19,192,210.751092** was absent from the component registry — locked supply understated by 19.19M | **HIGH** | Added `lock19mDev`; verified live at 138,275,163.574 total |
| 2 | `/who-we-are/` | Lock list named only "50M, 15M, two Streamflow" — omitted the 25M faucet lock **and** the 19.19M lock. Understated by **44.19M** | **HIGH** | All six listed with the 138.28M total; generalised guard added |
| 3 | Whitepaper (both copies) | ~49.71M destroyed stated with no way to reconcile against on-chain 50,000,000 | **HIGH** | Reconciliation paragraph added |
| 4 | `/xyo/` | GeoHackers and GeoAgora described in flat present tense while their own pages say "Coming Soon · Not public yet" | **HIGH** | Status qualifiers added; guard added |
| 5 | `/transparency/`, `/faucet/` | A 10-day-old snapshot asserted "**nothing is missing from the figure**" in the present tense | **HIGH** | Now leads "Snapshot as of…"; says plainly when stale |
| 6 | `/wallet/` ×3 | Privacy-policy contact points linked to a **404** | **MEDIUM** | Repointed to the verified-live Discord; guard added |
| 7 | `/transparency/` | Two cards for one pool, one showing a meaningless `$WinLEW: 0` | **LOW** (owner-reported) | Merged into one "Live Depth" card |
| 8 | `/images/old-index.htm` | Legacy homepage publicly reachable (HTTP 200, 21 KB) with dead `http://` subdomain links | **LOW** | Left in place deliberately — see Human Review |

**Note on #1:** the previous audit could not have caught it. The lock was created
the same day this audit ran.

---

# Incorrect Previous Changes

**None found.** No factual change made by the previous audit was reversed.

One change was **deliberately not made**, and the reasoning matters more than the
edit: the brief asked to correct the burn figure to the on-chain 50,000,000.
**The ~49.71M figure is correct** — it is what the project can evidence
transaction by transaction across 32 burns, and the whitepaper already separates
it carefully from the 50,000,000 merely *held* in the burn wallet. Overwriting it
would have destroyed a real distinction and broken the guard that pins it to the
ledger. The reconciliation was missing; the number was not wrong.

---

# Verified Shared Facts

Full evidence in `WINLEW_FINAL_VERIFIED_FACTS.md`. Headline:

| Fact | Value |
|---|---|
| Supply | **950,000,000** (`getTokenSupply`) |
| Destroyed | **50,000,000** on-chain = 49,707,077.187484 project-executed + 292,922.812516 holder-burned |
| Latest burn | 14,878,231.210253 on 2026-08-01 |
| Burn wallet | holds **50,000,000**, staged and **not** committed to burn |
| Locked | **138,275,163.573644** across six locks |
| Primary market | PumpSwap `Hmif58VX…` (31.64 wSOL) |
| Secondary market | Raydium CPMM `5nTz…` (5.65 wSOL) |
| Newest lock | 19,192,210.751092, cliff 2028-08-11, fully unlocked 2033-08-10 |

**Burn framework wording (owner decision, 2026-08-11):** the retained 50M is an
**open annual decision, not a commitment**. No page may say "50M remaining to
burn".

---

# Market Verification

| Venue | Classification |
|---|---|
| PumpSwap `Hmif58VX…` | **CURRENT — primary** |
| Raydium CPMM `5nTz…` | **CURRENT — secondary**, actively funded this week |
| Pump.fun bonding curve | **HISTORICAL** — preserved as launch history, never presented as current |
| Base contract `0x555c…` | **HISTORICAL** — retired, correctly disclosed |

---

# Link Verification

122 external URLs across 27 hosts; 51 non-`winlew.co` checked live.

- **Real failure: 1** — `github.com/LewSales/GeoWallet/issues` (404). Proven real
  with a control: `github.com/LewSales/Discord-Bot` returns 200 to the same
  client. **Fixed.**
- **Bot-blocked, not broken: ~15** — Solscan, DexScreener, Coinbase, gmgn.ai
  return 403 to automated clients. DexScreener confirmed 200 in real Chromium;
  the rest are **unverifiable from here**, not broken.
- **Benign redirects: 3** — `discord.gg` → `discord.com/invite` (normal), and a
  CoinMarketCap pool URL → its token page (resolves to the correct mint).
- **Dead subdomains** (`discord|health|verify.winlew.co`) appear only in the
  archived `/images/old-index.htm`, nowhere live.

---

# Security Findings

**No CRITICAL or HIGH.**

- `bot-keypair.json` in the GeoHackers repo: **untracked**, covered by that
  repo's `.gitignore` (`*-keypair.json`), not in any web-served path. Contents
  never read or printed. **No exposure.**
- `.htaccess-old` in the web root: returns **403** — the host blocks dotfiles
  generally. **No config disclosure.**
- Repository secret scan: clean across 724 tracked files.
- Four session-token leaks found and closed earlier this week (Phantom/Solflare
  universal links ×2, the request log, the address bar) are documented in
  register #26/#28 and `docs/verify-handoff.md`.

---

# Human Review Needed

1. **`npm run faucet:scan` on the serving machine.** The distribution figure is a
   snapshot from 2026-08-01 — the pages now say so honestly, but only that scan
   refreshes it. The reserve has also been topped up ~10M since.
2. **Deploy.** `src/mole/web.js` needs a pull + restart; seven `src/public/` files
   need re-uploading.
3. **GeoWallet support destination.** Contact links now point at the community
   Discord. If a dedicated GeoWallet channel or inbox exists, swap it in.
4. **`/images/old-index.htm`.** An archived homepage, `noindex` and unlinked but
   reachable at its exact URL. Deliberately not edited — rewriting an archive
   falsifies it. Delete it or leave it, but choose.
5. **Launch date 2024-12-07** remains owner-stated. Corroborated only indirectly
   (oldest pool created 2025-02-10, consistent with a bonding-curve launch
   before it). Unverifiable from here.
6. **`WEB_PROXY_SHARED_SECRET`** on the live host (register #27) — still
   unchecked, still fails safe.

---

# Testing

**1156/1156 passing**, including 20 tests added this pass.

Pages/paths actually exercised: `/`, `/home/`, `/about/`, `/who-we-are/`,
`/whitepaper/`, `/burn/`, `/transparency/`, `/roadmap/`, `/modules/`, `/xyo/`,
`/proof-of-value/`, `/faucet/`, `/quiz/`, `/governance/`, `/wallet/*`,
`/ecosystem/*`, `/verify/`, `/merch/`.

Live verification against `winlew.co`: transparency API (13 components, locked
total matched chain exactly), new POST routes (`401 session_required`,
`503 checkout_not_configured` — both correct), three content fixes confirmed
served, and a real-browser check of a Cloudflare-blocked link.

## A caveat about this audit's own work

**Three guards written during this pass initially passed while checking
nothing**, and each was caught only by deliberately breaking the subject and
demanding to see red:

- a regex with an unbounded `[\s\S]*?` that matched an identical expression in a
  *later* function;
- a 200-character window that ran past the end of one card and borrowed the
  words "Not public yet" from the card beside it;
- an early `return` that **disabled** a check when its subject was deleted,
  instead of failing.

A fourth script reported *zero WinLEW in every wallet* because an env var was
passed as an argv and every fetch threw into a `catch` that rendered failure as
"no balance". It now aborts instead.

This is recorded because it is the same class of defect the audit exists to
find: **a false clean result is more dangerous than a visible failure.**

### So the claim was tested, not just asserted

Rather than leave "any test never watched failing should be treated as unproven"
as a warning, it was measured. Every guard-style test (one that reads a source
file and asserts on its contents — 37 of 89 test files) had its subject **blanked
entirely**, then was re-run. A guard that still passes against an empty file is
verifying nothing.

| | pairs checked | vacuous |
|---|---|---|
| Guards protecting the live site | 24 | **0** |
| Guards in the halted $CUNT sprint | 26 | 3 |
| Guards written during this audit | 8 | **0** |

**Every guard protecting winlew.co survived.** That includes the previous audit's
work and everything added this pass.

The three real failures were all in `test/cunt/`, and the cause was structural
rather than careless: an assertion of the form *"this file must NOT contain X"*
is trivially satisfied by a file containing nothing, so it cannot distinguish
*safe* from *deleted*. Each is now paired with a presence assertion, and all
three were re-verified going red against an emptied subject.

A fourth flagged pair was a **false positive from the sweep's own extractor** —
it treated a path inside an allowlist literal as a guarded subject, when that
test never reads the file. Recorded because an audit tool that over-reports is
its own kind of unreliable.
