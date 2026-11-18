# Pac-Mole Payload A — Audit, Fairness, and State Repair

## Purpose
Bring Pac-Mole up to the new WinLEW Arcade standard established by Burrow Blaster and Root Glide.

## Included
- Refreshed the Pac-Mole game card and launch popup copy.
- Rebuilt the procedural level generator rules so all 20 levels have more unique, fair maze structure.
- Added stronger level-generation safety rules:
  - open onboarding area
  - reachable board validation
  - late-level blockers with escape notches
  - safer first/last lane routing
- Tuned early enemy pressure so the first levels are less punishing.
- Added spawn grace after a level starts / life reset so beetles cannot instantly punish the player.
- Fixed dead-run behavior: if lives hit 0, Start/Resume now restarts the current level instead of resuming a dead state.
- Improved Pac-Mole visuals:
  - underground maze walls
  - golden worm pickups
  - glow-grub power pellets
  - more detailed beetles
  - miner-mole player polish
  - readable level HUD
- Added cache-bust version in `index.html`.

## Validation
- JavaScript syntax check passed with `node --check js/app.js`.
- ZIP integrity was checked after packaging.

## Next Recommended Payload
Pac-Mole Payload B — Visual Identity and Gameplay Flavor Pass.
