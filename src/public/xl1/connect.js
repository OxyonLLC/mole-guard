// Connect XL1 wallet (P7): the card on winlew.co/xl1.
//
// Hidden by default. It appears only when the backend answers /api/xl1/connect/status for the
// signed-in account, which happens only while XL1_CONNECT_ENABLED is on AND the account is in the
// trial audience. Everyone else gets a 404 and never sees anything.
//
// The session travels ONLY in the x-winlew-session header (the routes refuse it in a URL or body).
// Connecting grants nothing: no rewards wording here until an account is actually eligible.
(function () {
  'use strict';
  var SESSION_KEY = 'winlew.verify.session';
  var card = document.getElementById('xl1-connect');
  if (!card) return;

  function session() {
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
  }
  function apiUrl(path) {
    var onShared = /^(?:www\.)?winlew\.co$/i.test(location.hostname || '');
    if (!onShared) return path;
    var u = new URL('/verify/api-proxy.php', location.origin);
    u.searchParams.set('path', path);
    return u.toString();
  }
  function call(method, path) {
    var s = session();
    if (!s) return Promise.resolve(null);
    return fetch(apiUrl(path), {
      method: method,
      headers: { 'x-winlew-session': s, accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; });
    }).catch(function () { return null; });
  }

  var el = function (id) { return document.getElementById(id); };
  var stateEl = el('xc-state'), detailEl = el('xc-detail'), btn = el('xc-connect'), off = el('xc-disconnect'), msg = el('xc-msg');
  var isIphone = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  function short(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a; }
  function say(t) { msg.textContent = t || ''; }

  function render(s) {
    card.hidden = false;
    var conflict = s.reason === 'wallet_verified_elsewhere';
    var connected = Boolean(s.xl1Address) && !conflict;
    stateEl.textContent = conflict ? 'Already in use' : (connected ? 'Connected' : 'Not connected');
    stateEl.className = 'chip ' + (connected ? 'chip-live' : 'chip-in');
    var text;
    if (conflict) {
      text = 'Wallet ' + short(s.xl1Address) + ' is already verified to another account, so it was not connected here. Nothing was moved.';
    } else if (connected) {
      text = 'Wallet ' + short(s.xl1Address) + ' is connected to your WinLEW account.';
    } else {
      text = 'Prove an XL1 wallet is yours with one signature. Nothing is sent and it costs nothing.';
    }
    if (s.reason === 'discord_verified') text += ' Your Discord-verified wallet keeps working exactly as before.';
    else if (connected && !s.eligible) text += ' Rewards: not eligible yet.';
    detailEl.textContent = text;
    btn.hidden = connected || isIphone;
    off.hidden = !connected;
    el('xc-iphone').hidden = !isIphone || connected;
  }

  function refresh() {
    return call('GET', '/api/xl1/connect/status').then(function (r) {
      if (!r || r.status !== 200) { card.hidden = true; return; }   // 404 = not in the trial: stay invisible
      render(r.body || {});
    });
  }

  btn.addEventListener('click', function () {
    btn.disabled = true; say('Opening the verification page…');
    call('POST', '/api/xl1/connect/start').then(function (r) {
      btn.disabled = false;
      if (r && r.status === 200 && r.body && /^https:\/\/winlew\.co\//.test(String(r.body.url || ''))) {
        location.assign(r.body.url);
      } else if (r && r.status === 429) {
        say('Too many tries. Wait a few minutes, then try again.');
      } else {
        say('Could not start right now. Try again in a minute.');
      }
    });
  });

  off.addEventListener('click', function () {
    off.disabled = true; say('');
    call('POST', '/api/xl1/connect/disconnect').then(function (r) {
      off.disabled = false;
      if (r && r.status === 200) { say('Disconnected.'); refresh(); } else { say('Could not disconnect right now. Try again in a minute.'); }
    });
  });

  // Coming back from the verification page: check again when the tab is shown.
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !card.hidden) refresh(); });
  refresh();
})();
