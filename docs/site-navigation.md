# WinLEW Site Navigation

Date: 2026-07-12. Updated 2026-07-18 (design-system unification — see bottom section).
Shell: `src/public/assets/nav.css` + `src/public/assets/nav.js` + `src/public/assets/wallet-auth.js`

## Architecture: two levels, one trigger, everywhere

Every canonical page (see "Intentional divergences" for the three exceptions) now shows:

1. **A short, always-visible primary row** — a page's own tailored 4-5 links if it has a `NAV_PAGE_IDENTITY` entry (see below), else Home/The Mole Hub/Quiz/Faucet. Visible on desktop (>860px), hidden on mobile/tablet.
2. **A right-side account area, same conceptual order everywhere** — Dashboard chip, then Connect Wallet (`#navWalletConnect`, wired via `/assets/wallet-auth.js`'s shared `walletLogin()`), then the Menu trigger.
3. **One "☰ Menu" trigger** — visible and functional at *every* width, including desktop. Opens the full grouped menu.

The full menu itself is never hand-authored per page. `nav.js`'s `buildTwoLevelNav()` rebuilds each page's `.navLinks` at load time from one canonical `NAV_GROUPS` array (also in `nav.js`), so adding, renaming, or regrouping a destination is a one-file change, not a fifteen-file find-and-replace.

## Route groups

Five groups, in an order chosen to answer a first-time visitor's questions in
sequence — "What can I do? → Can I trust this? → How can I help? → How is
everything built? → What are the legal policies?" — rather than mirroring
internal project structure. There is no standalone "Account" group: Dashboard
and Verify Wallet are the *start* of participation, not account management,
so they live in Play & Participate.

| Group | Destinations |
|---|---|
| Play & Participate | Dashboard, The Mole Hub, Verify Wallet, Quiz, Faucet, Bounties, Leaderboards, Community Events |
| Trust & Transparency | Who We Are, Transparency Center, Burn Center, Contribute, Health / Status, Whitepaper |
| Governance | Governance, Submit a Proposal, Sponsors & Partners, XYO Ecosystem |
| Build & Explore | About, Roadmap, Modules, WinLEW Forge, Discord Bots |
| Policies | All Policies & Legal, Terms of Service, Privacy Policy |

No deferred/未-built capability (Cross-Chain Bridge, Platform v2 analytics) has a menu entry — those stay purely informational on `/modules/`, never a fake application link.

## Desktop menu behavior

- The trigger is a real `<button>` — Enter/Space activate it natively, no custom keydown handler needed for that part.
- Click opens the panel; click again (or click the trigger a second time) closes it.
- Click anywhere outside the panel closes it.
- Escape closes it and returns focus to the trigger (`toggle.focus()` — a keyboard user is never dropped at the top of the document).
- The panel is a `position:fixed` **direct child of `<body>`**, not nested inside `.nav` — see "The clipping bug" below for why this specific structural choice matters.
- At >860px the panel renders as a grouped grid (`repeat(auto-fit, minmax(170px, 1fr))`), not a single long list — a genuine "mega-menu," not a stretched mobile dropdown.

## Mobile/tablet menu behavior (≤860px)

- The primary row is hidden entirely — brand, Dashboard chip, and the trigger are the whole always-visible bar.
- The panel becomes a single-column vertical sheet, `position:fixed`, capped to the viewport height with its own internal scroll (`overflow-y:auto`) so a tall grouped list never pushes the page itself.
- `body.navMenuLock` (added on open, removed on every close path — including outside-click and Escape) prevents the page from scrolling underneath the open panel; restored the instant the panel closes.
- Touch targets are full-width pills (`.navGroup .pill{width:100%}`), comfortably above the ~44px minimum.

## Active-route handling

`markActiveLinks()` normalizes `/index.html` and trailing slashes, then flags any link whose `href` resolves to the current `pathname`. It runs after `buildTwoLevelNav()` so it sees the final, rebuilt link set. There is no per-page "this is the active page" flag to hand-maintain.

## The clipping bug (found and fixed this pass)

The original implementation nested the full-menu panel inside `.nav`. Nearly every page's own `.nav{...}` rule sets `backdrop-filter: blur(10px)` — which, per spec, creates a new **containing block** for any `position:fixed` descendant. That silently clipped the panel to `.nav`'s own (much shorter) box instead of the real viewport, cutting off the right-hand columns of the grouped menu on desktop.

Fix: `buildTwoLevelNav()` moves the panel to be a direct child of `<body>` at runtime (`links.classList.add('navFullMenuPanel'); document.body.appendChild(links)`), escaping `.nav` as an ancestor entirely. `nav.css` selectors were updated from `.nav .navLinks` to `.navLinks.navFullMenuPanel` to keep the same specificity guarantee against a page's own unscoped `.navLinks{...}` rule, without depending on DOM nesting.

Two related layout bugs surfaced and were fixed in the same pass:
- Grid/flex items default to `min-width:auto`, which refuses to shrink a pill below its own unwrapped text width — long labels ("Transparency Center") were bleeding out of their column. Fixed with `min-width:0` + `white-space:normal`.
- Pills use the browser's default `box-sizing:content-box`, so `width:100%` only sized the *content* box — the pill's own padding+border rendered on top of that, overflowing its grid column by exactly `13px+13px+1px+1px=28px`. Fixed with `box-sizing:border-box`.

## Intentional divergences

**Mole Hub, Quiz, and Faucet keep their own pre-existing arcade-style nav** (`.navLinks.arcadeLinks`) instead of adopting the canonical grouped panel. `buildTwoLevelNav()` explicitly skips any `.navLinks` that also carries `.arcadeLinks`. This is a deliberate choice, not an oversight: these three pages' own hand-curated link lists (How to Play, Rewards, Leaderboards, etc.) have no equivalent in the canonical `NAV_GROUPS`, and the design direction for this pass was to use Mole Hub as a *quality bar*, not to mechanically flatten its identity into the generic shell. Their mobile collapse behavior is still shared (`.nav .navLinks.arcadeLinks{display:none}` / `.navOpen{display:flex}` in `nav.css`) — only the desktop "always show the full row, no toggle-gating" behavior and the link content itself remain page-owned.

## Accessibility

- `role="menu"` / `role="menuitem"` on the rebuilt panel and its links.
- `aria-expanded` / `aria-controls` kept in sync on the trigger.
- Visible focus (`:focus-visible` with the shared `--ring` token) on both the trigger and every menu link.
- Escape returns focus to the trigger — never left stranded.
- No `<div>` posing as an interactive control — the trigger is a real `<button>`, every destination a real `<a href>`.

## How validation prevents broken links

`test/nav/site-nav.e2e.test.mjs` drives every canonical page with real Chromium at 390/768/1440px and asserts: the trigger is visible everywhere, the primary row's visibility matches the breakpoint, the panel is closed by default and opens/closes via click/Enter/Escape/outside-click, the open panel's bounding box never extends outside the viewport (the regression test for the clipping bug above), every link has a real non-placeholder `href`, activating a link actually navigates, and the scroll lock is released on close.

## How authenticated links are treated

Nothing in the public menu requires authentication to be *visible* — Dashboard, Verify Wallet, Submit a Proposal all render for signed-out visitors, since each of those destination pages already handles its own "sign in first" state (see e.g. `/governance/submit/`'s `#signedOutBlock`). The menu itself never conditionally renders a link based on session state — that keeps `buildTwoLevelNav()` simple and avoids a second place session logic could drift from the page it's linking to.

## Footer

`nav.js`'s `buildSiteFooter()` renders the exact same `NAV_GROUPS` data as the mega-menu — same 5 groups, same order, same labels — as an always-visible sitemap injected at the end of `<body>` on every page that loads `nav.js` (guarded by `document.querySelector('.wlSiteFooter')` so it never double-renders). This is deliberate: desktop, mobile, and footer are one data source with three renderers, not three things a future edit could let drift apart. A handful of pages also have their own small page-local `<footer>` with a one-line copyright note (e.g. `src/public/index.html`) — left untouched, since `buildSiteFooter()`'s output is a distinct, later element and the two coexist without a markup change to those pages.

## 2026-07-18: design-system unification

User-provided "WinLEW Design System" spec + screenshots showed the site still read as "two different websites": Verify's header was visibly broken (bespoke `chip`/`glow` brand markup instead of the standard avatar+tagline block, and no `NAV_PAGE_IDENTITY` entry at all), and every non-arcade page (Home, Dashboard, Governance, Burn, Transparency, Whitepaper, Health, Modules, Events, Partners, Discord Bots, Forge, Leaderboards) had `Dashboard` + `Menu` in `.navRight` but no Connect Wallet control — only Quiz/Faucet/Mole Hub had one.

What changed:

- **Verify fixed**: `/verify/index.html` and `/verify/profile.html`'s brand markup normalized to the standard `<a class="navBrand">$WinLEW</a>` pattern (was bespoke `chip`/`glow` spans); both now have `NAV_PAGE_IDENTITY` entries (`VERIFY · LINK · TRUST` / `DASHBOARD · TRACK · GROW`).
- **Connect Wallet everywhere**: every non-arcade page now has `#navWalletConnect` in `.navRight`, wired to `wallet-auth.js`'s shared `walletLogin()` (same one-line pattern Faucet/Quiz already used) — `Home`, `Verify`, and `WinLEW Forge` didn't load `wallet-auth.js` at all before this and now do.
- **Balance chip everywhere (correction, same day)**: the first pass of this work stopped short — the user's screenshots showed Quiz's account area has FOUR elements (Dashboard, a points/balance chip, the wallet-identity/connect control, Menu), not three. Added a `.navBalanceChip` (real live WinLEW balance, not a fabricated number) between Dashboard and Connect Wallet on all 14 non-arcade pages. Data comes from a new `GET /api/wallet/balance` route in `web.js`, which is a thin wrapper around the *already-existing* `resolveGovernanceEligibility()` (called with no proposal) — this reuses `checkLiveWinlewEligibility()`'s existing 60s-per-wallet cache for free rather than adding a second cache. New shared `WinLEWAuth.refreshWalletBalance()` in `wallet-auth.js` renders it (or "—" when signed out / unverified / RPC-down — never a fabricated "0.00"). The chip is deliberately sized to match this file's own compact `.pill` dimensions, not Mole Hub's much taller in-page `.walletPill` (52px) — Standard pages must match each other's header height, not arcade's.
- **Mobile regression found and fixed in the same pass**: adding the 4th `.navRight` item pushed `WinLEW Forge` (and, by the same mechanism, every other non-arcade page) past 390px width — `.navRight{flex-shrink:0}` meant it refused to shrink once it no longer fit alongside the (already-hidden-on-mobile) primary row, and its own `flex-wrap:wrap` never got a chance to reflow its children onto a second row because the box itself wasn't constrained to the viewport. Fixed with a mobile-only `.navRight{flex-shrink:1;min-width:0;max-width:100%}` override, letting the 4 pills wrap onto 2 rows within the real available width instead of overflowing. Caught by `test/nav/site-nav.e2e.test.mjs`'s "must not cause horizontal page scroll at 390px" assertion — exactly what it's for.

- **A second, worse desktop regression (same day, caught by the user, not by any automated check)**: at real desktop widths, the header was wrapping onto 2 rows on every non-arcade page — 5 primary links + a 4-item account area needed ~1438px, but `.navInner` was capped at 1000px. Fixed by widening `.navInner`'s max-width to 1600px on all 14 pages (and `--wl-content-max` to match) — the same value Mole Hub's own arcade grid nav already uses, so it's a real established precedent, not an arbitrary number.

  That widening then exposed a THIRD, deeper bug, found by direct pixel measurement (`getBoundingClientRect()`) after the screenshot itself looked wrong in a way raw DOM measurements initially didn't explain: 7 of the 14 pages (Burn, Governance, Transparency, Partners, Modules, Events, Whitepaper) have `body{ max-width: ...; margin: auto; overflow-x: hidden }` — a narrower, centered box with its own overflow clip. `.nav`'s intentional full-bleed technique (`margin-left/right: calc(50% - 50vw)`, escaping body's own width to span the true viewport) still computed correctly, but **body's `overflow-x:hidden` clips any descendant to body's own box** regardless of negative margins pulling it wider — so the bled portion of `.nav` (everything outside body's narrow centered box) was being silently clipped away. This existed on all 7 pages since the original 2026-07-12 bleed-technique work, invisible the whole time because nav content never previously needed to actually occupy that bled space — it only became visible content-clipping (brand tagline cut on the left, the rightmost account pill and Menu cut on the right) once the account area grew to 4 items.

  Fixed per-page: removed `overflow-x:hidden` from `body` on 6 of the 7 (Burn, Governance, Transparency, Partners, Modules, Events) — `html`'s own `overflow-x:hidden` already fully covers "no page-level horizontal scroll," confirmed via the e2e suite's 390px check on all 6 with no regression. **Whitepaper was different**: removing it from body reproduced a *real* mobile overflow (this page has wide §3/§5/§13 tables that genuinely need it) — so body's `overflow-x:hidden` was restored there, and a new `.wlBodyScroll` wrapper (around everything except `.nav`) carries that same protection instead, scoped so it no longer also clips the nav.

  **Lesson**: a screenshot that looks wrong in a way `getBoundingClientRect()` doesn't explain usually means an ancestor is clipping the paint, not that the measured element's own box is actually wrong — check ancestor `overflow` before trusting "the numbers say it fits."

- **A FOURTH problem, the real one the user meant by "still looks like dog shit"**: every fix above was structural (fit, clipping, wrapping) — none of it addressed that the brand block itself was simply tiny next to Quiz/Faucet/Mole Hub's. Their own `.brandAvatar`/`.brandTitle`/`.brandSub` (`mole-hub/css/styles.css`) are 64px/40px/15px; the shared `.navAvatar`/`.navBrandWord`/`.navTagline` this whole pass had been using were 36px/~16px(inherited, never set explicitly)/10px — roughly half scale, on every non-arcade page, the entire time. Fixed in `nav.css`: avatar 36→56px, wordmark set explicitly to 32px/weight 1000 (was inheriting an unset ~16px), tagline 10→13px (with `@media(max-width:860px)` stepping down to 44px/26px/11px rather than hiding the tagline entirely, matching Mole Hub's own responsive behavior — it scales its brand block down at narrow widths too, it doesn't hide it).
- Widening the brand block correspondingly widened the whole header's minimum content — `.navInner`'s max-width went from 1600px to 2000px, and the single-row threshold moved from ~1480px down to ~1470px for the worst case (Whitepaper — 5 links + the longest tagline). Below that it cleanly wraps to 2 rows rather than clipping or overlapping — checked against Mole Hub's own behavior, which similarly stops being single-row below ~1366px, so this isn't a new class of fragility, just the same kind of tradeoff the canonical reference pages already have.
- Also found and fixed 2 pages with a stray hardcoded brand string instead of the plain `$WinLEW` every other page uses: Health said `$WinLEW Health`, Leaderboards said `$WinLEW Leaderboards` — the tagline already conveys the page identity, matching the other 12.

- **A FIFTH round, same day**: the sizing fix above (56px/32px/13px) was STILL visibly smaller than Mole Hub's real numbers, and used a circle instead of Mole Hub's rounded-square, and kept the `$` prefix Mole Hub's own wordmark doesn't have (its `.brandTitle` literally renders "WinLEW", not "$WinLEW"). Fixed by matching Mole Hub's exact CSS values instead of a rounded approximation: avatar 64px / `border-radius:20px` (was 56px circle), wordmark 40px weight 1000 (was 32px), tagline 15px (was 13px) — and removed the `$` from all 14 pages' brand link text. `.navInner` widened once more (2000px, unchanged) and `.navTagline`'s max-width raised to 420px so the longest taglines (Whitepaper's) don't truncate at the new larger font size. Single-row threshold is now ~1440-1480px for most pages, ~1480-1600px for the worst case (Whitepaper, 5 links) — within the same range Mole Hub's own nav requires (~1366px), not a new class of fragility.

- **A SIXTH round, same day**: user compared Leaderboards/Home directly against Mole Hub side-by-side and flagged 2 more real things: (1) the avatar sat measurably further left than Mole Hub's — `.navInner{padding:14px 22px}` vs Mole Hub's own `.navInner{padding:14px 32px}` (`mole-hub/css/styles.css`); fixed by matching 32px on all 14 pages. (2) The avatar itself "looks out of place" next to Mole Hub's real illustrated mascot — this one isn't a CSS bug, Mole Hub uses an actual image asset and Standard pages use a generic emoji on a uniform amber gradient. Asked the user directly rather than guessing a 6th time; they chose "themed color per page, keep emoji" over a shared logo image or commissioning new art. Implemented: `nav.css`'s `.navAvatar` background and `.navTagline` color now read `--avatar-c1`/`--avatar-c2`/`--tagline-c` custom properties (falling back to the original uniform amber), set inline by `nav.js`'s `applyBrandIdentity()` from a new `accent: [c1, c2, taglineColor]` field on 5 `NAV_PAGE_IDENTITY` entries whose doc-specified color differs from the default gold/amber: Burn (burnt orange), Transparency (teal), Health (green), Verify (blue/cyan), Whitepaper (slate/silver). Governance, Modules, Partners, Events, Dashboard, Home, Leaderboards, Discord Bots, Forge keep the default amber — matching the doc's own table exactly (those are its "gold/amber" or unlisted entries).

- **Round 7: the 20 sub-pages nobody had touched yet.** The prior 6 rounds only covered the 14 pages already listed at the top of `NAV_PAGE_IDENTITY`. `grep -rl "assets/nav.css" src/public` turned up 20 more pages loading the shared nav that had never gotten ANY of this pass's fixes: 12 `/discord-bots/*.html` policy pages, `/governance/proposal/` + `/governance/submit/`, and 6 `/modules/*.html` detail pages. Rather than hand-adding 20 more `NAV_PAGE_IDENTITY` entries, added a `findParentIdentity(here)` fallback to `nav.js` — matches the LONGEST registered directory-style key (e.g. `/discord-bots/`) that a page's path is nested under, when there's no exact entry for that page itself. One function, and every current AND future sub-page of a themed section inherits that section's avatar/tagline/accent/primary-row automatically. Then applied the same mechanical fixes as the 14 top-level pages to all 20: Connect Wallet button + balance chip in `.navRight`, `wallet-auth.js` (18 of the 20 had never loaded it at all), `.navInner` padding (32px) + max-width (2000px), and — on the 6 `/modules/*.html` pages specifically — the same bespoke `brandMark`/`chip`/`glow` markup Verify/Forge had in round 1, replaced with standard `<a class="navBrand">`. Also found the SAME body-`overflow-x:hidden`-clips-the-bled-nav bug from round 3 independently present on `/governance/proposal/` and `/governance/submit/` (not the 6 originally-fixed pages — a separate pair of files with their own copy of the same old pattern) — fixed the same way. Added `/governance/submit/` to the e2e suite's page list (63 tests now, was 60) since it hadn't been covered before either.
- **`NAV_PAGE_IDENTITY` corrected against the spec's exact per-page table**: Transparency/Modules/Health/Whitepaper/Partners had primary-row links or taglines that had drifted from the spec (e.g. Partners linked Governance+Discord Bots instead of Events+Transparency) — corrected. Added a `/winlew-forge/` entry (previously had none).
- **`.navInner{max-width:...}` standardized to 1000px** on every non-arcade page (was 900-1240px per page, hardcoded independently) — matches `--wl-content-max` in `nav.css`. Each page still carries the literal value locally rather than the CSS variable, since `nav.css` loads before each page's own `<style>` block and can't win the cascade — see the comment at the top of `nav.css` for why.
- Arcade pages (Quiz/Faucet/Mole Hub) were **not** touched — they remain the canonical reference per the spec.

Verified via `test/nav/site-nav.e2e.test.mjs` (60/60) after each phase, plus manual Playwright screenshots of Verify/Governance/Home/Forge confirming the avatar+tagline+Connect Wallet render correctly with zero console errors.

## 2026-07-25: information-architecture refactor (Account removed, Governance added)

Requested as a full IA pass: navigation should read by user intent ("What can I
do? → Can I trust this? → How can I help? → How is everything built? →
policies"), not internal project categories. Changed `NAV_GROUPS` only — since
it's the single data source behind the mega-menu, the mobile panel, AND the
footer (`buildGroupedPanel()` / `buildSiteFooter()`), this one edit updated
all three surfaces identically with zero risk of desktop/mobile/footer drift.

- **Removed the `Account` group.** Dashboard and Verify Wallet moved into
  `Play & Participate` (per the requesting brief: they're the *start* of
  participating, not account management). Governance and Submit a Proposal
  moved into a new standalone `Governance` group.
- **New `Governance` group**: Governance, Submit a Proposal, Sponsors &
  Partners (moved out of Trust & Transparency), XYO Ecosystem (moved from
  its own unlisted spot — previously reachable only via its own page's
  primary row, not the mega-menu/footer at all).
- **2026-07-25 correction, same day**: this entry originally read "XYO
  Partnership" — flagged by the user as confusable with an actual official
  partnership, which directly contradicts `/xyo/`'s own FAQ ("Is WinLEW
  officially partnered with XYO? No... No official partnership has been
  announced, and none should be assumed"). Renamed to "XYO Ecosystem",
  matching that same page's own H1 ("Supporting the XYO Ecosystem") and its
  `<title>` ("WinLEW × XYO — Community Ecosystem") — neither of which ever
  used the word "Partnership" either. Label-only change, same `/xyo/` path.
- **Fixed a real duplicate**: `Play & Participate` had both "The Mole Hub" and
  "Games" pointing at the identical `/mole-hub/` URL. Kept one entry under the
  site's established brand name.
- **Fixed a real orphan**: `/leaderboards/` had never had a mega-menu/footer
  entry in any group (reachable only from a couple of pages' own primary
  rows) — added to Play & Participate.
- **Contribute** stays in Trust & Transparency (asked the user directly since
  it isn't mentioned anywhere in the requesting brief's explicit item lists;
  they chose to leave it where it already was rather than move it to
  Governance or Play & Participate), repositioned right after Burn Center.
- **Two more real orphans found during the audit, unrelated to the menu/footer
  IA itself**: `/bounties/` and `/who-we-are/` had no `PAGE_CONFIGS` entry at
  all, so both silently rendered the Homepage's own tagline/accent/primary-row
  (fallback to `PAGE_CONFIGS[0]`) instead of their own identity. Gave each a
  proper entry (own `active` id, short primary row, subtitle) — same default
  amber accent every other undecorated page already uses, not a new color
  choice. Both also added to `test/nav/site-nav.e2e.test.mjs`'s `PAGES` list
  (81 tests now — 27 pages × 3 viewports, was 75) and
  `scripts/header-audit.mjs`'s route list, since neither tool had ever
  covered them.
- **THIS BUG RECURRED (2026-08-05), because the fix above was manual.** Adding
  two pages to two hardcoded lists by hand fixed those two pages and left the
  mechanism untouched, so it happened again — this time to eight pages: the
  seven `/ecosystem/<slug>/` sister-project pages and
  `/no-thank-you/promotions/`. All eight are listed in `NAV_GROUPS`, all eight
  had no `PAGE_CONFIGS` entry, and all eight were verified in a real browser
  rendering the storefront's `WELCOME • LEARN • BEGIN` subtitle with **Home**
  highlighted as the active link. Neither the e2e `PAGES` list nor
  `header-audit.mjs`'s routes covered any of them, which is why nothing caught
  it.

  **`test/nav/navRouteCoverage.test.mjs` now closes this for good.** It parses
  `NAV_GROUPS` and fails if any nav route lacks an exact `PAGE_CONFIGS` entry
  or is missing from the header-audit route list. Remember `PAGE_CONFIGS`
  matching is **exact, not by prefix** — a parent entry never covers its
  children, which is precisely how `/no-thank-you/promotions/` slipped past an
  entry whose own comment was about avoiding the Home fallback.
- **`header-audit.mjs` moved out of the published web root** (2026-08-05):
  `src/public/scripts/` → `src/scripts/`, joining every other dev tool, and run
  with `npm run header:audit`. It had been downloadable from the live site.
- **Fixed a pre-existing active-state bug found in the same audit**: the
  `/policies/` page's `PAGE_CONFIGS` entry had been copy-pasted from Discord
  Bots (`nav: NAV_SETS.bots`, `active: 'bots'`), so visiting `/policies/`
  highlighted "Discord Bots" as its own active primary-row link instead of
  itself. Added a small `NAV_SETS.policies` (Home, Policies, Terms, Privacy,
  About) and pointed the entry at `active: 'policies'`. Icon/accent left
  unchanged — a branding choice, not part of this fix.
- Column sizes are now 8/6/4/5/3 across the 5 groups (was 5/4/7/5/3 with
  `Account`) — no CSS change needed for this; `.wlSiteFooterGrid` and
  `.navFullMenuPanel` already lay out groups as equal-width `1fr` grid columns
  (`repeat(auto-fit, minmax(...,1fr))`), so a more even item count per group
  is a data-only improvement.
- **One real CSS bug found and fixed while eyeballing the result at 390px**:
  `.navLinks.navFullMenuPanel` (nav.css) never explicitly set `align-items`,
  so a page's own leftover unscoped `.navLinks{align-items:center}` rule (its
  old pre-shell desktop pill row) leaked through on that one property —
  exactly the same "CSS cascades per-property, not per-rule" trap this file's
  comments already call out twice for `flex-wrap` and `box-sizing`/
  `min-width`. Net effect: on mobile/tablet, every `.navGroup` shrank to its
  own content's width and centered itself independently instead of
  stretching edge-to-edge — Dashboard/Faucet/etc pills 332px wide, "Build &
  Explore"'s pills only 148px and shifted right, not aligned with its
  neighbors above/below. Fixed with one explicit `align-items:stretch` on the
  base rule (mirrors the existing `flex-wrap:nowrap` fix immediately above
  it). Confirmed via `getBoundingClientRect()` on every `.navGroup`: all 5
  now report the identical 332px width and 29px left offset at 390px width
  (was 5 different widths/offsets before). This was latent before this pass
  too — not something the group-count/label change caused — just newly
  visible because Play & Participate now has enough items to make the
  misalignment obvious at a glance instead of a couple-pixel discrepancy.
- No colors, typography, spacing, animation, or component styling changed
  otherwise — only `NAV_GROUPS` content, the 3 new/fixed `PAGE_CONFIGS`/
  `NAV_SETS` entries above, the one `align-items` layout-mechanics fix above,
  this doc, and the two test/audit-tool page lists.

Verified via `test/nav/site-nav.e2e.test.mjs` (81/81 across 390/768/1440px), a manual link-inventory grep confirming every `NAV_GROUPS` path resolves to a real file/directory, and a grep confirming `/mole-hub/` now appears exactly once in `NAV_GROUPS`.
