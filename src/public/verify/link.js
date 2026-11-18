// WinLEW Verify (client)
// - Multi-wallet support (Phantom / Solflare / Jupiter / Auto)
// - Flow: connect -> /api/wallet/challenge -> signMessage -> /api/wallet/link
// - Signature is stored as JSON array string (Uint8Array -> JSON) for backend decoding.

const API_BASE = (() => {
  const raw =
    window.WINLEW_API_BASE ||
    document.documentElement.getAttribute("data-api-base") ||
    "";
  return String(raw).replace(/\/$/, "");
})();

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function api(path, opts = {}) {
  const r = await fetch(apiUrl(path), {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!r.ok) {
    const err = new Error(json?.error || text || `HTTP ${r.status}`);
    // The code alone is not enough to act on: discord_not_attached carries the
    // URL that fixes it. Keep the whole body on the error.
    err.payload = json || null;
    err.status = r.status;
    throw err;
  }
  return json ?? {};
}

const $ = (id) => document.getElementById(id);
const SessionStore = {
  session: 'winlew.verify.session',
  app: 'winlew.verify.app',
  wallet: 'winlew.verify.wallet',
  verifiedAt: 'winlew.verify.verifiedAt',
};

function syncStoredSession() {
  try {
    const url = new URL(window.location.href);
    const session = url.searchParams.get('session') || "";
    const app = url.searchParams.get('app') || "mole";
    persistVerifyContext({ session, app });
  } catch {}
}

function setCookie(name, value, maxAgeSeconds = 86400) {
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax; Secure`;
  } catch {}
}

function persistVerifyContext({ session = "", app = "mole", wallet = "" } = {}) {
  try {
    if (session) {
      localStorage.setItem(SessionStore.session, session);
      sessionStorage.setItem(SessionStore.session, session);
      // NO COOKIE FOR THE SESSION. Nothing ever read it: every authenticated
      // route takes the token from the body, the X-WinLEW-Session header or
      // ?session=, and api-proxy.php forwards no cookies at all. It was a
      // bearer credential sitting in a third place for no benefit — and one
      // that rides along on requests that have no use for it.
    }
    if (app) {
      localStorage.setItem(SessionStore.app, app);
      sessionStorage.setItem(SessionStore.app, app);
      setCookie(SessionStore.app, app, 86400);
    }
    if (wallet) {
      localStorage.setItem(SessionStore.wallet, wallet);
      sessionStorage.setItem(SessionStore.wallet, wallet);
      setCookie(SessionStore.wallet, wallet, 86400);
    }
    localStorage.setItem(SessionStore.verifiedAt, new Date().toISOString());
  } catch {}
}

function buildProfileHref() {
  try {
    const url = new URL(window.location.href);
    const session = url.searchParams.get('session') || localStorage.getItem(SessionStore.session) || '';
    const app = url.searchParams.get('app') || localStorage.getItem(SessionStore.app) || 'mole';
    const wallet = (document.getElementById('wallet')?.value || localStorage.getItem(SessionStore.wallet) || '').trim();
    const profileUrl = new URL('/verify/profile.html', window.location.origin);
    if (session) profileUrl.searchParams.set('session', session);
    if (app) profileUrl.searchParams.set('app', app);
    if (wallet) profileUrl.searchParams.set('wallet', wallet);
    return profileUrl.toString();
  } catch {
    return '/verify/profile.html';
  }
}

// Shown proactively on load if there's no usable session, and again if a
// user manages to reach Generate/Verify without one (e.g. the URL's session
// expired mid-flow) — one visible recovery path instead of a dead-end alert
// with nothing to click. Reuses the server's existing Discord Linked Roles
// OAuth entrypoint (/linked-role/mole), which already mints a session and
// redirects back here — this page never had a self-serve way to start that
// flow, only documentation saying to go find the Discord bot link instead.
function showNoSessionBanner() {
  const el = $("noSessionBanner");
  if (el) el.style.display = "block";
}

function hasUsableSession() {
  // Storage-aware, not URL-only. The token is scrubbed from the address bar
  // immediately after pickup (see scrubSessionFromUrl), so a URL-only check
  // would declare every returning visitor logged out.
  return !!readSessionToken();
}

/** True when this page was opened from a hand-off link.
 *
 *  BOTH parameter names, deliberately. `?h=` is the desktop pairing link; the
 *  OAuth return added by da0dc2f arrives as `?handoff=<id>` (handoffRedirect()
 *  in src/mole/web.js). Only `h` was checked, so a SUCCESSFUL Discord return
 *  rendered the "no session, sign in with Discord" banner: link.js's
 *  DOMContentLoaded runs synchronously while wallet-auth's handleArrivalFromUrl()
 *  is async and yields before it can store the session. The page therefore told
 *  a user who had just signed in that they were signed out — an invitation to
 *  run the whole flow again, which on a phone is how people end up looping.
 */
function hasPendingHandoff() {
  const q = new URLSearchParams(window.location.search);
  return !!(q.get("h") || q.get("handoff"));
}

function wireProfileLinks() {
  const href = buildProfileHref();
  const nav = document.getElementById('profileNavLink');
  const card = document.getElementById('profileCardLink');
  if (nav) nav.href = href;
  if (card) card.href = href;
}
function setStatus(msg, cls) {
  const el = $("walletStatus");
  if (!el) return;
  el.classList.remove("ok", "warn", "bad");
  if (cls) el.classList.add(cls);
  el.textContent = msg;
}

// ---------- Solana Wallet Standard discovery ----------
// Jupiter's browser extension (and a growing set of newer Solana wallets)
// integrate via the Wallet Standard event handshake, NOT a legacy injected
// global like window.solana/window.jupiter — so getJupiter() below could
// never detect it before this, extension installed or not. Contract per
// the spec (github.com/wallet-standard/wallet-standard, packages/core/base/
// src/window.ts, verified 2026-07-25): a wallet dispatches
// "wallet-standard:register-wallet" with `detail` set to a callback the app
// must invoke with an API object exposing `register(wallet)`; the app also
// dispatches "wallet-standard:app-ready" with that same API directly as
// `detail`, so wallets that loaded before the app's listener attached can
// still register. Both directions are wired below so load order never
// matters.
const STANDARD_WALLETS = new Map(); // name -> raw Wallet Standard wallet object

function registerStandardWallet(wallet) {
  if (!wallet || !wallet.name) return () => {};
  STANDARD_WALLETS.set(wallet.name, wallet);
  return () => STANDARD_WALLETS.delete(wallet.name);
}

function initWalletStandard() {
  try {
    const appReadyApi = { register: registerStandardWallet };
    window.addEventListener("wallet-standard:register-wallet", (event) => {
      try { event.detail?.(appReadyApi); } catch {}
    });
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: appReadyApi }));
  } catch {}
}
initWalletStandard();

// Minimal base58 (Bitcoin/Solana alphabet) encoder — Wallet Standard
// accounts expose publicKey as raw bytes (Uint8Array), never a base58
// string or a @solana/web3.js PublicKey, and this page loads neither a
// base58 library nor web3.js. Verified byte-for-byte against the `bs58`
// package (already a project dependency, server-side) across randomized
// and leading-zero-byte cases before use here.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes) {
  if (!bytes || !bytes.length) return "";
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let out = BASE58_ALPHABET[0].repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

// Wraps a raw Wallet Standard wallet into the same connect()/publicKey/
// signMessage() shape every other provider in this file already exposes,
// so getProviderByKey()/connectWallet()/signMessage() need no branching for
// it. Only "usable" if it has both standard:connect and solana:signMessage
// — this flow never builds or sends a transaction, so nothing else here is
// required (matches the page's own "signature only" security note).
function adaptStandardWallet(wallet) {
  if (!wallet) return null;
  const connectFeature = wallet.features?.["standard:connect"];
  const signMessageFeature = wallet.features?.["solana:signMessage"];
  if (!connectFeature?.connect || !signMessageFeature?.signMessage) return null;

  const currentAccount = () => wallet.accounts?.[0] || null;

  return {
    isStandardWallet: true,
    standardWalletName: wallet.name,
    get publicKey() {
      const acc = currentAccount();
      if (!acc?.publicKey) return null;
      const address = base58Encode(acc.publicKey);
      return { toString: () => address, toBase58: () => address };
    },
    async connect() {
      const result = await connectFeature.connect();
      const acc = result?.accounts?.[0] || currentAccount();
      if (!acc?.publicKey) return { publicKey: null };
      const address = base58Encode(acc.publicKey);
      return { publicKey: { toString: () => address, toBase58: () => address } };
    },
    async signMessage(message) {
      const acc = currentAccount();
      if (!acc) throw new Error("wallet_standard_no_account");
      const [output] = await signMessageFeature.signMessage({ account: acc, message });
      return { signature: output.signature };
    },
  };
}

// First Wallet Standard wallet whose name contains `query` (case-insensitive) —
// used to find Jupiter's extension by name rather than a hardcoded identifier,
// since the spec has no fixed "id" field, only a human-readable `name`.
function findStandardWalletAdapterByName(query) {
  const needle = String(query || "").toLowerCase();
  for (const wallet of STANDARD_WALLETS.values()) {
    if (String(wallet.name || "").toLowerCase().includes(needle)) {
      const adapted = adaptStandardWallet(wallet);
      if (adapted) return adapted;
    }
  }
  return null;
}

function anyStandardWalletAdapter() {
  for (const wallet of STANDARD_WALLETS.values()) {
    const adapted = adaptStandardWallet(wallet);
    if (adapted) return adapted;
  }
  return null;
}

// ---------- Wallet detection ----------
function getPhantom() {
  const p = window?.solana;
  if (p && p.isPhantom && typeof p.connect === "function") return p;
  return null;
}

function getSolflare() {
  const p = window?.solflare;
  if (p && (p.isSolflare || p.isSolflare === true) && typeof p.connect === "function") return p;
  // some installs expose solflare via window.solana (multi-provider)
  const s = window?.solana;
  if (s && s.isSolflare && typeof s.connect === "function") return s;
  return null;
}

function getJupiter() {
  const j = window?.jupiter;
  if (j && typeof j.connect === "function") return j;
  // Jupiter's real browser extension registers via the Wallet Standard
  // handshake above, not window.jupiter — this is the path that actually
  // finds it on desktop (2026-07-25 fix).
  return findStandardWalletAdapterByName("jupiter");
}

// GeoWallet exposes its Solana surface at window.geowallet.solana
// (connect + signMessage), shaped like the standard injected Solana provider.
function getGeoWallet() {
  const g = window?.geowallet?.solana;
  if (g && typeof g.connect === "function" && typeof g.signMessage === "function") return g;
  return null;
}

function getAutoProvider() {
  // prefer window.solana if it supports signMessage
  const s = window?.solana;
  if (s && typeof s.connect === "function" && typeof s.signMessage === "function") return s;

  // fallback to GeoWallet / solflare / phantom / any Wallet-Standard wallet
  // (Jupiter's extension and others that don't inject a legacy global)
  return getGeoWallet() || getPhantom() || getSolflare() || anyStandardWalletAdapter() || null;
}

function getProviderByKey(key) {
  const k = String(key || "auto").toLowerCase();
  if (k === "phantom") return getPhantom();
  if (k === "solflare") return getSolflare();
  if (k === "jupiter") return getJupiter();
  if (k === "geowallet") return getGeoWallet();
  return getAutoProvider();
}

function providerLabel(provider) {
  if (!provider) return "Wallet";
  if (provider.isGeoWallet) return "Oxyon Wallet";
  if (provider.isPhantom) return "Phantom";
  if (provider.isSolflare) return "Solflare";
  if (provider.isJupiter) return "Jupiter";
  if (provider.isStandardWallet) return provider.standardWalletName || "Wallet";
  return "Wallet";
}

function isMobileDevice() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iOS "Request Desktop Website" rewrites the UA to look like macOS Safari but
  // can't fake touch hardware — a real Mac reports 0 touch points, a disguised
  // iPhone/iPad still reports several.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

// currentBrowseUrl() used to live here, returning window.location.href, and it
// was the DEFAULT argument of all three wallet-URL builders below. That default
// is what leaked: any call written as buildPhantomBrowseUrl() silently shipped
// the current URL — including ?session=<token> — to phantom.app. The helper is
// gone and the parameter is now required, so the leak cannot be reintroduced by
// omission, only deliberately.

function canonicalVerifyUrl() {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/index\.html$/, "");
  return url.toString();
}

function currentRefUrl() {
  return window.location.origin;
}

function buildPhantomBrowseUrl(url) {
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(currentRefUrl())}`;
}

function buildSolflareBrowseUrl(url) {
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(currentRefUrl())}`;
}

function buildGeoWalletBrowseUrl(url) {
  // Custom scheme (oxyon://) registered by the Oxyon Wallet mobile app; opens the URL inside
  // Oxyon Wallet's own in-app browser, which injects window.geowallet there.
  return `oxyon://browse?url=${encodeURIComponent(url)}`;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  }
}

