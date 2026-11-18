# 💰 WinLEW Discord Bot v3.3.3

Your all-in-one, self-hosted Discord bot for the $WinLEW Solana token.  
This bot brings **price data from multiple sources**, **faucet automation**, **community engagement tools**, and **admin features** to your Discord server—fully open, transparent, and extensible.

---

## 🌟 Features

- **Live $WinLEW Price** from GeckoTerminal, Raydium, Pump.fun, DexScreener, and more.
- **Aggregated stats**: `!data` command for all price sources at once.
- **Detailed per-source stats**: `!gdata`, `!ddata`, `!rdata`, `!pdata` commands.
- **User faucet** with 24h cooldown—one claim per wallet/account per day.
- **Wallet identity sync** with Mole Guard linked-wallet data so verified users are recognized automatically.
- **Balance checking** for Solana addresses and .sol domains.
- **Total supply** info and airdrop registration.
- **Buy/swap quicklinks** for all major DEXes and sites.
- **MOD/admin tools** and bot restart for safe management.
- **Automated Twitter/X announcements** and live channel price updates.
- **All code modular, extensible, and easy to upgrade.**

---

## 🚀 Getting Started

### 1. **Clone the Project**


### 2. **Install Dependencies**

```sh
npm ci
```

### 3. **Configuration**

1. **Copy the `.env.example` to `.env`** and fill out all required values:

   ```
   DISCORD_BOT_TOKEN=your-bot-token
   WINLEW_MINT=your-mint-address
   BOT_KEYPAIR_PATH=./your-bot-keypair.json
   RPC_URL=https://api.mainnet-beta.solana.com
   GECKO_PAIR_ID=...
   RAYDIUM_POOL_ID=...
   PUMPFUN_POOL_ID=...
   DEXSCREENER_PAIR_ID=...
   DRIP_AMOUNT=1000
   MOD_IDS=comma,separated,discord,user,ids
   VOICE_CHANNEL_ID=...
   PRICE_CHANNEL_ID=...
   ALERT_CHANNEL_ID=...
   VOICE_WEBHOOK_URL=...
   PRICE_WEBHOOK_URL=...
   GENERAL_WEBHOOK_URL=...
   ANNOUNCEMENT_WEBHOOK_URL=...
   TWITTER_BEARER_TOKEN=...
   ```

2. **Generate a Solana keypair** (if needed) and fund it for gas.

3. **(Optional) Set up Twitter/X API credentials** for tweet relaying.

### 4. **Run the Bot**

```sh
npm start
```

Before restart/deploy, validate the checkout exactly once:

```sh
npm test
npm run verify:imports
```

---

## 🕹️ Commands

This build exposes both prefix commands and slash commands. `!help`, `!commands`, and `!navigation` are the in-Discord guides for the `v3.3.3` release.

### Prefix Commands

**Quick Start**
- `!help` / `!menu` — Show the quick-start overview
- `!commands` / `!fhelp` — Show the full command catalog
- `!navigation` / `!nav` — Show grouped shortcuts by area

**Identity & Wallets**
- `!register <wallet-or-domain>` — Save a wallet for faucet, airdrops, and manual fallback
- `!mywallet` — Show your saved wallet and current balance
- `!whoami` — Show Discord identity, linked wallet, and faucet cooldown
- `!unlinkwallet` — Remove the saved wallet
- `!reverse <solana-pubkey>` — Reverse-lookup an SNS name

**Faucet & Token**
- `!faucet <wallet-or-domain>` / `!drip` — Claim the configured faucet amount
- `!faucetstatus` — Show cooldown and holder-floor readiness
- `!balance <wallet-or-domain>` — Check a token balance
- `!supply` — Show total token supply
- `!uptime` — Show bot uptime

**Market Data**
- `!price`, `!data`, `!ddata`, `!gdata`, `!pdata`, `!rdata`, `!sdata`

**Links & Public Wallets**
- `!links` / `!socials`
- `!quicklinks` / `!buylinks`
- `!buy`, `!swap`, `!dexscreener`, `!geckoterminal`, `!cmc`, `!website`, `!rugcheck`
- `!rpc` / `!rpcstatus` / `!endpoint`
- `!wallet`, `!xwallet`, `!devwallet`

**Moderator & Admin**
- `!modhelp` — Moderator/admin command list
- `!send <wallet-or-domain>` — Manual send helper
- `!debugprice` — Raw diagnostics for price sources
- `!restart` — Restart the faucet process

### Slash Commands — Mole Guard / Gaming

- `/mole link [app]`
- `/mole sync [app]`
- `/mole status`
- `/game hub`

### Slash Commands — Quiz / Utility

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
- `/quizcancel` — Manage Server
- `/redeemspending` — Manage Server
- `/markredeempaid id:<id> winlew:<amt> [tx]` — Manage Server
- `/requeueredeem id:<id>` — Manage Server
- `/payoutstatus` — Manage Server
- `/rejectredeem id:<id> [reason]` — Manage Server
- `/cycleclose` — Manage Server
- `/leaderboardpayout [minimum]` — Manage Server
- `/leaderboardpayouts` — Manage Server
- `/cyclepayouts [cycle]` — Manage Server

### Slash Commands — GeoAgora

- `/geoagora health`
- `/geoagora help`
- `/geoagora listing`
- `/geoagora marketplace`
- `/geoagora offer`
- `/geoagora profile`
- `/geoagora recent`
- `/geoagora status`
- `/geoagora wallet`
- `/geoagora watch list`
- `/geoagora watch start` — Manage Channels/Admin
- `/geoagora watch status`
- `/geoagora watch stop` — Manage Channels/Admin

### Watchdog / Ops

- Watchdog is a service module in this build, not a Discord slash-command app.
- Use watchdog web endpoints for health, heartbeat, and diagnostics.

---

## ⚡ Tech Stack

- Node.js (ESM)
- Discord.js v14
- Solana web3.js & SPL-Token
- dotenv for config
- Modular fetchers for price APIs (GeckoTerminal, Raydium, DexScreener, Pump.fun, Solscan)
- Twitter API v2 (optional)
- JSON for persistent data (faucet claims, etc.)
- Cron for scheduled channel updates

---

## 🛠️ File Structure

```
.
├── bot.js                  # Main Discord bot logic
├── priceTracker.js         # Aggregated price fetching logic
├── gecko.js                # GeckoTerminal price fetcher
├── raydium.js              # Raydium price fetcher
├── pumpfun.js              # Pump.fun price fetcher
├── dexscreener.js          # DexScreener price fetcher
├── solscan.js              # (Optional) Solscan price fetcher
├── faucet.js               # Faucet and drip logic
├── .env                    # Environment config
└── README.md
```

---

## 🧠 Notes & Best Practices

- **Keep your .env safe!** Never commit it with secrets.
- Run the bot under `pm2` or Docker for auto-restart on crash.
- Stick to npm only. `package-lock.json` is the single source of truth.
- Back up your keypair file securely.
- Update dependencies regularly for security.
- Extend or modify fetchers as new price APIs emerge.

---

## 🤝 Contributing

PRs, feature requests, and feedback are welcome!
Open an issue or fork and make a PR.

---

## 📣 Credits

- $WinLEW Community  
- [Your Discord](https://discord.gg/dhFxhWjVqU)  
- [Official Site](https://WinLEW.co)

---

*Built with ❤️ by passionate builders for the #WinLEW fam.*
