# Root Glide Payload C Hotfix — No-Freeze Fix

## Issue observed
The Payload C build could freeze early in the run, around the first obstacle spawn window.

## Cause
The Payload C merge accidentally placed the collision-checking block where the obstacle movement/update block belonged. That meant the first obstacle update tried to read the player hitbox before it existed for that frame.

## Fix
- Restored the correct Root Glide update order:
  1. spawn obstacles
  2. update speed / gravity / distance
  3. move obstacles
  4. process obstacle pass/checkpoint rewards
  5. update worms
  6. update particles / trails / banners
  7. calculate Lew's hitbox
  8. run terrain collision checks
  9. check round clear
- Preserved the Payload C visual depth and solid terrain blocker logic.
- Preserved worm pickups, edge saves, checkpoint banners, and premium feedback.

## Validation
- JavaScript syntax check passed using `node --check js/app.js`.
