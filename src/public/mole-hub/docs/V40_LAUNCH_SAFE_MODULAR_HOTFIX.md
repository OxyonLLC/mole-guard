# Gaming Hub v40 — Launch-Safe Modular Hotfix

Base used: `newest-gaming-hub(1).zip`.

## Fixes

- Changed the app bootstrap script from `type="module"` to ordered `defer` loading.
  - The app does not use ESM imports/exports.
  - Classic deferred loading preserves document order after the four game chunks.
  - This prevents the launch modal from calling fallback game objects before chunks register.
- Added a safe game instance factory.
  - One failed/missing game chunk no longer breaks the entire hub bootstrap.
  - Missing chunks now get a clear console warning instead of silently leaving the game idle.
- Added a Root Glide sprite fallback.
  - Root Glide no longer crashes if image assets are still loading on the first frame after the popup.
  - This is important on shared hosting/mobile where PNG assets may finish after the user taps Play.
- Hardened popup launch execution.
  - The launch modal now calls a safe starter wrapper.
  - DigLEW uses `startRun`; Pac-Mole, Root Glide, and Burrow Blaster use `startOrResume`.
  - If a module is not ready or throws during launch, the modal reopens with an error hint instead of dumping the player into a dead game screen.

## Why this is safer

The v39 split was the right performance direction, but the final app bootstrap used module loading even though the app file was not an ES module. This could create load-order/race problems on slower/shared hosts and mobile browsers. v40 keeps the modular split while making the loader behave more like the original working all-in-one app.
