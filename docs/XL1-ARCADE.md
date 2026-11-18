# XL1 Arcade operations

The Arcade uses the canonical games in `/mole-hub/` through its own launcher.
The launcher intercepts game claims before they reach the WINLEW ledger. XL1
sessions, accounting, and payout records are separate. Grub Drop remains playable
without rewards. The Windows and Raspberry Pi dashboards are unchanged.

## How rewards are earned (updated 2026-10-24)

Rewards pay for **time played, the same in every game**: one eligible point per second of a
finished round, at most `XL1_ROUND_CAP_SECONDS` (default 300) per round, at
`XL1_REWARD_PER_POINT` XL1 a point. The code default is 0.0004; live runs 0.004, which is
0.24 XL1 a minute, set in `mole-redirects.config.cjs`.

- **Daily cap:** at most `XL1_DAILY_REWARD_CAP` (live: 20) per UTC day, **per account and per
  wallet**, whichever is reached first. One wallet verified on several Discord accounts shares
  one cap (`xl1_arcade_wallet_days`).
- **Discord account age:** earning needs a Discord account at least `XL1_MIN_DISCORD_AGE_DAYS`
  old (default 30; 0 turns it off; blank means 30). This is read from the Discord ID itself.
  Play is open to everyone.
- **A round has to be real:** it counts only if the game reports it finished with a non-zero
  score that is plausible for its length under each game's `GAME_RULES`. Paid seconds are also
  limited to `score / minScorePerSecond`, so idle time and scripted 1-point rounds earn almost
  nothing.
- **One round at a time:** a player has one active round across all games, and a session
  expires 10 minutes after the round cap.
- **Hold multipliers:** rewards are held, then multiplied at cash-out by `XL1_HOLD_TIERS` (live:
  24h ×1, 72h ×2, 7d ×5, 30d ×7).

## Current mode

**Live, on XL1 Mainnet** (`XL1_REWARD_MODE=live` in `mole-redirects.config.cjs`). Earned rewards
are `HELD`. A cash-out moves them to `QUEUED`, and the payout worker (`winlew-arcade-payouts`)
sends them from the distributor wallet. With `XL1_REWARD_MODE=dry-run`, rewards are
`SIMULATED`, the worker never opens the signer, and simulated entries are never promoted to live
payments.

**Accounting** uses integer millionths of XL1. The signer converts each accounting unit into
exactly 10^12 attoXL1.

