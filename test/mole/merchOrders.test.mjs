// Covers src/mole/merchOrders.js — server-side merch pricing.
//
// Register #18: checkout was PayPal Smart Buttons in client-side mode. The
// BROWSER called actions.order.create() with an amount it computed itself, from
// a discount it computed itself, and then captured the order itself. The server
// never saw the sale. A modified client could pay $0.01 for a $40 tee, and the
// documented control was a human checking every order against the price sheet.
//
// The single rule these tests exist to enforce: THE CLIENT NAMES THE PRODUCT,
// NEVER THE PRICE. Every assertion below is a way of asking "can a request
// influence what it is charged?" — and the answer has to stay no.
//
// Same isolation as the other tests in this directory: the repo's .env points
// at a live Mongo cluster and a real DATA_DIR, both redirected before import.
import 'dotenv/config';

process.env.MONGO_ENABLED = 'false';
delete process.env.MONGO_URI;

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'winlew-merch-test-'));
process.env.DATA_DIR = TMP_DATA_DIR;

const {
  priceOrder,
  loadCatalog,
  isPlaceholder,
  formatAmount,
  paypalConfig,
  MAX_QTY,
  __testing,
} = await import('../../src/mole/merchOrders.js');

after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

const catalog = loadCatalog();
const sellable = (catalog.products || []).filter(
  (p) => p.section === 'winlew' && !isPlaceholder(p)
);
const sample = sellable[0];
const sampleSize = sample?.options?.size?.[0];

describe('merchOrders: the catalog these tests run against', () => {
  test('there is a real, sellable product to price', () => {
    // Guard the guard: if the catalog were empty or all placeholders, every
    // pricing assertion below would be vacuous.
    assert.ok(sellable.length > 0, 'no sellable winlew products found in products.json');
    assert.ok(Number(sample.price) > 0, 'sample product has no price');
    assert.ok(sampleSize, 'sample product has no options.size — the size tests would not exercise anything');
  });
});

describe('merchOrders: the client cannot influence the price', () => {
  test('a price sent by the caller is ignored', () => {
    // The shape of the original bug, expressed directly.
    const honest = priceOrder({ productId: sample.id, size: sampleSize, qty: 1 });
    const attacker = priceOrder({
      productId: sample.id,
      size: sampleSize,
      qty: 1,
      price: 0.01,
      total: 0.01,
      totalCents: 1,
      unitCents: 1,
      amount: '0.01',
    });
    assert.equal(attacker.totalCents, honest.totalCents);
    assert.equal(attacker.totalCents, Math.round(Number(sample.price) * 100));
  });

  test('the discount is clamped to the configured cap', () => {
    const cap = Number(catalog.config?.holderDiscount?.capPct ?? 15);
    const priced = priceOrder({ productId: sample.id, size: sampleSize, qty: 1, discountPct: 99 });
    assert.equal(priced.discountPct, cap);
  });

  test('the clamp holds even if the catalog cap is nonsense', () => {
    // Last line before money: a bad config must not become a free giveaway.
    assert.ok(__testing.ABSOLUTE_MAX_DISCOUNT_PCT <= 50);
    const priced = priceOrder({ productId: sample.id, size: sampleSize, qty: 1, discountPct: 1000 });
    assert.ok(priced.unitCents > 0);
    assert.ok(priced.discountPct <= __testing.ABSOLUTE_MAX_DISCOUNT_PCT);
  });

  test('a negative or fractional discount cannot raise or nudge the price', () => {
    const full = priceOrder({ productId: sample.id, size: sampleSize, qty: 1 }).totalCents;
    for (const pct of [-50, -1, 0.9, NaN, null, undefined, '5.9']) {
      const priced = priceOrder({ productId: sample.id, size: sampleSize, qty: 1, discountPct: pct });
      assert.ok(priced.totalCents <= full, `discountPct=${pct} produced a HIGHER total`);
      assert.ok(priced.totalCents > 0);
    }
  });
});

