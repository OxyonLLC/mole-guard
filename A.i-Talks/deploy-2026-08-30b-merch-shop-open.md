# Deploy 2026-08-30b — the merch shop opened at /merch/

**You are the reader, not the author.** See `README.md` in this folder. Written
by the assistant on the **development** machine. Anything under "You must do"
has **not happened yet** — it is being asked of you.

This is mostly an **FTP upload** job. A `git pull` alone changes nothing on
winlew.co.

---

## Are you the machine this is for?

This asks for static uploads to the shared host and one backend restart.

```bash
pm2 list                      # the winlew processes run here?
git remote -v                 # LewSales/mole-gaurd
```

If that is not you, stop here.

---

## What changed, and why

The owner has the merch **in hand**, so the shop stopped being staged.

| Before | After |
|---|---|
| `/merch/` = public "coming soon" teaser for Drop 01 | `/merch/` = **the shop** — 5 WinLEW tees + 9 XYO items |
| `/merch/shop.html` = the real shop, `noindex`, unlinked | `/merch/shop.html` = **redirect stub → `/merch/`** |
| nav + footer + `/links/` said **Merch · Soon** | tag removed everywhere |

The teaser page was **archived, not deleted** — it is now
`docs/archive/merch-teaser-2026-08-30.html`, which is outside `src/public/` and
therefore never served.

**The shop is open for browsing, not for selling.** That is deliberate and the
page says so in an amber notice at the top. See "The one thing that would
actually make it sell" at the bottom.

---

## You must do — 1. Pull, carefully

The **managed-file pull hazard** applies as always: `git pull` on this machine
can clobber runtime-written stores. Snapshot first.

```bash
git status --short             # nothing dirty under data/ ?
git pull
```

Nothing in this change touches `data/`, faucet registrations, or any managed
file. If `git pull` wants to overwrite something under `data/`, stop and ask
the owner — that is unrelated to this deploy.

## You must do — 2. Upload the static files (this is the actual deploy)

`/merch/` on winlew.co is **still the teaser** until you upload. Order matters
where noted.

| Upload | Path on the host | Note |
|---|---|---|
| 1 | `merch/index.html` | **now the shop.** Replaces the teaser. |
| 2 | `merch/products.json` | section subtitle changed to "Checkout opens shortly." |
| 3 | `merch/shop.html` | **now a 449-byte redirect stub.** Upload *after* #1 — reversing the order bounces anyone holding the private staged link onto the old teaser. |
| 4 | `assets/nav.js` | drops the `Soon` tag from the Merch pill. Affects the menu on **every** page — check one unrelated page after uploading. |
| 5 | `links/index.html` | "Merch (Soon)" → "Merch". |
| 6 | `roadmap/index.html` | regenerated from the registry (`npm run roadmap:build`). |
| 7 | `robots.txt` | comment-only edit. Cosmetic — skip it if you like. |

`sitemap.xml` did **not** change: `/merch/` was already listed, and
`/merch/shop.html` never was. Do not re-upload it.

There are **no new image files.** Everything the shop renders is already on the
host from the July staging upload.

## You must do — 3. Restart the backend (for `/modules/` only)

`src/mole/modulesData.js` changed — the `merch-store` record now describes an
open catalogue rather than a staged one (progress 40 → 65; status stays
`PARTIAL`, because you still cannot buy a WinLEW drop). That record is served
by the Node process through `getModulesStatusPayload`, so `/modules/` keeps
showing the old text until you restart.

The shop itself does **not** need the restart. Uploads alone open it.

```bash
pm2 restart <the winlew web process>
```

## You must do — 4. Verify

```bash
# the shop is where the teaser was
curl -s https://winlew.co/merch/ | grep -c "Official XYO Gear"        # 1, not 0
curl -s https://winlew.co/merch/ | grep -o 'name="robots" content="[^"]*"'
#   → index, follow      (it was noindex, nofollow, noarchive)

# the old staged path bounces
curl -s https://winlew.co/merch/shop.html | grep -o 'url=/merch/'     # url=/merch/

# the menu no longer says Soon
curl -s https://winlew.co/assets/nav.js | grep -c "path: '/merch/', tag: 'Soon'"   # 0
```

Then open <https://winlew.co/merch/> in a browser and confirm: the amber notice
is at the top, five WinLEW cards, nine XYO cards, and the XYO "Buy on XYO
Store ↗" buttons open `shop.xyo.network`.

---

## The one thing that would actually make it sell

**There is no `PAYPAL_CLIENT_SECRET` in your `.env`, and `PAYPAL_ENV` is
unset.** Confirmed live from the dev machine on 2026-08-30:

```
$ curl 'https://winlew.co/verify/api-proxy.php?path=/api/merch/config'
{"ok":true,"paypalClientId":"ARnYku0K…","checkoutReady":false,"paypalEnv":"sandbox"}
```

`checkoutReady:false` is what makes every WinLEW card render "PayPal checkout
coming online" instead of buttons. That gate is **correct and deliberate** —
`merchOrders.js` refuses to price an order it cannot capture, so a
half-configured deploy cannot take money. Do not work around it.

Only the owner can fix it, and only on this machine:

1. Add `PAYPAL_CLIENT_SECRET=…` and `PAYPAL_ENV=live` to `.env`.
   ⚠️ The client id already deployed (`ARnYku0K…`) was issued against a
   **sandbox** app. It is very likely the *whole pair* needs replacing with the
   live app's id + secret, not just the secret added.
2. Restart the backend.
3. Re-run the curl above — it must say `"checkoutReady":true` and
   `"paypalEnv":"live"`.
4. Then the amber notice on `/merch/index.html` should come down. `MERCH_README.md`
   has the exact three-step undo list under "Opening state — 2026-08-30".

Crypto checkout is a separate, untouched gap: all five
`checkout.crypto.url` values in `products.json` are still
`TODO_PASTE_NOWPAYMENTS_OR_COINBASE_COMMERCE_LINK`, and the provider has not
been chosen. Those buttons render disabled and correctly say so.

---

## Two things to tell the owner

1. **Two of the five tees have no photo.** `winlew-logo-tee` and
   `winlew-builder-tee` have `"image": null` in `products.json`, so they render
   a 🪙 glyph next to three tees that have real artwork. On a page that is now
   public and indexable, that is the most visible rough edge.
2. **The Drop 01 mockup still has the AI-render artifacts** flagged back on
   2026-07-31: `winlew-first-tee-shirt*.jpg/webp/png` reads "E5T. 2024" and
   "Comunity · Umitly · Transparency" on the front. It is the first card on the
   now-public shop **and** the `og:image` for the page. If the physical tee is
   correct, a real photo should replace it.
