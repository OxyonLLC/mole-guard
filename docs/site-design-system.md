# WinLEW Site Design System

Date: 2026-07-12

## Visual principles

Extracted from Mole Hub (the established quality bar), applied where it strengthens an older page — never applied mechanically, never at the cost of a page's own purpose:

- **Clear visual hierarchy** — one dominant heading, one primary action, supporting information visibly secondary.
- **Confident spacing** — generous card padding, real gaps between sections, not content packed edge-to-edge.
- **Card depth** — a soft radial glow + border + shadow reads as a deliberately designed surface, not a flat rectangle.
- **Consistent button/pill shapes** — one pill radius, one button height, everywhere.
- **Readable content width** — long-form content stays near `max-width:1000px`, never a full 1440px line length.
- **Balanced density** — neither a wall of unstyled text nor an over-decorated page fighting its own content.

## Canonical tokens

`src/public/assets/nav.css`'s `:root` block — **additive**, not a replacement for each page's own long-established `--line`/`--brand`/`--text`/`--ring`/`--shadow` locals (still fully honored; a page's own token wins where both are set, since page-local `<style>` loads after this shared stylesheet). New shared CSS, and any new page-level work, should prefer these:

```css
--wl-bg              #130b08
--wl-bg-elevated     #1b120e
--wl-panel           rgba(255,255,255,.045)
--wl-panel-strong    #150d09
--wl-border          rgba(255,255,255,.12)
--wl-border-accent   rgba(214,168,102,.34)
--wl-gold            #d6a866
--wl-gold-soft       rgba(214,168,102,.20)
--wl-text            #f6efe8
--wl-text-muted      rgba(246,239,232,.72)
--wl-radius-sm       10px
--wl-radius-md       14px
--wl-radius-lg       22px
--wl-shadow-card     0 22px 80px rgba(0,0,0,.42)
--wl-content-max     1000px
--wl-nav-height      64px
```

Every existing page already uses values *extremely close* to these (e.g. `#d6a866` gold, `#1b120e` panel background) under their own local names — the tokens formalize what was already the de facto palette, not a new one.

## Page types

Not every page should look the same — these are the four recurring shapes, matched to what a page is *for*:

### A. Platform / Action page
Quiz, Faucet, Verify, Governance voting, Dashboard. Strong branded hero, immediate user action, account/status context, supporting cards, one clear primary CTA.

### B. Transparency / Record page
Burn, Transparency, Partners, Events, Governance archive. Authoritative title treatment, evidence/status summary near the top, readable structured sections (timelines/tables/cards), restrained tone — **no arcade-style hype language or iconography**.

### C. Documentation / Policy page
Whitepaper, Terms, Privacy, Governance rules. Compact consistent header, a readable document container, contained table overflow (`overflow-x:auto` on the wrapping element, never the page), stronger typography than plain unstyled prose.

### D. Directory / Hub page
Mole Hub, Modules, Discord Bots. Clear category navigation, strong cards, visual grouping, consistent imagery, explicit destination CTAs.

## Intentional exception: Mole Hub

Mole Hub is the quality *bar*, not a template to force onto every page. Its distinct arcade personality (the `.navInner.navArcade` grid nav, `.arcadeLinks`, bold neon-adjacent accents on top of the shared brown/gold palette) is preserved deliberately — see `docs/site-navigation.md`'s "Intentional divergences". A serious transparency/record page (Burn, Governance) should *never* pick up arcade styling; the shared thing is craft level and the underlying design tokens, not literal visual sameness.

## Fixed this pass: the sticky-nav content-overlap bug

Found via real HTTP screenshots (not `file://`, which silently fails to load `/assets/...`-rooted stylesheets and produces misleading unstyled renders — see "file:// note" below): 20 pages used the identical pattern `.nav{position:sticky;top:0;margin:-32px -32px 0;...}` to bleed the nav bar to full viewport width by canceling `body`'s own `padding:32px`. On most of those pages this made the page's `<header>`/`<h1>` render **underneath** the nav bar by exactly 32px — the negative top margin's interaction with `position:sticky`'s "static position" calculation isn't consistently resolved the same way even across otherwise-identical markup (confirmed by direct `getBoundingClientRect()` comparison between an affected and an unaffected page with byte-identical CSS).

Fix, applied to all 20 affected pages: replaced the negative-margin bleed with the standard `margin-left:calc(50% - 50vw); margin-right:calc(50% - 50vw)` full-bleed technique, which achieves the same edge-to-edge visual result without touching `margin-top` at all — removing the ambiguous interaction with `position:sticky` entirely. Verified via `getBoundingClientRect()`: nav's bottom edge and the header's top edge now match exactly, on every affected page.

## `file://` note

Screenshots taken by opening a file directly (`file:///...`) rather than through a real HTTP server will show **broken/unstyled navigation** on nearly every page in this codebase — every shared stylesheet and script is referenced with a root-relative path (`/assets/nav.css`, `/assets/nav.js`), which resolves against the filesystem root under `file://`, not the site root. This is expected and is not a production bug; validation in this pass (and going forward) is against `src/public-server.js` or an equivalent real static server, never `file://`. See `docs/site-navigation.md` and the nav e2e suite for the real, HTTP-validated behavior.

## When to build a new page

1. Copy the shared shell markup (`.nav > .navInner > (.navBrand, .navPrimary placeholder, .navLinks, .navRight)`) from a recent canonical page (Governance, Burn, or Modules are current references) — `nav.js` rebuilds `.navPrimary`/`.navLinks` at runtime, so the page only needs the container structure and a correctly-linked `<script src="/assets/nav.js">`.
2. Pick the page type (A–D above) that matches the page's purpose, not its visual mood.
3. Reuse `--wl-*` tokens for anything new; don't invent a fifth color for gold or a second panel background.
4. Keep `body`'s full-bleed nav via the `calc(50% - 50vw)` technique — never the old negative-margin pattern.
5. Run the nav e2e suite against the new page before considering it done.
