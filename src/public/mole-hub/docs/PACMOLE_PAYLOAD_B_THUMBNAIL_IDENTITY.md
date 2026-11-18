# Pac-Mole Payload B — Thumbnail Identity Pass

This pass corrects Pac-Mole's direction so it feels like the thumbnail/card art instead of a generic dot maze.

## Direction
Pac-Mole should feel like a Pac-Man-inspired WinLEW arcade maze with its own mechanics:
- thumbnail-style Lew mole as the player character
- glowing blue underground maze blocks
- golden worm pickups
- glow-grub power mode
- colored beetle raider enemies
- Burrow Dash wall-break risk/reward
- 20-level progression with reward boxes

## Changes
- Rebuilt Pac-Mole canvas rendering with a darker underground arcade floor.
- Replaced the tiny player dot with a thumbnail-inspired mole: helmet, headlamp, snout, leaf cape, paws, and dust trail.
- Replaced plain green dots with golden worm pickups.
- Replaced simple power dots with glowing grubs.
- Replaced basic colored enemy circles with beetle-style raiders.
- Upgraded walls into glowing blue tunnel blocks with highlights, cracks, and depth.
- Added canvas HUD with level, lives, worms, dash fuel, and power mode.
- Updated launch popup/rules text to explain the current Pac-Mole mechanics.
- Added enemy role tags for future gameplay tuning.

## Main file
- `js/app.js`

## Validation
- JavaScript syntax check passed.
