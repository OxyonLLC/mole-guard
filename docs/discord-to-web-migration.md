# Discord-to-Web Migration Matrix

Date: 2026-07-16
Scope: a complete inventory of every Discord bot command/workflow across the three WinLEW bot codebases (Mole Guard, Faucet bot, Quiz bot), cross-referenced against the current website, to answer one question: **can a user fully participate in WinLEW from winlew.co without needing Discord?**

## Method

Every command registration file was read directly — `src/mole/commands.js`, `src/mole/bot.js` (Mole Guard), `src/faucet/bot.js` (Faucet bot, ~35 prefix commands), `src/quiz/index.js` + `src/quiz/command-data.cjs` (Quiz bot slash commands) — not just currently-visible slash commands. Each was cross-referenced against `src/mole/web.js`'s registered routes and the live pages under `src/public/`. GeoAgora/GeoHackers are confirmed separate products with their own bots, out of scope.

## Classification legend

- **Already exists on web** — full parity, same underlying data/logic.
- **Partially exists on web** — some but not all of the capability is mirrored.
- **Discord-only (gap)** — logically could/should be on the web, but isn't yet.
- **Should remain Discord-only** — inherently Discord-native (moderation, role administration, bot ops); migrating it would not improve the product.
- **Retired / not applicable** — informational-only command with no real "feature" behind it.

## Mole Guard bot (`src/mole/commands.js`, `src/mole/bot.js`)