function openWalletBrowser(key) {
  const k = String(key || SELECTED_WALLET || "phantom").toLowerCase();

  // Inside the native app, hand this to the shared implementation in
  // /assets/wallet-auth.js instead of setting location.href.
  //
  // Two things go wrong otherwise, and both were reported from a phone. First,
  // `window.location.href = 'https://phantom.app/ul/browse/…'` navigates the
  // WRAPPER'S OWN WebView to phantom.app — so the app stops being the app and
  // starts being a web page showing phantom.app, rather than the OS launching
  // the installed Phantom. Second, this path never registered a session
  // hand-off, so even a successful signature over there had no way back and the
  // app stayed signed out.
  //
  // The shared version does both: registers the hand-off, tags the URL it hands
  // the wallet, and leaves via Browser.open() so the OS resolves the universal
  // link into the real wallet app. It targets window.location.href exactly as
  // currentBrowseUrl() does here, so the destination is unchanged.
  //
  // Jupiter is left alone — it has no browse URL and works by copy/paste.
  const shared = window.WinLEWAuth && window.WinLEWAuth.openMobileWalletBrowser;
  if (typeof shared === 'function' && k !== 'jupiter') {
    shared(k === 'auto' ? 'phantom' : k);
    return;
  }

  // Every branch below used to default to currentBrowseUrl() === location.href,
  // which on /verify/?session=<token> handed the live token to phantom.app /
  // solflare.com, or onto the clipboard for Jupiter. Now each one gets a
  // single-use DIRECT hand-off id and no query string of ours. Fails closed:
  // falling back to location.href on error would restore the leak silently.
  mobileWalletTarget().then((target) => {
    if (!target) return;
    if (k === "geowallet") { window.location.href = buildGeoWalletBrowseUrl(target); return; }
    if (k === "solflare") { window.location.href = buildSolflareBrowseUrl(target); return; }
    if (k === "jupiter") {
      copyText(target).then((ok) => {
        setStatus(ok ? "📋 Hand-off link copied. Open Jupiter Mobile and paste it into its browser/search — it expires in two minutes." : "Copy the link manually into Jupiter Mobile.", ok ? "ok" : "warn");
      });
      return;
    }
    window.location.href = buildPhantomBrowseUrl(target);
  });
}

