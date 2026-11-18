# WinLEW Gaming Hub — Technical Roadmap

## Build direction
This package focuses on the `gaming-hub` slice and turns the landing page into a true two-lane arcade gateway:

- **Instant Web Play** for keyboard/mouse-friendly sessions
- **Mobile-Native Play** for touch-first, portrait-friendly sessions

The hub now uses a stronger separation between:

- **shared UI and gateway behavior**
- **web-first game entry points**
- **mobile-first game entry points**
- **matching card art assets** so the shipped page aligns with the approved visual direction

## Current architecture

### Shared / core
- `js/core/device-profile.js`
  - detects coarse pointer / narrow viewport
  - recommends the correct lane
- `js/core/share.js`
  - lightweight social-share / clipboard prompt logic

### Gateway
- `js/gateway/catalog-data.js`
  - source of truth for arcade catalog cards, metadata, reward values, launch routes, and statuses
- `js/gateway/catalog-ui.js`
  - renders the catalog shelf
  - handles filter chips, sort modes, lane highlighting, and share prompts

### Runtime
- `js/app.js`
  - still owns the live game runtime and reward flows
  - integrates the gateway modules and keeps route changes + game launch behavior intact

### Art / thumbnails
- `assets/brand-avatar.svg`
- `assets/rootglide-card.svg`
- `assets/burrowblaster-card.svg`
- `assets/diglew-card.svg`
- `assets/pacmole-card.svg`
- `assets/tunneltap-card.svg`
- `assets/grubdrop-card.svg`

## Phase lanes

### Phase 1 — Gateway architecture
Shipped in this pass:
- responsive main gateway
- clear web vs mobile lane split
- device-aware lane recommendation
- premium catalog card layout
- filter + sort behavior
- matching visual assets

### Phase 2 — Script diversification
Already present or staged:
- **Web lane**
  - DigLEW
  - Pac-Mole
- **Mobile lane**
  - Root Glide
  - Burrow Blaster
- **Planned lane padding / future conversion cards**
  - Tunnel Tap
  - Grub Drop

### Phase 3 — Execution roadmap
Next strongest implementation steps:
1. extract shared scoring / reward math into `js/core/score-engine.js`
2. extract shared game loop helpers into `js/core/game-loop.js`
3. move each live game into its own runtime module under `js/games/web/*` and `js/games/mobile/*`
4. add session missions / daily objectives for stronger retention loops
5. add real share-result cards after each completed run
6. connect leaderboards to a backend instead of localStorage-only storage

## First framework targets

### Web-first framework target
**DigLEW** remains the desktop-leaning path:
- mouse + keyboard friendly
- longer-session route reading
- higher map legibility
- pre-run upgrade loop

### Mobile-first framework target
**Root Glide** remains the touch-first path:
- one-touch control scheme
- short retry loop
- clear speed ramp
- portrait canvas and battery-light motion model

## Notes
This pass intentionally keeps the existing game runtime stable while upgrading:
- the **gateway structure**
- the **landing page scripts**
- the **art direction**
- the **device-aware lane behavior**

That makes the hub look much closer to the approved concept without risking a full gameplay regression in the live views.
