# Dashboard (`/verify/profile.html`) reorganization (2026-07-20)

User reviewed the dashboard after several pages/features were added this
session (Leaderboards, per-game reward tracking, etc.) and asked for a
layout pass: move Quick Actions up, consolidate a few related cards, and
make long/growing sections collapsible. This was a pure HTML restructuring
— every element ID was preserved exactly, so `profile.js` (which populates
everything via `document.getElementById`, never by DOM position) needed
zero changes.

## What moved

- **"Overview"** (the user's own name for the profile header hero card —
  clarified directly, not guessed) now also contains **Milestones**,
  **Governance + Your votes**, **Profile settings**, and **Public profile
  & ecosystem links** — each still its own clearly-divided sub-section
  (bordered, own heading), just consolidated into the one "about you" card
  instead of being scattered as separate sections down the page.
- **Primary wallet snapshot** now also contains **Known wallets** and
  **Roles & holding tiers**, positioned directly above **GeoAgora link**
  as asked — again as their own distinct sub-blocks, not merged into one
  list.
- **Quick actions** moved up to directly follow the hero row, before the
  stat tables — now the first thing visible below the fold instead of the
  last owner-only section on the page. Added a **Leaderboards** button
  (the page added earlier this session had no dashboard entry point yet).
- **Recent activity** moved to sit next to **Gaming Hub reward history**
  and **By game** (now a 3-column row) — all three are reward-transparency
  views over the same underlying claim data, and Recent activity is last
  in that row / lowest on the page, satisfying both phrasings of the
  request ("at the bottom" and "next to reward history") at once, since
  they turned out to describe the same outcome.
- `ownerOnly` visibility flags were preserved exactly per original element
  (checked via `document.querySelectorAll(".ownerOnly")` in profile.js,
  which is class-based and DOM-position-independent) — e.g. Known wallets/
  Roles stayed owner-only even though they moved into a card that's
  otherwise public-visible; Milestones and Public profile links stayed
  public even though they moved into a card that also has owner-only
  sub-sections.

## Collapsible sections

Follow-up ask mid-task: make the "tables" collapsible so returning users
don't have to scroll past everything every time. Used native
`<details>/<summary>` rather than a custom JS toggle — free keyboard
support and no extra markup semantics to maintain. Applied to every
content card except the two top identity cards (Overview, Primary wallet
snapshot — kept always-visible as the page's anchor) and Quick actions/the
stat grid (compact, not lists). A small inline script (separate from
`profile.js` — this is pure client-side presentation state, not profile
data) remembers each section's open/closed state in `localStorage`,
defaulting to open so a first-time visit looks identical to before this
change.

## Verification

- Diffed every `id="..."` in the file before/after: the only change was
  one removed ID (`ownerWalletSection`, the old outer wrapper around Known
  wallets/Roles) — confirmed via grep that it was never referenced in
  `profile.js`, so removing it is safe.
- Loaded live via Playwright: zero console errors, screenshot-verified the
  full reorganized layout renders correctly.
- Functionally verified collapsing: clicked a section's summary, confirmed
  its `<details>.open` flipped to `false`; reloaded the page and confirmed
  the collapsed state persisted via `localStorage`.
- `test/nav/site-nav.e2e.test.mjs` (covers this page) — full pass.