/**
 * A same-path URL carrying a single-use DIRECT hand-off id, for opening inside
 * a mobile wallet's in-app browser (a separate storage context, so it needs its
 * own authority). Returns "" and explains itself if the hand-off can't be
 * started — never the current URL, which is what used to leak.
 *
 * In practice this runs for JUPITER ONLY. openWalletBrowser() delegates
 * phantom/solflare/geowallet to wallet-auth.js's openMobileWalletBrowser()
 * whenever that shared function exists — which is always, since every page
 * loads it — and explicitly excludes jupiter because Jupiter has no browse URL
 * and works by copy/paste. Confirmed by driving a real headless browser: the
 * Phantom click never reaches this function.
 *
 * It is still fixed rather than deleted, because "the shared helper is always
 * there" is an assumption about load order and script availability, and the
 * fallback must not be the leaking one on the day that assumption breaks.
 */
async function mobileWalletTarget() {
  const session = readSessionToken();
  const url = new URL(window.location.pathname, window.location.origin);
  if (!session) return url.toString();
  try {
    const out = await api("/api/verify/handoff/start", {
      method: "POST",
      body: JSON.stringify({ session, mode: "direct" }),
    });
    url.searchParams.set("h", out.handoffId);
    return url.toString();
  } catch (error) {
    setStatus(friendlyHandoffError(error), "warn");
    return "";
  }
}

