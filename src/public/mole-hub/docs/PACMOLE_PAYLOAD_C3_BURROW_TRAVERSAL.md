# Pac-Mole Payload C.3 — Burrow Traversal Hard Fix

Baseline: `gaming-hub-35-pacmole-payload-c-maze-purpose.zip`, which was identified as the last stable Pac-Mole build.

## Fix
- Replaced destructive cracked-wall dash behavior with non-destructive Burrow traversal.
- SPACE now lets Lew pass under 1 or 2 wall spaces when a safe landing tile exists.
- The map data is not changed; walls remain intact after burrowing.
- Direction handling now prefers the buffered Arrow/WASD direction so SPACE feels responsive.
- Preserved v35 popup/start stability.

## Rules
- Requires at least one collected worm as fuel.
- Requires a safe landing within three tiles: 1-2 wall spaces, then an open tile.
- Cannot burrow through 3+ wall spaces or off the board.
