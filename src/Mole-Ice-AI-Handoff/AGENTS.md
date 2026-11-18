# AI development instructions

## Product goal

Build Mole Ice into a polished, original WinLEW browser arcade game. Preserve the fast grid movement, satisfying sliding blocks, enemy crushing, short rounds, and mobile usability.

## Required workflow

1. Read `README.md`, `PHASES.md`, and the full existing source before editing.
2. Run the existing game and establish a working baseline.
3. Make the smallest coherent improvement from the active phase.
4. Validate JavaScript syntax and test the game after each milestone.
5. Keep a short `CHANGELOG.md` describing completed behavior, not implementation theater.

## Technical rules

- Keep game rules deterministic wherever practical so future server validation can replay important events.
- Keep level definitions as data rather than hard-coded control flow.
- Separate simulation state, input, rendering, and audio when refactoring.
- Do not introduce a framework or dependency without a concrete benefit.
- Never place secrets, private keys, wallet seed phrases, or payout authority in browser code.
- Do not implement token rewards until the gameplay and later validation layer are complete.
- Do not copy protected Pengo assets, characters, names, audio, or maps.
- Maintain responsive desktop and touch controls.
- Respect reduced-motion settings and maintain readable contrast.

## Completion standard

A milestone is complete only when the game loads without console errors, keyboard and touch controls still work, the new behavior is playable, and relevant tests pass.
