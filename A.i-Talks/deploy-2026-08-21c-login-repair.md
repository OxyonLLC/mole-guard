# Deploy 2026-08-21 (third) — login repair, and the Phantom flag

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet**.

Follows `deploy-2026-08-21b-oauth-handoff.md`.

---

## What was broken, in one paragraph

The owner reported three things from a phone: `/verify/` failing with
**"Verify failed: no_oauth_tokens"**, the faucet claiming **no wallet was linked
to a Discord account verified since day one**, and **Phantom blocking winlew.co
as a phishing site**. The first two are the same bug. Since the identity layer
landed (`5270f50`, `fd6095a`) a session's account id can be a Discord snowflake,
`wallet:<hash>` or `x:<hash>` — but the role-connection push and the faucet
linkage store are both keyed by **snowflake**, and both were handed the raw
account id. The owner's own screenshot shows it: the challenge message read
`Discord: wallet:b78d3201498c27e0e86f85243dcd228e`. Nobody was unregistered;
the session simply was not Discord-rooted, and two surfaces mistranslated that
into "you never registered".

The third is structural and is addressed below.

---

## You must do

### 1. Pull, test, restart

```bash
cp -r src/data src/data.bak-$(date +%F)
cp -r data data.bak-$(date +%F) 2>/dev/null
cp src/faucet/wallet_links.json src/faucet/wallet_links.bak-$(date +%F).json
git fetch origin && git reset --hard origin/main
npm test        # expect 1974/1975 here; see "known failure" below
pm2 restart winlew-mole
```

### 2. Upload the static files

```
verify/api-proxy.php     verify/link.js     faucet/js/app.js
```

`api-proxy.php` is additive (it allowlists two new paths and nothing else
changes), so upload order is not critical this time. It is `php -l` clean.

### 3. Move the OAuth callbacks onto winlew.co — THE IMPORTANT ONE

Currently `redirect_uri` points at the raw tunnel:

```
https://orthomorphic-laevorotatory-trista.ngrok-free.dev/discord-oauth-callback
```

So every sign-in walks a visitor's address bar through an `ngrok-free.dev`
hostname, on a site that then asks them to sign a message. That is the shape of
a wallet drainer, and it is the most likely reason Phantom now blocks the
domain. `api-proxy.php` now forwards the callbacks, so set in `.env`:

```
DISCORD_REDIRECT_URI=https://winlew.co/verify/api-proxy.php/discord-oauth-callback
MOLE_DISCORD_REDIRECT_URI=https://winlew.co/verify/api-proxy.php/discord-oauth-callback
X_REDIRECT_URI=https://winlew.co/verify/api-proxy.php/x-oauth-callback
```

**Register each one verbatim in its developer portal BEFORE restarting** —
Discord and X both refuse a `redirect_uri` that is not a character-for-character
match. Then `pm2 restart winlew-mole`.

Confirm:

```bash
H=$(printf abc | sha256sum | cut -d' ' -f1)
curl -si "https://winlew.co/verify/api-proxy.php/linked-role/mole?claimHash=$H" \
  | grep -i '^location' | tr '&' '\n' | grep redirect_uri
#   want: winlew.co%2Fverify%2Fapi-proxy.php…   NOT ngrok-free.dev
```

### 4. Then, on a phone, in Phantom's in-app browser

That is the exact context that failed, so it is the one that matters.

1. `/verify/` → Sign in with Discord → lands signed in, no "no session" flash.
2. Connect wallet → Verify → roles sync; no `no_oauth_tokens`.
3. Connect a wallet WITHOUT attaching Discord → should now show
   "One more step — attach Discord" with a working button, not a raw error code.
4. `/faucet/` on that same wallet-only session → "no Discord account is attached
   to this one yet", not "use !register".

---

## Known failure, do not chase

`test/quiz/db-platform-stats.test.cjs` fails on the DEVELOPMENT machine because
`src/quiz/db.json` is a runtime file that does not exist there. It was verified
to fail identically on a clean checkout with none of this work applied. On the
serving machine, where that file exists, it should pass.

---

## Deliberately NOT done

**The merged faucet file is written with plain `writeJsonFile`, not
`writeManagedJson`.** Pushing it through managed storage would send the mole
process's view of the faucet's file to Mongo — the same `localHas && remoteHas
→ local wins` overwrite described below. The faucet bot already maintains
`faucet_wallet_links` in Mongo itself; the mole process has no business
republishing it. The merge only makes the local write strictly less
destructive than it was.

**`initFaucetStorage()` was not added to `src/index.js`.** It was in the plan and
then rejected on inspection: `bootstrapFile()` pushes **local over remote**
whenever both are non-empty (`src/faucet/storage.js:183-196`). Adding that call
would make every `start:mole` boot upload the local faucet files to Mongo —
turning the existing "never run start:faucet on the dev PC" hazard into "never
run start:mole either". Since all processes share one box and one filesystem
(`ecosystem.config.cjs`), the merge fix below is sufficient without it.

---

## Still open, for the owner

- **File the Phantom appeal**, once step 3 is live and verifiable.
  winlew.co appears in **none** of `phantom/blocklist`'s four list files
  (`blocklist.yaml`, `eth-blocklist.yaml`, `nft-blocklist.yaml`,
  `fuzzylist.yaml` — checked directly), so the block is coming from Phantom's
  real-time provider, not the public repo. Open an issue at
  github.com/phantom/blocklist AND email review@phantom.com (48–72h). Lead with
  the concrete change: the OAuth redirect chain no longer traverses
  `*.ngrok-free.dev`.
- **`ACCEPT_URL_SESSION_PATHS = []`** in `src/public/assets/wallet-auth.js` —
  the last URL-session hole. Still the one-liner from the previous note; do it
  about a week after this deploy, not with it.
- **Regenerate the leaked X credentials** — owed since 2026-08-20.
- **FOUND, NOT FIXED — quiz redemption has the same asymmetry, on a money
  path.** `redeemQuizPoints({ userId: s.discordUserId })` (src/mole/web.js:6186)
  passes the account id to `resolveLinkedWallet(uid, 'payout')`
  (src/quiz/redemption.js:164). Because the store is account-keyed that is
  correct for a wallet-rooted account that verified its own wallet — but a
  wallet-rooted session whose ONLY wallet sits under its Discord snowflake
  resolves to nothing and the redemption is refused with `no_wallet`.
  `web.js:6145` shows the same wallet as null in the quiz preview.
  This is the faucet bug wearing different clothes, and the remedy is the same
  Discord-first-then-account order that `faucetLookupId()` now implements —
  most likely by lifting it into a shared `linkageLookupId(accountId, intent)`.
  Deliberately left alone here: it is a payout path with its own anti-abuse
  gates, it was not part of the reported failure, and widening a login fix into
  quiz settlement unasked is not the right call. Worth its own change.
- Nothing further on the faucet. An earlier draft of this fix resolved every
  faucet lookup to a Discord snowflake and would have made the faucet
  Discord-required; that was caught and corrected before commit. The linkage
  store is **account-keyed** — `completeLink()` writes under the session id, and
  `src/data/linked_wallets.json` already holds live `wallet:<hash>` keys — so
  `faucetLookupId()` (src/mole/web.js) now tries Discord first and falls back to
  the account's own key. A wallet- or X-rooted account that verified a wallet on
  the site works without Discord. Two tests in
  `test/mole/accountDiscordResolution.test.mjs` pin this, including one that
  fails if `quiz/wallets.js` ever grows a snowflake guard.
