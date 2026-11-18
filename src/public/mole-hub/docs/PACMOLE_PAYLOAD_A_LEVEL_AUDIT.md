# Pac-Mole Level Audit Notes

Payload A audits the 20-level campaign at the generator level.

## Fix goals
- Avoid duplicate-feeling level layouts.
- Reduce impossible or near-impossible choke points.
- Keep early levels readable.
- Add more structure gradually across later levels.
- Keep every non-wall tile reachable from spawn.

## Current rules
- 20 levels are generated from a deterministic pattern.
- Each level uses a different seed, wall rhythm, and pocket pattern.
- `ensureReachable()` validates and repairs all reachable spaces.
- Early levels use fewer enemies and more open lanes.
- Later levels add more blockers and enemy count gradually.

## Known future work
Payload B should focus on richer visual identity and enemy/pickup flavor.
Payload C should deepen mechanics and smarter beetle behavior.
