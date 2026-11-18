# MIGRATION — move The Mole Guard (v3) to a new PC and cut over from v2

Goal: run **one** live instance. v2 and v3 must **not** be online at the same time
with the same Discord bot tokens (double command replies + gateway conflicts).

## 0. Mental model (what runs where)
- **Mongo Atlas (cloud)** is the source of truth (`MONGO_ENABLED=true`). The local
  `data/` dirs are just fallback mirrors — the new PC inherits state from the same
  cluster automatically.
- The **mole web server** (port `8787`, exposed via the reserved **ngrok** domain)
  serves `/verify`, `/gaming-hub`, `/quiz`, and the `/api/*` the bots + website call.
- Payouts:
  - **Faucet** = manual `!drip`/`!faucet` claim, sends immediately.
  - **Game winnings** = earned in the hub, paid in a **daily batch at 00:00:01 UTC**
    by the `gamepayouts` worker (only when `GAME_PAYOUTS_DRY_RUN=false`).
  - **Quiz** = points paid per cycle by the `quizpayouts` worker.

## 1. Get the code on the new PC
```
git clone https://github.com/LewSales/mole-gaurd.git
cd mole-gaurd
```

## 2. Copy the things git does NOT carry (gitignored secrets/state)
Move these from the old PC by hand (USB/secure copy — never commit them):
- **`src/faucet/bot-keypair.json`** ← MOST IMPORTANT. It's the treasury signer for
  the faucet **and** quiz **and** game payouts. Nothing pays out without it.
- `.env` (root) — plus `src/quiz/.env` and `src/faucet/.env` if they exist.
- Optional (Mongo is authoritative, so usually unnecessary): `data/`, `src/data/`,
  `src/quiz/data/`, `src/faucet/*.json`, `data-watchdog/` (copy the last one if you
  want watchdog heartbeat continuity).

## 3. Install dependencies
```
corepack enable          # repo pins yarn@4.12 via packageManager
yarn install
```

## 4. ngrok (so OAuth redirects keep working)
`.env` hard-codes the reserved domain for `DISCORD_REDIRECT_URI` / `PUBLIC_BASE_URL`
(`orthomorphic-...ngrok-free.dev`). On the new PC:
```
ngrok http 8787 --domain=orthomorphic-laevorotatory-trista.ngrok-free.dev
```
(The `NGROK_AUTHTOKEN` is already in `.env`.) Make sure **only one** tunnel points
at that domain — kill the old PC's tunnel. WinLEW owns this tunnel. GeoAgora must
not start ngrok; it sends Watchdog heartbeats through
`https://orthomorphic-laevorotatory-trista.ngrok-free.dev/watchdog`.

## 5. CUT OVER — stop v2 first
On the old PC, stop every v2 process (bots + web + workers). Confirm the old
Discord bots show **offline** before continuing.

## 6. Start v3
```
yarn start:all
```
`start:all` runs `node src/runner.js all`, which spawns the WinLEW services:
`mole, quiz, quizpayouts, gamepayouts, watchdog, public`. GeoAgora and GeoHackers
are started only from their own repositories. Run individual WinLEW services with
`node src/runner.js <name>` (e.g. `node src/runner.js gamepayouts`).

## 7. Go live (flip the switches when ready)
In `.env`, then restart the affected service:
- `MAINTENANCE_MODE=true → false` (currently on with reason "Migration") — takes the
  site out of maintenance.
- **Payout logs to Discord** (do this *during* the dry-run trial): create a webhook
  in the **the-logs** channel (Channel Settings → Integrations → Webhooks → New
  Webhook) and set `GAME_PAYOUT_LOG_WEBHOOK_URL=<url>`. Each nightly run then posts a
  summary there — `🧪 DRY RUN … would pay N players, total X WinLEW` (and `💸 sent …`
  once live). Leave unset = console + JSON ledger only, no Discord message.
- `GAME_PAYOUTS_DRY_RUN=true → false` — **only after** you've watched a night of
  those `🧪 DRY RUN` summaries and the amounts look right. Then restart `gamepayouts`.
  (It pays at 00:00:01 UTC; set `GAME_PAYOUT_RUN_NOW=true` once to fire a batch
  immediately for a test, then set it back to false.)

## 8. Post-cutover checks
- Discord: only the v3 bots online; `!wd-ping`, `!faucetstatus`, a `/verify` flow,
  and a hub game round all respond.
- Watchdog has **Ban Members** + **Manage Server** and its role sits **above**
  would-be impersonators (needed for auto-ban + the "joined via invite" line).
- Website: `winlew.co/verify`, `/gaming-hub`, `/quiz` load and `/api/*` answer.
- Watch the watchdog alert channel for the first few `impersonation_*` /
  `security_flag` events and tune the env lists if anything misfires.

## Service → env-file map (from src/runner.js)
| service       | entry                          | env file        |
|---------------|--------------------------------|-----------------|
| mole          | src/index.js                   | .env            |
| quiz          | src/quiz/index.js              | src/quiz/.env   |
| quizpayouts   | src/quiz/payout-worker.js      | src/quiz/.env   |
| gamepayouts   | src/games/payout-worker.js     | .env            |
| watchdog      | src/watchdog/index.js          | .env            |
| public        | src/public-server.js           | .env            |
