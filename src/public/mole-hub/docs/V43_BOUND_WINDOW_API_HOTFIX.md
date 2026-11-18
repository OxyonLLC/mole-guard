# V43 Bound Window API Hotfix

## Problem
After the v39+ modular split, each game chunk receives shared browser APIs through a dependency bag and executes inside a conservative wrapper. Chrome can throw `Illegal invocation` when native browser methods such as `requestAnimationFrame`, `cancelAnimationFrame`, `setTimeout`, or `clearTimeout` are called after being pulled through that object without their original `window` receiver.

This showed up when the launch modal's **Go** button tried to start Root Glide, Pac-Mole, or Burrow Blaster: the scripts returned 200, the modal stayed active, and the launch status reported `Illegal invocation`.

## Fix
- Bound `requestAnimationFrame` to `window` before passing it into game chunks.
- Bound `cancelAnimationFrame` to `window` before passing it into game chunks.
- Bound timer helpers to `window` as a defensive guard.
- Bumped script cache tags from `v42-launch-guard` to `v43-bound-window-api`.

## Scope
Only `src/public/gaming-hub` was changed. DigLEW gameplay was not upgraded.

## Regression Check
- Open `/gaming-hub/?game=rootglide#rootglide`, click **Go**, confirm the modal closes and Root Glide starts.
- Repeat for Pac-Mole and Burrow Blaster.
- Confirm browser network requests still return 200.
