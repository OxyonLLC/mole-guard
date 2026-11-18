
# Crypto Quiz Discord Bot v3.3.3

Features:
- `/startquiz [level]` and `/sponsorquiz sponsor:<xyo|winlew>`
- `/leaderboard`, `/sponsorboard`, `/cycleboard`, `/mypoints`, `/cycleinfo`, `/quizstatus`, `/quizhelp`
- `/redeem`, `/pastredeems`
- Admin payout and cycle tools: `/quizcancel`, `/redeemspending`, `/markredeempaid`, `/requeueredeem`, `/payoutstatus`, `/rejectredeem`, `/cycleclose`, `/leaderboardpayout`, `/leaderboardpayouts`, `/cyclepayouts`
- Points: Easy=BASE_POINTS, Medium=×1.5, Hard=×2.25; Sponsored uses `SPONSOR_BASE_POINTS`
- Persistence: `data/db.json`

## Setup
```bash
cp .env.example .env
# fill DISCORD_TOKEN, CLIENT_ID, GUILD_ID (optional)
npm install
npm run register
npm run dev
```

## Pools
- Easy: 20 Qs (general crypto)
- Medium: **15 Qs** (added)
- Hard: **25 Qs** (added)
- Sponsored: **XYO (50)**, **WinLEW (large)**

Edit pools in `questions.js` and `sponsor.js`.

## Redemption Notes
`/redeem` logs a pending entry in `data/db.json`. Handle payouts off-chain or extend with your own on-chain flow.

## Command Surface

### Public
- `/startquiz [level]`
- `/sponsorquiz sponsor:<xyo|winlew>`
- `/leaderboard`
- `/sponsorboard sponsor:<xyo|winlew>`
- `/cycleboard`
- `/mypoints`
- `/cycleinfo [user]`
- `/quizstatus`
- `/quizhelp`
- `/redeem amount:<points>`
- `/pastredeems`

### Admin
- `/quizcancel`
- `/redeemspending`
- `/markredeempaid id:<id> winlew:<amt> [tx]`
- `/requeueredeem id:<id>`
- `/payoutstatus`
- `/rejectredeem id:<id> [reason]`
- `/cycleclose`
- `/leaderboardpayout [minimum]`
- `/leaderboardpayouts`
- `/cyclepayouts [cycle]`
