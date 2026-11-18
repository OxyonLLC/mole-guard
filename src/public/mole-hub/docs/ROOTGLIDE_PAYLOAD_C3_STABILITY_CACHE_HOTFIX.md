# Root Glide Payload C.3 — Stability / Cache / Route Coverage Hotfix

## Issue observed
After Payload C.2, some loads showed route terrain without normal obstacles or only Lew/background. In other cases, route connector terrain appeared too large or misleading.

## Root causes fixed
- `spawnSpacing`, `initialRouteSegments`, and `maxRouteSegments` were missing from the Root Glide round config in the active package. That could create invalid obstacle positions and invisible obstacle runs.
- Connector visuals were still too heavy and could read like full terrain walls.
- Browser cache could keep an older `app.js` after upload on shared hosting.

## Fixes
- Added explicit Root Glide route config values.
- Added `ensureRouteCoverage()` so the route is continuously prebuilt ahead of the player.
- Sanitized route bounds and obstacle positions to avoid NaN/invisible obstacles.
- Changed between-obstacle connectors into thin preview rails only, with no connector collision.
- Kept solid collision on actual obstacle columns and protruding gear.
- Added an app.js cache-bust query in `index.html`.

## Validation
- `node --check js/app.js` passed.
- ZIP integrity check passed.
