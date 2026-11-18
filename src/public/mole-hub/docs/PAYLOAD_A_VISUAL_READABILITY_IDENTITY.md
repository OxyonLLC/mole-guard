# Payload A — Visual Readability & Identity Pass

## Build goal
Make Burrow Blaster cleaner, easier to read at speed, and more aligned with the thumbnail/card identity before adding more gameplay systems.

## Implemented scope

### A1. Clean playfield presentation
- Removed the distracting full-height guide/track lines from the active playfield.
- Moved environmental detail toward the edges/background.
- Kept the center combat area clearer for bullets, enemies, pickups, hazards, and Lew's drill-ship.

### A2. Hazard presentation cleanup
- Shock/bar hazards now originate from map borders instead of appearing randomly in the middle of the map.
- Horizontal beams enter from the left or right border.
- Vertical beams enter from the top border.
- Warning indicators communicate the danger zone and direction before activation.

### A3. Pickup differentiation
- Shards/coins now use a coin/token-like visual identity.
- Spread core uses a golden crate/core shape.
- Laser core uses a magenta battery/cell shape.
- Shield core uses a cyan orb/shield visual.
- Pickups no longer rely only on brightness/color differences.

### A4. Enemy visual upgrade
- Enemies have more shell/body detail.
- Enemy types have stronger silhouette and color differences.
- Added more readable legs, eyes, shells, trim, and body markings.

## Regression checklist
- [x] JavaScript syntax check passed with `node --check js/app.js`.
- [x] Start / Resume / Reset / Back to Hub wiring was preserved.
- [x] Reward overlay logic was preserved.
- [x] Round / wave loop logic was preserved.
- [x] Powerup types remain supported: spread, laser, shield.

## Next payload
Payload B — Enemy Variety & Flavor Pass.

Recommended next additions:
- Dasher / Charger enemy
- Support / Drop Carrier enemy
- more intentional wave composition
- refined drop table by enemy type
