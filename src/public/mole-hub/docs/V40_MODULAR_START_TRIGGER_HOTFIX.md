# Gaming Hub v40 — Modular Start Trigger Hotfix

Built from the uploaded `newest-gaming-hub.zip`.

## Fix
- The v39 modular split loaded game canvases correctly, but Root Glide, Burrow Blaster, and Pac-Mole could remain stuck on their internal pre-start splash after the launch modal closed.
- The modal `Go` button now forwards into each game start handler and also triggers the visible Start button as a fallback on the next tick.
- Root Glide canvas/SPACE now starts the run when no run exists, then hops afterward.
- Pac-Mole canvas/SPACE now starts from the splash when no level is active.
- Burrow Blaster keyboard/SPACE can start from the splash; pointer start behavior remains.

## Preserved
- Mobile-safe behavior: the game does not run behind the how-to popup.
- Modular v39 file split.
- Existing gameplay and state logic.
