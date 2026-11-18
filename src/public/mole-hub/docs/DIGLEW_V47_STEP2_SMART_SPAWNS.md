# DigLEW v47 Step 2 — Smart spawn pass

This patch implements the second DigLEW pass after the v47 road/items foundation.

## Main goals
- Keep DigLEW simple: lane switching + dash only.
- Increase top-road reward density so risk feels worth it.
- Remove bottom-road camping by lowering reward density and adding occasional bottom hazards.
- Make dash more central by adding blue dash-charge pickups and richer rock patterns.
- Add health recovery pacing with heart pickups.

## Spawn rules
- Top road (Risk Road) now has the strongest coin/gem clusters and the most mine pressure.
- Bottom road (Safe Road) still offers recovery windows, but reward density is intentionally lower.
- Bottom-road hazards may appear, but never in back-to-back bottom-hazard patterns.
- Stage 1 tutorial sequence teaches: middle coin line → top reward risk → redirect → dash gate → bottom relocation.
- Heart support drops: stage 1 = 1 around mid-run; stage 2 = 2 (mid + late); stage 3+ = roughly every 30% of the checkpoint.
- Dash-charge support drops: around 22%, 46%, and 72% of the checkpoint.

## New support pickups
- Blue dash charge: reduces/refills dash cooldown.
- Heart: restores 1 heart when missing, or converts to score when already full.

## Feel changes
- Top road should now feel tempting instead of empty.
- Bottom road should feel safer, not free.
- Dash should feel useful more often, especially around rock gates and double-rock patterns.
