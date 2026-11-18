# Pac-Mole v48 Step 7 — Layout Archetypes

This patch changes Pac-Mole from one repeated corridor grammar into a rotating set of maze archetypes.

## Goals
- Remove the repeated "border + inner border of worms" feel.
- Make each map feel more original while staying readable.
- Keep the stricter validator rules from Step 6.
- Stay Pac-Man-inspired, but not a direct clone.

## What changed
- Added five rotating layout archetypes:
  - classic
  - chambers
  - ring
  - switchback
  - split
- Reduced the always-open inner rim so rounds no longer all start with the same border worm loop.
- Added limited archetype-specific edge gates instead of clearing the entire inside edge.
- Kept rotating beetle den placement and dash-wall generation.
- Updated Pac-Mole flavor text to reflect layout archetypes instead of only strict corridor grammar.

## Kept from prior steps
- No isolated 1x1 wall islands.
- No 2x2 worm blobs.
- Filled corridors.
- Reachability validation.
- Burrow remains useful.
