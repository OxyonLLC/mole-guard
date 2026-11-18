# DigLEW v47 Step 3A — freeze/focus hotfix

This hotfix addresses the early-run freeze / accidental pause behavior reported after Step 3.

## Fixes
- Blurs Start/Pause/Resume/Reset buttons after clicking so keyboard Space does not accidentally re-click focused UI buttons during gameplay.
- Captures DigLEW control keys at the window level and blocks browser/button default key activation.
- Adds keyup protection for Space/Shift/Arrow/P/Esc so focused buttons cannot fire after keydown.
- Adds player-state normalization so Lew cannot disappear from a bad laneY/targetLane state.
- Adds a render/update guard so DigLEW pauses with a log message instead of silently freezing if a frame error occurs.
- Bumps DigLEW script cache to v47-step3a-freeze-focus-hotfix.

## Notes
Gameplay and Step 2 spawn rules remain unchanged. This is a stability and input-focus patch.
