# Transparency Center — UX Reorganisation

**Date:** 2026-08-13 · **Page:** https://winlew.co/transparency/

Reorganisation only. No evidence was removed, no record deleted, no number
changed.

---

# Before

Measured in a real browser against the live page, not estimated:

| | Desktop (1280px) | Mobile (390px) |
|---|---|---|
| Total page height | **17,872px** | **31,946px** |
| Tokenomics started at | 16,617px (93% down) | 29,547px (**92% down**) |
| Farm Records started at | 15,783px | 27,893px |

Three blocks accounted for roughly 70% of the page:

| Section | Desktop | Share |
|---|---|---|
| Wallet/lock component cards (12, live) | ~5,350px | ~30% |
| Community Liquidity Providers | 4,002px | 22.4% |
| Circulating Supply (calculation inline) | 3,139px | 17.6% |

**The problems, in order of how much they hurt:**

1. **Nothing summarised the token.** Total supply appeared in the mint card;
   circulating supply appeared 500px later; burns were on another page entirely.
   There was no single place answering "what is the state of this token".
2. **The circulating-supply calculation sat directly under its own result.**
   Correct information in the wrong place — six escrow rows, five
   not-excluded rows and a methodology table between the headline figure and
   everything else on the page.
3. **Every LP transaction rendered inline.** 60 records, always expanded.
4. **Tokenomics and Farm Records were unreachable in practice.** Both live,
   both accurate, both at the very bottom behind ~28,000px of evidence on a
   phone.
5. **No way to navigate.** No anchors on major sections, so nothing could be
   linked to — including for a CoinMarketCap reviewer.

# What Changed

1. **Quick navigation** (`.tcNav`) — eight anchor pills below the hero,
   horizontally scrollable on mobile, 40px minimum tap target.
2. **"At a glance" overview** (`#overview`) — four live metric cards: Total
   Supply, Circulating Supply, Locked/Vested, Burned (confirmed). Each carries a
   contextual link to its evidence.
3. **Circulating-supply calculation moved to the bottom** as
   `#supply-calculation`, retitled *Circulating Supply — Calculation &
   Evidence*, with a "↑ Back to overview" link. **Every row moved intact.**
4. **Community Liquidity Providers collapsed** — summary stats stay visible; the
   provider cards and the full transaction table are inside a `<details>` that
   states how many records it holds.
5. **Anchors added** to every major section.
6. **Burned added to the page** — previously only on `/burn/`. Read live from
   `/api/burn/status`, in its own fetch so a burn-API failure cannot take the
   supply tiles down with it.
7. **Tiles show whole tokens.** `811,724,836.43` wrapped to `811,724,836.` /
   `43` at tile width, which on this page reads as a different number. Full
   six-decimal precision remains in the evidence section, where anyone
   reproducing the arithmetic will be.
8. **`scroll-margin-top` + smooth scrolling**, with a `prefers-reduced-motion`
   opt-out.

# New Section Order

| # | Section | Anchor |
|---|---|---|
| 1 | Hero | `#about` |
| 2 | Quick navigation | — |
| 3 | **At a glance** (4 live metrics) | `#overview` |
| 4 | Official Token Identity | `#token` |
| 5 | Graduation Milestone | — |
| 6 | Active Markets | `#markets` |
| 7 | Superseded Market Infrastructure | — |
| 8 | Verified on-chain (wallet/lock cards) | `#wallets` |
| 9 | Community Liquidity Providers (records collapsed) | `#community-liquidity` |
| 10 | Liquidity Farm Rounds | `#farm-records` |
| 11 | Tokenomics | `#tokenomics` |
| 12 | **Circulating Supply — Calculation & Evidence** | `#supply-calculation` |

## Result

| | Desktop | Mobile (390px) |
|---|---|---|
| Page height | 17,872 → **14,616px** (−18%) | 31,946 → **25,359px** (−21%) |
| Tokenomics starts at | 16,617 → **10,601px** | 29,547 → **17,951px** |
| Farm Records starts at | 15,783 → **9,767px** | 27,893 → **16,296px** |

On a phone, Tokenomics moved from 92% down the page to 71%, and Farm Records
from 87% to 64% — while the page itself got 6,600px shorter.

# Collapsed / Expandable Records

**Only one dataset is collapsed: the Community Liquidity Provider records.**

- 4,002px desktop / 8,393px mobile → 649px / 1,252px.
- The summary — providers tracked, total WinLEW deposited, total SOL deposited —
  stays visible.
- The `<details>` summary shows the record count ("60 transactions on record"),
  so the size of what is hidden is visible without opening it. A collapsed
  section giving no hint of its contents invites the assumption that it is empty.
