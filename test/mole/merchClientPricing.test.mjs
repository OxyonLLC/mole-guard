// The merch page must never compute money again.
//
// Register #18: checkout was PayPal Smart Buttons in client-side mode. The
// browser called actions.order.create() with an amount it had worked out
// itself, then actions.order.capture() to take it. The server saw nothing. A
// modified client could pay $0.01 for a $40 tee.
//
// src/mole/merchOrders.js now prices everything, and test/mole/merchOrders.test.mjs
// proves the rules. This file guards the OTHER half: that the client keeps
// asking rather than deciding. It is a source-shape test because the failure it
// prevents is a future edit "simplifying" the round trip away — reintroducing a
// money bug that no functional test would notice, because the page would still
// happily take payment.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const merchJs = readFileSync(resolve(repoRoot, "src/public/merch/merch.js"), "utf8");

/** Source with comments stripped: the comments here deliberately describe the
 *  removed pattern so the next reader knows what not to reinstate. */
const code = merchJs
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

test("the client never creates or captures a PayPal order itself", () => {
  for (const banned of ["actions.order.create", "order.capture()", "purchase_units", "unit_amount", "item_total"]) {
    assert.ok(
      !code.includes(banned),
      `merch.js contains "${banned}" — the browser is constructing a PayPal order again. ` +
        `Orders must be created by POST /api/merch/order and captured by POST /api/merch/capture, ` +
        `so the amount is the server's and can be checked against what PayPal took.`
    );
  }
});

test("checkout goes through the server routes", () => {
  assert.ok(code.includes("/api/merch/order"), "merch.js no longer calls /api/merch/order");
  assert.ok(code.includes("/api/merch/capture"), "merch.js no longer calls /api/merch/capture");
});

test("the PayPal SDK is gated on the server being able to price orders", () => {
  // A client id alone renders buttons; only the secret lets the server price
  // and capture. Gating on the id alone would put buttons in front of a
  // checkout that cannot work — or, worse, invite a client-side fallback.
  assert.ok(
    /checkoutReady/.test(code),
    "merch.js does not check checkoutReady before loading the PayPal SDK."
  );
  const load = code.slice(code.indexOf("function loadPaypalSdk"));
  const body = load.slice(0, load.indexOf("\n  function "));
  assert.ok(
    /!state\.checkoutReady/.test(body),
    "loadPaypalSdk() must bail unless the server reports checkoutReady."
  );
});

test("the order request names a product, never a price", () => {
  const create = code.slice(code.indexOf("createOrder:"));
  const body = create.slice(0, create.indexOf("onApprove:"));
  assert.ok(/productId/.test(body), "the order request does not send a productId");
  for (const key of ["price", "total", "amount", "unit_amount"]) {
    assert.ok(
      !new RegExp(`\\b${key}\\s*:`).test(body),
      `the order request sends "${key}" — the client must name the product and never the price.`
    );
  }
});
