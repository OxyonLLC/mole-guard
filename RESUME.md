# Resume — 2026-08-21

Working tree clean, everything pushed. HEAD = `6b6c9cd`. Suite **1891/1891**.

## Paste this to resume

> Read RESUME.md and pick up where we left off.

---

## What is DONE but NOT DEPLOYED

The serving machine has not pulled since roughly `013b682`. Everything below is
on `origin/main` and live nowhere.

**Deploy = pull + restart + upload the static files.**

```bash
cp -r src/data src/data.bak-$(date +%F)      # runtime writes have been lost to a pull before
cp -r data data.bak-$(date +%F) 2>/dev/null
git fetch origin && git reset --hard origin/main
npm test        # expect 1891/1891
# then restart the node app
```

### Static files to upload (a pull does NOT put these on winlew.co)

```
assets/nav.js              assets/nav.css            assets/wallet-auth.js
verify/profile.html        verify/profile.js
hodl/index.html
news/index.html            news/geowallet-winlew-pieces-connect/index.html
giveaways/index.html       sitemap.xml               index.html
images/news/geowallet-banner.png
images/news/geowallet-ui.png
xl1/.htaccess
```

The XL1 section is served from here now, not redirected to Netlify. Upload
`xl1/.htaccess` together with the page files above -- the .htaccess alone would
leave the old pages serving, and the old pages read data from `/xl1/data/`,
which nothing updates any more.

The producer data is no longer uploaded at all. It lives in a public repository
the nodes write directly, and the pages fetch it cross-origin:

    https://github.com/LewSales/xl1-status-data

So the pages are static and change rarely, while the numbers on them stay live.
Routing data through the site was what broke it before: every five-minute update
was a full deploy, roughly 550 a day, which exhausted the build allowance and
froze the pages on an hour-old snapshot while both producers were healthy.

**Delete `/xl1/data/` on the server once the new pages are up.** Nothing reads
it, and leaving a stale windows.json there is how someone later finds a dead
timestamp and concludes the producers stopped.

Your file manager may hide dotfiles; turn on "show hidden files" rather than
assuming the .htaccess upload failed.

Check it took with:

```bash
curl -s https://winlew.co/xl1/windows/ | grep -c raw.githubusercontent
# expect: 1   (the page reads data from the data repo)
curl -sI https://winlew.co/xl1/ | grep -i '^location'
# expect: nothing -- it should serve, not redirect
```

`verify/api-proxy.php` is already uploaded and correct — leave it.

### Confirm the restart worked

```bash
curl -s "https://winlew.co/verify/api-proxy.php?path=/api/supply/circulating"
# new code -> {"circulatingSupply":811724797.042184}
# old code -> {"error":"not_found"}
```

---

## Decisions already made (do not re-ask)

- Wallet **is** the account. Connect is free; a synced Discord **or** X identity
  unlocks payouts. Either one alone is enough.
- One social identity belongs to **one** WinLEW account. Already-synced elsewhere
  is refused, and told where it lives.
- Public visibility is **opt-in, default off**. Syncing was for payouts, not
  publication.
- `/hodl/` shows **recent payouts** (receipts), never a top-holders list.
- Faucet: **one claim per person**, not per wallet.
- Identity gate: 3 days in-server, or skip the wait with a first wallet holding
  **100,000 WinLEW**.

---

## Open items, roughly in priority order