- `<details>` was chosen over a JS accordion deliberately: keyboard accessible,
  works with no script, and findable by the browser's own in-page search when
  open. No dependency added.
- Withdrawn providers still appear, still marked withdrawn.

The wallet/lock component cards were **not** collapsed. They are the page's core
evidence and the reason people visit; the quick nav makes them skippable without
hiding them. Noted below as a possible future refinement.

# Anchor Navigation

| URL | Lands on |
|---|---|
| `/transparency/#overview` | The four live metrics |
| `/transparency/#token` | Mint, decimals, authorities |
| `/transparency/#markets` | Active markets table |
| `/transparency/#wallets` | Live wallet, lock and reserve cards |
| `/transparency/#community-liquidity` | LP summary + collapsed records |
| `/transparency/#farm-records` | Both Raydium farm rounds |
| `/transparency/#tokenomics` | Allocation and history |
| `/transparency/#supply-calculation` | Full methodology and evidence |

Verified by clicking every pill at 390px and 1280px: each lands on its section
with the heading clear of the header.

**The one that matters for listings:**
`https://winlew.co/transparency/#supply-calculation`

# Supply Calculation

**Summary** — `#overview`, top of page: total, circulating, locked/vested,
burned, plus percentages, plus *"See how this is calculated ↓"*.

**Evidence** — `#supply-calculation`, bottom of page: the formula, all six
escrow records (provider, type, cliff, fully-unlocked date, claimable-today,
early-withdrawal status, on-chain-decoded vs project-reported, Solscan link,
lock-creation tx where one exists), the five balances deliberately **not**
deducted with reasons, the staged-vs-burned callout, and the calculation
timestamp.

Both views render from one server-side calculation. The browser does no
arithmetic, so the summary cannot disagree with the evidence.

Behaviour on failure is unchanged: if any source is unreadable, no figure is
published in either place.

# Community Liquidity Providers

Summary visible, 60 records one tap away, nothing removed. Search, pagination and
sorting were considered and **not** built — at 60 records they would add
machinery without solving anything the collapse does not already solve. Worth
revisiting past a few hundred.

# Farm Records

Reachable from the quick nav and from `#farm-records`. Both rounds preserved with
their historical labelling. Moved from 27,893px to 16,296px on mobile.

# Tokenomics

Reachable from the quick nav and from `#tokenomics`. Content unchanged — it
already named all six locks correctly. Moved from 29,547px to 17,951px on mobile.

# Mobile Testing

Tested at **360, 390, 430, 768 and 1280px** against live production data.

- No horizontal page overflow at any width.
- No console errors at any width.
- Metric tiles: 4 columns → 2 at ≤900px → 1 at ≤430px.
- **Corrected during testing:** metric values wrapped mid-number at tile width.
  Fixed by showing whole tokens plus `white-space: nowrap`.
- Tap targets: nav pills and `<details>` summaries at ≥40px.
- Long addresses still wrap inside cells; supply figures never do.

# Data Integrity

- No record, row, address, link or historical entry removed.
- No number hardcoded; every figure still read live.
- Burned shows only **confirmed** burns; staged burn-wallet tokens remain counted
  as circulating and the callout says so.
- Locked ≠ burned, staged ≠ confirmed, historical markets still labelled
  historical.
- Full suite **1231/1231**.

**Two pre-existing test failures found and fixed while running the suite** —
both from the restore-drill runbook committed earlier today, not from this work.
They were missed because that commit was checked with the secret scanner but not
the full suite:

1. `CUNT-RESTORE-DRILL.md` hardcoded two signer addresses, breaking the rule that
   they live in the manifest and nowhere else. Correctly caught: an address
   copied into a runbook keeps showing the old value after a re-seed — which is
   the exact scenario that runbook's own failure branch describes. It now prints
   them from the manifest instead.
2. `CUNT-SPRINT-RESULTS.md` said "16 documents"; adding the runbook made it 17.

# Remaining Recommendations

1. **The wallet/lock cards are now the longest block** (~5,350px desktop, ~50% of
   the page). Grouping them into Locks / Reserves / Liquidity — with counts and
   subtotals per group — would make them scannable without hiding anything.
   Larger than this pass.
2. **A sticky mini-nav** on long scrolls. Deliberately skipped: the site header
   is not sticky, and adding a second sticky bar risks the heading-behind-header
   problem the `scroll-margin-top` currently prevents.
3. **`?ref=cmc` style deep links** if a reviewer needs a pre-expanded view.
4. **LP search/pagination** past a few hundred records.
5. **A print stylesheet** — the hero already offers a Print button, and a
   reviewer may want a PDF with the evidence section expanded.
