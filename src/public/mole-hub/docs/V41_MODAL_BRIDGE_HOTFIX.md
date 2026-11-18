# V41 Modal Bridge Hotfix

## Fix target
The launch modal could open correctly while the Go button appeared dead. The safest assumption is that the game view route was changing, but the game instance/chunk bridge was not always ready when Go was clicked.

## Changes
- Added direct click listeners to Go, Go Back, and X instead of relying only on delegated modal clicks.
- Added a guarded launch-in-progress state so Go cannot double-fire.
- Kept the launch modal visible while the game engine is verified, then hides it only after a successful start.
- Added lazy game chunk retry loading if a modular game file did not register its factory.
- Recreates missing game instances after a retry instead of leaving the placeholder forever.
- Added `window.WinLEWLaunchDebug` for console checks during testing.
- Bumped script query strings to `v41-modal-bridge` to avoid browser/shared-host cache issues.

## Test notes
- Syntax checked `js/app.js` and every modular game chunk.
- Simulated the modal flow for Burrow Blaster: show popup → click Go → modal hides → pending launch clears.
