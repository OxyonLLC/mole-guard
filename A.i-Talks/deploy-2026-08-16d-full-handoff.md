# Deploy 2026-08-16d — full handoff: who, what, where, when

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

Supersedes `deploy-2026-08-16c-exploit-list.md`, folded in. If you read one file
before deploying, read this one.

> **Refreshed 2026-08-16, late.** An earlier version of this file listed only
> seven commits and is now six short — it predated the News publish, the HODL
> commands, the events fix and the mobile work. Everything below is current as
> of `d9e8c46`.

---

## WHERE you are

Your machine was reset to `origin/main` at **`700d603`**. **Thirteen** commits
have landed since. All pushed; none of this needs you to write code.

```
d9e8c46  app: the claim button froze in the background — and a wrong diagnosis
8fd1076  android: POST_NOTIFICATIONS  (see the correction in §Mobile)
89a2347  events: mobile clipping from a raw pool address
5411823  hodl: the commands it never had, and the data the page never showed
016eec8  news: publish the history — five articles, and the inventory
2ac794a  docs: the previous version of this handoff
b22c992  social: tweets -> their own channel, and can no longer be lost
795ecfa  security: escalating IP bans — 6 months, then permanent
149169c  history: 2BRZ date corrected; Dec 7 + HODL + 2BRZ drafts
c51c1b3  news/events: campaign draft; the snapshot claim corrected
9264fc2  news: the WinLEW News Center
4848fbe  transparency: the 40M Burn Lock
d27ff53  health: red/green bot lights
```

```bash
# snapshot the runtime data dirs FIRST — this has bitten before
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
npm test        # expect 1692/1692
```

---

## WHO / WHAT / WHEN — the incident, in order

All times UTC unless stated. Public version: `/news/security-update-august-16-2026/`.

| When | What |
|---|---|
| **Aug 16, ~07:13–07:57** | Scripted wallet-only sign-ins. One wallet 10× in a minute; then bursts of 10 and 8 new wallets. |
| Aug 16, 05:02 | Owner adds bans — production reaches **10 enforcing wallet bans, 4 account bans**. |
| Aug 16 | Verified against Mongo: **0 claims, 0 registrations** from any of the 19. Nothing taken. |
| Aug 16, 05:25 | Same day, unrelated: **40,000,000 WinLEW** moved into two Jupiter Lock escrows. |
| Aug 16, ~18:26 | The burst guard's **first real catch** — 6 sign-ins / 6 wallets, IP auto-banned. |
| Aug 16, 21:18 | Owner creates `🗣️-social-posts` (`1538658276831662271`). |

**Nobody has been identified.** The public article says so and names no one. Do
not add attribution the evidence does not support.

---

## You must do

### 1. Restart THREE services

`web/mole`, the **faucet bot**, and the **games payout worker**. Skipping the
games worker leaves the payout blocklist unenforced.

### 2. Env — two are DONE, two are not

Owner set these and reports them closed. **Verify, do not re-do:**

```
FAUCET_VERIFY_AFTER_CLAIMS=0     # DONE — verification required from claim #1
GAME_PAYOUTS_DRY_RUN=false       # DONE — the nightly game payout now SENDS
```

> **The next game-payout batch is the first LIVE one.** Claims accrued through
> the whole dry-run period, so it may be large; anyone over the 25,000/user
> ceiling lands in `held`, which is the ceiling working, not a bug. It is also
> the first time the payout blocklist runs against real money. Read that log.

Still to add:

```
SOCIAL_POSTS_CHANNEL_ID=1538658276831662271
FAUCET_TREASURY_PUBKEY=FcEtZqVowuhF2hdysy7qxJYRhu1eNZ8ws2JqHUDmPPjE
```

The bot **must be able to see and send in** the social channel. It falls back to
`GENERAL_WEBHOOK_URL` rather than dropping posts — but then nothing moves out of
general chat. `SOCIAL_POSTS_WEBHOOK_URL` also exists if you prefer a webhook
that already points at the channel; keep it separate from `GENERAL_WEBHOOK_URL`
so the tweet-watcher's outage alerts stay where maintainers look.

### 3. Re-upload ALL of `src/public/`

`nav.js` changed (News entry + a `matchPrefix` fix), so every page. New or
changed: `/news/`, `/hodl/`, `/health/`, `/burn/`, `/transparency/`,
`/who-we-are/`, `/events/`, `/app/`, `/`, `sitemap.xml`.

### 4. Rebuild the APK — a pull does NOT reach phones

Both mobile fixes live in `src/public/app/` and the Android manifest.
`npm run mobile:publish`, then a fresh install.

### 5. Owner-only

