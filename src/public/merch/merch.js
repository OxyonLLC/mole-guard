// /merch/ page renderer. Everything on the page comes from
// /merch/products.json (single source of truth — no hardcoded products
// here). Two fulfillment models, deliberately kept visually distinct:
//   winlew section — sold/shipped by WinLEW, PayPal Smart Buttons (client
//     side, no backend order flow in v1) + hosted crypto checkout links.
//   xyo section    — link-out only to shop.xyo.network (addToCartUrl when
//     the item has no options, else its product page). config.xyoCheckoutMode
//     stays "linkout" unless XYO ever grants written resale authorization.
// Holder discount (WinLEW items only): server-computed at
// /api/merch/discount from the session's verified wallet — 1% per 1M
// $WinLEW, capped (see MERCH_README.md).
(function () {
  'use strict';

  var Auth = window.WinLEWAuth;
  var state = {
    data: null,
    discountPct: 0,
    capPct: 15,
    paypalClientId: '',
    paypalReady: false,
    // Only true when the SERVER can price and capture orders itself.
    checkoutReady: false,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return '$' + Number(n).toFixed(2);
  }

  /** The verified session, if the visitor has one. Drives the holder discount
   *  server-side; an absent session simply means no discount, never an error. */
  function sessionToken() {
    return Auth ? (Auth.getAuth().session || '') : '';
  }

  /** POST/GET JSON through the shared proxy-aware fetch. Returns the parsed
   *  body for both success and failure so callers can read `error`. */
  function api(path, options) {
    return Auth.hubApiFetch(path, options).then(function (res) {
      return res.json().catch(function () { return null; });
    });
  }

  function discountedPrice(price) {
    if (!(state.discountPct > 0)) return price;
    return Math.round(price * (100 - state.discountPct)) / 100;
  }

  function isPlaceholder(p) {
    return /^EDIT ME/.test(String(p.description || ''));
  }

  // ── Ledger stamps (signature element) ────────────────────────────────────
  function xyoStamp(p) {
    return p.storeProductId
      ? 'BLOCK #' + p.storeProductId + ' · FULFILLED BY XYO'
      : 'XYO STORE · FULFILLED BY XYO';
  }

  function winlewStamp(index) {
    return 'WINLEW DROP ' + String(index + 1).padStart(3, '0') + ' · SHIPS FROM HQ';
  }

  // ── Card builders ────────────────────────────────────────────────────────
  function imgBlock(p, fallbackGlyph) {
    if (p.image) {
      return '<div class="productImgWrap"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" /></div>';
    }
    return '<div class="productImgWrap"><span class="imgPlaceholder" aria-hidden="true">' + fallbackGlyph + '</span></div>';
  }

  function xyoCard(p) {
    var buyUrl = p.addToCartUrl || p.productUrl;
    var card = document.createElement('div');
    card.className = 'productCard';
    card.innerHTML =
      imgBlock(p, '📡') +
      '<div class="productBody">' +
        '<strong>' + esc(p.name) + '</strong>' +
        '<div class="priceRow"><span class="price">' + money(p.price) + '</span></div>' +
        '<div class="buyRow">' +
          '<a class="buyBtn" href="' + esc(buyUrl) + '" target="_blank" rel="noreferrer noopener">Buy on XYO Store ↗</a>' +
        '</div>' +
      '</div>' +
      '<div class="ledgerStamp">' + esc(xyoStamp(p)) + '</div>';
    return card;
  }

  function placeholderCard(p, index) {
    var card = document.createElement('div');
    card.className = 'productCard comingSoon';
    card.innerHTML =
      imgBlock(p, '🪙') +
      '<div class="productBody">' +
        '<span class="tag pending">First drop loading</span>' +
        '<strong>' + esc(p.name) + '</strong>' +
        '<div class="priceRow"><span class="price">' + money(p.price) + '</span></div>' +
        '<span class="desc">In production — check back soon.</span>' +
      '</div>' +
      '<div class="ledgerStamp">' + esc(winlewStamp(index)) + '</div>';
    return card;
  }

  function winlewCard(p, index) {
    var card = document.createElement('div');
    card.className = 'productCard';
    card.dataset.productId = p.id;

    var base = Number(p.price);
    var now = discountedPrice(base);
    var priceHtml = state.discountPct > 0
      ? '<span class="priceWas">' + money(base) + '</span><span class="price">' + money(now) + '</span>' +
        '<span class="discountTag">−' + state.discountPct + '% holder</span>'
      : '<span class="price">' + money(base) + '</span>';

    var optsHtml = '';
    if (p.hasOptions && p.options && Array.isArray(p.options.size)) {
      optsHtml +=
        '<div class="optRow"><label for="size-' + esc(p.id) + '">Size</label>' +
        '<select id="size-' + esc(p.id) + '" data-role="size">' +
        p.options.size.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') +
        '</select></div>';
    }
    optsHtml +=
      '<div class="optRow"><label for="qty-' + esc(p.id) + '">Qty</label>' +
      '<input id="qty-' + esc(p.id) + '" data-role="qty" type="number" min="1" max="10" step="1" value="1" /></div>';

    var cryptoUrl = p.checkout && p.checkout.crypto && p.checkout.crypto.url || '';
    var cryptoLive = cryptoUrl && !/^TODO_/.test(cryptoUrl);
    var cryptoHtml = cryptoLive
      ? '<a class="cryptoBtn" href="' + esc(cryptoUrl) + '" target="_blank" rel="noreferrer noopener">Pay with crypto ↗</a>'
      : '<button class="cryptoBtn" type="button" disabled>Crypto checkout coming online</button>';

    card.innerHTML =
      imgBlock(p, '🪙') +
      '<div class="productBody">' +
        '<strong>' + esc(p.name) + '</strong>' +
        '<span class="desc">' + esc(p.description || '') + '</span>' +
        '<div class="priceRow">' + priceHtml + '</div>' +
        '<div class="buyRow">' +
          optsHtml +
          (p.checkout && p.checkout.paypal
            ? '<div class="paypalSlot" data-role="paypal"></div><span class="paypalNote" data-role="paypalNote">PayPal loading…</span>'
            : '') +
          cryptoHtml +
        '</div>' +
      '</div>' +
      '<div class="ledgerStamp">' + esc(winlewStamp(index)) + '</div>';
    return card;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function sectionMeta(id) {
    var sections = (state.data && state.data.sections) || [];
    for (var i = 0; i < sections.length; i++) if (sections[i].id === id) return sections[i];
    return null;
  }

  function render() {
    var data = state.data;
    var winMeta = sectionMeta('winlew');
    var xyoMeta = sectionMeta('xyo');
    if (winMeta) {
      document.getElementById('winlewSectionTitle').textContent = winMeta.title;
      document.getElementById('winlewSectionSub').textContent = winMeta.subtitle;
    }
    if (xyoMeta) {
      document.getElementById('xyoSectionTitle').textContent = xyoMeta.title;
      document.getElementById('xyoSectionSub').textContent = xyoMeta.subtitle;
    }

    var winGrid = document.getElementById('winlewGrid');
    var xyoGrid = document.getElementById('xyoGrid');
    winGrid.innerHTML = '';
    xyoGrid.innerHTML = '';

    var winIndex = 0;
    (data.products || []).forEach(function (p) {
      if (p.section === 'winlew') {
        winGrid.appendChild(isPlaceholder(p) ? placeholderCard(p, winIndex) : winlewCard(p, winIndex));
        winIndex++;
      } else if (p.section === 'xyo') {
        xyoGrid.appendChild(xyoCard(p));
      }
    });

    var linkoutRow = document.getElementById('linkoutRow');
    linkoutRow.innerHTML = '';
    (data.linkouts || []).forEach(function (l) {
      var a = document.createElement('a');
      a.className = 'buyBtn';
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = l.label + ' ↗';
      linkoutRow.appendChild(a);
    });

    mountPaypalButtons();
  }

  // ── Holder discount ──────────────────────────────────────────────────────
  function renderDiscountBar(html) {
    document.getElementById('discountBar').innerHTML = html;
  }

  function discountPitch() {
    var per = (state.data && state.data.config && state.data.config.holderDiscount &&
      state.data.config.holderDiscount.pctPerMillionWinlew) || 1;
    return 'Hold $WinLEW, save on drops: ' + per + '% off per 1M held, up to ' + state.capPct + '%.';
  }

  async function loadDiscount() {
    var cfg = state.data && state.data.config && state.data.config.holderDiscount;
    if (cfg && cfg.capPct) state.capPct = cfg.capPct;

    var session = Auth ? Auth.getAuth().session : '';
    if (!session) {
      renderDiscountBar(
        '<span>' + esc(discountPitch()) + '</span>' +
        '<a class="verifyCta" href="/verify/">Verify your wallet to unlock →</a>'
      );
      return;
    }
    try {
      var res = await Auth.hubApiFetch('/api/merch/discount');
      var j = await res.json();
      if (j && j.ok && j.discountPct > 0) {
        state.capPct = j.capPct || state.capPct;
        state.discountPct = j.discountPct;
        renderDiscountBar(
          '<span class="pctBadge">−' + j.discountPct + '%</span>' +
          '<span><strong>Holder discount active.</strong> ' +
          (j.balance != null ? Math.floor(j.balance).toLocaleString() + ' $WinLEW verified · ' : '') +
          'applies to $WinLEW drops below (cap ' + state.capPct + '%).</span>'
        );
        render(); // re-render so cards pick up discounted prices
        return;
      }
      if (j && j.ok) {
        renderDiscountBar(
          '<span>' + esc(discountPitch()) + '</span>' +
          '<span class="muted">' +
          (j.balance == null
            ? 'Balance check unavailable right now — discount will appear once it’s back.'
            : 'Verified balance: ' + Math.floor(j.balance).toLocaleString() + ' $WinLEW — 1M+ unlocks the first 1%.') +
          '</span>'
        );
        return;
      }
      // session expired or error → same pitch as signed-out
      renderDiscountBar(
        '<span>' + esc(discountPitch()) + '</span>' +
        '<a class="verifyCta" href="/verify/">Verify your wallet to unlock →</a>'
      );
    } catch (e) {
      renderDiscountBar('<span>' + esc(discountPitch()) + '</span>');
    }
  }

  // ── PayPal Smart Buttons (client-side, v1 backend-free) ──────────────────
  function paypalUnavailable(msg) {
    document.querySelectorAll('[data-role="paypalNote"]').forEach(function (el) {
      el.textContent = msg;
    });
  }

  async function loadPaypalSdk() {
    try {
      var res = await Auth.hubApiFetch('/api/merch/config');
      var j = await res.json();
      state.paypalClientId = (j && j.paypalClientId) || '';
      state.checkoutReady = Boolean(j && j.checkoutReady);
    } catch (e) {
      state.paypalClientId = '';
      state.checkoutReady = false;
    }
    // Gated on checkoutReady, not just the client id. The server reports that
    // flag only when it ALSO holds the PayPal secret — i.e. only when it can
    // price and capture orders itself. With a client id alone the buttons would
    // render and every order would fail at /api/merch/order, which is the right
    // failure but a pointless one to show a buyer. Rendering them and letting
    // the browser price the order is what this whole change removed.
    if (!state.paypalClientId || !state.checkoutReady) {
      paypalUnavailable('PayPal checkout coming online.');
      return;
    }
    var hasLivePaypalProduct = (state.data.products || []).some(function (p) {
      return p.section === 'winlew' && !isPlaceholder(p) && p.checkout && p.checkout.paypal;
    });
    if (!hasLivePaypalProduct) return;

    var currency = (state.data.config && state.data.config.currency) || 'USD';
    var s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(state.paypalClientId) +
      '&currency=' + encodeURIComponent(currency) + '&components=buttons&intent=capture';
    s.onload = function () { state.paypalReady = true; mountPaypalButtons(); };
    s.onerror = function () { paypalUnavailable('PayPal is unavailable right now — try again later.'); };
    document.head.appendChild(s);
  }

  function mountPaypalButtons() {
    if (!state.paypalReady || !window.paypal) return;
    document.querySelectorAll('.productCard[data-product-id]').forEach(function (card) {
      var slot = card.querySelector('[data-role="paypal"]');
      if (!slot || slot.dataset.mounted) return;
      var product = (state.data.products || []).find(function (p) { return p.id === card.dataset.productId; });
      if (!product) return;
      slot.dataset.mounted = '1';
      var note = card.querySelector('[data-role="paypalNote"]');

      // THE RULE: this client names the PRODUCT and never the PRICE.
      //
      // It used to do both. createOrder called actions.order.create() in the
      // browser with an amount computed in the browser from a discount computed
      // in the browser, and onApprove captured in the browser too — so the
      // server never saw the order at all and a modified client could pay a
      // cent for a $40 tee. Anything below that starts computing money again is
      // reintroducing that hole; see src/mole/merchOrders.js.
      window.paypal.Buttons({
        style: { layout: 'horizontal', height: 40, tagline: false },
        createOrder: function () {
          var qtyEl = card.querySelector('[data-role="qty"]');
          var sizeSel = card.querySelector('[data-role="size"]');
          return api('/api/merch/order', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              productId: product.id,
              qty: Math.max(1, Math.min(10, parseInt(qtyEl && qtyEl.value, 10) || 1)),
              size: sizeSel ? sizeSel.value : '',
              session: sessionToken(),
            }),
          }).then(function (j) {
            if (!j || !j.ok || !j.id) throw new Error((j && j.error) || 'order_failed');
            return j.id;
          });
        },
        onApprove: function (data) {
          // Captured on the server, which checks what PayPal actually took
          // against what it priced before showing the buyer a confirmation.
          return api('/api/merch/capture', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID }),
          }).then(function (j) {
            var buyRow = card.querySelector('.buyRow');
            var confirm = document.createElement('div');
            confirm.className = 'orderConfirm';
            if (!j || !j.ok) {
              confirm.innerHTML = '⚠️ <strong>Payment needs review.</strong> Your PayPal order ID is ' +
                esc(data.orderID) + '. Don\u2019t pay again — contact us with that ID and we\u2019ll sort it out.';
            } else {
              confirm.innerHTML = '✅ <strong>Order confirmed.</strong> PayPal order ID: ' +
                esc(j.orderId || data.orderID) +
                '<br />You\u2019ll get a PayPal receipt by email — we ship to your PayPal address.';
            }
            buyRow.replaceChildren(confirm);
          });
        },
        onError: function () {
          if (note) note.textContent = 'PayPal hit an error — nothing was charged. Refresh and try again.';
        },
      }).render(slot).then(function () {
        if (note) note.remove();
      }).catch(function () {
        if (note) note.textContent = 'PayPal is unavailable right now — try again later.';
      });
    });
  }

  // ── Scroll-in reveal (one per section; motion handled by CSS media query) ─
  function initReveal() {
    var els = document.querySelectorAll('.revealOnScroll');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('revealed'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    els.forEach(function (el) { io.observe(el); });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  async function boot() {
    initReveal();
    try {
      var res = await fetch('/merch/products.json', { cache: 'no-cache' });
      state.data = await res.json();
    } catch (e) {
      document.getElementById('winlewGrid').innerHTML =
        '<p class="muted">Could not load the catalog — refresh to try again.</p>';
      renderDiscountBar('<span>Catalog unavailable.</span>');
      return;
    }
    render();
    loadDiscount();
    loadPaypalSdk();
  }

  boot();
})();