1. **X OAuth — credentials exist; the door did not.** 2026-08-21: the serving
   machine's `.env` does have `X_CLIENT_ID`, `X_CLIENT_SECRET` and
   `X_REDIRECT_URI` (same ngrok host as the working Discord callback), and the
   client id is the OAuth 2.0 shape, not the Consumer Key. So this item is no
   longer "no credentials".

   What was actually missing: the nav's **Sign in / Sync account pill was
   hardcoded to Discord**, and `/verify/profile.html` was the only surface that
   ever mentioned X. Fixed — the pill now asks `GET /api/account/providers`
   and offers a chooser when X is available.

   **X can now SIGN IN, not just sync** (2026-08-21, second pass). The first
   cut wired the chooser only into the pill's sync mode, so a visitor with no
   session still got Discord and nothing else. `POST /api/account/signin/x/start`
   creates an `x:<hash>` account — or signs in to the account that already holds
   that X id — and the pill offers the choice in both modes.

   **Which account a wallet joins**, settled by the owner 2026-08-21 —
   "Discord is our MAIN Gateway, but not everyone has this":
   1. wallet already linked to a Discord account -> that account, always;
   2. otherwise, signed in with a PROVEN identity -> the account already in
      hand (this is what stops an X sign-in being dropped on wallet connect);
   3. otherwise -> a new wallet-rooted account, exactly as before.

   Step 2 tests `canBePaid()`, not "has a session": an anonymous wallet-only
   session has proved nothing, and letting it absorb further wallets would make
   an account's membership depend on connection order.

   **One thing still to do on the serving machine:**
   - **Register the callback in the X app.** `X_REDIRECT_URI` must be listed
     verbatim in the developer portal, and it moves whenever the ngrok host
     moves. A mismatch fails at the consent screen, not before it.

   Confirmed live 2026-08-21 after the owner restarted:
   `curl -s "https://winlew.co/verify/api-proxy.php?path=/api/account/providers"`
   returns `"x":{"available":true,...}`. That curl stays the deploy check —
   `false` there while the keys ARE in `.env` means the process was not
   restarted.

   The Consumer Key/Secret posted in chat earlier are a **different** credential
   from the OAuth 2.0 pair now in use — still worth regenerating. So are the
   Access/Refresh tokens from the portal's token generator, pasted 2026-08-21;
   this flow never uses them, but they are live for the owner's own account.

2. **Re-enable the one-account rule** once the sign-in button is live:
   `HUB_REQUIRE_LOGIN_BEFORE_CONNECT=true`, then restart. Upload `nav.js`,
   `nav.css`, `wallet-auth.js` FIRST or it is a gate with no door again.

3. **Duplicate tweets** — fixed in code, but check the marker on the serving
   machine before trusting it: `src/faucet/data/lastTweet.json` (or the
   `faucet_last_tweet` Mongo collection) against the newest tweet id. Also
   confirm the faucet bot is not running on a second machine; nothing in code
   prevents two instances both posting.

4. **Giveaway ledger — the second paying wallet.** Owner confirmed some payouts
   came from a personal wallet. That address has never been supplied, and it is
   why two announcements do not reconcile (7 stakers announced / 6 paid from the
   reserve; 4 people confirmed a 500k prize / 2 paid from the reserve).
   Send the address and it can be walked the same way, probably closing several
   of the 11 remaining unmatched payouts.

5. **Faucet drip history.** Three payouts read 1,000 / 1,500 / 1,000 in date
   order, which a single 1000 -> 1500 raise cannot produce. `DRIP_AMOUNT` is
   gitignored so the change date is not checkable here. Did the rate move more
   than once?

6. **Four GeoWallet screenshots** for the milestone article. Not in the repo and
   deliberately not fabricated. Drop them in `src/public/images/news/` as
   `geowallet-quantum.png`, `geowallet-connect.png`, `geowallet-sign.png`,
   `moleguard-verified.png` and they can be placed with captions.

---

## Two standing traps worth re-reading before touching related code

- **CSP blocks every inline script** (`script-src 'self'`). Redirect stubs that
  "preserve the query" with an inline script have never run. Eleven are now
  handled server-side in `STUB_REDIRECTS` in `src/mole/web.js`; twenty others
  have no query to lose and are deliberately untouched.
- **Route order vs `express.static`.** A route registered after it never runs —
  the static file answers first with a 200. This has already cost one debugging
  cycle.
