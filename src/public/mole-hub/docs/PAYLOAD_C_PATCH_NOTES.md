# Payload C Patch Notes

## Added
- Spawn safety checks for hazard warnings.
- Active warning/hazard caps by round.
- Warning lane conflict detection.
- Low-life mercy pacing for hazard pressure.
- Delayed warning activation when the player is too close.
- Endless depth label after Round 3.
- Risk shard pickups worth +55 points.
- Risk pickup counter in the side stats.

## Changed
- Round 1 is now more onboarding-friendly.
- Enemy quota and spawn timing scale more gradually.
- Formation chance now scales with wave/round but backs off slightly when lives are low.
- Hazard frequency scales with endless depth but remains capped.
- HUD now shows Near Miss and Risk counters.

## Preserved
- Payload A visual clarity improvements.
- Payload B enemy role system.
- Reward overlay flow.
- Round continuation flow.
- Shield / spread / laser / burst core behavior.

## Validation
- JavaScript syntax check passed.
- ZIP packaging completed.
- Existing start/resume/reward loop was preserved at the code level.
