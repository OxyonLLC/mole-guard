# WinLEW Quiz Bot (Crypto Quiz) — Ship README v3.3.3

This folder is the **Quiz** service for the WinLEW project.

It supports:
- Regular quizzes: `/startquiz` (easy/medium/hard)
- Sponsored quizzes: `/sponsorquiz sponsor:xyo|winlew`
- **Answer-leak protection** (sanitizes question text/choices and warns in logs)
- **ID-based redeems** (prevents admin mistakes)
- **Redemption history** (`/pastredeems`)
- **91-day cycles (quarters)** with payout generation & tracking

---

## 1) What you get

### ✅ Quiz modes
- **Regular**: easy / medium / hard
- **Sponsor**: **xyo** or **winlew**

**Shortcut:** `/startquiz level:xyo` or `/startquiz level:winlew` will automatically run the sponsor quiz.

### ✅ Points
- Points are awarded only after timer ends (button clicks lock answers).
- Points are tracked:
  - **Total points** (current balance)
  - **Sponsor breakdown** (per sponsor)
  - **Cycle points** (current 91-day “quarter”)

### ✅ Redeems (safe, edge-case resistant)
- Users create a request: `/redeem amount:<points>`
- Admin lists pending: `/redeemspending`
- Admin marks paid **by redeem ID**:
  - `/markredeempaid id:<redeemId> winlew:<amount> tx:<optional>`
- Admin can reject **by redeem ID**:
  - `/rejectredeem id:<redeemId> reason:<optional>`

Users can view their history:
- `/pastredeems` (includes points, WinLEW sent when recorded, tx if provided, and redeem ID)

### ✅ Cycles (4 per year, 91 days each)
- The bot tracks points per-cycle automatically.
- When a cycle ends, admin runs:
  - `/cycleclose`
- The bot generates **pending payout records** for each user with cycle points.
- Admin can list them:
  - `/cyclepayouts` (defaults to current cycle)
- Admin pays manually and marks each payout paid using `/markredeempaid` (same flow as manual redeems).

---

## 2) Commands

### Public
- `/startquiz [level]`  
  - level: easy | medium | hard | xyo | winlew  
  - If omitted, defaults to **easy**
- `/sponsorquiz sponsor:<xyo|winlew>`
- `/leaderboard`
- `/sponsorboard sponsor:<xyo|winlew>`
- `/cycleboard`
- `/mypoints` (ephemeral)
- `/cycleinfo [user]` (ephemeral for self; viewing another user requires Manage Server)
- `/redeem amount:<points>` (ephemeral)
- `/pastredeems` (ephemeral)
- `/quizstatus` (ephemeral)
- `/quizhelp` (ephemeral)

### Admin (requires **Manage Server**)
- `/redeemspending` (ephemeral)
- `/markredeempaid id:<redeemId> winlew:<amount> [tx]`
- `/requeueredeem id:<redeemId>`
- `/payoutstatus`
- `/rejectredeem id:<redeemId> [reason]`
- `/quizcancel` (cancels active quiz in channel)
- `/cycleclose`
- `/leaderboardpayout [minimum]`
- `/leaderboardpayouts`
- `/cyclepayouts [cycle]` (ephemeral)

---

## 3) Environment variables

Create `quiz/.env` (or edit it) with:

### Required
- `DISCORD_TOKEN` **or** `DISCORD_BOT_TOKEN`
- `CLIENT_ID` (Discord application client ID)
- `GUILD_ID` *(optional but recommended for fast command updates)*

### Optional / recommended
- `BASE_POINTS=100`
- `SPONSOR_BASE_POINTS=125`
- `QUIZ_TIME_MS=15000`
- `QUIZ_COOLDOWN_MS=30000`

### Optional: lock quizzes to certain channels
- `QUIZ_CHANNELS=123,456,789` (comma-separated channel IDs)  
If empty, quizzes work in any channel.

### Cycles (91-day quarters)
Set once to align your quarters:
- `CYCLE_EPOCH=2026-01-01`
- `CYCLE_LENGTH_DAYS=91`

Notes:
- `CYCLE_EPOCH` can be an ISO date (recommended) or a millisecond timestamp.
- On first run, the bot locks the epoch into `quiz/data/db.json` meta so it won’t shift later by accident.

---

## 4) Setup / Install

### Install deps
From inside `quiz/`:
```bash
npm install
```

### Register slash commands
Fastest: set `GUILD_ID` in `.env` and run:
```bash
node register-commands.js
```
If you don’t set `GUILD_ID`, commands register globally (can take longer to show up in Discord).

### Start the quiz bot
```bash
node index.js
```

---

## 5) Data storage

All data is stored locally in:
- `quiz/data/db.json`

It includes:
- `users[userId].points` (current balance)
- `users[userId].sponsor` (per-sponsor totals)
- `users[userId].cycles[cycleId]` (per-cycle totals)
- `redemptions[]` (manual redeems + cycle payouts)

Redemption records include:
- `id` (unique ID used for admin actions)
- `status`: pending | paid | rejected
- `winlewSent` (recorded when admin marks paid)
- `tx` (optional reference)

---

## 6) Cycle payout workflow (how to run quarters)

1) Let cycle run normally (91 days)
2) End of quarter: run `/cycleclose`
3) Bot generates pending payout records
4) Pay users manually (WinLEW transfer)
5) Mark paid:
   - `/markredeempaid id:<redeemId> winlew:<amount> tx:<optional>`
6) Users can verify in `/pastredeems`

---

## 7) Quick sanity checks

### Syntax check
```bash
node --check index.js
node --check db.js
node --check register-commands.js
```

### Common issues
- **Commands not showing:** set `GUILD_ID` and re-run `register-commands.js`
- **Token missing:** ensure `DISCORD_TOKEN` or `DISCORD_BOT_TOKEN` is in `.env`
- **Quizzes blocked in channel:** check `QUIZ_CHANNELS` (if set)

---

## 8) What we fixed / added from our discussion

- Prevented answer leaks by sanitizing question text/choices and warning in logs.
- Added `pastredeems` and stored `winlewSent` + optional `tx`.
- Switched admin actions to **redeems-by-ID** to avoid edge-case mistakes.
- Added 91-day **cycle tracking**, cycle leaderboard, and payout generation.
- Added sponsor pools for **XYO** and **WinLEW** and kept the rest simple.
- Added `/startquiz level:xyo|winlew` sponsor shortcut and default easy when omitted.

---

If you want: next step can be adding **automatic quarter rollovers**, or a `/cyclehistory` command to show closed cycles and payout completion.
