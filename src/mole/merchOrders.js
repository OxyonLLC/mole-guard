/**
 * Server-side merch pricing and PayPal order lifecycle.
 *
 * What was wrong (content-audit register #18): checkout was PayPal Smart
 * Buttons in "client-side v1" mode. `createOrder` called
 * `actions.order.create({ amount: { value: total } })` in the BROWSER, with
 * `total` computed in the browser from a discount also computed in the browser.
 * `onApprove` then called `actions.order.capture()` in the browser too. The
 * server never saw the order at all — not the amount, not the product, not the
 * fact that a sale had happened. A modified client could pay $0.01 for a $40
 * tee, and the documented control was "check every order total against the
 * price sheet before shipping", by hand.
 *
 * The rule this file exists to enforce: THE CLIENT NAMES THE PRODUCT, NEVER THE
 * PRICE. A request may say "two of winlew-genesis-tee in L". It may not say
 * what that costs. Everything monetary is derived here from products.json and
 * the session's own verified holdings.
 *
 * Money is handled in INTEGER CENTS throughout. `0.1 + 0.2 !== 0.3` is not an
 * acceptable property for a payment path, and the old client code did its
 * arithmetic in floats.
 *
 * ── On holding a PayPal secret ──────────────────────────────────────────────
 * .env.example used to say "NEVER put the PayPal secret anywhere." That was
 * written when checkout was client-only, and it is precisely what kept this
 * hole open: server-side order creation is impossible without it, because
 * PayPal's REST API authenticates with client_credentials.
 *
 * It is safe here for a specific, checkable reason: this Node process does not
 * run on the shared web host. The shared host runs only static files and a PHP
 * proxy; the backend runs on the owner's own machine behind a tunnel, and it
 * already holds DISCORD_TOKEN, MONGO_URI, and a Solana keypair that controls
 * real funds. A PayPal client secret is strictly less dangerous than the
 * keypair already sitting beside it.
 *
 * If PAYPAL_CLIENT_SECRET is absent, checkout is DISABLED rather than falling
 * back to the old client-side flow. A half-applied fix here would be worse than
 * none, because the page would look fixed.
 */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readJson, writeJson } from "./storage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = resolve(HERE, "../public/merch/products.json");

const ORDERS_FILE = "merch_orders.json";

/** Section whose prices we control. XYO gear checks out on shop.xyo.network. */
const SELLABLE_SECTION = "winlew";

export const MAX_QTY = 10;

/** Defensive ceiling regardless of what any caller computes. */
const ABSOLUTE_MAX_DISCOUNT_PCT = 50;

let cache = { mtimeMs: 0, data: null };

/** products.json, re-read when it changes on disk. */
export function loadCatalog() {
  const { mtimeMs } = statSync(PRODUCTS_PATH);
  if (!cache.data || cache.mtimeMs !== mtimeMs) {
    cache = { mtimeMs, data: JSON.parse(readFileSync(PRODUCTS_PATH, "utf8")) };
  }
  return cache.data;
}

/** Mirrors the client's own rule: an unfinished product is not for sale. */
export function isPlaceholder(product) {
  return /^EDIT ME/.test(String(product?.description || ""));
}

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("invalid_price");
  // Round through a string to avoid 40.07 * 100 === 4006.9999999999995.
  return Math.round(Number(n.toFixed(2)) * 100);
}

export function formatAmount(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * The authoritative price of an order. Throws rather than guessing on anything
 * it does not recognise — an unknown size or a product that isn't for sale is a
 * malformed request, not a $0 line item.
 */
export function priceOrder({ productId, size, qty, discountPct = 0 } = {}) {
  const catalog = loadCatalog();
  const product = (catalog.products || []).find((p) => p.id === String(productId || ""));
  if (!product) throw new Error("unknown_product");
  if (product.section !== SELLABLE_SECTION) throw new Error("product_not_sold_here");
  if (isPlaceholder(product)) throw new Error("product_not_available");

  // Accept a number or a numeric string — an HTML input's value is a string,
  // and JSON bodies carry it through as one. Reject every other type outright:
  // bare Number() coercion says true -> 1 and [3] -> 3, and on a money path
  // there is no upside to guessing what a boolean quantity meant.
  if (typeof qty !== "number" && typeof qty !== "string") throw new Error("invalid_quantity");
  const quantity = Number(String(qty).trim());
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) throw new Error("invalid_quantity");

  // Sizes are validated against the product's own list, so a request cannot
  // invent one and have it printed onto a fulfilment record.
  //
  // The list lives at product.options.size, gated by product.hasOptions — the
  // same shape the page renders its <select> from. Reading a plausible-looking
  // `product.sizes` instead (as the first draft here did) finds nothing on
  // every real product, which would have rejected every order that named a
  // size — i.e. all of them.
  const sizes = product.hasOptions && Array.isArray(product.options?.size)
    ? product.options.size.map(String)
    : [];
  let chosenSize = "";
  if (sizes.length) {
    chosenSize = String(size || "");
    if (!sizes.includes(chosenSize)) throw new Error("invalid_size");
  } else if (size) {
    throw new Error("invalid_size");
  }

  const configuredCap = Number(catalog.config?.holderDiscount?.capPct ?? 15);
  const cap = Math.min(
    Number.isFinite(configuredCap) ? configuredCap : 15,
    ABSOLUTE_MAX_DISCOUNT_PCT
  );
  // Clamp here as well as at the source. This is the last line before money, so
  // a bug upstream must not be able to hand out a 100% discount.
  const pct = Math.max(0, Math.min(cap, Math.floor(Number(discountPct) || 0)));

  const listCents = toCents(product.price);
  const unitCents = Math.round((listCents * (100 - pct)) / 100);
  const totalCents = unitCents * quantity;
  if (totalCents <= 0) throw new Error("invalid_total");

  const description = [
    product.name,
    chosenSize ? `(Size ${chosenSize})` : "",
    pct > 0 ? `— holder discount ${pct}%` : "",
  ].filter(Boolean).join(" ").slice(0, 127);

  return {
    productId: product.id,
    productName: String(product.name || ""),
    size: chosenSize,
    quantity,
    currency: String(catalog.config?.currency || "USD"),
    listCents,
    unitCents,
    totalCents,
    discountPct: pct,
    description,
  };
}

