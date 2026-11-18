# DigLEW v47 Step 1 — Road + Items Foundation

This patch begins the v47 simplification pass.

## Locked gameplay direction

Move roads, avoid hazards, dash cracked rocks, collect treasure, and reach the checkpoint.

## Step 1 changes

- Converted DigLEW from 4 lanes to 3 roads:
  - Top: Risk Road
  - Middle: Main Road
  - Bottom: Safe Road
- Removed jump and duck controls from the game loop.
- Space / Shift / X now all trigger dash.
- Up / Down only switch roads.
- Hanging mines are forced to the top road only.
- Spikes are road-block hazards instead of jump hazards.
- Cracked rocks remain the dash skill-check hazard.
- Added clearer road visuals and road labels.
- Added 3-button touch controls: Lane Up / Dash Rock / Lane Down.
- Kept pause / resume.
- Kept the bound-window API launch fix.

## Next step

v47 Step 2 should tighten the exact safe-pattern spawn rules and make sure every cluster always leaves one obvious safe road.
