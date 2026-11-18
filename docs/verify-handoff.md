# Desktop-to-phone hand-off (`/verify/`)

Date: 2026-08-10
Scope: `src/mole/webHandoff.js`, `src/mole/web.js` (`/api/verify/handoff/*`),
`src/public/verify/link.js`, `src/public/verify/index.html`.
Tests: `test/mole/webHandoff.test.mjs`, `test/mole/verifyPageSecrecy.test.mjs`.

## 1. What was wrong

`/verify/` is opened from Discord as `/verify/?session=<token>`. That token is a
bearer credential — anyone holding it inside its life can complete a wallet link
and point the account's faucet and payout wallets at their own address.

The desktop "finish on phone" panel handed out `canonicalVerifyUrl()`, which
keeps the query string. So the "verify link" **was** the session token. The
panel said so:

> **Treat this link like a password.** … Never paste it into a chat, a ticket,
> or a screenshot.

Two buttons beside that warning did precisely that. `buildPhantomBrowseUrl()`
wraps the URL into `https://phantom.app/ul/browse/<encoded>` and Solflare has an
equivalent — **real HTTPS requests to those companies**. The token travelled in
the path of a third-party request and landed in a third party's logs.

This is the same leak as the QR code removed on 2026-08-05 for handing the URL
to `api.qrserver.com`. That fix caught the picture and missed the two buttons
next to it, because the test written at the time explicitly allowed the wallet
vendors on the reasoning that "handing the page to the wallet you are verifying
with IS the feature." True — but handing it the *page* and handing it the
*credential* were the same act only because the URL carried both.

## 2. The design

An authorization-code exchange, like `src/mole/nativeHandoff.js` — but note the
**direction is reversed**, and that changes one thing materially.

In the native flow the *receiver* (the app wrapper) starts the exchange, so it
can invent a claim secret in advance and register only its hash. Here the
*sender* (the desktop) holds the session and the receiver is a phone that has
never spoken to us. The receiver cannot pre-register anything, so the server
mints a pairing code instead.

| Step | Who | What |
|---|---|---|
| `start` | desktop | presents its live session; gets a hand-off id **and** a six-digit code |
| — | user | sends the link; reads the code off the desktop screen |
| `claim` | phone | presents id **and** code; gets a fresh session, once |
| `peek` | desktop | id **and** code; sees `pending` / `claimed` / `expired` |

The link carries only the id. Phantom's logs, a screenshot of the URL bar, a
forwarded message, browser history — all get an identifier that redeems nothing
without a code that only ever existed on the other screen.

### Properties that are deliberate

- **The desktop's own token never leaves the server.** `claim` mints a *new*
  session for the same Discord user rather than copying the existing one, so the
  two can be revoked independently. The hand-off record holds no session token
  at all — only the Discord id a fresh one will be minted for.
- **The grant cannot outlive its source.** The new session inherits the
  *remaining* life of the originating one, capped at one hour. Otherwise
  chaining hand-offs would renew a session forever.
- **Five minutes, not fifteen.** The native flow's 15 minutes covers an
  unhurried first wallet round trip; this covers typing six digits, and the link
  is a live target for exactly that long. Re-generating is one click.
- **The attempt cap is load-bearing here.** Unlike the native flow's 256-bit
  secret, six digits *are* guessable in principle — 1 in a million per try. Five
  attempts per record, backed by a per-IP rate limit so the same code can't be
  hammered across many records.
- **`peek` authenticates before answering.** The first draft returned "claimed"
  before checking the code, which made the id alone enough to learn that a
  hand-off had existed and been used. Fixed, and pinned by a test.
- **`peek` exists for the user, not the UI.** It is how someone learns their
  hand-off was claimed by somebody else. The wording is chosen to make that
  legible: "Opened on a phone. If that wasn't you, disconnect and start a new
  session."

## 3. The mobile path

`openMobileWalletBrowser()` in `src/public/assets/wallet-auth.js` leaked the
same way and worse. It set `target = window.location.href` and handed that to
`buildPhantomBrowseUrl()`, and since **56 pages load that file** and its wallet
picker is reachable from all of them, any page arrived at from a Discord link
shipped the token to phantom.app.

Fixed too, with an honest caveat about strength.

