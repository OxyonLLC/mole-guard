# /merch/ — WinLEW + XYO Merch Shop

Live at `winlew.co/merch/`. Two sections, two fulfillment models:

1. **$WinLEW Drops** — sold and shipped by WinLEW. PayPal (Smart Buttons) +
   hosted crypto checkout links.
2. **Official XYO Gear** — displayed here, but every buy click lands on
   `shop.xyo.network` (cart-add deep link when the item has no options, its
   product page otherwise). XYO handles payment, shipping, fulfillment. The
   page and footer both disclose this — never remove that copy.

## Files

| File | What it is |
|---|---|
| `src/public/merch/products.json` | **Single source of truth** — every product, section, and link renders from this. |
| `src/public/merch/index.html` | The shop itself (theme matches winlew.co). |
| `src/public/merch/shop.html` | Redirect stub → `/merch/`. The shop lived here while it was staged; the path is kept so links handed out privately in that window still land. |
| `docs/archive/merch-teaser-2026-08-30.html` | The pre-launch "coming soon" teaser that used to occupy `/merch/`. Archived, not served. |
| `src/public/merch/merch.js` | Renderer + discount + PayPal/crypto wiring. |
| `src/public/merch/img/` | Downloaded XYO product images (og:image copies, not hotlinked). |
| `src/mole/web.js` | `/api/merch/config` (PayPal client id) + `/api/merch/discount` (holder discount). |

## Opening state — 2026-08-30

The shop **moved from `/merch/shop.html` onto `/merch/` and opened for
browsing.** The teaser it replaced is archived at
`docs/archive/merch-teaser-2026-08-30.html`; `shop.html` is now a redirect
stub; the nav entry lost its `Soon` tag; `/merch/` is `index, follow` and in
`sitemap.xml`.

**It is open, not selling.** The serving machine has `PAYPAL_CLIENT_ID` but no
`PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV` is unset (so `merchOrders.js` defaults
to `sandbox`). `GET /api/merch/config` returns `checkoutReady: false`, which is
what makes every WinLEW card render "PayPal checkout coming online" instead of
buttons. All five crypto links are still `TODO_PASTE_...`, so those buttons are
disabled. XYO gear is unaffected — it checks out on `shop.xyo.network`.

Three things to undo when payment is switched on, in this order:

1. On the **serving machine's** `.env`: set `PAYPAL_CLIENT_SECRET` and
   `PAYPAL_ENV=live`, then restart. The client id currently deployed was issued
   against a sandbox app — confirm it is the live pair, not just the secret.
   Re-check with `curl 'https://winlew.co/verify/api-proxy.php?path=/api/merch/config'`;
   it must report `checkoutReady: true` and `paypalEnv: "live"`.
2. Paste real hosted-checkout URLs over the five `checkout.crypto.url`
   `TODO_` placeholders in `products.json` (provider still unchosen —
   NOWPayments vs Coinbase Commerce).
3. Delete the `.openNotice` block in `/merch/index.html` (both its CSS and its
   markup — the CSS comment says so), and put the section subtitle back to
   "Sold and shipped by WinLEW. PayPal or crypto." in **both**
   `products.json` and the static fallback in `index.html`.

## Editing products

Everything is `products.json`. To add/change a WinLEW product:

```jsonc
{
  "id": "winlew-my-product",        // unique slug
  "section": "winlew",
  "name": "My Product",
  "price": 25.0,                     // USD
  "description": "One-liner.",       // if it STARTS WITH "EDIT ME" the card
                                     // renders as "First drop loading" (no buy buttons)
  "image": "/merch/img/my-product.jpg",  // put the file in src/public/merch/img/
  "hasOptions": true,                // sizes?
  "options": { "size": ["S","M","L"] },
  "checkout": {
    "paypal": true,
    "crypto": { "provider": "hosted-link", "url": "https://..." }
    // url starting with "TODO_" renders a disabled "coming online" button
  }
}
```

The three current WinLEW products are **placeholders** (descriptions start
with `EDIT ME`), so the section shows a tasteful "First drop loading" state
with no live buy buttons until you replace them.

XYO items: keep `productUrl` always; add `addToCartUrl` only for no-option
items; `storeProductId` feeds the card's `BLOCK #NNN` ledger stamp. Catalog
verified against shop.xyo.network 2026-07-29 — prices can drift; the "final
price set by the XYO store" microcopy covers that, keep it. Do **not** build
direct checkout for XYO items unless XYO grants written resale authorization
(then flip `config.xyoCheckoutMode`).

