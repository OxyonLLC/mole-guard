# Pac-Mole v48 Step 6 — Strict corridor grammar

This patch tightens the Step 5 maze validator around the newest map rules.

## New rules
- No isolated 1x1 wall islands.
- No 2x2 worm / globe blobs.
- Collectible adjacency is capped so a worm should not sit inside chunky 4-way clusters.
- Any anti-blob correction turns the tile into attached wall, not an empty path.
- Inner border double-walls are carved back so the outside border remains one tile thick.
- Every legal non-wall tile is filled with a worm or power globe unless it belongs to the beetle den.

## Goal
Keep the maze simple yet complex: readable corridors, filled paths, no ugly clusters, no route-breaking wall islands, and stronger Burrow value.
