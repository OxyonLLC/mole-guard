# Pac-Mole Payload C.1 — Maze Fairness Hotfix

This hotfix corrects the Payload C maze behavior based on playtesting feedback.

## Changes

- Rebuilt maze templates into more intentional Pac-Man-style layouts.
- Filled nearly every walkable slot with a golden worm so the board no longer has large empty stretches.
- Added four glow-grubs per level, one near each corner route.
- Moved beetle/enemy homes toward the center of the board.
- Improved cracked-wall Burrow Dash detection so it can work when the player faces a crack or stands beside a valid crack route.
- Added escape notches / alternate openings to reduce instant-death corner pockets.
- Preserved the Payload B thumbnail-style player, glowing blue maze walls, gold worms, glow-grubs, and beetle visuals.

## Design rule
Pac-Mole should feel like classic Pac-Man pathing with WinLEW changes: golden worm routing, tactical glow-grubs, center-spawn beetles, and dash shortcuts that matter.