- Discord server → verification level **Highest** (the phone requirement).
- **Rotate the X-posts webhook** — it was pasted into a chat.
- Recover the **19 sybil addresses**, which exist ONLY on your machine:

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('src/data/profile_prefs.json','utf8'));console.log(Object.values(d).filter(v=>v.wallet&&v.updatedAt>='2026-08-16').map(v=>v.wallet).join('\n'))"
```

  Then `!faucetcluster` a few. The outward walk from the existing ban set matched
  **0 of 19** — the operator changed funding source, and the shared funder is the
  seed that makes the depth-2 cluster walk refuse all of them at once.

---

## WHAT changed, by area

### Security

- **Identity-age gate** — verification measures how long a Discord account has
  *existed*. 30 days account, 7 days in-server, screening required. Link time
  only; nobody already verified is affected.
- **Payout blocklist** (`src/services/payoutGate.js`) — one check in front of
  every fund release. **Game payouts previously had none.** Blocked funds are
  HELD, not skipped, and it **fails closed**.
- **Escalating IP bans** — **6 months**, then **permanent**. Strikes live outside
  the ban record because `purgeExpired()` deletes expired bans.
- **Burst gate 6 → 3** distinct wallets, all thresholds env-tunable.
- **Appeal route on every refusal.**

> The threshold was tightened *and* the penalty lengthened on the same day.
> Three anonymous wallets from one address now costs six months, and a shared
> house or one person's phone-plus-laptop produces that exact shape. If honest
> people start appealing, **raise `WALLET_BURST_MAX_WALLETS` — do not shorten the
> ban and do not disable the guard.**

### Transparency

Burn wallet now holds exactly **10,000,000**; two escrows hold 20M each —
`6drzVwvru3…76Xw` unlocks **2027-08-01**, `CQYV3c6tVU…ZVwx` over **2029→2031**.
Locked total on `/who-we-are/` went 138.28M → **178.28M**. `/burn/` corrected:
it said staged tokens were "still moveable", which 40M no longer are.

### News — now populated

`/news/` is generated from `src/mole/newsData.js` via `npm run news:build`.
**Run it after editing that file and commit the output.**

**Five published:** the security update, HODL Rewards, 2BRZ, the Dec 7
anniversary, and a burn history. Two drafts remain and must not be published
without the owner. `NEWS_INVENTORY.md` (78 candidates) is regenerated with
`npm run news:inventory`.

The burn article leads with **50,000,000 destroyed** — the on-chain figure
(1B start, 950M now), which is **50.0% of the 100M target**. WinLEW's own ledger
confirms 49,707,077.187484; the 292,922.812516 difference is holder-initiated
burns the project did not perform. Both numbers are published, and the smaller
one is the stricter claim.

### HODL

`!hodl`, `!hodl me` (public, self only) and `!hodl preview` (mod, read-only).
**There is deliberately no `!hodl pay`** — paying stays on the CLI behind
`npm run hodl:pay -- --apply`, because that script requires a reconcile pass and
its own header records that this repo "has twice paid people twice". A test
asserts the command cannot import a keypair or send a transaction.

`/hodl/` and `/api/hodl/status` now publish the limits governance cannot raise,
the PoV tiers, the payout day, the next payout date, and a lifetime total.

### Mobile

**A correction: the POST_NOTIFICATIONS commit (`8fd1076`) had the wrong
diagnosis.** `@capacitor/local-notifications` declares that permission in its own
manifest and Android merges it in — it was never missing. The real cause was OEM
battery management killing the app so the alarm never ran; a tester fixed it by
allowing **Auto Start** and **Background running** in App Info. That is a support
answer, not a code fix, and worth telling anyone reporting silent notifications.

The real bug found alongside it IS fixed: the cooldown countdown was computed
once at fetch and frozen, so a backgrounded app showed "Next drip in ~2h" while
the notification correctly said ready. It now derives from an absolute timestamp
on a 30-second tick, works with no network and no resume event, and asks the
server rather than enabling the button on local time.

### Health

`/health/` bot lights: green = heartbeat within 5 min, red = reported before and
stopped, **grey = never heard from**. The Utility Bot is grey and that is honest
— it needs ~10 lines, in `utility-bot-heartbeat.md`.

---

## Do NOT

- **Do not run `npm run start:faucet` on the DEV PC.** Its `.env` points at
  production Mongo and `bootstrapFile()` lets a non-empty local file overwrite
  the remote unconditionally. Its stale `wallet_bans.json` would replace 10
  enforcing bans with 1 review-only record — very likely what emptied the list on
  2026-08-15, and **that hole is still open**.
- **Do not add a ban check to `/api/hub/wallet-login`.** Sign-in is free by
  design; bans gate payouts. Gating login breaks anonymous play.
- **Do not read ban lists from local files.** Mongo or `!faucetbans` only.
- **Do not publish a news draft** without the owner.

---

## Watch after restart

| Log line | Means |
|---|---|
| `⛔ HELD … on the faucet ban list` | payout gate working; funds stayed on the bot |
| `[game-payout] LIVE batch=…` | dry-run is off — this now sends |
| `ban list unreadable … holding the entire batch` | **fail-closed fired, nothing paid** — fix the read, don't bypass |
| `auto-banned … (offence N, PERMANENT)` | escalation working |
| `🛑 Verification refused — identity too new` | expect some; lower the threshold, don't disable |
| `[SOCIAL] could not post to channel …` | bot lacks access; it fell back rather than dropping |
| `[TWITTER] delivered N/M — leaving lastTweetId` | delivery failed; tweets pending, will retry |
| `[TWITTER] … credits are depleted` | X API out of credits — announces once, parks, self-recovers |

---

## Known open, not forgotten

1. **X API credits depleted** — the tweet watcher announces nothing until topped
   up. It now says so loudly rather than failing silently.
2. **`bootstrapFile` local-wins branch** — still overwrites remote with a stale
   non-empty local.
3. **`profile_prefs.json` is single-machine, unbacked state** — the only record
   tying a wallet-only session to an address, on one disk, not in Mongo.
4. **The wallet-account layer** — an account *above* the wallet, so three wallets
   declared by one person stop looking like three people. Proving it by signing
   from an already-linked wallet makes the declaration real. The right fix for the
   false-positive risk in §Security. Not started.
5. **Quiz and HODL economics** — owner wants quiz points halved to 0.5 WinLEW per
   point (`QUIZ_WINLEW_PER_POINT`, already env-driven) and the HODL pool halved
   with a tenure multiplier so long holders grow back toward the old rate. Note
   before building: the pool is a **ceiling**, so a tenure bonus redistributes
   rather than adds — a long holder only reaches their old amount if newer
   holders dilute below it. Not started.
6. **News cross-linking and timeline** (§8/§9/§11 of the news brief), plus the
   owner's historical document for the remaining backfill.
