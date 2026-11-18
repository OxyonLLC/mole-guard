// Oxyon /future/ — local-only interactions. No network requests, no storage, no dependencies.
(function () {
  'use strict';
  var subtle = window.crypto && window.crypto.subtle;
  var enc = new TextEncoder();

  function sha256(text) {
    return subtle.digest('SHA-256', enc.encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }
  function $(id) { return document.getElementById(id); }

  if (!subtle) {
    var msg = 'Web Crypto is unavailable here (it needs HTTPS).';
    if ($('ev-hash')) $('ev-hash').textContent = msg;
    if ($('hash-now')) $('hash-now').textContent = msg;
    return;
  }

  // Hero evidence card: a real hash of an illustrative record.
  var now = new Date();
  var iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  if ($('ev-time')) $('ev-time').textContent = iso;
  sha256(JSON.stringify({
    schema: 'oxyon.geoproof.event.v1',
    observed: 'Sensor 7 reads 21.4 C',
    origin: 'xl1:4f2a...c19e',
    cell: '8a2a1072b59ffff',
    time: iso
  })).then(function (h) {
    $('ev-hash').textContent = h;
    $('ev-conf').textContent = 'high · 3 of 3 checks';
    requestAnimationFrame(function () { $('ev-bar').style.width = '86%'; });
  });

  // Fingerprint demo.
  var input = $('obs'), now_ = $('hash-now'), prev = $('hash-prev'), diff = $('hash-diff');
  if (!input) return;
  var last = null, timer = null, seq = 0;

  function update() {
    var id = ++seq;
    sha256(input.value).then(function (h) {
      if (id !== seq) return; // a newer keystroke won
      if (last && last !== h) {
        prev.textContent = last;
        var changed = 0;
        for (var i = 0; i < h.length; i++) if (h[i] !== last[i]) changed++;
        diff.textContent = changed + ' of 64 hex characters changed.';
      }
      if (last !== h) { now_.textContent = h; last = h; }
    });
  }
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  });
  update();
})();
