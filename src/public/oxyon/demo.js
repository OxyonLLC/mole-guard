// Fingerprint demo — local only (Web Crypto). No network, no storage.
(function () {
  var input = document.getElementById('obs');
  if (!input) return;
  var now = document.getElementById('hash-now'), prev = document.getElementById('hash-prev'), diff = document.getElementById('hash-diff');
  if (!(window.crypto && crypto.subtle)) { now.textContent = 'Web Crypto needs HTTPS.'; return; }
  var enc = new TextEncoder(), last = null, timer = null, seq = 0;
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function update() {
    var id = ++seq;
    crypto.subtle.digest('SHA-256', enc.encode(input.value)).then(function (buf) {
      if (id !== seq) return;
      var h = hex(buf);
      if (last && last !== h) {
        prev.textContent = last;
        var n = 0; for (var i = 0; i < 64; i++) if (h[i] !== last[i]) n++;
        diff.textContent = n + ' of 64 hex characters changed.';
      }
      if (last !== h) { now.textContent = h; last = h; }
    });
  }
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(update, 120); });
  update();
})();
