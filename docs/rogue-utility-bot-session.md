# Investigation: WinLEW-UtilityBot double-replying (rogue second session)

Date started: 2026-07-24
Status: **root cause found and fixed locally — pending a restart-verification test before committing/pushing anything**

## Resolution (2026-07-24, later the same day)

The "second session running on unreachable infrastructure" conclusion below was **wrong** — found the real cause shortly after writing it. The user ran `docker compose up --build` on this same PC (Docker Desktop, Windows host, WSL2 backend) to test something unrelated. `docker-compose.yml` mounts the real root `.env` and `src/faucet/.env` (see its `env_file:` list) and runs `command: yarn dev:all`, which starts a **full second copy of every service** — Mole Guard, WinLEW-UtilityBot, Watchdog, the faucet payout worker (`dryRun=false`) — all authenticating with the exact same real Discord tokens and connecting to the exact same real MongoDB (`mole_guard`) as the pm2-managed processes already running on this machine. Confirmed directly from the container's own logs:

```
[start:all] ✅ Logged in as WinLEW-UtilityBot#5306
[start:all] 🧿 Watchdog online as WinLEW-Watch Dog#4280
[start:all] 🕵️‍♂️ The Mole Guard online as The Mole Gaurd#6400
[start:all] [mongo] Mole-Guard connected to mole_guard
[start:all] [faucet-payouts] starting — scan every 5000ms, batch 10, dryRun=false
```

That's the entire mystery: not a remote rogue deployment, a **local Docker container racing the pm2 processes with identical production credentials**, on this exact PC. It explains every symptom that had been observed (`!drip` x2, `!help` x2, watchdog audit x2, and even `!nav` only replying once *if* the container happened to be running older code without that command — never independently confirmed, and now moot).

Ran `docker compose down` — container stopped and removed, confirmed via `docker ps` (empty) and via `!uptime` in Discord going back to a single reply.

**No code changes were needed or made for this specific bug** — the fix was operational (stop the container), not a code fix. The earlier `!restart`/dedupe-guard fix (still described below) was a real, separate, already-shipped fix for a different failure mode (a brief overlap during a pm2-driven restart) — it remains correct and in place, just wasn't the cause of *this* symptom.

### Standing risk not yet addressed

`docker-compose.yml` has no isolation from production — running it on this machine at any point in the future will recreate this exact problem (duplicate bots + duplicate live payout worker against real funds) unless something changes. Not fixed yet; flagged in the "what to do next" section below. Options to consider later: separate dev-only Discord bot tokens/guild for the Docker path, a distinct dev MongoDB database, or at minimum a giant warning in `DOCKER_README.md` / `docker-compose.yml` never to run it while pm2 is also running on the same host.

## Pending verification (before pushing anything)

The user is about to power this PC off entirely, check Discord while it's off (expectation: **the bots should show fully offline** — no `!uptime` reply from anyone, since this PC is the only thing that has ever hosted them, confirmed above), then power back on and confirm pm2 auto-starts everything and `!uptime` gives exactly one reply again.

**Do not commit or push based on this document's "root cause found" claim alone — wait for the user to confirm the restart test came back clean first.** If the bots do *not* go fully offline while this PC is off, that would mean a genuinely separate instance exists somewhere after all, and the conclusion above is incomplete.

## Original investigation notes (superseded by "Resolution" above, kept for the record)

Status at time of writing: **unresolved — second session not yet located**

## Symptom

Every command handled by the faucet/utility bot (`!drip`, `!help`, `!uptime`) replies **twice**. Watchdog's duplicate-wallet audit also posts twice. `!nav` is the one exception — it only replies once.

## Decisive test already run

Typed `!uptime` in Discord. Got two replies from `WinLEW-UtilityBot` (verified `APP` badge on both — not an impersonator), same timestamp, **different uptime values**:

- `0h 23m 50s`
- `5h 56m 0s`

`process.uptime()` is per-process and monotonic — it cannot produce two different values from one running process. **This proves two separate live processes are both logged into Discord as WinLEW-UtilityBot right now**, one much newer than the other.

## What's already been fixed (2026-07-24, earlier this session) and is NOT the remaining bug

