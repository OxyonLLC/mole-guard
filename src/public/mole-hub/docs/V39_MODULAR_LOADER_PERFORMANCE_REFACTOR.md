# Gaming Hub v39 — Modular Loader / Performance Refactor

Base used: uploaded `working-gaming-hub(1).zip`.

## What changed

- Split the large game bodies out of `js/app.js` into separate game chunks:
  - `js/games/diglew.js`
  - `js/games/pac-mole.js`
  - `js/games/root-glide.js`
  - `js/games/burrow-blaster.js`
- Kept hub/bootstrap, routing, launch modal, reward overlay, wallet, storage, and shared helpers in `js/app.js`.
- Added `makeGameDeps()` so each game receives shared hub helpers through a dependency bag.
- Preserved gameplay behavior from the uploaded working hub.
- Added cache-bust query strings for the new game chunks.

## Why this helps

- Future fixes can target a single game file instead of one huge `app.js`.
- Reduces the risk that a Pac-Mole patch breaks Root Glide or Burrow Blaster.
- Makes browser caching and file inspection cleaner.
- Creates the foundation for a later true on-demand lazy-loader pass.

## Conservative choice

This v39 pass still includes all game chunks up front so launch timing stays stable. The next performance pass can lazy-load only the selected game after this split is verified.
