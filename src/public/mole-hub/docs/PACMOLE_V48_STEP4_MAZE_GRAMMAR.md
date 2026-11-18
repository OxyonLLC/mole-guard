# Pac-Mole v48 Step 4 — Maze grammar rules

This patch tightens the Step 3 classic path grid into stricter maze grammar.

## Map rules added
- Outer border should stay one tile thick.
- Corridors are mostly one tile wide.
- 2x2 open path blobs are removed.
- 3x3 thick stone chunks are broken up.
- Dead-end paths are reduced by carving loop exits.
- Every path should have a way in and out unless it is part of a controlled spawn/den area.
- Worm/globe placement avoids blob clusters: a collectible should touch no more than two other collectibles.

## Gameplay result
- More classic path readability.
- Less worm spam and fewer blob clusters.
- Walls feel present without becoming giant blocks.
- Burrow gates still matter.
- The rotating 2x2 beetle den remains intact.
