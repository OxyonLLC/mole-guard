# Pac-Mole v48 Step 5 — Map Validator Rules

This patch adds stricter maze grammar validation after the Step 4 rebuild.

## Rules added
- Outer border stays exactly one tile thick.
- Inner perimeter is carved back open unless reserved for the beetle den.
- Isolated 1x1 wall islands are removed.
- 3x3 thick stone chunks are broken up.
- 2x2 open path blobs are reduced before collectible fill.
- Every non-wall, non-den path tile is refilled with a worm/globe.
- Surviving accidental 2x2 collectible blobs are broken up.
- Dead ends are reduced by carving loop exits.
- Rotating 2x2 beetle den remains intact.
- Burrow remains useful through tighter wall routes.

## Intent
The board should now feel closer to a classic maze reference: clear corridors, meaningful walls, full pellet coverage, fewer blobs, no loose single wall blocks, and no double-thick outer border.
