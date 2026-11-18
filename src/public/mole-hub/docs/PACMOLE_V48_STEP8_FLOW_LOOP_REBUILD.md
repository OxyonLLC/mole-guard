# Pac-Mole v48 Step 8 — Flow-Loop Rebuild

This pass focuses on the hard part: map flow and enemy pressure.

## What changed
- Replaced the wall-heavy archetype generator with a flow-loop generator.
- Added five cleaner layout families:
  - classic
  - chambers
  - ring
  - switchback
  - split route
- Reduced the repeated inner border/rim path effect.
- Reduced dead-end feeling and heavy wall lockouts.
- Kept corridors filled with worms/glow-globes.
- Kept rotating 2x2 beetle dens.
- Kept Burrow shortcuts, but with loop routes so beetles stay relevant.
- Added enemy spread logic so two beetles do not collapse into the same tile and feel like one enemy.
- Added slight enemy targeting variety so they do not all chase the same exact path.

## Goal
Pac-Mole should feel more like a Pac-inspired maze chase:
- readable corridors
- less repeated border looping
- fewer dead ends
- enemy pressure stays involved
- Burrow helps without completely removing the chase
