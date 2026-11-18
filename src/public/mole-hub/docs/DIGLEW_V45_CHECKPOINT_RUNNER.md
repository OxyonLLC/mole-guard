# DigLEW v45 Checkpoint Runner

DigLEW was reset into a clear checkpoint runner.

Core rule:

> Jump spikes, duck maces, dash rocks, collect treasure, reach 300m, open reward box.

## Player controls

- Space / W / Arrow Up: Jump
- S / Arrow Down: Duck / dig low
- Shift / X: Dash through cracked rock walls

Mobile-like screens get three touch buttons: Duck, Jump, Dash.

## Gameplay changes

- Removed passive energy drain.
- Removed manual R cash-out from the core loop.
- Added 3-heart run structure.
- Added 300m automatic checkpoint reward.
- Reworked pickups into coins, worms, and gems.
- Reworked hazards into floor spikes, hanging maces, and cracked rock walls.
- Simplified the active HUD so the canvas is the focus during gameplay.

## Launch safety

This build keeps the v43/v44 bound-window API fix in app.js. Browser-native APIs such as requestAnimationFrame and cancelAnimationFrame remain bound to window before being passed to modular game chunks.
