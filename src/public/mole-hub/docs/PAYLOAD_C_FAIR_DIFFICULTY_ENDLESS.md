# Payload C — Fair Difficulty & Endless Structure

## Goal
Make Burrow Blaster harder in a skill-based way while preserving the round-to-round endless loop.

## What this payload focuses on
- Fair hazard spawning
- Safer warning placement
- Hazard overlap prevention
- Round escalation tuning
- Risk/reward pickup placement
- Endless continuation clarity

## Gameplay rules added

### Spawn safety
Hazards now run through safety checks before spawning warnings:
- warnings avoid spawning too close to the player
- warnings avoid overlapping the same lane as active warnings/hazards
- active warning/hazard counts are capped per round
- low-life mercy slightly slows hazard pressure
- warnings can delay activation if the player is too close when the timer ends

### Hazard overlap prevention
The system now checks for lane conflicts between:
- beam warnings
- root warnings
- active beam/root hazards
- rock warning clusters
- active rock hazards

This reduces unavoidable hazard stacking and keeps at least one recovery path more consistently available.

### Fair escalation
Rounds still scale upward, but the first round is treated as onboarding:
- slower hazard pacing
- lighter enemy quota
- fewer simultaneous threats

Later rounds increase:
- enemy density
- formation chance
- hazard frequency
- active threat limits

### Endless structure
Round progression remains open-ended. After Round 3, the game now labels deeper rounds as endless escalation:
- Round 4 = Endless +1
- Round 5 = Endless +2
- and so on

The loop still continues through reward boxes and next-round starts.

### Risk/reward pickup placement
Risk shards can now appear near hazard warnings.

These are worth more than normal shards:
- normal shard: +25
- risk shard: +55

The placement tries to keep them risky but not unfairly placed directly on top of the player.

## Player-facing result
- Safer early onboarding
- More readable difficulty ramp
- Fewer cheap deaths from overlapping hazards
- Better score-chase incentives
- Endless mode has clearer progression language
