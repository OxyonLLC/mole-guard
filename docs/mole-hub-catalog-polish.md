# Mole Hub catalog card polish (2026-07-19)

User reported the hub's game catalog looked visually broken in a
screenshot: inconsistent emoji use between cards, and payout text
overflowing/oversized. Reproduced and fixed each concretely rather than
guessing from the description.

## 1. Stale thumbnail cache (Grub Drop)

The screenshot showed Grub Drop's OLD flat-colored-squares thumbnail, even
though the file on disk was already the new mole-themed art from earlier
the same day. Confirmed via `git status`/direct re-render that the file
itself was correct — the browser was just serving a cached copy, since
`grubdrop-card.png`'s filename never changed. Fixed by adding a
cache-busting `?v=` query string to both places the thumb is referenced
(`catalogGames` and `gameLaunchCopy`), matching the versioning convention
already used on `<script>` tags elsewhere on this page.

## 2. Emoji inconsistency

Grub Drop's stat labels (`'🎚️ Difficulty'`, `'⏰ Round'`, `'💰 Payout'`) had
emoji prefixes baked in; all 5 other games use plain labels. Removed the
emoji to match the established site-wide convention.

## 3. Payout text clipping/overflow — real CSS bug, reproduced and measured

"Tunnel Tap"'s payout showed as "Planr" (or "Plan", depending on exact
width) instead of "Planned". Root-caused, not guessed:

- A "Final UI polish patch" CSS block force-set the Payout stat's font
  size to **30px** (24px on the narrowest mobile breakpoint) — fine at
  the wide 2-column tablet/laptop grid width this was evidently tuned at,
  but `.catalog-grid` switches to a 3-column layout above 1520px, which
  squeezes each card down to ~480px. Measured directly: at that width the
  Payout `<strong>` element had `clientWidth: 50` but needed
  `scrollWidth: 137` to fit "Planned" at 30px — the card's own
  `overflow:hidden` (for its rounded corners) clipped the excess instead
  of showing it, which is what read as truncated text.
- Fixed in two parts: (a) brought the payout/difficulty/time font sizes
  down from 28/24/20/30px to a more modest, consistent 19-20px range
  (`src/public/mole-hub/css/styles.css`'s `.catalog-stats strong` rules),
  with `overflow-wrap: break-word` added as a safety net so any future
  long value wraps instead of clipping; (b) the deeper issue was that
  `.catalog-card`'s own internal layout uses a fixed `252px` thumbnail
  column everywhere except the two narrower breakpoints — fine when 1-2
  cards share a row (plenty of room left for content), but at the
  ≥1521px 3-column range that left only ~176px total for title +
  description + the entire 3-column stats row. Added a targeted
  `@media (min-width:1521px)` rule narrowing just that column to `170px`
  for that specific range, without touching the `252px` value used
  everywhere else. Re-measured after both fixes: 0 overflowing stat
  values at 390/665/900/1440/1600/1920px, and the longest real payout
  values ("10–420 LEW", "2–160 LEW") now wrap cleanly at the natural word
  boundary instead of clipping or breaking mid-character.

## 4. Bonus: fixed a cropping glitch in the new Grub Drop thumbnail itself

While re-verifying the thumbnail fix, noticed the live card showed an
orphaned "ORIGINAL" watermark in the corner — the new thumbnail SVG (built
earlier the same day) had baked-in "Grub Drop / A WinLEW Underground
Original" wordmark text, but `.catalog-thumb`'s `object-fit:cover` crops
the 16:9 SVG into whatever narrower box the card actually renders, cutting
that text down to just its last word. No other game thumbnail has baked-in
text (the card already shows the title as real HTML next to the thumb) —
removed the wordmark group from the SVG and regenerated the PNG.

## Verification

- Measured `scrollWidth` vs `clientWidth` on every catalog stat value
  across 5 viewport widths (390/665/900/1440/1600/1920px): 0 overflow
  everywhere, before vs. after comparison confirms the fix.
- Visually confirmed via screenshots at each width — "Planned" fits fully,
  long payout ranges wrap cleanly at word boundaries, no more mid-word
  character breaks.
- Confirmed the new Grub Drop thumbnail renders without the watermark
  crop artifact in the actual live card (not just the standalone image).
