# Wiring the Utility Bot's status light

**You are the reader, not the author.** Written by the assistant on the
development machine. The task below has **not** been done — it is being asked
of whoever runs the WinLEW Utility Bot.

## What exists now

`/health/` has a **Bot status** card with a light per bot:

- **green** — a heartbeat arrived within the last 5 minutes
- **red** — one arrived before, but not recently (it *was* up and stopped)
- **grey** — nothing has ever been heard from it

Right now the Utility Bot's light is **grey**, and that is honest: nothing in
this repo can observe it. `/api/discord-bots/status` has always said so —
*"there is nothing honest to check for them today."* The light is deliberately
never green by default; a status page that says "fine" during an outage is
worse than no status page.

## What you need to add (about 10 lines)

In the Utility Bot, POST a heartbeat on startup and then on an interval:

```js
async function beat(kind = 'heartbeat') {
  try {
    await fetch(`${MOLE_WEB_BASE}/api/bot/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BOT_HEARTBEAT_TOKEN}`,
      },
      body: JSON.stringify({ service: 'winlew-utility-bot', kind, version: pkg.version }),
    });
  } catch (e) {
    // Never let a status ping take the bot down.
    console.warn('[heartbeat] failed:', e?.message || e);
  }
}
beat('startup');
setInterval(() => beat(), 60_000).unref?.();
```

**Send it only once the bot is actually ready** — inside discord.js's `ready`
handler, not at the top of the file. A heartbeat sent before the gateway
connects makes the light green while the bot is still unusable, which is
exactly the lie this design is built to avoid.

### Config

- `BOT_HEARTBEAT_TOKEN` — must match the Mole Guard's. Falls back to
  `WATCHDOG_HEARTBEAT_TOKEN` there, so reusing that value works with no new
  secret.
- `MOLE_WEB_BASE` — the Mole Guard web server. From the same machine,
  `http://127.0.0.1:8787`.

### Valid service ids

Only `winlew-utility-bot` and `the-mole-guard` are accepted. Anything else is
rejected with `unknown_service` on purpose: a typo should surface as a failed
heartbeat, not as a second light nobody is watching.

## Checking it worked

```bash
curl -s http://127.0.0.1:8787/api/bot/health
```

The service should read `"state": "up"`. Then reload `/health/` — the light
goes green. Stop the bot and it turns red within 5 minutes
(`BOT_HEALTH_STALE_AFTER_SEC`).

## Please do NOT

- Do not make the Mole Guard post the Utility Bot's heartbeat on its behalf.
  That would make the light report "the web server is up", which is the exact
  false signal this replaced.
- Do not remove the grey state. "Never reported" and "stopped reporting" are
  different facts, and merging them trains everyone to ignore the light.
