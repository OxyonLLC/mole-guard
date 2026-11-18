# Enable the shadow run — for the AI on the serving machine

**2026-08-14.** Companion to `deploy-2026-08-14-anti-abuse.md`. Read this one
first; it is short and it is the only thing currently blocking the shadow run.

## What happened

The owner asked to turn on participation signals and the risk engine. They were
enabled on his **development** checkout by mistake — that box is not running the
backend, so nothing changed in production. The four settings need to go on the
machine that actually runs the Node backend and the quiz payout worker.

That may be your machine. **Check before you do anything else** (§1).

---

## 1. First: are you on the machine that serves?

Do not assume. `writeManagedQuizJson()` in `src/quiz/storage.js` always calls
`writeLocal()`, so **every quiz DB write touches `src/quiz/data/db.json` in the
checkout the process runs from** — that is true even with Mongo enabled, because
Mongo is a mirror, not a replacement. `DATA_DIR` is a constant and cannot be
moved by env.

So the test is a timestamp:

```bash
stat -c '%y' src/quiz/data/db.json
date
```

Have the owner answer one quiz question **on the website**, then run it again.

- **mtime jumps to now** → you are on the serving machine. Continue.
- **mtime does not move** → the backend is running somewhere else. Stop and say
  so; do not edit `.env` here, it will do nothing and will look like it worked.

On the dev box this file was four hours stale while the owner was actively
earning points, which is how the mistake was caught.

---

## 2. The four settings

```bash
PARTICIPATION_SIGNALS_ENABLED=true
PARTICIPATION_HASH_SALT=<ask the owner — see below>
QUIZ_RISK_ENGINE_ENABLED=true
QUIZ_RISK_ENFORCEMENT_ENABLED=false
```

`QUIZ_RISK_ENFORCEMENT_ENABLED` stays **false**. It is the only one of the four
that can withhold money, and nobody has reviewed a cycle of output yet. Do not
turn it on, and do not treat a quiet log as evidence that it is safe to.

### The salt

**A value already exists. Ask the owner for it — do not generate a new one, and
do not put it in any tracked file.** He can read it off the dev box with:

```bash
grep '^PARTICIPATION_HASH_SALT=' .env
```

It must be **byte-identical on every machine and every process** that hashes or
reads a hash. This is the part that fails silently: two machines with different
salts produce unrelated device hashes, correlate nothing, and the risk engine
scores everyone clean. No error, no warning, no log line — just an engine that
never finds anything. If shadow output is empty after a full cycle, check this
before concluding the users are honest.

An unset salt means **no collection at all**, not weak collection. That is
deliberate: a `/24` has 256 possible values, so an unsalted hash of one is a
lookup table rather than a protection.

`npm run scan:secrets` covers 767 tracked files and would flag this value as a
real finding. Keep it in `.env` only.

---

## 3. Restart BOTH processes

| Restart | Why |
|---|---|
| Node backend / web | `collectSignals()` runs on the quiz answer route |
| quiz payout worker | the risk engine runs at settlement |

Collection happens on one and scoring on the other. Restarting only the worker
gives you an engine with nothing to score, which looks exactly like "no abuse
found".

---

## 4. Verify it actually works

Signals only come from the **website**. A Discord-only answer produces nothing
here by design, and that scores clean rather than suspicious — so testing from
Discord tells you nothing.

Have the owner answer one question on the site, then:

```bash
node -e "const db=require('./src/quiz/db.js');const r=db.listParticipation({since:0});
console.log(r.length?'OK '+r.length+' record(s) device='+Boolean(r.at(-1).deviceHash)+' net='+Boolean(r.at(-1).netHash):'NOTHING COLLECTED')"
```

| Result | Meaning |
|---|---|
| `OK n device=true net=true` | working end to end |
| `OK n device=false` | the browser sent no fingerprint — `quiz/js/app.js` on the host is stale. Re-upload it (§1 of the deploy note) |
| `NOTHING COLLECTED` | the backend did not pick up the env, or the salt is missing. `collectSignals()` returns null before doing anything if either is true |

---

## 5. What you should see afterwards

```
[payout][risk] <id> band=elevated score=32 signals=shared_device SHADOW — settling regardless
```

`SHADOW — settling regardless` means it scored the payout and **paid it anyway**.
That is correct in shadow mode. Only bands above `normal` print, so silence is
plausible — but see the salt warning in §2.

History starts empty at this restart, so the first cycle will be thin no matter
what. That is expected, not a fault.

---

## 6. Report back

- Did the §1 timestamp test confirm you are on the serving machine?
- Are the backend **and** the quiz payout worker both restarted?
- Did the §4 check return `OK` with `device=true net=true`?
- After a full cycle: how many payouts scored above `normal`, and in which bands?

**No values from `.env` in your reply** — say `set` / `not set`. Never paste the
salt.

---

## 7. Do not

- Do not enable `QUIZ_RISK_ENFORCEMENT_ENABLED` or `QUIZ_WATCHLIST_GATE_ENABLED`.
- Do not set `QUIZ_MIN_HOLDER_BALANCE`. The owner rejected a holder minimum
  outright: any holder should be able to earn.
- Do not generate a fresh salt "to be safe". Rotating it breaks correlation with
  every existing record, which is the retention mechanism working as designed —
  and doing it accidentally is how you get an engine that finds nothing.
- Do not `git reset --hard`, `git checkout .` or `git stash` on this machine.
  `src/faucet/airdrops.json` and `registrations.json` are written at runtime and
  tracked in git; those three commands destroy live registrations regardless of
  what changed upstream. A plain `git pull` is safe.