## Holder discount

**1% off per 1,000,000 $WinLEW held, capped at 15%. WinLEW drops only** —
XYO prices are set by XYO's store. Computed server-side at
`/api/merch/discount` from the session's *verified* wallet (same cached
live-balance lookup the nav chip uses). Tunable via
`MERCH_DISCOUNT_PCT_PER_MILLION` / `MERCH_DISCOUNT_CAP_PCT` in `.env`.

✅ **Checkout is server-priced as of 2026-08-10.** The browser names the
product, the quantity and the size; it never names a price. `POST
/api/merch/order` prices the basket in `src/mole/merchOrders.js` from
`products.json` plus the session's own verified holdings, records what it
expects to be paid, and creates the PayPal order server-side. `POST
/api/merch/capture` captures it and **checks what PayPal actually took against
that record** before the buyer sees a confirmation. A mismatch is refused,
logged, and flagged on the order.

This replaces the old manual control ("compare every order total against the
price sheet before shipping"), which was the only thing standing between a
tampered client and a $0.01 tee.

## Payments — the two things you must configure

1. **PayPal**: create an app at developer.paypal.com and put **both** the
   client id and the secret in `.env` as `PAYPAL_CLIENT_ID=` /
   `PAYPAL_CLIENT_SECRET=`, plus `PAYPAL_ENV=sandbox` or `live`. Both are
   required — server-side pricing needs the secret, and with the client id
   alone the page deliberately shows "checkout coming online" rather than
   rendering buttons it cannot safely back. The secret belongs only in the
   backend machine's `.env`; never in `src/public/`, a commit, or the web host.
   Blank = buttons
   show "PayPal checkout coming online." Orders (with the buyer's shipping
   address) appear in your PayPal dashboard + email — that's where you
   fulfill from.
2. **Crypto**: pick a hosted-checkout provider — NOWPayments (huge token
   list; check whether XYO/XL1-relevant tokens are supported) or Coinbase
   Commerce (BTC/ETH/USDC etc.). Create a payment link per product in their
   dashboard and paste it into that product's `checkout.crypto.url`.
   Payments land in that provider's dashboard. No API keys in the repo.

## Still TODO (needs LewSales)

- [ ] `PAYPAL_CLIENT_ID` in `.env` (live id when ready; sandbox id to test)
- [ ] Crypto provider choice + one hosted payment link per WinLEW product —
      all five WinLEW products still carry the `TODO_PASTE_…` placeholder, which
      `merch.js` correctly renders as a disabled "Crypto checkout coming online"
      button, so nothing is broken until these are filled in
- [x] ~~Real WinLEW products: names, prices, descriptions, images (replace the
      three `EDIT ME` placeholders)~~ — **done.** All five WinLEW products have
      real names, prices and descriptions; no `EDIT ME` placeholders remain.
      Two (`winlew-logo-tee`, `winlew-builder-tee`) still have `image: null`
      and fall back to a glyph placeholder, so photos for those are the only
      product-content gap left.

## Audit checkpoint — 2026-08-04

Checked during the `/merch/` folder audit:

- **All 9 XYO prices match `shop.xyo.network` exactly** (verified by fetching
  each product page and reading its `product:price:amount`), and all 9
  `productUrl`s return 200. `config.catalogLastVerified` bumped to `2026-08-04`.
  Re-run that check before launch — these are XYO's prices, not ours to guess.
- ~~**The v1 client-side-order caveat is the main launch risk.**~~ **FIXED
  2026-08-10.** `createOrder` no longer builds an amount in the browser. See
  the server-priced note above, `src/mole/merchOrders.js`, and its two test
  files — `merchOrders.test.mjs` (pricing rules, including that a `price` sent
  by the caller is ignored) and `merchClientPricing.test.mjs` (which fails if
  the client ever constructs a PayPal order again). Order history is available
  to maintainers at `GET /api/merch/orders`, with a computed `mismatch` flag
  rather than a total to eyeball.
- Product images were resized: the hero tee PNG was 3.9 MB rendered into a
  366px box. `products.json` and `/merch/index.html` now point at 900px
  WebP/JPEG derivatives; the source PNGs are untouched on disk.