describe('merchOrders: input validation', () => {
  test('unknown, non-sellable and placeholder products are refused', () => {
    assert.throws(() => priceOrder({ productId: 'no-such-thing', qty: 1 }), /unknown_product/);
    const xyo = (catalog.products || []).find((p) => p.section === 'xyo');
    if (xyo) {
      // XYO gear checks out on shop.xyo.network; we do not control its price.
      assert.throws(() => priceOrder({ productId: xyo.id, qty: 1 }), /product_not_sold_here/);
    }
    const placeholder = (catalog.products || []).find((p) => p.section === 'winlew' && isPlaceholder(p));
    if (placeholder) {
      assert.throws(() => priceOrder({ productId: placeholder.id, qty: 1 }), /product_not_available/);
    }
  });

  test('quantity must be a whole number in range', () => {
    for (const qty of [0, -1, 1.5, MAX_QTY + 1, 1e9, NaN, null, undefined, Infinity, '2abc', '']) {
      assert.throws(
        () => priceOrder({ productId: sample.id, size: sampleSize, qty }),
        /invalid_quantity/,
        `qty=${String(qty)} was accepted`
      );
    }
    assert.equal(priceOrder({ productId: sample.id, size: sampleSize, qty: MAX_QTY }).quantity, MAX_QTY);
  });

  test('a numeric string is accepted and normalised', () => {
    // Form inputs and JSON bodies both carry the quantity as a string.
    const priced = priceOrder({ productId: sample.id, size: sampleSize, qty: '3' });
    assert.equal(priced.quantity, 3);
    assert.equal(priced.totalCents, priced.unitCents * 3);
  });

  test('non-numeric types are refused rather than coerced', () => {
    // Bare Number() says true -> 1 and [3] -> 3. On a money path there is no
    // upside to guessing what a boolean quantity meant.
    for (const qty of [true, false, [3], [], {}, () => 3]) {
      assert.throws(
        () => priceOrder({ productId: sample.id, size: sampleSize, qty }),
        /invalid_quantity/,
        `qty=${String(qty)} was coerced instead of refused`
      );
    }
  });

  test('the size must be one the product actually offers', () => {
    // Otherwise a request could write an arbitrary string onto a fulfilment
    // record — "Size <script>" or "Size FREE".
    assert.throws(() => priceOrder({ productId: sample.id, size: 'XXXXL', qty: 1 }), /invalid_size/);
    assert.throws(() => priceOrder({ productId: sample.id, size: '', qty: 1 }), /invalid_size/);
    for (const size of sample.options.size) {
      assert.equal(priceOrder({ productId: sample.id, size, qty: 1 }).size, size);
    }
  });

  test('the size list is read from where it really lives', () => {
    // The first draft read product.sizes, which does not exist on any real
    // product — so every order naming a size would have been rejected, i.e.
    // all of them. Pin the real shape.
    assert.ok(Array.isArray(sample.options.size) && sample.options.size.length > 0);
    assert.equal(sample.hasOptions, true);
    assert.equal(priceOrder({ productId: sample.id, size: sampleSize, qty: 1 }).size, sampleSize);
  });
});

describe('merchOrders: money arithmetic', () => {
  test('totals are integer cents, never floats', () => {
    const priced = priceOrder({ productId: sample.id, size: sampleSize, qty: 3 });
    assert.ok(Number.isInteger(priced.unitCents));
    assert.ok(Number.isInteger(priced.totalCents));
    assert.equal(priced.totalCents, priced.unitCents * 3);
  });

  test('toCents survives the classic float traps', () => {
    // 40.07 * 100 === 4006.9999999999995 in IEEE754. The old client did its
    // arithmetic in floats.
    assert.equal(__testing.toCents(40.07), 4007);
    assert.equal(__testing.toCents(0.1 + 0.2), 30);
    assert.equal(__testing.toCents('19.99'), 1999);
    assert.equal(__testing.toCents(0), 0);
    assert.throws(() => __testing.toCents(-1), /invalid_price/);
    assert.throws(() => __testing.toCents('abc'), /invalid_price/);
  });

  test('formatAmount renders exactly two decimals', () => {
    assert.equal(formatAmount(4000), '40.00');
    assert.equal(formatAmount(1), '0.01');
    assert.equal(formatAmount(123456), '1234.56');
  });

  test('a discount never produces a sub-cent or zero total', () => {
    for (let pct = 0; pct <= 50; pct++) {
      const priced = priceOrder({ productId: sample.id, size: sampleSize, qty: 1, discountPct: pct });
      assert.ok(priced.totalCents > 0, `pct=${pct} produced a zero total`);
      assert.ok(Number.isInteger(priced.totalCents));
    }
  });
});

describe('merchOrders: PayPal configuration fails safe', () => {
  const saved = { id: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, env: process.env.PAYPAL_ENV };
  after(() => {
    if (saved.id === undefined) delete process.env.PAYPAL_CLIENT_ID; else process.env.PAYPAL_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.PAYPAL_CLIENT_SECRET; else process.env.PAYPAL_CLIENT_SECRET = saved.secret;
    if (saved.env === undefined) delete process.env.PAYPAL_ENV; else process.env.PAYPAL_ENV = saved.env;
  });

  test('a client id alone is NOT configured', () => {
    // The important one. With only a client id the page could still render
    // PayPal buttons — which is exactly the client-priced flow this replaced.
    process.env.PAYPAL_CLIENT_ID = 'abc';
    delete process.env.PAYPAL_CLIENT_SECRET;
    assert.equal(paypalConfig().configured, false);
  });

  test('both halves make it configured', () => {
    process.env.PAYPAL_CLIENT_ID = 'abc';
    process.env.PAYPAL_CLIENT_SECRET = 'shh';
    assert.equal(paypalConfig().configured, true);
  });

  test('the environment defaults to sandbox, never live', () => {
    // A misconfigured deploy must not take real money.
    delete process.env.PAYPAL_ENV;
    assert.equal(paypalConfig().env, 'sandbox');
    process.env.PAYPAL_ENV = 'nonsense';
    assert.equal(paypalConfig().env, 'sandbox');
    process.env.PAYPAL_ENV = 'live';
    assert.equal(paypalConfig().env, 'live');
    assert.equal(paypalConfig().base, 'https://api-m.paypal.com');
  });
});