| Command | Audience | Web equivalent | Route | Disposition |
|---|---|---|---|---|
| `/mole link [app]` | user | OAuth + linked-role verification flow | `/verify/` | Already exists on web |
| `/mole sync [app]` | user | Session-based role re-sync | `POST /api/roles/sync` | Already exists on web (separate route from the bot's own shared-secret `sync-bot` endpoint, by design — see `src/mole/web.js`) |
| `/mole status` | user | — | — | Retired / not applicable — prints config URLs only, no real feature |
| `/game hub` | user | Mole Hub | `/mole-hub/` | Already exists on web (the command is a convenience link) |

Mole Guard has no gaps — everything user-facing already has a full web equivalent.

## Faucet bot (`src/faucet/bot.js`, prefix `!`, ~35 commands)

| Command | Audience | Web equivalent | Route | Disposition |
|---|---|---|---|---|
| `!faucet` / `!drip` | user | Calls the same shared `claimFaucet({source:'web',...})` service (`src/faucet/service.js`) — cross-platform cooldown enforced by `claimStore.js`'s shared `userKey`/`walletKey` locks, confirmed shared, not duplicated | `/faucet/` | Already exists on web, full parity including shared cooldown |
| `!mywallet` / `!savedwallet`, `!whoami` / `!me`, `!faucetstatus` | user | Read-only wallet/balance/cooldown display | Dashboard (`/verify/profile.html`) | Already exists on web |
| `!register` / `!setwallet` / `!linkwallet`, `!unlinkwallet` / `!forgetwallet` | user | A legacy, pre-OAuth manual wallet-registration path | `/verify/` (OAuth flow) | Superseded by web — the OAuth verification flow is the current canonical path; the legacy Discord commands remain live for users still on the old flow, not retired outright this sprint (retiring a still-used Discord command is out of scope for a website migration sprint) |
| `!balance <wallet>` | user | Arbitrary-wallet balance lookup | — | Partially exists on web — the Dashboard shows the signed-in user's own balance; looking up an *arbitrary* wallet has no direct web page, though Solscan/DexScreener (already linked from Transparency/Whitepaper) serve this externally. Minor gap, low value — not implemented this sprint (see Remaining Gaps) |
| `!price`, `!data`/`!ddata`/`!gdata`/`!rdata`/`!pdata`/`!sdata`, `!supply`, `!wallet`/`!xwallet`/`!devwallet`, `!buy`, `!dexscreener`, `!rugcheck`, `!swap`, `!geckoterminal`, `!cmc`, `!website`, `!rpc`, `!reverse`, `!help`/`!commands`/`!fhelp`, `!navigation`/`!links`, `!quicklinks`/`!buylinks` | user | Thin link-posting / data-echo wrappers around external services (DexScreener, RugCheck, GeckoTerminal, CMC, Raydium) | Transparency Center, Whitepaper, homepage link hub | Already exists on web — every external link these commands post is already present and verified on the site (see Official Link Review below); no unique capability to migrate |
| `!send <address>` | **admin/mod-only** (`MOD_ID_LIST`) | — | — | **Should remain Discord-only.** This is an actual on-chain token-send command that signs and broadcasts a real transfer using the bot's own keypair. Exposing this class of capability on the public web is explicitly prohibited by this sprint's safety rules |
| `!restart`, `!modhelp` | **admin/mod-only** | — | — | Should remain Discord-only — bot process administration |

## Quiz bot (`src/quiz/index.js`, `src/quiz/command-data.cjs`, slash commands)

| Command | Audience | Web equivalent | Route | Disposition |
|---|---|---|---|---|
| `/startquiz [level]`, `/sponsorquiz <sponsor>` | user | `POST /api/quiz/play/next`, `POST /api/quiz/play/answer` | `/quiz/` | Already exists on web |
| `/leaderboard`, `/sponsorboard`, `/cycleboard` | user | `GET /api/quiz/leaderboard`, `/api/quiz/leaderboard/platform`, `/api/quiz/compare`, plus the Dashboard's `quiz.rank` | `/quiz/`, `/verify/profile.html` | Already exists on web |
| `/mypoints`, `/cycleinfo [user]` | user | `GET /api/quiz/me` + Dashboard's "Quiz lifetime overview" | `/verify/profile.html` | Already exists on web |
| `/pastredeems` | user | Dashboard's `quiz.payouts.recent` (Version 2.2) + `/quiz/`'s own redemption history table | `/verify/profile.html`, `/quiz/` | Already exists on web |
| `/quizstatus`, `/quizhelp` | user | — | — | Retired / not applicable — informational only |
| **`/redeem <amount>`** | user | `POST /api/quiz/redeem` — calls the exact same `redeemQuizPoints()` shared service Discord now calls too (`src/quiz/redemption.js`) | `/quiz/` (Redeem points card), cross-linked from `/verify/profile.html` | **Migrated this sprint.** See "Implementation" below |
| `/quizcancel` | **admin/mod-only** (`requireManageGuild`) | — | — | Should remain Discord-only |
| `/redeemspending`, `/markredeempaid`, `/requeueredeem`, `/payoutstatus`, `/rejectredeem`, `/cycleclose`, `/leaderboardpayout`, `/leaderboardpayouts`, `/cyclepayouts` | **admin/mod-only** | — | — | Should remain Discord-only — payout-queue administration, no user-facing purpose |

## Scheduled jobs (infrastructure, not commands)

`src/faucet/payout-worker.js`, `src/games/payout-worker.js`, `src/quiz/payout-worker.js` — backend batch payout processors. Platform-agnostic, not migration candidates.

## Totals

| Category | Count |
|---|---|
| Already exists on web | 15 (14 from the original audit + `/redeem`, migrated this sprint) |
| Partially exists on web | 1 (`!balance <wallet>`, arbitrary-wallet lookup) |
| Discord-only (confirmed gap) | 0 |
| Should remain Discord-only | 12 (7 faucet admin/utility-redundant + 3 mod-only + `!send` + `/quizcancel` + 8 redeem/payout admin commands — see tables above for the full list) |
| Retired / not applicable | 3 (`/mole status`, `/quizstatus`, `/quizhelp`) |
| Migrated during this sprint | 1 (`/redeem`) |
| Unresolved | 0 |

## Implementation: `/redeem`

This was the one confirmed user-facing participation gap found by the original Discord-to-Web audit (2026-07-16). It is now implemented, following the exact design that audit proposed: reuse `db.redeemPoints()` behind the same session authentication every other write route on this site already requires, with no second redemption economy.

## `/discord-bots/` live status — what's actually checkable (2026-07-17)

Investigated directly before building anything, given this project's standing rule against showing a fake "live"/"online" status: **no real Discord-gateway "is this bot connected" status is observable from the web process, for any of the 5 bots shown on `/discord-bots/`.**

- **The Mole Guard** (`src/mole/bot.js`) and **WinLEW Utility Bot** (`src/faucet/bot.js`, a fully separate process, separate token) each hold their Discord `Client` as a local variable — never exported, never written anywhere the web server could read. There is nothing to check for either today.
- **WinLEW Watch Dog**'s only exposure to this server is two POST-only, auth-required relay routes (`/watchdog/heartbeat`, `/watchdog/event`, `src/mole/web.js`) — a one-way "report in" channel, not something you can query for status.
- **GeoHackers** and **GeoAgora** are confirmed separate products with their own bots (see "Method" above) — reverse-proxy targets exist (`GEOHACKERS_API_LOCAL_URL`, `GEOAGORA_API_LOCAL_URL`) but no health/ping endpoint is documented on either, and probing one would mean guessing at an unaudited external codebase's routes.

`GET /api/discord-bots/status` (added this date) checks the one thing that's honestly checkable without guessing: whether the Watch Dog/GeoHackers/GeoAgora proxy targets' ports are reachable and answer an HTTP request at all (any response, including a 404, counts — only a connection failure/timeout means "unreachable"). This is explicitly labeled "service reachable," never "bot online," on both the API response and the `/discord-bots/` page itself — Mole Guard and Utility Bot show no live badge at all rather than a guessed one.

**Implemented in the Phase 4 closeout sprint** (2026-07-16 → 2026-07-20; see `docs/web-quiz-redemption.md` for the full architecture, security boundary, and test coverage). Prior to this, a first attempt at this exact endpoint had been reverted mid-sprint after this environment's own safety review flagged it as needing explicit, specific owner authorization beyond a general "implement confirmed parity gaps" instruction — the review was correct that this class of change (a session triggering a real payout-eligible redemption) warrants an explicit go-ahead, not an inference. That authorization was given directly in the Phase 4 closeout sprint's instructions ("You are explicitly authorized to implement the web equivalent now"), so the endpoint was built, tested, and shipped.

**This gap is now resolved** — see the Executive Summary of the Phase 4 closeout report.

## Parity questions — answered

1. **Can a user claim the faucet from the web without Discord?** Yes — `/faucet/`, full parity, shared cross-platform cooldown confirmed.
2. **Can a user avoid double-claiming across web and Discord?** Yes — `claimStore.js`'s `userKey`/`walletKey` locks are shared across both `source: 'web'` and `source: 'discord'` claims.
3. **Can a user play trivia without Discord?** Yes — `/quiz/`.
4. **Can a user view quiz standing and history without Discord?** Yes — `/quiz/` leaderboards + the Dashboard's quiz overview, rank, and payout history.
5. **Can a user see game activity and rewards without Discord?** Yes — the Dashboard's game history/summary (Version 2.2).
6. **Can a user verify a wallet without manually using a bot command?** Yes — `/verify/`'s OAuth + linked-role flow.
7. **Can a user manage or resync their linked identity from the web?** Yes — `POST /api/roles/sync`, session-authenticated.
8. **Can a user view their Proof of Value without Discord?** Yes — the Dashboard (Version 2.1/2.2).
9. **Can a user see official token, liquidity, lock, burn, and reserve information without Discord?** Yes — the Transparency Center, and now the Burn Center (this sprint).
10. **Can a user view public policies and legal pages without Discord?** Yes — `/discord-bots/*` policy pages are website pages, not Discord content.
11. **Can a user find all active modules without Discord?** Yes — `/#roadmap` and the six linked `/modules/*.html` pages.
12. **Can a user understand sponsors and partnerships without searching old posts?** Yes, as of this sprint — `/partners/`.
13. **Can a user fully participate without joining Discord?** **Yes, as of this sprint.** Every capability above, including converting earned quiz points into WinLEW (`/redeem`, now `/quiz/`'s "Redeem points" card), is available on the web. The one remaining item (`!balance <wallet>`, arbitrary-wallet lookup) is a minor read-only convenience already served externally by Solscan/DexScreener — see Remaining Gaps.