// The real signal that matters is "no provider was found," not a guess about
// device type. isMobileDevice()'s UA sniffing is fooled by a mobile browser's
// "Desktop site" mode (drops "Mobile"/"Android" from the UA, doesn't match
// the Macintosh+touch iOS case either) — on a real phone with desktop mode
// on, that misfire used to send someone straight into a dead-end
// alert("install the extension...") even though extensions don't exist on
// mobile at all. Revealing the existing any-wallet picker on FAILURE,
// unconditionally, sidesteps the unreliable guess entirely — it's correct
// whether isMobileDevice() got it right or not, and whether the device is
// phone, tablet, or a desktop with no extension installed.
function revealWalletPicker(explicitReason) {
  const wrap = $("mobileWalletActions");
  if (!wrap) {
    alert("Wallet not detected. Install Phantom/Solflare/Oxyon Wallet, or use the Jupiter handoff path, then refresh.");
    return;
  }
  wrap.style.display = "block";
  wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  setStatus(
    explicitReason ||
      "No wallet extension or app detected automatically here — including if this browser is in \"Desktop site\" mode, which hides mobile wallet apps from the page. Pick a wallet below to open it directly.",
    "warn"
  );
}

function wireMobileButtons() {
  const geoWalletBtn = $("btnOpenGeoWallet");
  if (geoWalletBtn) geoWalletBtn.addEventListener("click", () => openWalletBrowser("geowallet"));

  const phantomBtn = $("btnOpenPhantom");
  if (phantomBtn) phantomBtn.addEventListener("click", () => openWalletBrowser("phantom"));

  const solflareBtn = $("btnOpenSolflare");
  if (solflareBtn) solflareBtn.addEventListener("click", () => openWalletBrowser("solflare"));

  const jupiterBtn = $("btnOpenJupiter");
  if (jupiterBtn) jupiterBtn.addEventListener("click", () => openWalletBrowser("jupiter"));

  const wrap = $("mobileWalletActions");
  if (!wrap) return;

  if (isMobileDevice()) {
    wrap.style.display = "block";
    if (!getAutoProvider()) {
      setStatus("📱 Mobile detected. Open this page inside Oxyon Wallet, Phantom, or Solflare, or copy it into Jupiter Mobile.", "warn");
    }
  } else {
    wrap.style.display = "none";
  }
}

// ---------- UI state ----------
let SELECTED_WALLET = "auto"; // default path favors the active wallet on this device

function getInstructionHtml(key) {
  const k = String(key || "phantom").toLowerCase();
  if (k === "geowallet") return "<strong>Oxyon Wallet</strong><br/>Desktop: use the Oxyon Wallet extension if installed.<br/>Mobile: tap <em>Open in Oxyon Wallet</em> so this verify page opens in Oxyon Wallet's in-app browser.";
  if (k === "solflare") return "<strong>Solflare</strong><br/>Desktop: use the Solflare extension if installed.<br/>Mobile: tap <em>Open in Solflare</em> so this verify page opens in Solflare's in-app browser.";
  if (k === "jupiter") return "<strong>Jupiter Mobile</strong><br/>Use the desktop-to-phone QR or copy the verify link into Jupiter Mobile's browser/search, then connect and sign there.";
  if (k === "auto") return "<strong>Auto-detect</strong><br/>Best when you already have one wallet extension/browser provider active on this device.";
  return "<strong>Phantom</strong><br/>Desktop: use the Phantom extension.<br/>Mobile: tap <em>Open in Phantom</em> so this verify page opens in Phantom's in-app browser.";
}

function updateWalletInstructions(key) {
  const el = $("walletInstructionText");
  if (!el) return;
  el.innerHTML = getInstructionHtml(key);
}

/** The app key, same precedence as the session token. */
function readAppKey() {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get("app");
    return fromUrl || localStorage.getItem(SessionStore.app) || "mole";
  } catch {
    return "mole";
  }
}

