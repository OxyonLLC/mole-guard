# Gaming Hub v41 — Exact Start Handler Hotfix

## Why
The v39/v40 modular split loaded the game shells correctly, but Root Glide, Burrow Blaster, and Pac-Mole could remain on their internal pre-start splash after the launch popup closed. DigLEW worked because it used an older direct start flow.

## Fix
- Switched `js/app.js` back to a classic deferred script so modular game chunks and the hub bootstrap run in deterministic order.
- Added a direct `gameLaunchGo.onclick` path each time the modal opens.
- Added `forceSelectedGameStart()` that calls the selected game API and dispatches the visible Start button as a fallback.
- Added capture-phase Start button guards for Pac-Mole, Root Glide, and Burrow Blaster.
- Exposed `window.WinLEWHubGames` / `window.WinLEWForceStartGame()` for quick browser-console diagnosis if needed.

## Preserved
- Games still wait behind the how-to popup on mobile.
- Gameplay logic was not rewritten.
- v39 modular split remains intact.
