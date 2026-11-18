# /cunt/future/ landing-page concept

The page lives at **`src/public/cunt/future/`** and is served at
`winlew.co/cunt/future/`.

**These notes deliberately live outside `src/public/`.** They were previously at
`src/public/cunt/README.md`, which meant the whole staging posture — including
the unfinished-claims checklist at the bottom of this file — was downloadable by
anyone who guessed the URL. Do not move this file back under the web root.

## Why the page is one level down (2026-08-08)

`/cunt/` itself is a **guard stub** that redirects to `/no-thank-you/`, the same
pattern used for `/images/` and the other directory guards. The real page sits at
`/cunt/future/`.

The point is that the page is *live but unlisted* — reachable if you know the
path, invisible otherwise — because the token is still months out and the owner
does not want it shown off before it is finished. Four things hold that up, and
all four have to stay true:

1. `noindex, nofollow` on the page itself.
2. Not in `src/public/assets/nav.js` — no nav entry, no `PAGE_CONFIGS` row.
3. **Nothing links to it.** This is the one that will break first; a single
   `href="/cunt/future/"` from any indexed page undoes the rest.
4. **Not in `robots.txt`** — and it must stay out. A `Disallow: /cunt/future/`
   line would *advertise* the exact path to anyone who reads the file, which is
   the opposite of the goal. `noindex` is the mechanism; `robots.txt` is not.

The path is obscurity, not security. There is nothing secret on the page — it is
a deliberately unfinished teaser. Treat it as "don't show it off yet", not as
access control, and never put anything on it that would matter if found.

## What this build intentionally does
- Keeps the WinLEW dark / warm shell DNA while giving the meme page its own graffiti identity.
- Treats the token as a community meme experiment, not a second WinLEW utility token.
- **States that the token is moving to Solana, and says plainly that it started on Base.**
- Uses a staging posture: `noindex, nofollow`, "IN THE BELLY," and no aggressive buy CTA.
- Uses only local CSS, JS, and image assets; no build step or external dependency is required.

## The chain change (2026-08-07)

Originally this page described a **Base** token, and leaned on "different chain" to
separate the meme from $WinLEW. That separation is now gone: the token is moving to
**Solana**, where the Discord, the bots, the verified wallets and $WinLEW itself
already are.

Two consequences the page has to carry, and does:

1. **The "not the utility token" warning got harder, not easier.** On Base, the chain
   did the explaining. On Solana both tokens sit in the same wallet, the same
   explorer and the same Discord, so the distinction has to be made in words. That
   is the red-bordered block in `02 / RECEIPTS`. Do not quietly trim it.
2. **The Base origin is stated, not deleted.** Section `03 / THE PART WE COULD HAVE
   DELETED` says where it started, why it moved, and that the old contract still
   exists and must not be bought. The page one section earlier promises "we are not
   rewriting history" — dropping the chain it launched on would have made that a lie.
   It costs nothing to admit, because there were **zero outside buyers**.

## Files
- `src/public/cunt/index.html` — the guard stub (redirect to `/no-thank-you/`)
- `src/public/cunt/future/index.html`
- `src/public/cunt/future/assets/styles.css`
- `src/public/cunt/future/assets/app.js` — the copy-address handler; it no-ops safely while there is no
  mint (`if (!button || !contract) return;`), so the button is simply absent.
- `src/public/cunt/future/images/gods-joke-platypus.png`
- `src/public/cunt/future/images/original-cu-nt-art.png` (held as an alternate/reference asset)

## MUST be true before `noindex` comes off

- [ ] **Pull the Zora liquidity on Base.** The page states the old contract's
      liquidity "is being withdrawn so it can't be traded." Until that is done, that
      sentence is a claim rather than a fact — on the one page whose argument is that
      it doesn't hide things.
- [ ] **Mint the Solana token** and replace `not minted yet` with the real address.
      Never publish a placeholder address.
- [ ] Decide and publish supply, and whether mint authority is revoked.
- [ ] Re-verify every date, link and chain claim against live sources.
- [ ] Confirm the Base link still points at the retired contract and is still
      labelled as retired.
