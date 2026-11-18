# Deploy 2026-08-21 (second) — OAuth hand-off binding, and five live bug fixes

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet**.

Follows `deploy-2026-08-21-x-signin-nav.md`, which **has been done** — verified
from here: all five static files hash-matched winlew.co and
`/api/account/providers` reported the new code.

---

## WHERE you are

```
0512c61  nav,wallet: five live breakages found by walking the deployed site
da0dc2f  auth: bind every OAuth return to the browser that started it
```

```bash
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
npm test        # expect 1953/1953
```

---

## You must do

1. **Pull and restart the node app.** `da0dc2f` changes how every OAuth callback
   returns a session. The app and the static files must move TOGETHER — see the
   ordering note below.

2. **Upload the static files:**

   ```
   assets/nav.js            assets/nav.css          assets/wallet-auth.js
   mole-hub/index.html      governance/index.html
   ```

3. **ORDER MATTERS, and this time it matters more than usual.**
   Restart the app FIRST, then upload. In between, a browser running the old
   `wallet-auth.js` will still read `?session=` from any page, which is the old
   behaviour and still works. The reverse order — new JS, old app — gives you a
   browser that ignores `?session=` talking to a server that still sends it, and
   sign-in stops working until the restart catches up.

---

## What changed, in one paragraph

A session token is a bearer credential. `getAuth()` used to adopt `?session=`
from ANY url on ANY page, so `winlew.co/home/?session=<attacker's token>` put a
reader's browser into the attacker's account — after which their play, claims
and connected wallet accrued to an account whose payout wallet the attacker
controls. Sessions now come back by one-time hand-off, bound to a secret the
receiving tab invented before the round trip started, and `?session=` is only
honoured on `/verify/`.

---

## Confirm it worked

```bash
# 1. Discord's Linked Roles entry bounces to mint a claim instead of going
#    straight to Discord
curl -si "https://winlew.co/verify/api-proxy.php/linked-role/mole" | grep -i '^location'
#    want: .../verify/?connect=mole        (NOT discord.com)

# 2. ...and proceeds once it has one
curl -si "https://winlew.co/verify/api-proxy.php/linked-role/mole?claimHash=$(printf abc | sha256sum | cut -d' ' -f1)" \
  | grep -i '^location'
#    want: https://discord.com/oauth2/authorize?...

# 3. the loop guard lets a second pass through unbound
curl -si "https://winlew.co/verify/api-proxy.php/linked-role/mole?b=1" | grep -i '^location'
#    want: https://discord.com/oauth2/authorize?...
```

Then, in a browser: sign in with Discord from the nav on any page. You should
land back on that page with `?handoff=…` in the address bar for an instant,
signed in, and the parameter scrubbed. **If you land signed OUT, the static
files and the app are out of step — check step 3 above.**

---

## Still open, deliberately

- **`/verify/` still accepts a URL session.** So
  `winlew.co/verify/?session=<token>` is still an attack. It is the last of it,
  and it is kept only so a cached `nav.js` (served by the shared host) does not
  strand anyone mid-sign-in. **About a week after this deploy**, set
  `ACCEPT_URL_SESSION_PATHS = []` in `src/public/assets/wallet-auth.js`, upload,
  and it closes. That is a one-line change and the tests already describe it.
- **Register the X callback in the developer portal** — still owed from the
  previous note. `X_REDIRECT_URI` must be listed verbatim and moves with the
  ngrok host.
- **Regenerate the leaked X credentials** — still owed.
- **`Contribute`'s nav column** is an owner decision, not yours. Leave it.