### DIRECT mode, and why it is weaker

A same-device hand-off has **no second screen**. The pairing code works on
desktop precisely because it appears somewhere the link does not travel; on one
device there is no such place. So `HANDOFF_MODES.DIRECT` has no code and the id
alone redeems.

What it still buys is large, and it is worth being exact about the shape:

| | Before | After |
|---|---|---|
| What Phantom's logs receive | a session token | a hand-off id |
| Valid for | hours | **120 seconds** |
| Reusable | yes, unlimited | **no, single use** |
| To abuse it you must | possess it | **win a race** against a page that loads a second later |

A leak of a DIRECT id is a race. A leak of a session token was a key. That is a
real change in kind, and it is *not* equivalent to PAIRED — anything describing
them as the same protection is wrong.

`WEB_HANDOFF_DIRECT_TTL_SEC` should be raised only if real-device testing shows
120s is too tight, and then by the smallest amount that works. Every extra
second is a second the id stays redeemable by whoever read it in transit.

### The root cause, which was neither panel

All three `build*BrowseUrl()` helpers took `url = currentBrowseUrl()` as a
**default argument**. Any call written without an argument silently shipped the
current URL. The QR fix in August removed one *caller*; the loaded gun stayed on
the table. The default is now gone and the parameter is required, so the leak
can only be reintroduced deliberately, not by omission. `currentBrowseUrl()`
itself is deleted.

### Failing closed

If `start` fails, `openMobileWalletBrowser()` shows a message and **goes
nowhere**. The tempting `catch { target = location.href }` would restore the
exact bug at the exact moment something is already wrong, so a test asserts the
fallback does not exist.

### What the browser test caught that source-reading could not

`test/nav/mobile-handoff.e2e.test.mjs` drives real headless Chromium with an
iPhone UA, a canary session token in the URL, a real click, and an assertion on
the URL the browser was actually sent to.

Two things only that test could tell us:

1. **`link.js`'s own `mobileWalletTarget()` never runs for Phantom.**
   `openWalletBrowser()` delegates phantom/solflare/geowallet to
   `wallet-auth.js` whenever the shared helper exists — always, in practice —
   and excludes only Jupiter. Sabotaging `link.js` changed nothing observable;
   sabotaging `wallet-auth.js` failed the test immediately. The `link.js` path
   is still fixed rather than deleted, because "the shared helper is always
   there" is an assumption that should not be load-bearing for a credential.
2. **The first version of that test was vacuous.** Its selector matched no
   element, so no click happened, the captured-URL list was empty, and every
   assertion was skipped — it passed with the leak fully restored. It now
   asserts `walletUrls.length > 0` before checking anything else. A test that
   cannot fail is worse than no test, because it is counted as coverage.

## 4. The other thing this did not do — DONE since, in two steps

As written, this said the verify flow read the session **only** from the query
string (`link.js` `hasUsableSession`, `getChallenge`, `verifyAndSync`), so
`?session=` could not be stripped after pickup without breaking the page, and
that fixing it was worth doing but too broad to bundle here.

Both halves have since landed:

- **2026-08-10** — those three call sites now read through `readSessionToken()`
  (URL first, then storage), and `scrubSessionFromUrl()` removes the token from
  the address bar with `replaceState` once it is persisted. The credential-
  bearing URL never becomes a history entry.
- **2026-08-13** — the remaining half, which this section could not see at the
  time: API calls themselves stopped carrying `?session=`. That was blocked on
  `/verify/api-proxy.php`, which builds a fresh header list and drops everything
  the browser sends (so a browser cannot spoof `X-WinLEW-Proxy-Secret`), and
  which had no PHP parser available to check a change to. `php-cli` was
  installed, the proxy now forwards exactly one validated browser header
  (`X-WinLEW-Session`), and all 16 call sites dropped the query parameter.

What remains is only the inbound Discord link — `/verify/?session=<token>` — and
that is scrubbed on arrival. See `WINLEW_PUBLIC_CONTENT_AUDIT.md` #26 and #28.

The hand-off is safe regardless, because `handoffUrlFor()` builds from
`window.location.origin` and never reads the current URL. A test enforces that,
and enforces that the copy/Phantom/Solflare handlers use it.