/**
 * Takes the session token out of the address bar once it has been stored.
 *
 * Discord hands out /verify/?session=<token>, and until now that URL simply
 * stayed there — in the address bar, in browser history, in any screenshot of
 * the page, in the shared host's access log, and in anything the user copied
 * and pasted to ask for help. The token is a bearer credential: whoever holds
 * it inside its life can link THEIR wallet to the account.
 *
 * Everything on this page now reads the token through readSessionToken(), which
 * prefers the URL and falls back to storage — so removing it from the URL after
 * syncStoredSession() has persisted it changes nothing functionally.
 *
 * replaceState rather than pushState: the goal is that the credential-bearing
 * URL never becomes a history entry the user can navigate back to.
 *
 * This used to note that API calls still travelled as ?session=, because
 * /verify/api-proxy.php built a fresh header list and dropped anything the
 * browser sent — deliberately, so a browser cannot spoof X-WinLEW-Proxy-Secret
 * — and that changing that file was blocked with no PHP parser available here.
 *
 * Both parts are resolved as of 2026-08-13. php-cli was installed, the proxy
 * now forwards exactly one browser header (X-WinLEW-Session, validated), and
 * every API call site dropped ?session= in favour of it. The session reaching
 * this page in the URL, and being scrubbed here, is now the only place a token
 * touches a URL at all. See WINLEW_PUBLIC_CONTENT_AUDIT.md #26 and #28.
 */
function scrubSessionFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("session")) return;
    url.searchParams.delete("session");
    window.history.replaceState({}, "", url.toString());
  } catch { /* older browser: leaving the URL alone is the safe failure */ }
}

// The session token, wherever it currently lives. The page's own flow still
// reads it straight out of the query string (see getChallenge/verifyAndSync),
// so the URL is the primary source; storage is the fallback for a reload.
function readSessionToken() {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get("session");
    return fromUrl || localStorage.getItem(SessionStore.session) || "";
  } catch {
    return "";
  }
}

// ── Desktop → phone hand-off ────────────────────────────────────────────────
//
// This panel used to hand out canonicalVerifyUrl(), which keeps the query
// string — so the "verify link" WAS `/verify/?session=<live token>`. The panel
// even said "treat this link like a password… never paste it into a chat, a
// ticket, or a screenshot", while the two buttons beside it did exactly that:
// buildPhantomBrowseUrl() wraps the URL into `https://phantom.app/ul/browse/…`
// and Solflare's equivalent, which are real HTTPS requests to those companies.
// The token travelled in the path of a third-party request and landed in a
// third party's logs. Same leak as the QR code removed in August 2026 for
// handing the token to api.qrserver.com — that fix caught the picture and
// missed the buttons next to it.
//
// Now the link carries a hand-off id and nothing else, and the six-digit
// pairing code that redeems it is shown only on this screen. See
// src/mole/webHandoff.js. THE RULE FOR ANY FUTURE EDIT HERE: build the link
// from window.location.origin, never from location.href — the moment this
// reads the current URL, whatever is in the query string ships with it.
let HANDOFF = null;
let HANDOFF_POLL = null;

function handoffUrlFor(handoffId) {
  const url = new URL("/verify/", window.location.origin);
  url.searchParams.set("h", handoffId);
  return url.toString();
}

function setHandoffMessage(text, cls) {
  const el = $("handoffMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = cls ? `note ${cls}` : "note";
  el.style.display = text ? "block" : "none";
}

function stopHandoffPolling() {
  if (HANDOFF_POLL) { clearInterval(HANDOFF_POLL); HANDOFF_POLL = null; }
}

function renderHandoff(active) {
  const panel = $("handoffActive");
  const startWrap = $("handoffStart");
  if (panel) panel.style.display = active ? "block" : "none";
  if (startWrap) startWrap.style.display = active ? "none" : "block";
}

async function createHandoff() {
  const session = readSessionToken();
  if (!session) {
    showNoSessionBanner();
    setHandoffMessage("No active session. Use “Verify with Discord” above to start one, then try again.", "warn");
    return;
  }
  const btn = $("btnCreateHandoff");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }
  try {
    const out = await api("/api/verify/handoff/start", {
      method: "POST",
      body: JSON.stringify({ session }),
    });
    HANDOFF = { id: out.handoffId, code: out.pairingCode, expiresAt: Number(out.expiresAt || 0) };

    const url = handoffUrlFor(HANDOFF.id);
    const input = $("handoffLink");
    if (input) input.value = url;
    const codeEl = $("handoffCode");
    if (codeEl) codeEl.textContent = `${HANDOFF.code.slice(0, 3)} ${HANDOFF.code.slice(3)}`;

    renderHandoff(true);
    setHandoffMessage("Waiting for your phone…", "");
    startHandoffPolling();
  } catch (error) {
    setHandoffMessage(friendlyHandoffError(error), "warn");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Create hand-off link"; }
  }
}

