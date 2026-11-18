# Deploy 2026-08-21 — X sign-in, the nav account pill, and the rebuilt nav groups

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

The owner's words for why this is going out now: *"lets push this so it can be
viewed by the community."* The GitHub push is done. What is below is the part
that is not.

---

## WHERE you are

Three commits, one series:

```
fd6095a  identity: sign in with X, and a wallet joins the account you signed into
bbaafa6  nav: the balance is not a logout button, and sync is a job that ends
6a030d3  nav: rebuild the first four groups around visitor intent
```

```bash
# snapshot the runtime data dirs FIRST — a pull has destroyed runtime writes before
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
npm test        # expect 1909/1909 — that is what it returned here
```

Then **restart the node app** and **restart the Discord bot** (see below — the
bot carries a change of its own this time).

---

## VERIFIED LIVE STATE — 2026-08-21, 17:30 UTC

Checked from the development machine against winlew.co, not assumed. Anyone can
re-run these.

**The serving machine last pulled at `c7ba513`.** Proof, no session needed:

```bash
curl -s "https://winlew.co/verify/api-proxy.php?path=/api/account/providers"
```

It answers `"x":{"available":true,"canSignIn":false,...}`. `canSignIn:false` is
the OLD code — `fd6095a` flips it to `true`. So the running process predates all
three commits above.

Note `"available":true`: the X OAuth credentials ARE present and loaded. That
question is settled — do not go looking for missing keys.

**Three static files are STALE and must be uploaded.** Fetched from winlew.co
and hashed against the local copy:

| file | state |
| --- | --- |
| `assets/nav.js` | **stale — upload** |
| `assets/nav.css` | **stale — upload** |
| `assets/wallet-auth.js` | **stale — upload** |
| `verify/profile.js` | already uploaded, leave it |

A `git pull` does NOT put these on winlew.co. They are a separate FTP upload.

> When hashing these yourself, send a full browser `User-Agent`. winlew.co
> answers a short/absent UA with a 159-byte openresty **403** for `.js`, and
> every file then hashes identically — which looks like a match failure but is
> really the same error page four times.

---

## You must do

1. **Pull and restart the node app.** Without it, `/api/account/signin/x/start`
   404s and the nav's X sign-in button leads nowhere.

2. **Upload the three static files above.** Order matters if you cannot do both
   at once: uploading `nav.js` before the app restarts gives you a sign-in
   chooser whose X option 404s. Restart first, then upload.

3. **Restart the Discord bot.** `6a030d3` changed
   `src/shared/command-inventory.js`, so `!pages` teaches the new site map —
   `Play & Earn` / `Learn & Connect` / `Trust & Transparency` /
   `Build & Contribute`. Until the bot restarts it keeps serving the old one.
   No command re-registration is needed; `!pages` is a prefix command.

---

## Confirm it worked

```bash
# 1. the app has the new code
curl -s "https://winlew.co/verify/api-proxy.php?path=/api/account/providers"
#    want: "x":{"available":true,"canSignIn":true,"canSync":true}

# 2. X sign-in exists and needs no session
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  "https://winlew.co/verify/api-proxy.php?path=/api/account/signin/x/start"
#    want: {"ok":true,"url":"https://x.com/i/oauth2/authorize?..."}
#    a 401 means the old code; a 503 means the credentials stopped loading

# 3. the nav is uploaded
curl -s -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" \
  https://winlew.co/assets/nav.js | grep -c "PLAY & EARN"
#    want: 1
```

In a browser, hard-refresh (Ctrl+Shift+R) — the old `nav.js` will still be
cached otherwise.

---

## What the community will see change

- **Sign in now offers X**, not just Discord. Someone with no Discord account
  can sign in with X and get a real account; connecting a wallet afterwards
  joins that account instead of silently creating a second one.
- **The balance chip is no longer a logout button.** Clicking your own balance
  used to ask "Disconnect your wallet from WinLEW?".
- **The account pill has three states** — Sign in → Sync account → Disconnect —
  instead of offering a sync that never finished.
- **The first four nav/footer groups are rebuilt** around what a visitor is
  trying to do. Same 30 destinations, no URL changed; GOVERNANCE and everything
  below it untouched. Link Wallet + Roles, HODL Rewards and Airdrop Registry
  came up out of the bottom of the old LEARN & CONNECT.

---

## Still owed, and NOT part of this deploy

- **Register the X callback in the developer portal.** `X_REDIRECT_URI` must be
  listed verbatim there, and it moves whenever the ngrok host moves. A mismatch
  fails AT the consent screen, so the button will look like it worked. This is
  the one thing that could still make X sign-in fail after a clean deploy.
- **Regenerate the leaked X credentials.** The Consumer Key/Secret and the
  portal token-generator Access/Refresh tokens were both pasted into chat. This
  flow uses neither, but they are live for the owner's own account.
- **An open question for the owner, not for you:** whether `Contribute` should
  move back under TRUST & TRANSPARENCY. It is in BUILD & CONTRIBUTE as of
  `6a030d3`. Do not move it — it is being left as-is on purpose until the owner
  has seen it live.
