# Pac-Mole Payload C.2 — Popup / Start Hotfix

## Fixed
- Added direct click handlers for the launch modal Go/Back/Close buttons.
- Kept delegated modal click handling as a backup.
- Wrapped launch execution in a guarded start flow so a Pac-Mole runtime/start-state error cannot leave the player trapped behind the popup.
- Added a Pac-Mole fallback that starts Level 1 cleanly if resume fails due stale local state.
- Bumped the cache-bust version in `index.html`.

## Scope
This patch is intentionally narrow: it preserves Pac-Mole Payload C.1 maze/pathing work and only hardens the launch/start flow.
