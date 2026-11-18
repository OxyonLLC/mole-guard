# Pac-Mole Payload C — Maze Purpose / Pathing Pass

## Goal
Keep the thumbnail-style Pac-Mole visual upgrade while restoring the smarter Pac-Man-inspired maze feel.

## What changed

### Classic maze pathing restored
- Replaced the overfilled worm-carpet board generation with structured maze archetypes.
- Added clearer loops, junctions, side lanes, and risk pockets.
- Reduced low-value worm clutter by converting some corridor spaces into bare tunnel floor.

### Glow-grubs now have purpose
- Glow-grubs rotate through tactical pressure points instead of appearing as decoration.
- They are placed to help flip dangerous beetle chase moments.

### Burrow Dash now has a reason
- Added cracked shortcut walls.
- Dash only works through cracked shortcut / bonus / escape walls.
- Dashing breaks the cracked wall segment and creates a route choice.

### Visual identity preserved
- Kept the thumbnail-style Lew mole.
- Kept glowing blue maze blocks.
- Kept golden worms, glow-grubs, and beetle-style raiders.

## Main file
- `js/app.js`
