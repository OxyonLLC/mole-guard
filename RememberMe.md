# RememberMe — parked features, test-harness recipes, and gotchas

Institutional knowledge that is **not** discoverable from the code (removed/gated
commands leave no trace) plus the testing patterns used in this repo. Keep this
updated.

---

## 1. Parked / awaiting-activation features

Features intentionally NOT built or disabled until a condition is met. (Scanned
faucet + mole + quiz + geoagora + watchdog on 2026-06-26 — these conditions are
**not** encoded anywhere in the source, so track them here or they get lost.)

### `!airdrop` command — ⏳ awaiting 500 X (Twitter) followers
- **Status:** not implemented. The faucet has airdrop *registration* (`!register`
  marks a wallet for airdrops, stored in `src/faucet/airdrops.json` /
  `AIRDROPS_FILE`), but there is **no distribution command**.
- **Unlock condition:** 500 followers on X.
- **Target date:** **Dec 7, 2026** — the **2-year token anniversary** (token launched
  Dec 7, 2024). Plan: activate `!airdrop` + a social-media push to mark it (assuming
  the 500-follower milestone is met by then).
- **When activating:** add the `!airdrop` handler to `src/faucet/bot.js`, register it
  in `src/shared/command-inventory.js` (Wallet/Faucet section), and it'll auto-appear
  in `!commands` / `!help`. Pays from `bot-keypair.json` to the registered airdrop
  wallets; reuse the faucet's existing send/transfer + duplicate-wallet audit
  (the watchdog already runs a "duplicate wallet" airdrop audit).

### Other removed/gated commands — ✍️ ADD FROM MEMORY
No code traces were found for these, so list them here as you recall them:
- `!__________` — removed because: __________ ; re-activate when: __________
- `!__________` — removed because: __________ ; re-activate when: __________

---

## 2. Test-harness recipes (how this repo is tested)

There is no formal test runner. Verification is done with **throwaway Node
harnesses** in two shapes. Reuse these patterns; they all clean up after
themselves and never touch production (Mongo OFF + scratch dirs).

### A. Isolated integration test (boots the real web server)
Boots `startWeb()` with **Mongo disabled** and a **scratch `DATA_DIR`**, drives the
HTTP API with a real Solana keypair, and restores any hardcoded data file it has to
touch. Used for: wallet-login, reward claim/validation, guest reconcile, game
payout dry-run, quiz web-play.

```js
import fs from "node:fs"; import path from "node:path";
import dotenv from "dotenv"; import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
const ROOT = process.cwd(), PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
dotenv.config({ path: path.join(ROOT, ".env") });
process.env.MONGO_ENABLED = "false";   // <- never hit the prod cluster
process.env.MONGO_URI = "";
process.env.DATA_DIR = path.join(process.env.SCRATCH_DIR, "data"); // scratch
process.env.PORT = String(PORT); process.env.HOST = "127.0.0.1";
// Back up any HARDCODED data file you'll mutate (see gotchas §3):
// const RH = path.join(ROOT,"src","data","game_reward_history.json");
// const bak = fs.existsSync(RH) ? fs.readFileSync(RH) : null;
const { startWeb } = await import(path.join(ROOT, "src/mole/web.js"));
await startWeb(); await new Promise(r => setTimeout(r, 400));
// ...drive endpoints, sign challenges with nacl.sign.detached(...)...
// finally: restore the backup (or unlink if it didn't exist), process.exit
```
Run it from the repo root (so `node_modules` resolves) with a scratch dir:
```
cp harness.mjs ./.tmp.mjs && SCRATCH_DIR=/tmp/x node ./.tmp.mjs; rm -f ./.tmp.mjs
```

### B. Pure-function unit test (extract via `new Function`)
For logic inside files you can't `import` (browser game chunks that use `with`, or
the watchdog service script). Slice the function source out and rebuild it:

```js
const fs = require("fs");
const src = fs.readFileSync("src/watchdog/index.js", "utf8");
const a = src.indexOf("const IMPERSONATION_DECORATORS");
const b = src.indexOf("function buildImpersonationNote");
const { classifyNameImpersonation } =
  new Function(src.slice(a, b) + "\nreturn { classifyNameImpersonation };")();
// assert against known-good / known-bad inputs...
```
Used for: the wallet-scam detector, the impersonation name matcher, the Grub Drop
reward planner. Always test **both** must-flag and must-NOT-flag (false positives
matter most on a crypto server).

### C. Syntax checks
- ESM/CJS files: `node --check <file>`.
- Browser game chunks use `with (deps)` → `node --check` (ESM/strict) **falsely
  errors**. Validate them with a non-strict parse instead:
  `node -e "new Function(require('fs').readFileSync('<file>','utf8'))"`.

---

## 3. Gotchas worth remembering
- **Hardcoded data paths ignore `DATA_DIR`:** `rewardHistory.js` →
  `src/data/game_reward_history.json`; quiz `db.js` → `src/quiz/data/db.json`.
  Tests must back up/restore these directly (Mongo OFF) or they pollute real data.
- **Reward claim shape:** hub games must POST `{game, roundKey, baseReward,
  multiplier, payout}` — missing `roundKey` → server rejects (`invalid_reward_claim`).
  The server recomputes `payout = baseReward * multiplier`.
- **Shadow-mode flags:** `REWARD_VALIDATION_MODE=shadow` (recompute only, caps log-
  only) and `GAME_PAYOUTS_DRY_RUN=true` (compute + log, send nothing) are the safe
  defaults. Flip after watching logs.
- **Env parity:** keep `.env` and the `*.env.example` files in sync; the bots read
  many keys. (`.env` is gitignored.)
- **Claude model ids:** latest are Opus 4.8 (`claude-opus-4-8`), Sonnet 4.6
  (`claude-sonnet-4-6`), Haiku 4.5, Fable 5 (`claude-fable-5`). The watchdog/services
  default to an older sonnet — bump in `CLAUDE_MODEL` / `src/services/claude.js` when
  you want the newest.
- **Two live instances = chaos:** never run v2 and v3 with the same bot tokens (see
  MIGRATION.md).
