# Pac-Mole Payload A Hotfix — Render / Start Fix

## Issue
Payload A showed the launch popup, but after pressing Go / Start the Pac-Mole playfield stayed blank.

## Root Cause
The Pac-Mole start routine still called a Burrow Blaster-only arcade banner helper (`showArcadeBanner`). That helper is scoped to Burrow Blaster, so Pac-Mole could error during start and stop before drawing the maze.

## Fix
- Added a Pac-Mole-local `showPacBanner()` guard.
- Replaced the bad scoped banner call with the local helper.
- Preserved the Start/Resume behavior where 0 lives restarts the current level.
- Updated the Pac-Mole launch popup rules.
- Updated cache busting in `index.html`.

## Validation
- `node --check js/app.js` passed.
- ZIP integrity test passed.