function startHandoffPolling() {
  stopHandoffPolling();
  HANDOFF_POLL = setInterval(async () => {
    if (!HANDOFF) return stopHandoffPolling();
    if (HANDOFF.expiresAt && Date.now() / 1000 > HANDOFF.expiresAt) {
      stopHandoffPolling();
      setHandoffMessage("This hand-off expired. Create a new one if you still need it.", "warn");
      renderHandoff(false);
      HANDOFF = null;
      return;
    }
    try {
      const out = await api("/api/verify/handoff/peek", {
        method: "POST",
        body: JSON.stringify({ handoffId: HANDOFF.id, pairingCode: HANDOFF.code }),
      });
      if (out.status === "claimed") {
        stopHandoffPolling();
        // Deliberately worded so a user who did NOT just do this on their own
        // phone recognises it as someone else having used the link.
        setHandoffMessage("✅ Opened on a phone. If that wasn't you, disconnect and start a new session.", "ok");
      } else if (out.status === "expired") {
        stopHandoffPolling();
        setHandoffMessage("This hand-off expired. Create a new one if you still need it.", "warn");
        renderHandoff(false);
        HANDOFF = null;
      }
    } catch { /* transient; the expiry check above is the backstop */ }
  }, 4000);
}

function friendlyHandoffError(error) {
  const msg = String(error?.message || error || "");
  if (/session_invalid|session_required/.test(msg)) return "Your session has expired. Start a fresh one with “Verify with Discord” above.";
  if (/pairing_code_mismatch/.test(msg)) return "That code doesn't match. Check the six digits on your computer screen.";
  if (/handoff_already_claimed/.test(msg)) return "This link has already been used. Create a new hand-off on your computer.";
  if (/handoff_not_found|handoff_expired/.test(msg)) return "This link has expired. Create a new hand-off on your computer.";
  if (/HTTP 429|rate/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  return "Hand-off failed. Please try again.";
}

function updateDesktopHandoff() {
  const wrap = $("desktopHandoff");
  if (!wrap) return;
  if (isMobileDevice()) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  renderHandoff(false);

  $("btnCreateHandoff")?.addEventListener("click", createHandoff);
  $("btnCopyHandoff")?.addEventListener("click", async () => {
    if (!HANDOFF) return;
    const ok = await copyText(handoffUrlFor(HANDOFF.id));
    setStatus(ok ? "📋 Hand-off link copied. The six-digit code stays on this screen." : "Copy failed. Long-press the link field and copy it manually.", ok ? "ok" : "warn");
  });
  // Safe to hand these to Phantom/Solflare now: the URL carries only the
  // hand-off id, which redeems nothing without the code.
  $("btnOpenHandoffPhantom")?.addEventListener("click", () => {
    if (HANDOFF) window.open(buildPhantomBrowseUrl(handoffUrlFor(HANDOFF.id)), "_blank", "noopener,noreferrer");
  });
  $("btnOpenHandoffSolflare")?.addEventListener("click", () => {
    if (HANDOFF) window.open(buildSolflareBrowseUrl(handoffUrlFor(HANDOFF.id)), "_blank", "noopener,noreferrer");
  });
}

// ── Phone side: /verify/?h=<id> ─────────────────────────────────────────────
// The link on its own proves nothing, so the arriving device is asked for the
// code showing on the computer that made it.
function initHandoffClaim() {
  let handoffId = "";
  try { handoffId = new URL(window.location.href).searchParams.get("h") || ""; } catch {}
  if (!handoffId) return;

  const panel = $("handoffClaim");
  if (!panel) return;
  panel.style.display = "block";

  const submit = async () => {
    const code = ($("handoffClaimCode")?.value || "").trim();
    if (!code) return;
    const btn = $("btnClaimHandoff");
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    try {
      const out = await api("/api/verify/handoff/claim", {
        method: "POST",
        body: JSON.stringify({ handoffId, pairingCode: code }),
      });
      persistVerifyContext({ session: out.session, app: "mole" });
      // Replace the URL with a real session URL: the page's own flow still
      // reads ?session= from the query string, and this also drops ?h= so a
      // reload can't try to re-claim a hand-off that is now spent.
      const next = new URL("/verify/", window.location.origin);
      next.searchParams.set("session", out.session);
      next.searchParams.set("app", "mole");
      window.location.replace(next.toString());
    } catch (error) {
      setHandoffClaimMessage(friendlyHandoffError(error), "warn");
      if (btn) { btn.disabled = false; btn.textContent = "Continue"; }
    }
  };

  $("btnClaimHandoff")?.addEventListener("click", submit);
  $("handoffClaimCode")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

function setHandoffClaimMessage(text, cls) {
  const el = $("handoffClaimMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = cls ? `note ${cls}` : "note";
  el.style.display = text ? "block" : "none";
}

function setSelectedWallet(key) {
  SELECTED_WALLET = key;

  document.querySelectorAll(".walletTile").forEach((btn) => {
    const on = btn.getAttribute("data-provider") === key;
    btn.classList.toggle("active", on);
  });

  updateWalletInstructions(key);

  const p = getProviderByKey(key);
  if (!p) {
    if (String(key).toLowerCase() === "jupiter") {
      setStatus("Jupiter handoff selected. Use the QR or copy-link flow, then continue inside Jupiter Mobile.", "ok");
      return;
    }
    const missing = isMobileDevice()
      ? `⚠️ ${key.toUpperCase()} is not available in this browser. Open this page inside the wallet app.`
      : `⚠️ ${key.toUpperCase()} not detected. Use Connect wallet for auto-detect, or install the wallet extension and refresh.`;
    setStatus(missing, "warn");
    return;
  }
  setStatus(`Manual wallet selected: ${providerLabel(p)}`, "ok");
}

function updateDetectTags() {
  const setTag = (id, ok, textOk, textBad) => {
    const el = $(id);
    if (!el) return;
    el.textContent = ok ? textOk : textBad;
  };
  setTag("tag_geowallet", !!getGeoWallet(), "Detected", "Not found");
  setTag("tag_phantom", !!getPhantom(), "Detected", "Not found");
  setTag("tag_solflare", !!getSolflare(), "Detected", "Not found");
  setTag("tag_jupiter", !!getJupiter(), "Detected", "Handoff ready");
  setTag("tag_auto", !!getAutoProvider(), "Recommended", "Auto detect");
}

// ---------- Flow ----------
async function connectWallet() {
  // Only fall back to the copy-link mobile handoff when there's no real
  // Jupiter provider to connect to — a Jupiter extension detected via
  // Wallet Standard (getJupiter(), 2026-07-25) should connect normally like
  // any other wallet, not skip straight to "copy this link" every time.
  if (String(SELECTED_WALLET).toLowerCase() === "jupiter" && !getJupiter()) {
    openWalletBrowser("jupiter");
    return;
  }
  const provider = getProviderByKey(SELECTED_WALLET);
  if (!provider) {
    revealWalletPicker();
    return;
  }

  try {
    setStatus("Connecting…", "warn");
    const resp = await provider.connect({ onlyIfTrusted: false });
    const pubkey =
      resp?.publicKey?.toString?.() ||
      provider.publicKey?.toString?.() ||
      resp?.publicKey?.toBase58?.() ||
      provider.publicKey?.toBase58?.();

    if (pubkey) $("wallet").value = pubkey;
    persistVerifyContext({ wallet: pubkey || "" });
    wireProfileLinks();
    setStatus(pubkey ? `✅ Connected: ${pubkey}` : "✅ Connected", "ok");
  } catch (e) {
    setStatus("❌ Connect failed.", "bad");
    alert(`Connect failed: ${e?.message || e}`);
  }
}

async function getChallenge() {
  const btn = $("btnChallenge");
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const session = readSessionToken();
    const app = readAppKey();
    const wallet = $("wallet").value.trim();

    if (!session) {
      showNoSessionBanner();
      alert("Session missing/expired. Use the \"Verify with Discord\" button above to start a fresh session, then try again.");
      return;
    }
    if (!wallet) {
      alert("Connect your wallet first.");
      return;
    }

    const data = await api("/api/wallet/challenge", {
      method: "POST",
      body: JSON.stringify({ session, app, wallet }),
    });

    $("challengeBox").innerHTML = `<pre>${escapeHtml(data.message || "")}</pre><div class="muted" style="margin-top:8px;">Expires at: ${escapeHtml(data.expires_at || "—")}</div>`;
    $("message").value = data.message || "";
    $("btnSign").disabled = false;

    setStatus("Challenge generated. Next: sign it.", "ok");
  } catch (e) {
    setStatus("❌ Challenge failed.", "bad");
    alert(`Challenge failed: ${e?.message || e}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "🧾 Generate challenge";
  }
}

async function signMessage() {
  const provider = getProviderByKey(SELECTED_WALLET);
  if (!provider) {
    revealWalletPicker();
    return;
  }

  const msg = $("message").value;
  if (!msg) {
    alert("Generate a challenge first.");
    return;
  }

  if (typeof provider.signMessage !== "function") {
    alert("This wallet provider doesn't support message signing in this context. Try a different wallet.");
    return;
  }

  const btn = $("btnSign");
  btn.disabled = true;
  btn.textContent = "Signing…";

  try {
    if (!provider.publicKey) await provider.connect({ onlyIfTrusted: false });

    const pubkey =
      provider.publicKey?.toString?.() ||
      provider.publicKey?.toBase58?.() ||
      null;

    if (pubkey) $("wallet").value = pubkey;

    const encoded = new TextEncoder().encode(msg);
    const signed = await provider.signMessage(encoded, "utf8");

    // Most providers return { signature: Uint8Array, publicKey: ... }
    const sigBytesRaw = signed?.signature;
    const sigBytes =
      sigBytesRaw instanceof Uint8Array
        ? sigBytesRaw
        : Uint8Array.from(sigBytesRaw || []);

    if (sigBytes.length !== 64) {
      throw new Error(`unexpected_signature_length:${sigBytes.length}`);
    }

    $("signature").value = JSON.stringify(Array.from(sigBytes));
    setStatus(`✅ Signed with ${providerLabel(provider)}`, "ok");
  } catch (e) {
    setStatus("❌ Sign failed.", "bad");
    alert(`Sign failed: ${e?.message || e}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "✍️ Sign message";
  }
}

async function verifyAndSync() {
  const wallet = $("wallet").value.trim();
  const signature = $("signature").value.trim();
  const message = $("message").value.replace(/\r\n/g, "\n");

  if (!wallet || !signature || !message) {
    alert("Wallet, signature, and message are required.");
    return;
  }

  const session = readSessionToken();
  const app = readAppKey();

  if (!session) {
    showNoSessionBanner();
    alert("Session missing/expired. Use the \"Verify with Discord\" button above to start a fresh session, then try again.");
    return;
  }

  const btn = $("btnVerify");
  btn.disabled = true;
  btn.textContent = "Verifying…";

  try {
    const pushed = await api("/api/wallet/link", {
      method: "POST",
      body: JSON.stringify({ session, app, wallet, signature, message }),
    });

    persistVerifyContext({ session, app, wallet });
    wireProfileLinks();
    const profileHref = buildProfileHref();

    $("resultBox").innerHTML =
      `<div class="ok" style="font-weight:950;">✅ Wallet verified</div>` +
      `<div class="muted" style="margin-top:6px;line-height:1.6;">Your wallet ownership check is complete and your Discord roles are syncing now. Updates usually appear within about 10–30 seconds.</div>` +
      `<div style="margin-top:12px;"><a class="btn" href="${escapeHtml(profileHref)}">Open profile</a></div>`;

    const saved = $("savedWalletValue");
    if (saved) saved.textContent = wallet;
    setStatus("✅ Verification complete. Check Discord for role updates.", "ok");
  } catch (e) {
    const code = String(e?.message || "");

    // THE ONE THAT SENT PEOPLE IN CIRCLES. Both of these mean "your session is
    // real, it just isn't rooted in a Discord account" — a wallet-only or
    // X-only sign-in. The page used to alert the bare string
    // "Verify failed: no_oauth_tokens", which reads as a site fault and gives
    // the user nothing to do. Since the identity layer landed, connecting a
    // wallet before attaching Discord is a normal way to arrive here, and
    // attaching Discord is the entire remedy.
    if (code === "discord_not_attached" || code === "no_oauth_tokens") {
      const connectUrl = e?.payload?.connectUrl
        ? `/verify/?connect=${encodeURIComponent(readAppKey())}`
        : `/verify/?connect=mole`;
      setStatus("🔗 Attach Discord to finish syncing your roles.", "warn");
      $("resultBox").innerHTML =
        `<div style="font-weight:950;">🔗 One more step — attach Discord</div>` +
        `<div class="muted" style="margin-top:6px;line-height:1.6;">You are signed in with your wallet, so your wallet is saved. Discord roles are granted by Discord, so this account needs a Discord login attached before the roles can sync. Nothing you have done is lost.</div>` +
        `<div style="margin-top:12px;"><a class="btn" href="${escapeHtml(connectUrl)}">Attach Discord</a></div>`;
      return;
    }

    setStatus("❌ Verify failed.", "bad");
    alert(`Verify failed: ${code || e}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "✅ Verify & Sync Roles";
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", () => {
  syncStoredSession();
  // Persist before scrubbing. This ordering is defensive rather than
  // load-bearing, and it is worth knowing why: wallet-auth.js is loaded first
  // by this page and its own getAuth() already writes the URL's session to
  // 'winlew.verify.session' — the SAME key syncStoredSession() uses. So two
  // independent paths persist it, and swapping these two lines does not
  // actually log anyone out (verified by deliberately swapping them).
  //
  // Kept in this order anyway: link.js must not depend on another file having
  // run first, and a future page that loads link.js alone would break silently
  // if it did.
  scrubSessionFromUrl();
  wireProfileLinks();
  initHandoffClaim();
  // A device arriving on a hand-off link legitimately has no session yet —
  // the claim panel above IS its recovery path, so the "no session" banner
  // would only be a second, wrong instruction.
  if (!hasUsableSession() && !hasPendingHandoff()) showNoSessionBanner();
  // wallet tiles
  document.querySelectorAll(".walletTile").forEach((btn) => {
    btn.addEventListener("click", () => setSelectedWallet(btn.getAttribute("data-provider")));
  });

  // actions
  $("btnConnect")?.addEventListener("click", connectWallet);
  $("btnChallenge")?.addEventListener("click", getChallenge);
  $("btnSign")?.addEventListener("click", signMessage);
  $("btnVerify")?.addEventListener("click", verifyAndSync);

  updateDetectTags();
  wireMobileButtons();
  updateDesktopHandoff();

  const useSaved = $("btnUseSavedWallet");
  if (useSaved) useSaved.addEventListener("click", () => {
    const current = $("savedWalletValue");
    if (current) {
      $("wallet").value = current.textContent.trim();
      setStatus("Using the saved wallet on file. You can still connect a different wallet if you want to replace it.", "ok");
    }
  });

  const clearBtn = $("btnClearWalletInput");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    $("wallet").value = "";
    $("signature").value = "";
    setStatus("Saved wallet cleared. Connect a wallet, generate a fresh challenge, sign, and verify.", "warn");
  });

  // default selection: auto-detect first; manual selection stays available as backup
  setSelectedWallet("auto");

  // refresh detection tags periodically (wallet installed after load)
  setInterval(updateDetectTags, 2000);
});
