# Pac-Mole v48 Step 2 — Tactical Maze Pass

This patch responds to Step 1 testing feedback.

## Fixes
- Reduces worm spam. The maze no longer fills nearly every path tile with worms.
- Adds more wall structure so the board is less open and Burrow traversal has real value.
- Varies worm/globe placement by level instead of repeating the same positions.
- Replaces the always-center den with a rotating 2x2 beetle den.
  - Most rounds use one of the three non-start corners.
  - Every 4th round uses the center den.
- Keeps the board large in the game box.
- Adds per-level wall palettes and tile accents so the walls do not look copy-pasted.

## Den rotation
The player starts near upper-left, so beetle dens rotate through:
- upper-right
- lower-left
- lower-right
- center every 4th level

## Gameplay intent
Pac-Mole should feel more tactical: fewer free dots, more wall choices, more useful Burrow moments, and less same-map repetition.