`src/faucet/bot.js` previously had no graceful shutdown (`!restart` and pm2-driven restarts both called a bare `process.exit(0)`, never closing the Discord session), which could cause a brief overlap during a restart. Fixed: added a `SIGTERM`/`SIGINT` handler that calls `client.destroy()` before exiting, updated `!restart` to do the same, and added a message-id dedupe guard in the `messageCreate` handler as a safety net. All still in place and correct — confirmed by re-reading the live file. **This fix does not explain the current symptom**, because it only covers a short overlap window during a restart on *this* machine; the second session found via `!uptime` is long-lived (~24 minutes at the time of the test, not a few seconds of overlap).

## What's been ruled out on THIS machine (the one hosting pm2)

Checked immediately after the `!uptime` test, all clean:

- **pm2's own process list** (`pm2 jlist`) — exactly one `winlew-faucet` process, matches the 5h56m session exactly (`pm_uptime` cross-checked against wall clock).
- **Every OS-level process on this WSL box** — cross-referenced 1:1 against pm2's tracked list via `ps -eo pid,ppid,etimes`. No untracked node process, no orphan (no `ppid=1` node process), nothing with an uptime anywhere near ~24 minutes.
- **The Windows host** (`tasklist.exe`) — zero `node.exe` processes.
- **The other installed WSL distro** (`Ubuntu-22.04`) — state is `Stopped`, can't be hosting a live process.
- **Docker** (`docker ps`) — zero running containers.
- **`src/geoagora/index.js`** (a leftover script from before the GeoAgora/GeoHackers split, still present in this repo) — considered as a candidate since it also reads a `DISCORD_BOT_TOKEN` env var, but it implements GeoAgora event-alert commands only, not `!drip`/`!help`/`!uptime`/`!nav` — doesn't match the symptom (it wouldn't reply to those commands at all).
- **`src/faucet/_legacy/`** — old standalone scripts from 2026-05-03 (`sendWinlew.js`, `helpers.js`, etc.), not a full bot service with a `messageCreate` handler. Doesn't match either.

**Conclusion: the second session is not running anywhere reachable from this machine.** It must be running on separate infrastructure entirely — another physical machine, a forgotten cloud/VPS deployment (Railway/Render/Fly/a old droplet — anything from this project's history), or a leftover `screen`/`tmux` session on a remote box — that still holds a valid copy of the `DISCORD_BOT_TOKEN` (`src/faucet/.env`) and has been connected to Discord this whole time.

## Why `!nav` doesn't double (still an open question)

Not resolved. Possibilities not yet checked: the rogue instance might be running an older build of `bot.js` that predates the `!nav`/`navigation` command being added (it clearly *is* running an older/different codebase in some way, since it's a separate deployment) — if the rogue instance's code doesn't have a `nav` case in its command switch, it would simply ignore `!nav` silently, so only the legitimate instance replies once. This is consistent with everything observed but not independently confirmed.

## Recommended fix (not yet executed — waiting on Discord Developer Portal access)

Rotate the bot token, since the rogue instance can't be located/killed directly:

1. In the Discord Developer Portal, regenerate the bot token for WinLEW-UtilityBot. This immediately invalidates every existing session using the old token, including the untraceable one.
2. Update `DISCORD_BOT_TOKEN` in `src/faucet/.env` with the new token.
3. `pm2 restart winlew-faucet` on this machine to pick it up.
4. Confirm the fix: type `!uptime` again — should get exactly one reply.

## Next steps to try on the other PC

Since the rogue session isn't findable from this machine, worth checking directly on the other PC (and any other machine/account this project has ever been deployed from):

- Any local terminal, `screen`, or `tmux` session that might have `node src/faucet/bot.js` (or an old equivalent) running and forgotten about.
- Any cloud/VPS provider account tied to this project (Railway, Render, Fly.io, DigitalOcean, a VPS, etc.) for a still-running deployment nobody remembered to tear down.
- Whether that PC's own clone of this repo has a `.pm2` daemon of its own still running services from a previous session.
- Worth doing `pm2 jlist` / `pm2 kill` there too, in case pm2 was ever run on that machine and never fully stopped.

If none of that turns anything up, token rotation (above) resolves it either way without needing to actually find the rogue process.
