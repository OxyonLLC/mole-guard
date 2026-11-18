# Mole Ice

Mole Ice is an original, Pengo-inspired WinLEW arcade game. Phase 1 is already playable and is intentionally lightweight: plain HTML, CSS, JavaScript, and Canvas with no build step.

## Open and run it

Open this unzipped folder in a terminal, then run:

```bash
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080` in your browser.

On Windows, if `python3` is unavailable, use:

```powershell
py -m http.server 8080 --directory dist
```

## Give this prompt to your AI

```text
Open and inspect this entire Mole Ice project before changing anything. Read README.md, PHASES.md, AGENTS.md, and all files in dist/.

Phase 1 is a working prototype. Do not restart it, replace it with a framework, or remove existing working behavior. First run and test the current game. Then continue with Phase 2 in small, verifiable steps while keeping desktop and mobile controls working.

Priorities:
1. Fix any existing gameplay bugs you discover.
2. Refactor the single game.js only where needed to support clean expansion.
3. Add data-driven levels and a proper difficulty curve.
4. Add three original enemy behaviors: Chaser, Breaker, and Sneak.
5. Add three Proof Blocks and an original Proof of Value activation mechanic.
6. Improve combo feedback, chain reactions, animation, particles, audio, and game balance.
7. Add a clear title/help flow and accessibility settings without covering the game in unnecessary menus.
8. Add lightweight automated tests for deterministic grid movement, block sliding, collisions, scoring, and level completion.

Important boundaries:
- This must remain an original game inspired by the broad block-pushing arcade concept. Do not copy Sega artwork, names, level layouts, sounds, characters, or branding.
- Do not add wallets, accounts, leaderboards, server sessions, blockchain calls, or WinLEW payouts yet. Those belong to later phases.
- Keep arcade score separate from any future verified reward score.
- Never trust browser-calculated scores for future rewards.
- Preserve the fast, dependency-free browser build unless a change is genuinely necessary and explained first.
- Keep each change playable. Run tests and manually verify keyboard and touch controls after every milestone.

Before writing code, reply with: (a) what currently works, (b) bugs or architectural risks you found, and (c) the exact first Phase 2 milestone you will implement. Then begin implementing that milestone unless blocked by a decision that materially changes the game.
```

## Current controls

- Arrow keys or WASD: move and face a direction
- Space: push or shatter ice
- P: pause
- Mobile: large directional buttons and PUSH button

## Project map

- `dist/index.html` — game screen and controls
- `dist/styles.css` — responsive arcade presentation
- `dist/game.js` — complete Phase 1 engine
- `PHASES.md` — five-phase product roadmap
- `AGENTS.md` — rules for an AI continuing the build

## Current Phase 1 features

- 15×13 grid-based frozen mine
- Sliding and shattering ice blocks
- Enemy crushing and combo scoring
- Chasing Glitch Bugs
- Lives, rounds, pause, simple sound, particles, keyboard, and touch controls