**Limits of these checks:** they are heuristic checks on a client-reported score, not a
cryptographic replay of gameplay (see `docs/marathon-2026-10/sprint-arcade-integrity/` in the
owner's workspace for the layered plan).

**Grub Drop** has no approved score rule: its score is exponential in group size and combos, so
a per-second score bound does not fit it.

## Sender credential

`sender.js` contains a recovery phrase in an `XL1_Sender="..."` assignment. It is
parsed as text, never executed. Keep this file outside the repository and all
public directories. Do not paste it into JavaScript, an issue, or a commit.

Set `XL1_SENDER_FILE` to its absolute server-side path. `XL1_SDK_MODULE` can point
to GeoHackers' installed `@xyo-network/xl1-sdk/dist/neutral/index.mjs`; this adapter
was checked against GeoHackers' SDK 1.30.3. Alternatively provision that package
in the server's module resolution path. A Docker deployment must mount the
credential and SDK/dependencies at the configured paths; host paths alone will
not work inside a container. The web frontend needs neither the file nor the SDK.

Run `npm run xl1:sender-check`. It derives child `0` with GeoHackers' same SDK
wallet derivation, compares it to `XL1_DISTRIBUTOR_ADDRESS`, and prints only the
public address and check result. It does not submit a transaction.

## Player verification

Set `XL1_VERIFICATION_FILE` to the running GeoHackers bot's
`.bot-verification-db.json`. The bot resolves this relative to its working
directory (see GeoHackers `apps/bot/src/lib/store.ts`). The file is created when
verification sessions run; it is not part of a Git checkout.

The authenticated Mole Guard Discord ID must match the stored GeoHackers user.
Only `mode=wallet-signature` and `source=xl1-wallet-signature` records are accepted.

**Verifying from the arcade page.** "Verify XL1 wallet" calls
`POST /api/xl1-arcade/verify-wallet`. For a player signed in with Discord, it asks the
bot (`GEOHACKERS_VERIFY_LOCAL_URL`, default `http://127.0.0.1:8793`) for a verify session
via `POST /api/web-verify-session`, authenticated with `GEOHACKERS_WEB_VERIFY_TOKEN`; set
the same value in the bot's `.env`. The player is sent to the bot's public
verify page (`https://winlew.co/xl1/verify/api-proxy.php/verify/<session>`, the bot's
`PUBLIC_BASE_URL`; `XL1_VERIFY_PUBLIC_BASE` if it changes) and signs in their own wallet there (Oxyon
Wallet sign-in, nothing is sent). That page links back to the arcade. Wallet-backed
WinLEW logins are asked to sign in with Discord first.
A Solana verification, manually typed XL1 address, or discovered/anchored address
alone does not authorize an XL1 reward destination. Missing/unreadable verification
storage fails closed. This integration reads the bot store; it never modifies it.

## Live worker configuration

Live sending is not enabled by adding a credential. Configure explicitly:

- `XL1_REWARD_MODE=live`
- `XL1_REWARD_SIGNER_ADAPTER=xl1-sdk`
- `XL1_NETWORK=beta` for the GeoHackers shared Sequence network (mainnet remains
  an explicit operator choice)
- `XL1_RPC_URL=https://beta.api.chain.xyo.network/rpc`
- `XL1_CHAIN_ID=4b43a753c8024c0e5000e8ac948ac0063ac624bc`, the chain ID read from
  the beta RPC's current block on 2026-09-20
- `XL1_SENDER_FILE`, `XL1_DISTRIBUTOR_ADDRESS`, and `XL1_VERIFICATION_FILE`
- `XL1_SDK_MODULE` when using GeoHackers' existing SDK installation
- Working MongoDB configuration shared by the API and worker

The worker verifies the derived distributor and RPC chain ID before preparing or
submitting transactions. Defaults: warn below 100 XL1 and retain a 20 XL1 reserve
plus the transfer's maximum gas cost. Change these with
`DISTRIBUTOR_LOW_BALANCE_WARNING` and `DISTRIBUTOR_PAYOUT_PAUSED_THRESHOLD`.
The beta mempool also requires a minimum gas limit of 10,000,000,000; the signer
adapter applies that protocol floor when building transfers.

Restart the API after changing its environment and run the worker separately:

```
npm run xl1:rewards-worker
```

`npm run xl1:rewards-worker -- --once` runs one cycle. **In live mode this can send
funds**; in dry-run it only reports that sending is disabled. No process-manager
entry or startup hook enables payments automatically.

## Recovery and pause controls

The worker writes signed bytes and their transaction hash into
`xl1_arcade_payouts` before broadcasting. A restart confirms that same hash and,
when appropriate, rebroadcasts only those identical bytes. A lease coordinates
workers sharing the database; compare-and-swap revisions protect preparation.
Only one unresolved transfer is allowed at a time for the distributor. Confirmed
payouts are reconciled into the reward ledger after crashes.

An expired unconfirmed transaction is held in `REVIEW`, blocking further sends.
Inspect its stored hash on the configured chain and resolve it operationally;
do not delete the job or sign a replacement without establishing what happened.
The worker never automatically converts an ambiguous result into a new transfer.

`XL1_GAME_REWARDS_ENABLED=false` stops new reward allocations and stops the worker
after its configuration is reloaded. For an immediate database-backed payout
pause, set `paused: true` on the `_id: "control"` document in
`xl1_arcade_worker`; the worker checks this again immediately before broadcasting.
This cannot recall a transaction already submitted. Unset it to resume.

Public activity separates actual `PAID` totals from simulation and exposes only
aggregate balance, warning state, and worker health. Check `workerCheckedAt` for
stale monitoring. No sender phrase, signing material, or signed transaction bytes
are returned through public APIs.

## Verification

- `npm run test:xl1-arcade` — reward rules, bridge/proxy isolation, sender parsing,
  wallet proof selection, and worker recovery with a simulated adapter.
- `XL1_ARCADE_MONGO_TEST=1 node src/xl1-arcade/mongo.integration.test.js` — creates
  and removes its own randomly named test database; never uses production ledger
  collections. Exercises concurrency, caps, and interrupted UTC-midnight recovery.
- `XL1_ARCADE_SDK_TEST=1 node src/xl1-arcade/signer.integration.test.js` — offline
  signing with a public test phrase, not the distributor credential. No RPC calls.

A funded end-to-end transfer on the chosen network still needs validation before
production activation. Neither a passing mock test nor offline signing proves
RPC submission/confirmation or funding on that network.
