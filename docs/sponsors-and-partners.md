# Sponsors & Partners

Date: 2026-07-16
Route: `/partners/` (canonical). `/sponsors/` redirects here rather than duplicating the page — "Sponsors & Partners" is used as the on-page public label to cover both concepts, but only one route/data model exists behind it.

## Why `/partners/`, not `/sponsors/`

The quiz system already uses "sponsor" for a different concept — sponsor-branded question pools (`sponsorquiz`, `sponsorboard`, per-sponsor point breakdowns; see `src/quiz/db.js`/`platform-stats.js`). Using `/sponsors/` as the canonical route risked colliding with that existing, unrelated meaning of the word. `/partners/` avoids the ambiguity while `/sponsors/` still works as a redirect for anyone who guesses that URL.

## 1. Inclusion criteria

A record belongs on this page if it is either:
- A **partnership/collaboration** between WinLEW and another project/community, with at least one piece of public evidence (an announcement, a linked account, a joint post), or
- A **verified project investment or ecosystem-support milestone** (a listing service payment, a domain registration, a liquidity program) the project itself ran or paid for.

A record does **not** belong here merely because it was mentioned informally in Discord with no evidence link, and a paid vendor/service relationship does not become a "partnership" or "sponsorship" just because money changed hands — see §3.

## 2. Status rules

Defined in `src/mole/partnersData.js`'s `PARTNER_STATUSES`. The one rule enforced in code, not just convention: **`validatePartnerRecord()` rejects any record marked `active` with zero public evidence links** (`test/mole/partnersData.test.mjs` covers this directly). An old announcement with no reconfirmed current evidence can be `historical` or `status-unconfirmed`, never `active`.

## 3. Service provider vs. sponsor/partner distinction

`ECOSYSTEM_SUPPORT` (in `src/mole/partnersData.js`) is a **separate array** from `PARTNERS`, rendered in its own "Project Milestones and Ecosystem Support" section on the page. Raydium (liquidity pool, farm program), DEX listing services, and RugCheck are documented there as verified purchases/registrations — never labeled "sponsor" or "partner," since no partnership was announced or evidenced with any of them. This separation is enforced by which array a record lives in, not just page layout.

## 4. Evidence standard

Every `PARTNERS` record must have at least one `publicEvidence` entry (checked by `getPartnerById`/`validatePartnerRecord`). Every `ECOSYSTEM_SUPPORT` record carries an explicit `verification` label (`verified`, `owner-supplied`, or `conflicting-dates`) so a reader always knows how solid a given line is — nothing is presented as verified fact by default.

## 5. Historical versus active distinction

The 2BRZ record (see §6) is deliberately **not** marked `active`. The April 2025 announcement is real and evidenced, but no current (2026) activity was independently reconfirmed for this sprint — so it's `status-unconfirmed` with the public label "Historical Community Partner," rather than defaulting to "active" just because nothing says otherwise.

## 6. Initial 2BRZ record

- **Name:** 2BRZ / 2 Brotherz
- **Type:** Community Partner
- **Status:** Status Unconfirmed ("Historical Community Partner")
- **Announced:** April 2025
- **Evidence:** [X announcement](https://x.com/LewSales/status/1907618750523736507), [2BRZ token on Pump.fun](https://pump.fun/coin/3oB7hyAZXqrzzbSebt3XykCrXqAX6Vv57Qdin3bVpump) (confirmed reachable, page title matches: "2BRZ (2BRZ) Price, Chart & Market Cap | Pump"), [2brz.com](http://2brz.com) (confirmed live and active, not a parked domain, as of 2026-07-16)
- **What it involved:** a public cross-promotion / community-alignment announcement between the two projects' communities.
- **What is not claimed:** no formal legal partnership, investment, endorsement, revenue-sharing arrangement, or contractual obligation. The promotional language used at the time ("shared goals," "mutual support," "collaboration," "community alignment," "complementary strengths") is preserved as historical framing, not repeated as objective fact.
- **Original announcement quote** (`announcementQuote` field, added 2026-07-16 from the owner's Discord announcement post dated 03/31/2025, publishing April 1, 2025): *"Together, we complement each other perfectly; combining creativity with execution to drive results that matter. It's a synergy built on shared goals, mutual strengths, and a passion for success. Here's to an unstoppable collaboration!"* — rendered on `/partners/` in quote styling, same "preserved as historical framing, not objective fact" treatment as the rest of the record's promotional language.

## 7. Unresolved dates / status questions

- **DEX/RugCheck service payment date conflict** — one owner-supplied statement gives April 24, 2025; a separate owner-supplied statement says the payment was made in August. Neither could be independently verified from repository history or on-chain data (these are off-chain service payments, not on-chain events). Both dates are preserved in the `dex-rugcheck-services` ecosystem-support record with `verification: "conflicting-dates"` rather than one being silently chosen.
- **"~22M locked in liquidity"** — a historical public statement supplied by the project owner. This figure matches the Streamflow vesting lock amount (~22.07M, already documented independently in the Transparency Center) far more closely than it matches the actual Raydium liquidity pool's balance, which is a separate on-chain component with its own (much smaller) figure. This page does not repeat "~22M in liquidity" as a distinct ecosystem-support line item, to avoid restating what looks like a conflation between two different components as if it were a third fact — see the Transparency Center for the Streamflow lock's real, independently-documented figure.
- **"More than 18M reportedly distributed historically"** (community giveaways/incentives) — included as an owner-supplied narrative total, explicitly labeled unverified. No transaction list or on-chain query backs this specific number.
- **Raydium farm program totals** (weekly rewards, total rewards locked) — owner-supplied historical terms, not independently re-verified on-chain for this sprint. Labeled accordingly.
- **A second Raydium farm** (`raydium-farm-2`, farm ID `3ew3rB5UTgDNxuLNGm1Bvb4krBscBMzJjptvYbA8R8d7`) was found on 2026-07-16, run back-to-back after the first (2025-06-16 → 2025-09-14, vs. the first farm's 2025-03-10 → 2025-06-08). Unlike the first farm, this one's terms are `verified`, not owner-supplied: dates and reward rate were pulled from Raydium's public API and cross-checked against the project owner's own wallet portfolio screenshot, using the same weekly-rate × 90/7 formula that independently reproduced the first farm's already-on-file total exactly (290,685.6288/week × 90/7 = 3,737,386.66, matching the existing record) — giving confidence in the resulting ~2,999,996.35 WinLEW total for farm #2. Both farms are historical/completed; neither is currently active.

## 7a. Related events (`/events/`, added 2026-07-16)

`GET /api/partners/status` now includes a computed, read-only `relatedEvents` array per partner (id/title/status only, via `eventsData.js`'s `getEventsForPartner()`) — the Partners page links into `/events/` without duplicating any event data here. The 2BRZ record's April 2025 announcement is also modeled as an event (`2brz-partnership-announcement-2025`) for this reason. Referencing an event never changes a partner's own `status` field — see `docs/community-events.md`.

## 8. Update / removal process

1. Add or edit a record in `src/mole/partnersData.js` (`PARTNERS` for partnerships, `ECOSYSTEM_SUPPORT` for service/investment history).
2. Run `npm test` — `test/mole/partnersData.test.mjs` validates every record's required fields and rejects an unsupported `active` claim automatically.
3. No other file needs to change — `/api/partners/status` and the `/partners/` page both read directly from this module.
4. To remove a record, delete its entry — there is no separate "archive" state; git history preserves the removed record if it's ever needed again.
