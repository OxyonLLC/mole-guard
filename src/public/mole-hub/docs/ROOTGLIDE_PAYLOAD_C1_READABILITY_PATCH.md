# Root Glide Payload C.1 — Rules Popup + Connected Terrain Readability

## Why this patch exists
After Payload C hotfix testing, Root Glide played well, but two readability issues remained:

1. The launch popup still described the older/simple rule set.
2. The map still looked like separated obstacle columns, which made it harder to read whether the route was moving up or down.

## What changed

### Launch popup updated
The Root Glide popup now explains the current rules:
- tap/click/SPACE to hop
- follow the connected tunnel opening
- dodge protruding boots, shovel heads, stones, roots, and thorn bursts
- snag golden worms near risky edges
- clear the beacon distance to open the reward box

### Connected terrain route added
The map now visually connects the terrain between obstacle columns.

This creates a clearer tunnel shape so players can see whether the safe route is trending up or down before the next obstacle arrives.

### Route collision alignment
The connected terrain is no longer only visual. When Lew is between two obstacle columns, the game checks the interpolated safe route bounds so the visual route and gameplay route stay aligned.

### Existing features preserved
- Payload C no-freeze update order
- solid terrain blockers
- worms
- edge saves
- checkpoint banners
- beacon/depth background polish
- reward flow

## Main file changed
- `js/app.js`

## Validation
- JavaScript syntax check passed with `node --check js/app.js`