// ── PayPal REST ─────────────────────────────────────────────────────────────

export function paypalConfig() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  // Default to sandbox. Defaulting to live would mean a misconfigured deploy
  // takes real money, which is the wrong way round for a mistake to fail.
  const env = String(process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase() === "live" ? "live" : "sandbox";
  const base = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  return { clientId, clientSecret, env, base, configured: Boolean(clientId && clientSecret) };
}

async function paypalFetch(path, { method = "GET", body, token } = {}) {
  const { base } = paypalConfig();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const detail = json?.details?.[0]?.description || json?.message || `HTTP ${res.status}`;
    const error = new Error(`paypal_error: ${detail}`);
    error.status = res.status;
    throw error;
  }
  return json ?? {};
}

async function getAccessToken() {
  const { clientId, clientSecret, base, configured } = paypalConfig();
  if (!configured) throw new Error("paypal_not_configured");
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("paypal_auth_failed");
  const json = await res.json();
  if (!json?.access_token) throw new Error("paypal_auth_failed");
  return json.access_token;
}

// ── Order ledger ────────────────────────────────────────────────────────────

function orders() {
  return readJson(ORDERS_FILE, {});
}

function saveOrders(d) {
  writeJson(ORDERS_FILE, d);
}

/**
 * Creates a PayPal order for a server-priced basket and records what we expect
 * to be paid. The recorded figure is what `captureOrder` checks against — it is
 * the whole point of writing it down before the money moves.
 */
export async function createOrder({ productId, size, qty, discountPct, discordUserId, wallet } = {}) {
  const priced = priceOrder({ productId, size, qty, discountPct });
  const token = await getAccessToken();

  const amount = formatAmount(priced.totalCents);
  const created = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    token,
    body: {
      intent: "CAPTURE",
      purchase_units: [{
        description: priced.description,
        amount: {
          currency_code: priced.currency,
          value: amount,
          breakdown: { item_total: { currency_code: priced.currency, value: amount } },
        },
        items: [{
          name: priced.productName.slice(0, 127),
          unit_amount: { currency_code: priced.currency, value: formatAmount(priced.unitCents) },
          quantity: String(priced.quantity),
        }],
      }],
    },
  });

  if (!created?.id) throw new Error("paypal_order_not_created");

  const d = orders();
  d[created.id] = {
    ...priced,
    paypalOrderId: created.id,
    status: "created",
    discordUserId: String(discordUserId || ""),
    wallet: String(wallet || ""),
    createdAt: new Date().toISOString(),
    capturedAt: "",
    paidCents: 0,
    mismatch: false,
  };
  saveOrders(d);

  return { id: created.id, totalCents: priced.totalCents, currency: priced.currency };
}

/**
 * Captures a previously created order and verifies that what PayPal actually
 * took matches what we priced.
 *
 * The amount check is not paranoia about PayPal. It is the assertion that the
 * order being captured is the one we created — the client supplies the order
 * id, so without this an attacker could create a cheap order and present its id
 * against an expensive expectation, or vice versa.
 */
export async function captureOrder({ paypalOrderId } = {}) {
  const id = String(paypalOrderId || "").trim();
  if (!id) throw new Error("invalid_order_id");

  const d = orders();
  const record = d[id];
  if (!record) throw new Error("unknown_order");
  // Idempotent: a retried capture returns the original result rather than
  // charging again or reporting a spurious failure.
  if (record.status === "captured") {
    return { ok: true, alreadyCaptured: true, orderId: id, amount: formatAmount(record.paidCents) };
  }

  const token = await getAccessToken();
  const captured = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: "POST",
    token,
  });

  const capture = captured?.purchase_units?.[0]?.payments?.captures?.[0];
  const paidCents = capture?.amount?.value ? toCents(capture.amount.value) : 0;
  const currency = String(capture?.amount?.currency_code || "");

  record.status = "captured";
  record.capturedAt = new Date().toISOString();
  record.paidCents = paidCents;
  record.paypalCaptureId = String(capture?.id || "");
  record.payerEmail = String(captured?.payer?.email_address || "");
  // Recorded, never thrown away: an order that was captured for the wrong
  // amount is exactly the case a human needs to see before shipping anything.
  record.mismatch = paidCents !== record.totalCents || (currency && currency !== record.currency);
  d[id] = record;
  saveOrders(d);

  if (record.mismatch) {
    const error = new Error("amount_mismatch");
    error.expected = formatAmount(record.totalCents);
    error.paid = formatAmount(paidCents);
    throw error;
  }

  return {
    ok: true,
    orderId: id,
    captureId: record.paypalCaptureId,
    amount: formatAmount(paidCents),
    currency: record.currency,
  };
}

export function getOrder(paypalOrderId) {
  return orders()[String(paypalOrderId || "")] || null;
}

export function listOrders({ limit = 100 } = {}) {
  return Object.values(orders())
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 100)));
}

export const __testing = { toCents, ORDERS_FILE, PRODUCTS_PATH, ABSOLUTE_MAX_DISCOUNT_PCT };
