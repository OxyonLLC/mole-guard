# Site Navigation & Link Audit

Date: 2026-07-10
Scope: shared mobile hamburger navigation (`src/public/assets/nav.css` + `nav.js`) and a full first-party link audit of `winlew.co`.

## 1. Executive Summary

The reported bug ("hamburger opens, links don't respond, inconsistent across pages") was **not** a JavaScript click-handler bug. `nav.js` was correct on every page. The actual defect was a **CSS specificity collision**: 17 of 21 pages that load the shared `nav.css` also define their own unconditional `.navLinks{display:flex;...}` rule in an inline `<style>` block, for desktop layout, written before the shared mobile-collapse system existed. Because that page-local rule has the same specificity as `nav.css`'s `@media(max-width:860px){.navLinks{display:none}}` rule and loads *later* in the document, CSS's "last rule wins on a specificity tie" behavior let the page-local rule silently defeat the mobile collapse on every affected page. **Mole Hub, Quiz, and Faucet never had that page-local override**, which is the entire reason Mole Hub "worked" — it isn't running different, better code; it's the only page family that never fought its own nav.css.

A second, related bug was found and fixed the same way: on pages with a nowrap tagline chip next to the logo (root, verify, verify/profile, winlew-forge), that chip's un-shrinkable text width plus the Profile pill and toggle button exceeded 390px, pushing the toggle button itself out of the reachable viewport / under the Profile pill on narrow phones — confirmed with a real (non-forced) Playwright tap that failed with `<a class="pill navProfile"> intercepts pointer events`.

Both are fixed in the **one shared file**, `src/public/assets/nav.css` — zero pages needed their own bespoke patch for the collapse behavior itself. Separately, `mole-hub`, `quiz`, and `faucet` had their nav (and some body) links hardcoded to absolute `https://winlew.co/...` URLs instead of the root-relative convention every other page uses; these were normalized for consistency and testability.

30 new Playwright-driven browser tests (`test/nav/site-nav.e2e.test.mjs`) now cover all 10 distinct page templates at mobile/tablet/desktop, using **real taps that fail loudly on interception** (never `element.click({force:true})`). All 107 tests in the repo (77 pre-existing + 30 new) pass.

## 2. Root Cause, In Detail

### 2.1 Why Mole Hub worked and the homepage didn't

Both pages load `nav.css` in `<head>` and `nav.js` at the end of `<body>` — identical markup convention (`.nav > .navInner > .navLinks#siteNavLinks`, `.navToggle[aria-controls="siteNavLinks"]`). The divergence is entirely in each page's own inline `<style>` block:

| | Homepage (`src/public/index.html`) | Mole Hub (`src/public/mole-hub/index.html`) |
|---|---|---|
| Own `.navLinks{...}` rule? | Yes, line 82: `display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;` (unconditional, no media query) | **No such rule exists.** Mole Hub relies entirely on `nav.css` for `.navLinks` display behavior. |
| Result at ≤860px | `nav.css`'s `@media(max-width:860px){.navLinks{display:none}}` and the homepage's unconditional `.navLinks{display:flex}` have equal specificity (one class each). The homepage's rule loads later in the document (its `<style>` block is after the `nav.css` `<link>`), so **it wins** — `.navLinks` stays `display:flex` at every width, all 8 pills stay rendered inline, and the "collapsed" menu was never actually collapsed. | No competing rule exists, so `nav.css`'s `display:none` applies cleanly, `.navToggle` shows, and `.navOpen` correctly toggles visibility. |

The same pattern (a local, unconditional `.navLinks{display:flex;...}` rule) was found on 17 of the 21 pages that include `nav.css`:

- `src/public/index.html`
- `src/public/verify/index.html`
- `src/public/verify/profile.html`
- `src/public/health/index.html`
- `src/public/winlew-forge/index.html`
- `src/public/discord-bots/index.html` + all 12 `privacy-*.html` / `terms-*.html` policy pages (byte-identical rule, from the earlier scripted nav retrofit)

`mole-hub`, `quiz`, and `faucet` never had this rule — they're the "control group" that happened to work.

### 2.2 The fix (single shared file)

