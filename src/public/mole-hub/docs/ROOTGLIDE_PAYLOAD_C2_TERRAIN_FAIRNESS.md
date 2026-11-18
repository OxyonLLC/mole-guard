# Root Glide Payload C.2 — Terrain Fairness / Route Readability

## Why this patch exists
Payload C.1 connected the terrain between obstacle columns, but testing showed three issues:

1. Connector terrain could appear too late to read cleanly.
2. Terrain colors changed mid-run in a distracting way.
3. The connected terrain could act like a sudden wall inside the playable gap.

## What changed

### Brown terrain standard
- Live-run terrain now uses a consistent warm brown cave-soil palette.
- Alternate colors are reserved for future intentional round/checkpoint themes instead of random obstacle switching.

### Earlier route preview
- The game prebuilds several upcoming terrain segments when the round starts.
- New obstacles now spawn beyond the furthest prebuilt segment instead of popping into the same near-screen slot.
- This lets the player see the route trend earlier.

### Connector fairness
- Terrain connectors are now route rails / visual guidance, not surprise lethal walls.
- Solid collision remains focused on the actual obstacle columns and protruding items.
- Connector visuals are thinner, warmer, and less opaque so they guide the eye without blocking the playable opening.

### Popup/rules update
- Root Glide modal copy now explains the brown route rails and clarified danger rules.

## Validation
- JavaScript syntax check passed with `node --check js/app.js`.
