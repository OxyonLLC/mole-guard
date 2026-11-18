# Pac-Mole v48 Step 3 — Classic Path Grid

This patch tightens Pac-Mole toward the uploaded reference map.

## Goals
- More walls and stronger maze shape.
- Less open-room feeling.
- Every carved path tile should carry a worm or globe unless reserved for spawn / den / safety.
- Beetle den stays compact at 2x2 and rotates through corners, with center den only every 4 rounds.
- Burrow remains useful by adding selected dash-wall shortcut gates.

## Changes
- Replaced the open-field wall scatter generator with a carve-from-stone maze generator.
- Added loop openings so the maze still feels liquid instead of one long snake.
- Added classic horizontal corridor bands inspired by the reference image.
- Filled leftover open path cells after reachability repair so empty travel lanes do not appear.
- Updated Pac-Mole launch/how-to copy.