`src/public/assets/nav.css`, inside `@media(max-width:860px)`: raised the collapse rule's specificity from `.navLinks` (one class) to `.nav .navLinks` (two classes) so it wins regardless of a page's own unscoped rule or load order:

```css
.nav .navLinks{ display:none; ... }
.nav .navLinks.navOpen{ display:flex }
.nav .navLinks .pill{ width:100% }
```

This was chosen over patching all 17 pages individually because the task is architecturally a **shared-component bug**: nav.css's own header comment already documents the intent ("loads on every page ALONGSIDE that page's own nav rules... only adds what none of them have"), so the fix belongs where the shared contract is defined, not scattered across 17 near-duplicate edits.

### 2.3 The second bug: toggle button pushed out of the viewport

Confirmed via Playwright at 390px width with `isMobile:true` (which honors the page's own `<meta name=viewport>`, matching real phone behavior more closely than a plain narrow browser window): on the homepage, `window.innerWidth` measured **457px**, not 390px, because `.navInner` is `flex-wrap:nowrap` and its children don't shrink below their content's natural width by default. The brand chip span (`.chip{white-space:nowrap}`, text "MemeFi • Proof of Value") plus the Profile pill plus the toggle button together demanded ~423px minimum — wider than the 390px viewport — so the mobile browser widened its layout viewport to fit, and the toggle button rendered partially off-screen / overlapping the Profile pill. A real (non-forced) Playwright click on `.navToggle` failed with:

```
<a class="pill navProfile" href="/verify/profile.html">👤 Profile</a> intercepts pointer events
```

**Fix**, added to the same `nav.css` mobile block, scoped to the shared `.brandMark`/`.chip` class names used by root, verify, verify/profile, and winlew-forge:

```css
.nav .brandMark{ min-width:0 }
.nav .brandMark .chip{ max-width:150px; overflow:hidden; text-overflow:ellipsis }
```

The tagline now truncates with an ellipsis instead of forcing the row wider than the screen. Visual identity (the pill badge, its color, its position) is unchanged — only its maximum width is capped.

Verified after the fix: every one of the 10 tested pages renders at the correct 390px width with zero toggle interception (see §7).

## 3. Navigation Implementations Discovered

| Family | Pages | Nav markup pattern | Had the display:flex collision? |
|---|---|---|---|
| Standard | `/`, `/verify/`, `/verify/profile.html`, `/health/`, `/winlew-forge/`, `/discord-bots/*` (13 files) | `.nav > .navInner > .navLinks` + `.navRight` | Yes (17 files) |
| Arcade | `/mole-hub/`, `/quiz/`, `/faucet/` | `.nav > .navInner.navArcade > .navLinks.arcadeLinks` + `.navRight` (wallet/points chip) | No |
| Unreachable / stale | `src/public/discord-bots/bothub.html` | Own pre-nav.js/nav.css markup, no hamburger at all | N/A — see §9 |
| Intentional redirect (not stale) | `src/public/gaming-hub/index.html` | No nav markup at all by design — a tracked, minimal redirect stub to `/mole-hub/`, correctly excluded from the nav retrofit | N/A — see §9, corrected 2026-07-15 |

All "Standard" and "Arcade" pages share the same `nav.js` and, after this fix, the same effective CSS collapse/open/close behavior — this is the "one shared implementation" the task asked for, expressed as one file (`nav.js`) plus one file (`nav.css`) that every page opts into, rather than a server-rendered partial (this is a static-file site with no templating layer; see §12 for the recommended next step).

## 4. Canonical Route Map

| Label | Canonical path | Notes |
|---|---|---|
| Home | `/` | |
| Verify | `/verify/` | |
| Mole Hub | `/mole-hub/` | |
| Quiz | `/quiz/` | |
| Faucet | `/faucet/` | Built and deployed this cycle; **see §9 — not linked from any other page's nav yet.** |
| Discord Bots | `/discord-bots/` | |
| Profile | `/verify/profile.html` | |
| Health | `/health/` | |
| WinLEW Forge | `/winlew-forge/` | |
| Games overview | `/modules/games-trivia.html` | |
| About (same-page anchor) | `/#what` | |

**Fixes applied for consistency:** `mole-hub`, `quiz`, and `faucet` had every nav link (and a few body links on `mole-hub`) hardcoded as absolute `https://winlew.co/...` URLs while every other page already used root-relative paths. Converted all of them to the root-relative form above. This was not cosmetic — it also broke local/offline testing of these three pages' cross-page navigation, which is exactly the kind of thing an automated test should have caught before now (it does now).

## 5. Internal Link Inventory (crawl summary)

A same-origin crawler (`Playwright`, seeded at `/`, following every `<a href>` including JS-rendered ones, deduplicating normalized paths, avoiding logout/OAuth/destructive actions) reached **27 distinct pages** and recorded **427 link occurrences**. Full raw output is not checked in (it's a point-in-time crawl artifact); the pages reached:

```
/  /discord-bots/  /discord-bots/index.html  /discord-bots/privacy-{geoagora,geohackers,mole,utility,watchdog}.html
/discord-bots/terms-{geoagora,geohackers,mole,utility,watchdog}.html
/geoagora/profile/  /health/  /linked-role/mole/
/modules/{community-ops,core-infrastructure,games-trivia,proof-of-value-engine,quests-progression,utility-expansion}.html
/mole-hub/  /quiz/  /verify/  /verify/profile.html  /verify/profile.html?app=mole
```

`/discord-bots/privacy.html` and `/discord-bots/terms.html` exist and return 200 directly, but are not linked from any crawled page (only their per-bot variants are linked) — not a bug, just an unreferenced-but-working alias page.

Every internal link discovered resolved to a real page (HTTP 200) or a same-page anchor; no internal 404s or dead links were found among the 427 recorded link occurrences.

### 5.1 Placeholder links found

Two `href="#"` anchors on `/verify/profile.html` (`🌍 Open public view`, `🌍 Public profile`). **Investigated, not a bug**: `profile.js:132-147` sets a real `href` and un-hides these buttons only once a public profile URL is resolvable (`publicBtn.href = publicUrl || "#"`, `classList.toggle("hidden", !publicUrl)`). The `#` is a safe default before that JS runs, and the element stays hidden whenever there's no real destination. This is standard progressive enhancement, not a false interactive element — left unchanged.

### 5.2 Pages that exist and work but are unreachable from any current link

- `/faucet/` — see §9, the significant finding.
- `src/public/discord-bots/bothub.html` — see §9, stale duplicated markup.
- `src/public/gaming-hub/index.html` — see §9; **not** stale duplicated markup, corrected 2026-07-15 — it's a tracked, intentional redirect stub to `/mole-hub/`, same category as `winlew-forge.html`'s redirect shim (§5.2).
- `src/public/winlew-forge.html` (note: the flat file, not `/winlew-forge/`) — this one is fine as-is: it's a one-line meta-refresh + JS redirect shim to `/winlew-forge/`, for old bookmarks/links to the pre-directory URL. Not a bug.

## 6. External Link Inventory

20 unique external destinations found (all currently on the homepage). Checked with a real Chromium navigation (not just `curl`, since several of these sites block non-browser HTTP clients regardless of link validity):

| URL | Status | Classification |
|---|---|---|
| discord.gg/7mZ2JP87JS | 200 | OK |
| x.com/WinLewToken, x.com/LetEveryOneWin, x.com/LewSales, x.com/i/communities/... | 200 | OK |
| pump.fun/coin/... | 200 | OK |
| raydium.io/swap/..., raydium.io/liquidity/increase/... | 200 | OK |
| rugcheck.xyz/tokens/... | 200 | OK |
| coinmarketcap.com/dexscan/... | 200 | OK |
| t.me/LetsEveryOneWin | 200 | OK |
| winlew.co/GeoAgora | 200 | OK — self-referencing, labeled "(Under construction)" in the UI, intentional |
| solscan.io/account/..., solscan.io/token/... (5 links) | 403 via curl | **Bot protection**, not broken — Solscan blocks non-browser clients; do not alter |
| dexscreener.com/solana/..., dexscreener.com/ (3 links) | 403 via curl, **200 confirmed via real Chromium** | Bot protection only — verified genuinely reachable and correct, do not alter |
| geckoterminal.com/solana/pools/5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx | **404, confirmed via real Chromium** (title: "404: This page could not be found") | **Genuinely broken — external service limitation, not our bug.** The pool address is correct and case-correct (verified identical address resolves fine on DexScreener, showing live $11,575.73 volume), so GeckoTerminal simply hasn't indexed this specific pool. No corrected URL exists to substitute. Left unchanged; recommend periodic recheck. |

## 7. Mobile / Tablet / Desktop Test Results

`test/nav/site-nav.e2e.test.mjs` — Chromium via Playwright, real taps (`locator.tap()` / `locator.click()`, never forced), 3 viewports × 10 page templates = 30 tests, **all passing**:

- **Mobile (390×844, `isMobile`+`hasTouch`)**: hamburger visible & tappable with no interception, opens (`aria-expanded=true`), every menu link has a real non-placeholder `href`, tapping a non-self link navigates and the menu is not left open on the destination page, Escape closes it, tapping outside closes it, reopening after either close still works.
- **Tablet (768×1024)**: same checks, same results (768 < 860px breakpoint, so mobile-collapsed nav is exercised here too).
- **Desktop (1440×900)**: hamburger confirmed hidden (`display:none`), full link row visible without any interaction needed.

Console-error assertions run on every page too, with a narrow, precise allowlist: same-origin 404s are only excused when the URL is under `/api/*` (this test harness has no backend — this matches the task's own note that missing-API warnings on quiz/mole-hub are expected noise, not a nav bug). Any 404 for a page's own static assets (CSS/JS) would fail the test — that's deliberate, since "missing shared asset on nested routes" was one of the explicit failure classes to rule out, and none were found.

## 8. Accessibility

No changes were needed to `nav.js` itself — it was already correct:
- Real `<button type="button">` for the toggle (not a submitting form control).
- `aria-expanded` flips true/false on open/close.
- `aria-controls` correctly references the menu's id.
- `Escape` closes the menu (`document.addEventListener('keydown', ...)`).
- Outside click closes the menu without swallowing the triggering click on a real link (verified: the menu's own click listener closes-then-lets-navigation-proceed; no `preventDefault()` anywhere in `nav.js`).
- All menu items are real `<a href>` elements — nothing was converted to JS-only navigation.

These behaviors are now covered by the new automated tests (§7), so a future regression here will fail `npm test`, not just be caught by manual QA.

## 9. Significant Findings Beyond the Reported Bug

1. **`/faucet/` has no discoverable entry point from anywhere else on the site.** Its own nav (Faucet/Games/Quiz/Verify/About) is correct and now uses root-relative links, but no other page — not the homepage, not Mole Hub, not Quiz, not Discord Bots — links to it. A user has to already know the URL. This is very likely worth fixing, but it's a content/IA decision (which page's nav gets a new "Faucet" pill, and where) rather than a pure bug fix, so it was **not** changed here without confirmation. Flagging as the top recommendation in §12.
2. **One orphaned, stale duplicate nav implementation was found and (in a later cleanup pass) removed; a second file flagged alongside it turned out to be an intentional redirect, not stale markup — corrected below (2026-07-15).**
   - `src/public/discord-bots/bothub.html` — an old draft of `discord-bots/index.html` ("WinLEW — Bot Services"), own pre-nav.js markup, two separate `.navLinks{}` rules, no hamburger, no `nav.css`/`nav.js` includes at all. Confirmed unreachable and superseded; deleted in the `docs/platform-audit-2026-07.md` dead-code cleanup (commit `89ab5f8`).
   - `src/public/gaming-hub/index.html` — **not** stale duplicate markup. Its `<link rel="canonical" href="https://winlew.co/mole-hub/">` was correctly read as a signal of supersession, but the conclusion drawn from it was wrong: this file isn't leftover pre-nav.js markup that needs replacing, it's a tracked, 11-line, intentional redirect stub (`location.replace("/mole-hub/" + location.search + location.hash)`) — there's no nav to retrofit because the page does nothing but redirect. `git show --stat` on commit `9592591` ("Connect Mole Hub wallets through shared hosting") confirms `mole-hub/` is `gaming-hub/`'s direct, renamed successor (`{gaming-hub => mole-hub}` renames for `js/games/*.js`, `css/styles.css`, `ROADMAP.md`, and more). `/gaming-hub/` correctly redirects to `/mole-hub/` today, both client-side (this stub) and server-side (`.htaccess`'s `gaming-hub(?:\.html)?/?$ → /mole-hub/` rewrite). The untracked leftover files that *were* genuinely stale (old `app.js` variants, superseded build/patch-note docs, unshipped-game assets) sat alongside this stub in the same directory and were removed in the same later cleanup pass — the redirect stub itself was correctly left in place throughout, and should remain.
3. **GeckoTerminal 404 on the homepage** (§6) — external, not fixable from this repo.

## 10. Files Changed

- `src/public/assets/nav.css` — the two shared fixes (§2.2, §2.3). This is the entire fix for the reported bug; it applies to all 21 pages that load this file.
- `src/public/mole-hub/index.html` — nav + body links converted from absolute `https://winlew.co/...` to root-relative.
- `src/public/quiz/index.html` — nav links converted to root-relative.
- `src/public/faucet/index.html` — nav links converted to root-relative.
- `test/nav/site-nav.e2e.test.mjs` (new) — 30 Playwright regression tests, §7.
- `package.json` / `yarn.lock` — added `playwright` as a devDependency (test-only; not shipped to any running service).

**Not touched** (by this navigation audit itself): `src/public/discord-bots/bothub.html` (later deleted in a separate cleanup pass, see §9), `src/public/gaming-hub/index.html` (correctly left alone — it's an intentional redirect, not orphaned nav markup; see §9), all `<link rel="canonical">` / `<meta property="og:*">` / favicon absolute URLs (those are conventionally absolute regardless of navigation concerns), the GeckoTerminal link (§6), and every other file in the repo untouched by `git status` at the start of this task (working tree was clean before this change).

## 11. Verification Commands Run

```
npx playwright install chromium      # one-time browser install for this suite
npm test                             # full repo suite: 107/107 passing (77 pre-existing + 30 new)
node --test test/nav/site-nav.e2e.test.mjs   # nav suite in isolation: 30/30 passing
```

No build step exists for this static site (`src/public` is served as-is by `src/public-server.js` / Docker); local verification used `express.static` directly (same static-serving code path the production `public-server.js` uses) inside the test file, plus a standalone `python3 -m http.server` session for interactive/manual crawling and the original bug reproduction.

## 12. Recommended Next Steps

1. **Add a `/faucet/` entry point** somewhere reachable — most natural fits are the homepage's main nav (next to Verify/Mole Hub/Quiz/Discord Bots) and/or Mole Hub & Quiz's arcade nav (they already cross-link to each other and to Verify). Needs a product decision on placement/wording, not just a code change.
2. ~~Delete `src/public/discord-bots/bothub.html` and `src/public/gaming-hub/index.html`~~ — **done for `bothub.html`** (removed in the `docs/platform-audit-2026-07.md` cleanup, commit `89ab5f8`); **not applicable to `gaming-hub/index.html`**, which turned out to be an intentional redirect stub, not stale duplicate markup — see the correction in §9. It should remain. The untracked cruft that genuinely was stale, sitting alongside it in the same directory, was removed instead.
3. **Longer-term**: this is a static-HTML site with no templating layer, so the nav's HTML skeleton is still duplicated 21 times (only the CSS/JS behavior is centralized). If more nav changes are anticipated, consider a build-time include step (even a small Node script that stamps a shared `nav.html` fragment into each page at deploy time) so the markup itself — not just its styling and scripting — has one source of truth.

## 13. Status Legend Applied Above

- **Fixed and verified**: the CSS specificity collision (§2.2), the toggle/Profile-pill overlap (§2.3), the absolute→root-relative link normalization (§4) — all covered by the new automated tests and manually re-checked via Playwright.
- **Existing intentional behavior**: the `#`-placeholder public-profile buttons (§5.1), `winlew-forge.html`'s redirect shim (§5.2), the self-referencing "active" nav links on arcade pages (e.g. Mole Hub's "Home" pointing at `/mole-hub/`).
- **Deferred (recommendation only, needs a product/content decision)**: adding a `/faucet/` nav entry point (§12.1).
- **Blocked (external, not fixable here)**: the GeckoTerminal 404 (§6).
