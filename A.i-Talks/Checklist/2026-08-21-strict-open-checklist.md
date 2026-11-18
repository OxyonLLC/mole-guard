# Strict Open Checklist — 2026-08-21

Derived from a full audit of `A.i-Talks/*.md` on **2026-08-21**.

Rule for this file:
- `[ ]` = still open, or must be explicitly verified as done
- `[x]` = already closed in repo history; do not reopen it from an old handoff

This is the residue list after removing items that later notes explicitly
closed or superseded.

---

## Repo tasks

- `[x]` Close the last URL-session adoption hole in `src/public/assets/wallet-auth.js` by setting `ACCEPT_URL_SESSION_PATHS = []`.
- `[ ]` Upload the updated `src/public/assets/wallet-auth.js` to the host so the `/verify/?session=<token>` closure is live, not just committed locally.
- `[ ]` Build the campaign draw's verifiable randomness flow (commit-reveal / future-slot rule).
- `[ ]` Build the campaign close-out script that walks LP `mintTo` history and produces the qualified list.
- `[ ]` Wire the Utility Bot heartbeat from the Utility Bot itself to `POST /api/bot/heartbeat`; do not fake it from Mole Guard.
- `[ ]` Decide whether to fix the long-term `profile_prefs.json` design: it is still single-machine local state, not mirrored to Mongo.
- `[ ]` Decide whether to redesign `bootstrapFile()` conflict resolution so a stale non-empty local file cannot silently win over remote state.
- `[ ]` Decide whether to implement the optional Android `DownloadListener` hardening in `MainActivity` for the updater path. This was explicitly "later, not now", not a deploy blocker.
- `[ ]` If still wanted, do the news cross-linking / timeline backfill work referenced in the 2026-08-16 full handoff.

## Serving-machine / runtime tasks

- `[ ]` Verify the updated `wallet-auth.js` is actually uploaded on the serving machine.
- `[ ]` Run `npm run faucet:scan` on the serving machine if it has never been run there; lifetime payout sections stay hidden until the checkpoint exists.
- `[ ]` Verify `WEB_PROXY_SHARED_SECRET` is set correctly on the serving machine if that check was never conclusively closed.
- `[ ]` Configure a real second RPC provider in `SOLANA_RPC_FALLBACK`; the warning path still says the public endpoint is not real failover.
- `[ ]` If never done: recover the 19 sybil-run wallet addresses from the serving machine's `src/data/profile_prefs.json` and finish the funder walk.
- `[ ]` If the old mobile artifact is still on the host: delete `winlew-beta-0.2.0.apk`.
- `[ ]` Pull the Zora liquidity on Base before `/cunt/future/` ever loses `noindex`, if that has still not happened.
- `[ ]` Top up X API credits if the tweet watcher is still parked on depleted credits.

## Owner-only / external decisions

- `[ ]` Register `X_REDIRECT_URI` in the X developer portal.
- `[ ]` Regenerate the leaked X credentials.
- `[ ]` Decide whether `Contribute` belongs in `BUILD & CONTRIBUTE` or back under `TRUST & TRANSPARENCY`.
- `[ ]` Decide the campaign holder-milestone definition: wallets or people.
- `[ ]` Decide whether HODL should have its own reserve wallet.
- `[ ]` Decide whether epoch 1 should align to a calendar quarter.
- `[ ]` Decide whether the quiz / HODL economics change is still wanted: `QUIZ_WINLEW_PER_POINT=0.5` and a halved HODL pool with tenure redistribution.

## Verify, do not duplicate

- `[x]` The August 19 static upload handoff was superseded by August 20; do not redo that upload just because the old note says it was missing.
- `[x]` The older "wallet-account layer" gap was later addressed by the multi-wallet identity work from 2026-08-20; do not reopen that as an unimplemented auth feature.
- `[x]` The HODL payout proof checks from the first 2026-08-16 letter were completed by the second 2026-08-16 letter; do not rerun them as if they were still pending.
- `[x]` The `/verify/?session=<token>` code change itself is now done in repo; the remaining task is deployment verification.

## Notes

- This file intentionally separates **code work** from **serving-machine work**
  and **owner-only work**. Several handoffs mixed them together.
- If a future handoff explicitly closes one of the `[ ]` items above, flip it to
  `[x]` here rather than leaving historical ambiguity around.
