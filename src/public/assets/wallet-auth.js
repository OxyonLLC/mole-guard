// Shared wallet-connect + session layer for winlew.co. Loaded as a plain
// classic <script> (no bundler/module system on this static site — same
// constraint nav.js already works within), so everything is exposed on
// window.WinLEWAuth rather than via ES `export`.
//
// This consolidates what were four to five near-duplicate copies of the same
// logic (Mole Hub, Faucet, Quiz, Verify's profile signing, and an orphaned
// unreferenced copy at /link.js) into one source of truth: which wallet
// providers are installed, how to open a mobile deep-link picker when none
// are, how to reach the API on both Node-direct and winlew.co shared-hosting
// deployments, and where the shared session lives.
//
// What this file deliberately does NOT do: the /verify/ page's own
// OAuth-style linked-roles flow (link.js) solves a different problem —
// establishing a brand-new Discord<->wallet link, with a desktop-to-phone QR
// handoff — and keeps its own flow. It still uses the shared
// provider-detection/picker primitives below for wallet *selection*, just
// not the shared walletLogin()/session flow, since it isn't signing into an
// existing session. (Correction 2026-07-28: this comment previously claimed
// link.js also does SNS resolution — it never has; only the Discord bot did,
// until src/mole/solana.js's resolveWalletSnsName() extended it to the
// Dashboard's own wallet display this same day.)
(function () {
  'use strict';

  // ── Shared localStorage keys ────────────────────────────────────────────
  // Standardized on the winlew.verify.* namespace, which /verify/ and Mole
  // Hub already used — Faucet and Quiz previously wrote the wallet display
  // cache under a separate winlew.hub.wallet key. Read both during the
  // migration window so a session established before this change still
  // shows a wallet label instead of just "Connected ✓" on first load.
  const AuthKeys = {
    session: 'winlew.verify.session',
    app: 'winlew.verify.app',
    wallet: 'winlew.verify.wallet',
    // 'discord' | 'wallet'. The nav needs to know whether a session is backed
    // by a real Discord account or is an anonymous wallet-only one, so it can
    // show the sign-in control to the people who still need it. The server
    // already tells us: a wallet-only identity is `wallet:<sha256>`.
    identity: 'winlew.verify.identity',
  };
  const LEGACY_WALLET_KEY = 'winlew.hub.wallet';

  /**
   * Where a session token in the ADDRESS BAR is still honoured.
   *
   * It used to be honoured everywhere, on every page. A session is a bearer
   * credential, so `winlew.co/home/?session=<attacker's token>` was enough to
   * put someone else's browser into the attacker's account — after which the
   * victim's play, claims and connected wallet all accrue to an account whose
   * payout wallet the attacker controls. The scrub that takes the token out of
   * the bar afterwards never addressed that; it removed the token from history,
   * not from the threat.
   *
   * Sessions now arrive by one-time hand-off instead (see claimPendingHandoff),
   * bound to a secret the receiving tab made before the round trip began. This
   * list is what remains for flows that cannot carry one: the /link bookmark,
   * and a stale cached nav.js whose sign-in POST predates the binding. Both land
   * on /verify/, which is why /verify/ is the only entry left.
   *
   * TO CLOSE THE LAST OF IT: once cached copies of nav.js have rolled over
   * (they are served by the shared host, so give it a week), set this to an
   * empty array. The flow does not need it — it is here so an old cache does
   * not strand anyone mid-sign-in.
   */
  const ACCEPT_URL_SESSION_PATHS = ['/verify/'];

  function urlSessionIsAcceptableHere() {
    try {
      const here = window.location.pathname;
      return ACCEPT_URL_SESSION_PATHS.some((prefix) => here === prefix || here.startsWith(prefix));
    } catch { return false; }
  }

  function getAuth() {
    const url = new URL(window.location.href);
    const s = urlSessionIsAcceptableHere() ? url.searchParams.get('session') : null;
    const a = url.searchParams.get('app');
    if (s) localStorage.setItem(AuthKeys.session, s);
    if (a) localStorage.setItem(AuthKeys.app, a);
    return {
      session: s || localStorage.getItem(AuthKeys.session) || '',
      app: a || localStorage.getItem(AuthKeys.app) || 'mole',
    };
  }

  // ── OAuth hand-off: the secret that never leaves this tab ────────────────
  //
  // Before starting a round trip the browser invents a secret, keeps it in
  // sessionStorage (per-tab, and it survives the trip out to Discord/X and
  // back), and sends only its SHA-256 to the server. The callback deposits the
  // new session against that hash and returns an id in the URL. Only a tab
  // holding the matching secret can redeem it.
  //
  // sessionStorage rather than localStorage on purpose: the secret is worthless
  // after one redemption and has no business outliving the tab that made it.
  const HANDOFF_SECRET_KEY = 'winlew.verify.handoffSecret';

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Mint a claim for a flow about to start. Returns the hash to send, or ''
   *  when the browser cannot do this — an http:// origin has no crypto.subtle,
   *  and the server falls back to its old behaviour rather than refusing. */
  async function newOAuthClaim() {
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      const hash = await sha256Hex(secret);
      sessionStorage.setItem(HANDOFF_SECRET_KEY, secret);
      return hash;
    } catch (error) {
      console.warn('[wallet-auth] could not mint a hand-off claim:', error);
      return '';
    }
  }

  /** Redeem a `?handoff=` the callback left in the URL. Silent when there is
   *  nothing to redeem, or when this tab holds no matching secret — which is
   *  exactly what happens to someone sent an attacker's hand-off link. */
  async function claimPendingHandoff() {
    let id = '';
    let secret = '';
    try {
      id = new URL(window.location.href).searchParams.get('handoff') || '';
      secret = sessionStorage.getItem(HANDOFF_SECRET_KEY) || '';
    } catch { return false; }
    if (!id) return false;
    if (!secret) {
      console.warn('[wallet-auth] a hand-off arrived for a tab that never started one — ignored.');
      scrubHandoffFromUrl();
      return false;
    }

    try {
      const res = await fetch(hubApiUrl('/api/hub/native-handoff/claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffId: id, claimSecret: secret }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok && data.session) {
        localStorage.setItem(AuthKeys.session, data.session);
        sessionStorage.removeItem(HANDOFF_SECRET_KEY);
        clearIdleNotice();
        return true;
      }
      console.warn('[wallet-auth] hand-off could not be claimed:', data && data.error);
    } catch (error) {
      console.warn('[wallet-auth] hand-off claim failed:', error);
    } finally {
      scrubHandoffFromUrl();
    }
    return false;
  }

  function scrubHandoffFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('handoff')) return;
      url.searchParams.delete('handoff');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    } catch { /* the token is single-use; a tidy URL is a nicety */ }
  }

  function getCachedWallet() {
    return localStorage.getItem(AuthKeys.wallet) || localStorage.getItem(LEGACY_WALLET_KEY) || '';
  }

  function setCachedWallet(wallet) {
    localStorage.setItem(AuthKeys.wallet, wallet);
    localStorage.removeItem(LEGACY_WALLET_KEY);
  }

  function clearSession() {
    localStorage.removeItem(AuthKeys.session);
    localStorage.removeItem(AuthKeys.app);
    localStorage.removeItem(AuthKeys.wallet);
    localStorage.removeItem(AuthKeys.identity);
    localStorage.removeItem(LEGACY_WALLET_KEY);
  }

  // ── API base ─────────────────────────────────────────────────────────────
  // On the winlew.co shared-hosting domain there is no direct route to the
  // Node backend at /api/* — only /verify/api-proxy.php (forwarding to the
  // active ngrok tunnel) is reachable. Direct fetch('/api/...') works in
  // local/Docker testing (Node serves /api itself there) but 404s in
  // production; every app must route through hubApiFetch() instead.
  const HUB_API_BASE = (function () {
    const onSharedHost = /^(?:www\.)?winlew\.co$/i.test(window.location.hostname || '');
    const configured = window.WINLEW_API_BASE
      || document.documentElement.getAttribute('data-api-base')
      || (onSharedHost ? '/verify/api-proxy.php' : '');
    if (!window.WINLEW_API_BASE && !onSharedHost) return '';
    return String(configured).replace(/\/$/, '');
  })();

  function hubApiUrl(path) {
    const rawPath = String(path || '');
    if (!HUB_API_BASE) return rawPath;
    if (!/api-proxy\.php(?:$|\?)/i.test(HUB_API_BASE)) return `${HUB_API_BASE}${rawPath}`;

    const [pathnamePart, queryPart = ''] = rawPath.split('?');
    const cleanPath = pathnamePart.startsWith('/') ? pathnamePart : `/${pathnamePart}`;
    const url = new URL(HUB_API_BASE, window.location.origin);
    url.searchParams.set('path', cleanPath);
    const extra = new URLSearchParams(queryPart);
    for (const [key, value] of extra.entries()) url.searchParams.append(key, value);
    return url.toString();
  }

  /**
   * The header every authenticated API call travels in.
   *
   * Sessions used to be passed as `?session=<token>` on the URL. That put the
   * token in the address bar, in browser history, in the shared host's access
   * log, and in this backend's own log file — the same credential-in-a-URL
   * class that also leaked it to phantom.app twice. A header goes in none of
   * those places.
   *
   * Attached centrally rather than at each call site so that a new API call
   * cannot forget it, and so that removing `?session=` from the ~16 places that
   * built it is a deletion rather than a migration.
   */
  const SESSION_HEADER = 'x-winlew-session';

  /**
   * Deploy-safety latch for the header→query-string migration.
   *
   * The header only reaches the backend if winlew.co's /verify/api-proxy.php
   * forwards it, and that file is uploaded by hand, separately from these
   * assets. This host has served stale assets before, so "both halves are live"
   * is not something to assume — and with `?session=` now deleted from the call
   * sites, a proxy that drops the header would authenticate nobody.
   *
   * So instead of depending on upload order, we detect. A 401 on a request that
   * carried the header means the header did not arrive; retry that one request
   * with `?session=` and, ONLY IF THAT SUCCEEDS, latch so the rest of the page
   * load skips the doomed first attempt.
   *
   * Latching on success rather than on the 401 is the important detail: an
   * ordinarily expired session also returns 401, and latching on that would put
   * the token back into URLs for the rest of the page over nothing.
   */
  let sessionQueryFallback = false;
  // Say it once. A stale session can fan out across several calls on one page
  // load, and four identical console lines reads like four separate faults.
  let warnedSessionCleared = false;

  function withSessionQuery(path, session) {
    const raw = String(path || '');
    if (/[?&]session=/.test(raw)) return raw;
    return raw + (raw.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(session);
  }

  async function hubApiFetch(path, options) {
    const opts = options ? { ...options } : {};
    let session = '';
    try {
      session = getAuth().session || '';
    } catch { /* no session available; the request goes out unauthenticated */ }

    if (session) {
      // Preserve any headers the caller set, in whatever form they set them.
      const headers = new Headers(opts.headers || {});
      if (!headers.has(SESSION_HEADER)) headers.set(SESSION_HEADER, session);
      opts.headers = headers;
    }

    if (session && sessionQueryFallback) return fetch(hubApiUrl(withSessionQuery(path, session)), opts);

    const res = await fetch(hubApiUrl(path), opts);
    if (res.status !== 401 || !session) return res;

    // Only retry what is safe to send twice. The 401 is returned by the session
    // guard before any handler does work, so a repeat cannot double-apply
    // anything — but a non-string body (stream/FormData) may already be
    // consumed and cannot be replayed.
    const body = opts.body;
    if (body != null && typeof body !== 'string') return res;

    const retry = await fetch(hubApiUrl(withSessionQuery(path, session)), opts);
    if (retry.ok) sessionQueryFallback = true;

    // BOTH attempts refused: the header was sent, then the query fallback was
    // sent, and the server rejected each. That is not a WebView stripping a
    // header — it is a token the server no longer knows, so keeping it only
    // guarantees the same two requests on every page load, for as long as the
    // browser keeps that localStorage entry.
    //
    // Seen in the logs on 2026-08-15 as a pair of 401s on /api/wallet/balance,
    // one per attempt, repeating. Harmless-looking, but on shared hosting the
    // scarce resource is proxied requests, and these are guaranteed-useless
    // ones from every stale client at once.
    //
    // Only on a definitive 401. A network failure or a 5xx leaves the session
    // alone, because "we could not ask" must never mean "you are signed out".
    if (retry.status === 401) {
      clearSession();
      if (!warnedSessionCleared) {
        warnedSessionCleared = true;
        console.info('[winlew] session expired — cleared. Sign in again to restore your wallet chip.');
      }
    }
    return retry;
  }

  async function readHubApiJson(response, fallback) {
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(/^\s*</.test(text)
        ? 'The WinLEW API bridge returned a web page. Refresh and try again.'
        : `${fallback || 'api_request_failed'}:invalid_response`);
    }
    return data;
  }

  // ── Device / provider detection ─────────────────────────────────────────
  function isMobileDevice() {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
    // iOS "Request Desktop Website" rewrites the UA to look like macOS Safari
    // but can't fake touch hardware — a real Mac reports 0 touch points, a
    // disguised iPhone/iPad still reports several.
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  const STANDARD_WALLETS = new Map();
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function registerStandardWallet(wallet) {
    if (!wallet || !wallet.name) return () => {};
    STANDARD_WALLETS.set(wallet.name, wallet);
    return () => STANDARD_WALLETS.delete(wallet.name);
  }

  function initWalletStandard() {
    try {
      const appReadyApi = { register: registerStandardWallet };
      window.addEventListener('wallet-standard:register-wallet', (event) => {
        try { event.detail?.(appReadyApi); } catch {}
      });
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: appReadyApi }));
    } catch {}
  }
  initWalletStandard();

  function base58Encode(bytes) {
    if (!bytes || !bytes.length) return '';
    const digits = [0];
    for (let i = 0; i < bytes.length; i += 1) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j += 1) {
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
    while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
    let out = BASE58_ALPHABET[0].repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
    return out;
  }

  function standardAccount(wallet) {
    return wallet?.accounts?.[0] || null;
  }

  function standardSolanaChain(account) {
    const chains = Array.isArray(account?.chains) ? account.chains : [];
    return chains.find((chain) => /^solana:/i.test(String(chain || ''))) || 'solana:mainnet';
  }

  function adaptStandardWallet(wallet, { requireSignAndSend = false } = {}) {
    if (!wallet) return null;
    const connectFeature = wallet.features?.['standard:connect'];
    const signMessageFeature = wallet.features?.['solana:signMessage'];
    const sendFeature = wallet.features?.['solana:signAndSendTransaction'];
    if (!connectFeature?.connect || !signMessageFeature?.signMessage) return null;
    if (requireSignAndSend && !sendFeature?.signAndSendTransaction) return null;

    return {
      isStandardWallet: true,
      standardWalletName: wallet.name,
      get publicKey() {
        const account = standardAccount(wallet);
        if (!account?.publicKey) return null;
        const address = base58Encode(account.publicKey);
        return { toString: () => address, toBase58: () => address };
      },
      async connect() {
        const result = await connectFeature.connect();
        const account = result?.accounts?.[0] || standardAccount(wallet);
        if (!account?.publicKey) return { publicKey: null };
        const address = base58Encode(account.publicKey);
        return { publicKey: { toString: () => address, toBase58: () => address } };
      },
      async signMessage(message) {
        const account = standardAccount(wallet);
        if (!account) throw new Error('wallet_standard_no_account');
        const bytes = message instanceof Uint8Array ? message : Uint8Array.from(message || []);
        const result = await signMessageFeature.signMessage({ account, message: bytes });
        const output = Array.isArray(result) ? result[0] : result;
        const signature = output?.signature instanceof Uint8Array ? output.signature : Uint8Array.from(output?.signature || []);
        return { signature };
      },
      async signAndSendTransaction(transaction) {
        if (!sendFeature?.signAndSendTransaction) throw new Error('wallet_standard_send_transaction_unsupported');
        const account = standardAccount(wallet);
        if (!account) throw new Error('wallet_standard_no_account');
        const serialized = transaction?.serialize
          ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
          : transaction;
        const result = await sendFeature.signAndSendTransaction({
          account,
          chain: standardSolanaChain(account),
          transaction: serialized,
        });
        const output = Array.isArray(result)
          ? result[0]
          : (Array.isArray(result?.signatures) ? result.signatures[0] : result);
        const signature = typeof output === 'string'
          ? output
          : base58Encode(output?.signature || output);
        if (!signature) throw new Error('wallet_standard_missing_signature');
        return { signature };
      },
      // Sign-only path — lets callers fall back to submitting the raw
      // transaction through their own RPC when the wallet's send fails
      // (see /contribute/'s /api/contribute/submit fallback). Returns the
      // same `{ serialize() }` shape callers get from Phantom's
      // signTransaction(), which is all the fallback uses.
      ...(wallet.features?.['solana:signTransaction']?.signTransaction ? {
        async signTransaction(transaction) {
          const signFeature = wallet.features['solana:signTransaction'];
          const account = standardAccount(wallet);
          if (!account) throw new Error('wallet_standard_no_account');
          const serialized = transaction?.serialize
            ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
            : transaction;
          const result = await signFeature.signTransaction({
            account,
            chain: standardSolanaChain(account),
            transaction: serialized,
          });
          const output = Array.isArray(result) ? result[0] : result;
          const signedBytes = output?.signedTransaction instanceof Uint8Array
            ? output.signedTransaction
            : Uint8Array.from(output?.signedTransaction || []);
          if (!signedBytes.length) throw new Error('wallet_standard_missing_signed_transaction');
          return { serialize: () => signedBytes };
        },
      } : {}),
    };
  }

  function getHubWalletProviders({ requireSignAndSend = false } = {}) {
    const candidates = [
      window.phantom && window.phantom.solana,
      window.solana,
      window.solflare,
      window.geowallet && window.geowallet.solana,
    ];
    const providers = candidates.filter((provider, index) => (
      provider
      && typeof provider.connect === 'function'
      && typeof provider.signMessage === 'function'
      && (!requireSignAndSend || typeof provider.signAndSendTransaction === 'function')
      && candidates.indexOf(provider) === index
    ));
    for (const wallet of STANDARD_WALLETS.values()) {
      const adapted = adaptStandardWallet(wallet, { requireSignAndSend });
      if (adapted) providers.push(adapted);
    }
    return providers;
  }

  /**
   * Wait a beat for a wallet to show up before declaring there is none.
   *
   * WHY. Wallet Standard registration is ASYNCHRONOUS — an extension announces
   * itself with a `wallet-standard:register-wallet` event whenever its content
   * script gets around to running, which on a cold page load can land after the
   * user has already clicked. getHubWalletProviders() answered honestly for the
   * instant it was asked and the visitor got "No compatible Solana wallet was
   * injected" with three wallets installed. Reported on a desktop PC, straight
   * after an OAuth redirect — the exact timing where the click beats the
   * injection, and the same shape as the earlier "sometimes acts like im in
   * incognito mode".
   *
   * Polling rather than waiting on the event, because the failure includes
   * window.solana-style injections that fire no event at all. ~1.2s is long
   * enough for every extension seen in testing and short enough that a genuine
   * "no wallet installed" still answers while the click feels connected.
   */
  async function waitForWalletProviders(options = {}, { timeoutMs = 1200, stepMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let providers = getHubWalletProviders(options);
    while (!providers.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      providers = getHubWalletProviders(options);
    }
    return providers;
  }

  /** What detection ACTUALLY saw. The old copy guessed "you must be in
   *  Incognito", which was wrong for the desktop report above and sent the
   *  reader off to chrome://extensions for nothing. A wrong explanation is
   *  worse than none — this one states the evidence and lets the reader judge. */
  function describeWalletDetection() {
    const seen = [];
    if (window.phantom?.solana) seen.push('window.phantom.solana');
    if (window.solana) seen.push('window.solana');
    if (window.solflare) seen.push('window.solflare');
    if (window.geowallet) seen.push('window.geowallet');
    for (const name of STANDARD_WALLETS.keys()) seen.push(`Wallet Standard: ${name}`);
    return seen;
  }

  function walletProviderHelp() {
    const geo = window.geowallet;
    if (geo && !geo.solana) {
      return 'Oxyon Wallet (formerly GeoWallet) is installed, but this version does not include Solana website connections. Update it to the latest version, then reload this page.';
    }
    const seen = describeWalletDetection();
    if (seen.length) {
      // Something IS there, it just does not offer what signing needs. Naming it
      // turns an unanswerable "no wallet injected" into a fixable sentence.
      return 'A Solana wallet is present but did not offer the connect + signMessage '
        + `features this site needs (${seen.join(', ')}). Update it, or try Phantom or Solflare, then reload.`;
    }
    return 'No Solana wallet answered. Reload the page and try again — an extension that is still '
      + 'starting up can miss the first click. If it keeps happening: check the wallet is enabled for '
      + 'this site, install Phantom, Solflare or Oxyon Wallet, and in Incognito enable "Allow in Incognito" '
      + 'for the extension.';
  }

  function providerWalletAddress(provider, response) {
    return String(
      (response && response.publicKey && response.publicKey.toString && response.publicKey.toString())
      || (provider && provider.publicKey && provider.publicKey.toString && provider.publicKey.toString())
      || (response && response.publicKey && response.publicKey.toBase58 && response.publicKey.toBase58())
      || (provider && provider.publicKey && provider.publicKey.toBase58 && provider.publicKey.toBase58())
      || (provider && provider.selectedAddress)
      || (provider && provider.accounts && provider.accounts[0])
      || '',
    ).trim();
  }

  async function connectHubWalletProvider(options = {}) {
    const providers = getHubWalletProviders(options);
    if (!providers.length) return null;
    let lastError = null;
    for (const provider of providers) {
      try {
        const existingWallet = providerWalletAddress(provider);
        const response = existingWallet ? null : await provider.connect({ onlyIfTrusted: false });
        const wallet = providerWalletAddress(provider, response);
        if (!wallet) throw new Error('No wallet address from provider');
        return { provider, wallet };
      } catch (error) {
        lastError = error;
        const unsupportedGeoConnect = /unsupported method:\s*sol_connect/i.test(String((error && error.message) || error));
        if (!unsupportedGeoConnect) throw error;
      }
    }
    throw lastError || new Error('No compatible Solana wallet found');
  }

  // ── Mobile deep-link handoff ─────────────────────────────────────────────
  function buildPhantomBrowseUrl(url) {
    const target = url || window.location.href;
    return `https://phantom.app/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(window.location.origin)}`;
  }
  function buildSolflareBrowseUrl(url) {
    const target = url || window.location.href;
    return `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(window.location.origin)}`;
  }
  function buildGeoWalletBrowseUrl(url) {
    // Custom scheme (oxyon://) registered by the Oxyon Wallet mobile app; opens the URL
    // inside Oxyon Wallet's own in-app browser, which injects window.geowallet.
    const target = url || window.location.href;
    return `oxyon://browse?url=${encodeURIComponent(target)}`;
  }
  // ── Native-wrapper session hand-off ──────────────────────────────────────
  // Signing happens inside the wallet app's own in-app browser, which is a
  // separate storage context from the Capacitor wrapper's WebView — so the
  // session created there is invisible to the app the user came from. These
  // three steps carry it across. The server side, including why this is a
  // code exchange rather than a session token in the return URL, is in
  // src/mole/nativeHandoff.js; the deep-link registration is in
  // mobile/{android,ios}. All of it is inert outside the wrapper.
  const NATIVE_HANDOFF_KEY = 'winlew.native.handoff';
  const NATIVE_HANDOFF_PARAM = 'native_handoff';

  function isNativeWrapper() {
    return !!(window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  }

  function capacitorPlugin(name) {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
  }

  function toHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return toHex(new Uint8Array(digest));
  }

  function readPendingHandoff() {
    try {
      const raw = JSON.parse(localStorage.getItem(NATIVE_HANDOFF_KEY) || 'null');
      if (!raw || !raw.handoffId || !raw.claimSecret) return null;
      if (raw.expiresAt && Date.now() > Number(raw.expiresAt)) return null;
      return raw;
    } catch { return null; }
  }

  function clearPendingHandoff() {
    try { localStorage.removeItem(NATIVE_HANDOFF_KEY); } catch {}
  }

  // The wallet browser's own record of "a hand-off is in progress".
  //
  // The id used to be read from the URL only, which broke on the first real
  // device test (2026-08-02): the parameter lives on the page the wallet opens,
  // and the moment the user navigates anywhere — to /verify/, to the dashboard,
  // to anything — it is gone, and with it any chance of handing the session
  // back. Persisting it means the hand-off survives a journey rather than a
  // single page view.
  //
  // Only the id is stored here, never the claim secret: the secret stays in the
  // native app, which is the entire reason an intercepted deep link is useless.
  const NATIVE_HANDOFF_PENDING_KEY = 'winlew.native.handoff.pending';

  function rememberHandoffFromUrl() {
    try {
      const fromUrl = new URL(window.location.href).searchParams.get(NATIVE_HANDOFF_PARAM);
      if (fromUrl) localStorage.setItem(NATIVE_HANDOFF_PENDING_KEY, fromUrl);
    } catch {}
  }

  function nativeHandoffIdFromUrl() {
    try {
      const fromUrl = new URL(window.location.href).searchParams.get(NATIVE_HANDOFF_PARAM);
      if (fromUrl) return fromUrl;
      return localStorage.getItem(NATIVE_HANDOFF_PENDING_KEY) || '';
    } catch { return ''; }
  }

  function clearPendingHandoffMarker() {
    try { localStorage.removeItem(NATIVE_HANDOFF_PENDING_KEY); } catch {}
  }

  /**
   * Step 1 — invent a claim secret, register only its hash, keep the secret.
   * Returns '' when a hand-off can't be set up, and callers treat that as
   * "carry on without one": the wallet still opens, the user just lands back
   * logged out, which is the pre-existing behaviour rather than a new failure.
   */
  async function beginNativeHandoff() {
    if (!isNativeWrapper()) return '';
    // crypto.subtle needs a secure context. winlew.co is HTTPS and the wrapper
    // uses androidScheme https, so this should always hold — but degrade rather
    // than throw if some future WebView disagrees.
    if (!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues)) {
      console.warn('[wallet-auth] native handoff unavailable: no WebCrypto');
      return '';
    }
    try {
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const claimSecret = toHex(secretBytes);
      const claimHash = await sha256Hex(claimSecret);

      const res = await hubApiFetch('/api/hub/native-handoff/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimHash }),
      });
      const data = await readHubApiJson(res, 'handoff_start_failed');
      if (!data || !data.handoffId) throw new Error((data && data.error) || 'handoff_start_failed');

      localStorage.setItem(NATIVE_HANDOFF_KEY, JSON.stringify({
        handoffId: data.handoffId,
        claimSecret,
        expiresAt: Date.now() + (Number(data.ttlSec) || 300) * 1000,
      }));
      return data.handoffId;
    } catch (error) {
      console.warn('[wallet-auth] native handoff start failed:', error);
      return '';
    }
  }

  /**
   * Step 2 — runs inside the wallet's in-app browser, once a session exists.
   * No-op anywhere the hand-off parameter isn't present, which is every normal
   * page view.
   */
  async function depositNativeHandoffIfRequested(wallet) {
    const handoffId = nativeHandoffIdFromUrl();
    if (!handoffId) return false;
    const { session } = getAuth();
    if (!session) return false;
    try {
      const res = await hubApiFetch('/api/hub/native-handoff/deposit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffId, session, wallet: wallet || getCachedWallet() }),
      });
      const data = await readHubApiJson(res, 'handoff_deposit_failed');
      if (!data || data.error) throw new Error((data && data.error) || 'handoff_deposit_failed');
      clearPendingHandoffMarker();
      showNativeReturnPrompt(handoffId);
      return true;
    } catch (error) {
      console.warn('[wallet-auth] native handoff deposit failed:', error);
      return false;
    }
  }

  /**
   * The way back. Wallet in-app browsers frequently refuse to navigate to a
   * custom scheme, so the deep link is attempted but never relied on — the
   * visible button is the honest path, and the wrapper also retries the claim
   * whenever it comes back to the foreground (see nav.js). Any one of the
   * three completing is enough.
   */
  function showNativeReturnPrompt(handoffId) {
    const deepLink = `co.winlew.app://auth-callback?handoff=${encodeURIComponent(handoffId)}`;
    if (!document.getElementById('nativeReturnPrompt')) {
      const el = document.createElement('div');
      el.id = 'nativeReturnPrompt';
      el.className = 'nativeReturnPrompt';
      el.innerHTML = `
        <div>Wallet connected. Return to the WinLEW app to finish signing in.</div>
        <a class="nativeReturnPromptBtn" href="${deepLink}">Return to WinLEW</a>
        <div class="nativeReturnPromptHint">If nothing happens, switch back to the WinLEW app manually — it will pick the session up on its own.</div>
      `;
      document.body.appendChild(el);
    }
    // Give the banner a frame to paint before attempting the bounce, so the
    // user isn't left staring at an unchanged page if the scheme is blocked.
    window.setTimeout(() => { try { window.location.href = deepLink; } catch {} }, 400);
  }

  /**
   * Step 3 — runs in the wrapper. `linkHandoffId`, when present, is whatever
   * arrived on the deep link, and it is checked against the id this app
   * actually started: a deep link is an entry point any other app can fire, so
   * an id we didn't originate is never claimed. (The claim would fail anyway —
   * the secret is ours — but that would spend one of the attempt budget on the
   * legitimate hand-off's behalf.)
   */
  async function completeNativeHandoff(linkHandoffId) {
    const pending = readPendingHandoff();
    if (!pending) return { ok: false, reason: 'no_pending' };
    if (linkHandoffId && String(linkHandoffId) !== pending.handoffId) {
      console.warn('[wallet-auth] ignoring deep link for an unknown hand-off id');
      return { ok: false, reason: 'state_mismatch' };
    }
    try {
      const res = await hubApiFetch('/api/hub/native-handoff/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffId: pending.handoffId, claimSecret: pending.claimSecret }),
      });
      const data = await readHubApiJson(res, 'handoff_claim_failed');
      if (data && data.pending) return { ok: false, reason: 'pending' };
      if (!data || !data.session) {
        // A hand-off that can never succeed (expired, burned, already claimed)
        // must not be retried forever on every resume.
        clearPendingHandoff();
        return { ok: false, reason: (data && data.error) || 'handoff_claim_failed' };
      }

      localStorage.setItem(AuthKeys.session, data.session);
      localStorage.setItem(AuthKeys.app, data.app || 'mole');
      if (data.wallet) setCachedWallet(data.wallet);
      markActivity();
      clearPendingHandoff();
      return { ok: true, wallet: data.wallet || '' };
    } catch (error) {
      console.warn('[wallet-auth] native handoff claim failed:', error);
      return { ok: false, reason: 'error', error };
    }
  }

  function hasPendingNativeHandoff() {
    return !!readPendingHandoff();
  }

  // ── The URL we hand the wallet ───────────────────────────────────────────
  //
  // This used to be `window.location.href`, full stop. On any page reached from
  // a Discord link that URL is `…?session=<live token>`, and the wallet URLs
  // below are `https://phantom.app/ul/browse/<encoded>` — real HTTPS requests
  // to Phantom and Solflare. So every tap of "Open in Phantom" put a session
  // token valid for hours into a third party's access logs, from any of the 56
  // pages that load this file.
  //
  // Now the wallet gets the same PATH with a single-use hand-off id and no
  // query string of ours. Same-device has no second screen, so unlike the
  // desktop hand-off there is no pairing code — see HANDOFF_MODES.DIRECT in
  // src/mole/webHandoff.js for why that is still a large improvement and why
  // it is not equivalent.
  //
  // RULE FOR ANY FUTURE EDIT: never pass window.location.href to a
  // build*BrowseUrl(). Build from origin + pathname, as below.
  async function buildWalletTarget() {
    const url = new URL(window.location.pathname, window.location.origin);

    const session = getAuth().session;
    if (!session) return url.href; // nothing to protect, nothing to hand over

    const res = await hubApiFetch('/api/verify/handoff/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, mode: 'direct' }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.handoffId) {
      // Fail closed. Falling back to location.href here would silently restore
      // the exact leak this exists to remove, and it would do it precisely when
      // something is already wrong.
      const error = new Error(data?.error || 'handoff_start_failed');
      error.handoffFailed = true;
      throw error;
    }
    url.searchParams.set('h', data.handoffId);
    return url.href;
  }

  async function openMobileWalletBrowser(key) {
    let target;
    try {
      target = await buildWalletTarget();
    } catch (error) {
      const msg = /session_invalid|session_required/.test(String(error?.message || ''))
        ? 'Your session expired. Reconnect with Discord, then open your wallet again.'
        : 'Could not start a secure wallet hand-off. Check your connection and try again.';
      try { window.alert(msg); } catch {}
      return;
    }

    // Inside the wrapper, tag the URL the wallet will open so the page running
    // over there knows to hand its session back.
    if (isNativeWrapper()) {
      const handoffId = await beginNativeHandoff();
      if (handoffId) {
        try {
          const url = new URL(target);
          url.searchParams.set(NATIVE_HANDOFF_PARAM, handoffId);
          target = url.href;
        } catch { /* keep the untagged target */ }
      }
    }

    const walletUrl = key === 'solflare' ? buildSolflareBrowseUrl(target)
      : key === 'geowallet' ? buildGeoWalletBrowseUrl(target)
      : buildPhantomBrowseUrl(target);

    // location.href is CORRECT here, including inside the native wrapper.
    //
    // This briefly used Browser.open() on the assumption that it was "what lets
    // the OS resolve the universal link into the wallet app". That is backwards
    // and it broke wallet connect on a real phone: Browser.open() opens a
    // Chrome Custom Tab, which loads phantom.app as a WEB PAGE — so the user
    // gets Phantom's "download the app" page instead of their installed wallet.
    //
    // Assigning location.href does the right thing because Capacitor
    // intercepts it. BridgeWebViewClient.shouldOverrideUrlLoading hands every
    // navigation to Bridge.launchIntent(), which for any host that isn't the
    // app's own fires `new Intent(Intent.ACTION_VIEW, url)` and returns true.
    // Android resolves that intent to the installed Phantom/Solflare via app
    // links, and returning true means the WebView does NOT navigate — so the
    // app stays exactly where it was, still holding the pending hand-off, ready
    // for the user to come back.
    //
    // In a plain mobile browser it is an ordinary navigation, as before.
    window.location.href = walletUrl;
  }

  function closeMobileWalletPicker() {
    const el = document.getElementById('mobileWalletPicker');
    if (el) el.remove();
    document.removeEventListener('click', closeMobileWalletPickerOnOutsideClick, true);
  }
  function closeMobileWalletPickerOnOutsideClick(event) {
    const menu = document.getElementById('mobileWalletPicker');
    if (menu && !menu.contains(event.target)) closeMobileWalletPicker();
  }
  function showMobileWalletPicker(anchorBtn) {
    closeMobileWalletPicker();
    const menu = document.createElement('div');
    menu.id = 'mobileWalletPicker';
    menu.className = 'walletPickerMenu';
    menu.innerHTML = `
      <button type="button" data-wallet="phantom">\u{1F47B} Open in Phantom</button>
      <button type="button" data-wallet="solflare">☀️ Open in Solflare</button>
      <button type="button" data-wallet="geowallet">\u{1F30D} Open in Oxyon Wallet</button>
    `;
    document.body.appendChild(menu);

    if (anchorBtn) {
      const rect = anchorBtn.getBoundingClientRect();
      menu.style.top = `${Math.round(rect.bottom + 8)}px`;
      menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12))}px`;
    }

    menu.querySelectorAll('button[data-wallet]').forEach((btn) => {
      btn.addEventListener('click', () => openMobileWalletBrowser(btn.dataset.wallet));
    });

    window.setTimeout(() => document.addEventListener('click', closeMobileWalletPickerOnOutsideClick, true), 0);
  }

  // ── Nav wallet-button label ──────────────────────────────────────────────
  function setConnectedUi(label, btnId) {
    const btn = document.getElementById(btnId || 'navWalletConnect');
    if (!btn) return;
    const w = String(label || '');
    if (!w) {
      btn.textContent = 'Connect wallet';
      btn.classList.remove('active');
      return;
    }
    const short = w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
    btn.textContent = w === 'connected' ? 'Connected ✓' : `◎ ${short}`;
    btn.classList.add('active');
  }

  // ── High-level: challenge/sign/session-store wallet login ───────────────
  // Every app (Mole Hub, Faucet, Quiz) does the exact same challenge/sign/
  // store-session dance against /api/hub/wallet-login[/challenge] — only
  // what happens *after* success differs (Mole Hub reconciles guest
  // winnings, Faucet/Quiz just reload their status). onSuccess receives the
  // wallet address and the parsed login response.
  async function walletLogin({ triggerBtn, btnId, onSuccess, onError } = {}) {
    const btn = document.getElementById(btnId || 'navWalletConnect');
    const restore = btn ? btn.textContent : '';
    if (!getHubWalletProviders().length) {
      // Say what is happening while we wait — a button that sits dead for a
      // second reads as a broken click, which is how this got reported.
      if (btn) { btn.disabled = true; btn.textContent = 'Looking for wallet…'; }
      const found = await waitForWalletProviders();
      if (btn) { btn.disabled = false; btn.textContent = restore; }
      if (!found.length) {
        if (isMobileDevice()) {
          showMobileWalletPicker(triggerBtn || btn);
          return;
        }
        console.warn('[wallet-auth] no usable provider after waiting. Detected:', describeWalletDetection());
        alert(walletProviderHelp());
        return;
      }
    }

    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
      const connected = await connectHubWalletProvider();
      const provider = connected && connected.provider;
      const wallet = (connected && connected.wallet) || '';
      if (!provider || !wallet) throw new Error('No compatible Solana wallet found');

      const chRes = await hubApiFetch('/api/hub/wallet-login/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      const ch = await readHubApiJson(chRes, 'challenge_failed');
      if (!ch || !ch.message) throw new Error((ch && ch.error) || 'challenge_failed');

      const encoded = new TextEncoder().encode(ch.message);
      const signed = await provider.signMessage(encoded, 'utf8');
      const raw = signed && signed.signature;
      const sigBytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw || []);
      if (sigBytes.length !== 64) throw new Error(`unexpected_signature_length:${sigBytes.length}`);
      const signature = JSON.stringify(Array.from(sigBytes));

      const liRes = await hubApiFetch('/api/hub/wallet-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, signature, message: ch.message }),
      });
      const li = await readHubApiJson(liRes, 'wallet_login_failed');
      if (!li || !li.session) {
        // One account per person (2026-08-20). The wallet is fine; there is
        // simply no account behind it yet. Sending them straight to the Discord
        // login is the whole remedy, and their play carries over when they link
        // this same wallet afterwards — so the copy says that rather than
        // leaving them to wonder what they lost.
        if (li && li.error === 'login_required') {
          const message = li.message || 'Sign in with Discord first, then connect this wallet.';
          // Always carries a return path, so signing in brings them back to the
          // page they were actually using instead of dropping them on /verify/.
          const loginUrl = discordSignInUrl();
          if (btn && restore) btn.textContent = restore;
          if (onError) onError({ reason: 'login_required', message, loginUrl });
          else {
            alert(message);
            window.location.href = loginUrl;
          }
          return;
        }
        if (li && li.error === 'wallet_not_linked') {
          const message = li.message || "This API target is still enforcing the older Discord-link requirement. The current Mole Hub supports wallet-only web sessions; if you need Discord-linked roles, use /verify/ explicitly.";
          alert(message);
          if (btn && restore) btn.textContent = restore;
          if (onError) onError({ reason: 'wallet_not_linked', message });
          return;
        }
        throw new Error((li && li.error) || 'wallet_login_failed');
      }

      localStorage.setItem(AuthKeys.session, li.session);
      clearIdleNotice(); // signed in again; the notice has served its purpose
      localStorage.setItem(AuthKeys.app, li.app || 'mole');
      try {
        const kind = String(li.discordUserId || '').startsWith('wallet:') ? 'wallet' : 'discord';
        localStorage.setItem(AuthKeys.identity, kind);
      } catch {}
      setCachedWallet(wallet);
      // Start the idle clock at login. Without this, a stale timestamp left
      // from an earlier visit would make the new session look idle and get
      // disconnected within seconds of connecting.
      markActivity();
      // If this page was opened by the native wrapper (it tagged the URL with
      // native_handoff), hand the session back before doing anything else —
      // onSuccess on some pages navigates away.
      await depositNativeHandoffIfRequested(wallet);
      if (onSuccess) await onSuccess(wallet, li);
    } catch (error) {
      console.warn('[wallet-auth] wallet-login failed:', error);
      if (btn && restore) btn.textContent = restore;
      const message = /unsupported method:\s*sol_connect/i.test(String((error && error.message) || error))
        ? "Oxyon Wallet's Solana connector is not available in this browser. Open the page with Phantom or Solflare, then connect the wallet you verified on Discord."
        : ((error && error.message) || error);
      if (onError) onError({ reason: 'error', message, error });
      else alert('Wallet connect failed: ' + message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function logout({ revoke = true } = {}) {
    const { session } = getAuth();
    // Revoke server-side first, while the token is still readable. Fire and
    // forget with keepalive so it still goes out if the tab is closing —
    // clearing localStorage alone would leave the token valid until its TTL.
    if (revoke && session) {
      try {
        hubApiFetch('/api/session/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }
    clearSession();
    // getAuth() re-persists ?session= straight back out of the URL, so a
    // logout that leaves it there would undo itself on the next read.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('session') || url.searchParams.has('app')) {
        url.searchParams.delete('session');
        url.searchParams.delete('app');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {}
    setConnectedUi('');
  }

  // ── Idle auto-disconnect ────────────────────────────────────────────────
  // A connected wallet session used to persist indefinitely, so a machine
  // left unlocked stayed one click away from contributing, voting or
  // redeeming as its owner. Signing never takes minutes, so idle time here
  // has no legitimate use — after IDLE_MS with no interaction the session is
  // revoked server-side and cleared locally.
  //
  // Activity is shared across tabs through localStorage: using the site in
  // one tab must not log you out of another. The timestamp is also what
  // makes this survive a reload — reopening a page after an hour away
  // shouldn't silently resume a stale session.
  const IDLE_ACTIVITY_KEY = 'winlew.verify.lastActivity';
  // Set when an idle logout actually happens, cleared when the notice is
  // dismissed or a new session begins.
  //
  // WHY IT HAS TO PERSIST. The whole point of an idle timeout is that nobody is
  // watching when it fires, and the notice used to be posted at that moment and
  // removed twelve seconds later — so the person it was written for never saw
  // it. They came back to a site that had quietly forgotten them, which reads
  // as a bug in the login: "sometimes acts like im in incognito mode." The
  // timeout itself is deliberate and unchanged; only its legibility is fixed.
  const IDLE_LOGOUT_KEY = 'winlew.verify.idleLogout';
  const DEFAULT_IDLE_MS = 5 * 60 * 1000;
  const IDLE_CHECK_MS = 15 * 1000;

  // Inside the native wrapper the session is allowed to survive far longer.
  //
  // The 5-minute rule exists for a browser someone else can walk up to — a
  // shared desktop, a library machine, a tab left open. That threat does not
  // describe a phone: the app sits behind the device's own lock screen, and its
  // storage is private to the app rather than to a browser profile.
  //
  // Keeping 5 minutes there would also defeat the point of the app. The faucet
  // cooldown is 24 hours, so an idle window shorter than that guarantees a full
  // wallet round trip — open Phantom, sign, come back — before EVERY claim,
  // rather than the open-tap-close it is meant to be. 7 days clears the
  // cooldown with slack while staying well inside the session's own 91-day TTL,
  // so the server-side expiry still has the final word.
  //
  // Web behaviour is deliberately unchanged. WINLEW_IDLE_TIMEOUT_MS still
  // overrides both, and the 60s floor still applies.
  const NATIVE_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

  function idleTimeoutMs() {
    const configured = Number(window.WINLEW_IDLE_TIMEOUT_MS);
    // Floor of 60s so a bad override can't make the site unusable.
    if (Number.isFinite(configured) && configured >= 60_000) return configured;
    return isNativeWrapper() ? NATIVE_IDLE_MS : DEFAULT_IDLE_MS;
  }

  function markActivity() {
    try { localStorage.setItem(IDLE_ACTIVITY_KEY, String(Date.now())); } catch {}
  }

  function lastActivityAt() {
    const raw = Number(localStorage.getItem(IDLE_ACTIVITY_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function clearIdleNotice() {
    try { localStorage.removeItem(IDLE_LOGOUT_KEY); } catch {}
    const el = document.getElementById('winlewIdleNotice');
    if (el) el.remove();
  }

  function showIdleNotice() {
    if (document.getElementById('winlewIdleNotice')) return;
    if (!document.body) return;
    const el = document.createElement('div');
    el.id = 'winlewIdleNotice';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:20px',
      'z-index:2147483000', 'max-width:min(92vw,480px)', 'padding:12px 16px',
      'border-radius:14px', 'border:1px solid rgba(214,168,102,.45)',
      'background:linear-gradient(180deg,rgba(32,18,12,.98),rgba(19,11,8,.98))',
      'color:#f6efe8', 'font:600 14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial',
      'box-shadow:0 18px 54px rgba(0,0,0,.45)',
    ].join(';');
    el.innerHTML = '🔒 Wallet disconnected after inactivity. '
      + '<span style="opacity:.82;font-weight:500">Reconnect when you\'re ready — nothing was sent.</span> '
      + '<button type="button" id="winlewIdleNoticeClose" style="margin-left:10px;padding:4px 10px;'
      + 'border-radius:8px;border:1px solid rgba(214,168,102,.45);background:none;color:#f6efe8;'
      + 'font:inherit;font-size:13px;cursor:pointer">Got it</button>';
    document.body.appendChild(el);
    // No auto-dismiss. It stays until acknowledged, because the reader was not
    // in the room when it appeared.
    const close = document.getElementById('winlewIdleNoticeClose');
    if (close) close.addEventListener('click', clearIdleNotice);
  }

  function startIdleWatch() {
    // Always attach, even when signed out — the user may connect later in
    // this same page load, and the interval below no-ops without a session.
    if (getAuth().session && !lastActivityAt()) markActivity();

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    let throttle = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - throttle < 1000) return;   // localStorage write per second, max
      throttle = now;
      markActivity();
    };
    events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true, capture: true }));
    // Returning to the tab counts as activity; leaving it does not.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      onActivity();
      // They were away while it fired. Now that somebody is looking, say what
      // happened rather than letting a signed-out site speak for itself.
      try { if (localStorage.getItem(IDLE_LOGOUT_KEY)) showIdleNotice(); } catch {}
    });

    // Same again for a reload or a fresh page in the same tab.
    try { if (!getAuth().session && localStorage.getItem(IDLE_LOGOUT_KEY)) showIdleNotice(); } catch {}

    setInterval(() => {
      if (!getAuth().session) return;
      const last = lastActivityAt();
      if (!last) { markActivity(); return; }
      if (Date.now() - last < idleTimeoutMs()) return;
      logout();
      try { localStorage.removeItem(IDLE_ACTIVITY_KEY); } catch {}
      try { localStorage.setItem(IDLE_LOGOUT_KEY, String(Date.now())); } catch {}
      showIdleNotice();
    }, IDLE_CHECK_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startIdleWatch);
  } else {
    startIdleWatch();
  }

  function formatCompactBalance(balance) {
    const amount = Number(balance);
    if (!Number.isFinite(amount)) return null;
    const abs = Math.abs(amount);
    const units = [
      { value: 1e9, suffix: 'B' },
      { value: 1e6, suffix: 'M' },
      { value: 1e3, suffix: 'K' },
    ];
    const full = amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const unit = units.find((entry) => abs >= entry.value);
    if (!unit) return { short: full, full };
    const scaled = amount / unit.value;
    return {
      short: `${scaled.toLocaleString('en-US', {
        minimumFractionDigits: scaled >= 100 ? 0 : 2,
        maximumFractionDigits: scaled >= 100 ? 0 : 2,
      })}${unit.suffix}`,
      full,
    };
  }

  // ── Nav "Points or wallet balance" chip ──────────────────────────────────
  // 2026-07-18 design-system unification: every non-arcade page now shows a
  // live WinLEW balance chip in the account area, not just Mole Hub (whose
  // own chip is a separate, local in-game-winnings ledger — this one is the
  // real on-chain balance for the session's verified wallet, via the new
  // /api/wallet/balance endpoint, which reuses governance's existing
  // 60s-per-wallet balance cache). Shows "—" (never a fabricated "0.00")
  // when signed out, unverified, or the RPC check is temporarily down.
  async function refreshWalletBalance({ amountId = 'navWalletAmount' } = {}) {
    const amountEl = document.getElementById(amountId);
    if (!amountEl) return;
    const chip = amountEl.closest('.navBalanceChip, .navMetricChip, .walletPill');
    const { session } = getAuth();
    if (!session) {
      amountEl.textContent = '—';
      amountEl.removeAttribute('title');
      if (chip) {
        chip.setAttribute('aria-label', 'Connected wallet balance');
        chip.title = 'Connected wallet balance';
      }
      return;
    }
    try {
      const res = await hubApiFetch('/api/wallet/balance');
      const data = await readHubApiJson(res, 'wallet_balance_failed');
      if (data.ok && data.balance !== null && data.balance !== undefined) {
        const formatted = formatCompactBalance(data.balance);
        if (!formatted) throw new Error('wallet_balance_invalid');
        amountEl.textContent = formatted.short;
        amountEl.title = `${formatted.full} LEW in connected wallet`;
        if (chip) {
          chip.title = `${formatted.full} LEW in connected wallet`;
          chip.setAttribute('aria-label', `Connected wallet balance: ${formatted.full} LEW`);
        }
        return;
      }
      amountEl.textContent = '—';
      amountEl.removeAttribute('title');
      if (chip) {
        chip.title = 'Connected wallet balance';
        chip.setAttribute('aria-label', 'Connected wallet balance');
      }
    } catch (error) {
      console.warn('[wallet-auth] balance chip refresh failed:', error);
      amountEl.textContent = '—';
      amountEl.removeAttribute('title');
      if (chip) {
        chip.title = 'Connected wallet balance';
        chip.setAttribute('aria-label', 'Connected wallet balance');
      }
    }
  }

  /**
   * Hands the session back as soon as one exists in this browser, whatever
   * produced it.
   *
   * Hooking only walletLogin() was too narrow, and the first device test showed
   * why: `/verify/` never calls it. That flow arrives with a session already in
   * the URL from Discord OAuth and does its own challenge/signature, so a user
   * who went to verify completed everything inside the wallet browser and
   * handed nothing back — the hand-off record sat un-deposited and the app
   * stayed logged out. This watches for a session instead of assuming which
   * flow created it.
   *
   * Bounded, and gated on a hand-off actually being in progress, so an ordinary
   * visitor never runs the timer at all.
   */
  function initNativeHandoffDeposit() {
    rememberHandoffFromUrl();
    if (!nativeHandoffIdFromUrl()) return;

    if (getAuth().session) {
      depositNativeHandoffIfRequested(getCachedWallet());
      return;
    }

    // No session yet — the user still has to connect or finish verifying.
    // Three minutes is comfortably longer than a wallet signature takes and
    // short enough that an abandoned attempt stops on its own.
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (!nativeHandoffIdFromUrl() || Date.now() - startedAt > 180000) {
        window.clearInterval(timer);
        return;
      }
      if (getAuth().session) {
        window.clearInterval(timer);
        depositNativeHandoffIfRequested(getCachedWallet());
      }
    }, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNativeHandoffDeposit);
  } else {
    initNativeHandoffDeposit();
  }

  /**
   * Completes a DIRECT hand-off: the wallet's in-app browser has just opened
   * `<same path>?h=<id>`, which is a different storage context with no session
   * of its own.
   *
   * This lives here rather than in verify/link.js because the wallet picker is
   * reachable from every page that loads this file, so the return can land
   * anywhere — the hand-off deliberately preserves the path the user was on.
   *
   * PAIRED hand-offs (the desktop panel, /verify/?h=…) also match `?h=`. The
   * server answers `pairing_code_required` for those and this backs off,
   * leaving the code panel in verify/link.js to handle it. That probe costs
   * nothing: a missing code never counts as a failed attempt, precisely so this
   * site-wide check can run on every page load without destroying a hand-off
   * the user is midway through.
   */
  async function claimDirectHandoffFromUrl() {
    let handoffId = '';
    try { handoffId = new URL(window.location.href).searchParams.get('h') || ''; } catch { return; }
    if (!handoffId) return;
    // Already carrying a session — the round trip is done, or this page was
    // reloaded after a successful claim. Never spend a hand-off we don't need.
    if (getAuth().session) return;

    try {
      const res = await hubApiFetch('/api/verify/handoff/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handoffId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.session) return; // includes pairing_code_required

      // Swap ?h= for the session the rest of the site reads. replace() rather
      // than push so the spent hand-off id leaves the history entry too — and
      // so a back-navigation cannot try to re-claim it.
      const next = new URL(window.location.pathname, window.location.origin);
      next.searchParams.set('session', data.session);
      next.searchParams.set('app', getAuth().app || 'mole');
      window.location.replace(next.href);
    } catch { /* offline or blocked; the page still works, just signed out */ }
  }
  /** Everything the URL might be asking us to do on arrival, in the order that
   *  matters: redeem a hand-off first (it produces a session), then the
   *  mobile-wrapper `?h=` claim, then the Discord-initiated bounce. */
  async function handleArrivalFromUrl() {
    await claimPendingHandoff();
    await claimDirectHandoffFromUrl();
    startBoundLinkedRole();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleArrivalFromUrl);
  } else {
    handleArrivalFromUrl();
  }

  /**
   * Bind the flow Discord itself starts.
   *
   * Clicking "Connect account" in Discord's Linked Roles panel opens
   * /linked-role/mole directly — no page of ours ran first, so no tab has a
   * secret and the session would have to come back in the URL. That single
   * exception is what would keep `?session=` alive, and with it the crafted-link
   * problem the hand-off exists to end.
   *
   * So the server sends that arrival to /verify/?connect=<app> instead, this
   * mints a claim on OUR origin where sessionStorage is ours to write, and the
   * flow restarts bound. One extra redirect, and the exception closes.
   */
  async function startBoundLinkedRole() {
    let appKey = '';
    let next = '';
    try {
      const params = new URL(window.location.href).searchParams;
      appKey = params.get('connect') || '';
      next = params.get('next') || '';
    } catch { return; }
    if (!appKey || !/^[a-z0-9_-]{1,32}$/i.test(appKey)) return;

    // NO "already signed in, skip" CHECK. An earlier draft had one and it was
    // wrong in the most important case: a wallet-only session clicking "Verify
    // with Discord" IS signed in, and attaching Discord is the entire point of
    // the trip. Skipping would have left them parked on /verify/?connect=mole
    // with nothing happening — a button that silently does nothing for exactly
    // the people it exists for.

    // b=1 tells the server we have been round once already, so that if this
    // hash is lost in transit it proceeds instead of bouncing us back here.
    const query = new URLSearchParams({ b: '1' });
    if (next && next.startsWith('/')) query.set('next', next);

    const hash = await newOAuthClaim();
    // No crypto.subtle (an http:// origin, an ancient browser) means no
    // binding is possible. Go anyway, unbound: b=1 makes the server proceed
    // rather than bounce back, and the session lands on /verify/ where a URL
    // one is still read. Degraded, not dead — the alternative is a visitor
    // stranded on a page that looks like it did nothing.
    if (hash) query.set('claimHash', hash);

    // replace(), so the back button does not bounce them round again.
    window.location.replace(hubApiUrl(`/linked-role/${encodeURIComponent(appKey)}?${query.toString()}`));
  }

  /** 'discord' when this session belongs to a real Discord account, 'wallet'
   *  for an anonymous wallet-only one, and 'none' when nobody is signed in.
   *  Unknown is reported as 'wallet' on purpose: showing a sign-in control to
   *  somebody who does not need it is harmless, hiding it from somebody who
   *  does is exactly the bug this was built to fix. */
  function getIdentityKind() {
    try {
      if (!getAuth().session) return 'none';
      return localStorage.getItem(AuthKeys.identity) === 'discord' ? 'discord' : 'wallet';
    } catch { return 'none'; }
  }

  /** The one place the Discord sign-in URL is built.
   *
   *  IT MUST GO THROUGH hubApiUrl(). /linked-role/ lives on the Node backend,
   *  and on winlew.co Apache serves none of it — only /verify/api-proxy.php
   *  reaches Node. The first version of this linked straight to
   *  "/linked-role/mole?next=/", which 404s on the live site: a Sign in button
   *  that looks real and goes nowhere, which is the same "there is nowhere to
   *  sign in" problem it was built to solve, wearing a disguise. Verified
   *  against production — direct 404, proxied 302 to Discord.
   *
   *  `next` is the path to come back to. The server validates it as
   *  same-origin before it is ever used and ignores anything else. */
  /**
   * Where to come back to after a round trip, WITHOUT the credentials that
   * happen to be in the address bar.
   *
   * The canonical copy. nav.js had grown its own after a real URL came back
   * reading `/home/?session=P5u9...&app=mole%2F&syncError=already_linked` — the
   * session had been captured as the return path and printed straight back out.
   * This one exports so there is a single list of what must never travel.
   *
   * Everything else in the query survives: a return path that silently drops
   * the filter or tab someone was on is its own bug.
   */
  const NEVER_IN_A_RETURN_PATH = ['session', 'app', 'handoff', 'connect', 'synced', 'syncError'];

  function returnPathHere() {
    try {
      const params = new URLSearchParams(window.location.search);
      for (const key of NEVER_IN_A_RETURN_PATH) params.delete(key);
      const rest = params.toString();
      return window.location.pathname + (rest ? `?${rest}` : '');
    } catch {
      return window.location.pathname;
    }
  }

  // One wallet sign-in at a time. Some pages wire Connect wallet themselves and this module also
  // wires it on every page (below), so a single click can reach walletLogin twice; the second
  // call joins the first instead of opening a second wallet prompt.
  let walletLoginInFlight = null;
  let walletLoginStartedAt = 0;
  function walletLoginOnce(options) {
    if (walletLoginInFlight) return walletLoginInFlight;
    walletLoginStartedAt = Date.now();
    const attempt = Promise.resolve(walletLogin(options)).finally(() => { if (walletLoginInFlight === attempt) walletLoginInFlight = null; });
    walletLoginInFlight = attempt;
    // A wallet prompt left open forever must not block the button for the rest of the visit.
    setTimeout(() => { if (walletLoginInFlight === attempt) walletLoginInFlight = null; }, 120000);
    return attempt;
  }

  // Every page's header has #navWalletConnect, but only some page scripts wired it: on the
  // homepage and the WinLEW 3.0 pages a click did nothing (2026-10-23, reproduced as a new
  // visitor on desktop and phone). Wire it once here, for every page, through a document-level
  // listener so it also covers a header rebuilt after load. A page that wires the button itself
  // still runs first (its listener is on the button) and keeps its own onSuccess; this click
  // then joins that sign-in. Started from here, a successful sign-in reloads the page so every
  // panel reflects it, as the page scripts do.
  // The Mole Hub has its own sign-in (it also reconciles guest winnings), outside this module:
  // it keeps sole charge of the button there; any other page can opt out the same way with
  // data-wallet-wired on the button. Elsewhere, wait one tick and leave the click alone if a page
  // handler already took it: a sign-in under way, the button disabled, or one that started (and
  // perhaps already failed) within the last second.
  const ownSignIn = /^\/mole-hub(\/|$)/.test(window.location.pathname || '');
  document.addEventListener('click', (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('#navWalletConnect') : null;
    if (!btn || event.defaultPrevented || ownSignIn || btn.dataset.walletWired) return;
    setTimeout(() => {
      if (walletLoginInFlight || btn.disabled || Date.now() - walletLoginStartedAt < 1000) return;
      void walletLoginOnce({ triggerBtn: btn, onSuccess: () => { window.location.reload(); } });
    }, 0);
  });
  // Show a signed-in session on the button, as the page scripts do, where no page script does.
  const showSignedIn = () => {
    const btn = document.getElementById('navWalletConnect');
    if (btn && !btn.classList.contains('active') && getAuth().session) setConnectedUi(getCachedWallet() || 'connected');
  };
  // Again after a moment: nav.js may build or rebuild the header after DOMContentLoaded.
  const showSignedInSoon = () => { setTimeout(showSignedIn, 0); setTimeout(showSignedIn, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showSignedInSoon);
  else showSignedInSoon();

  function discordSignInUrl(next) {
    const target = typeof next === 'string' && next.startsWith('/') ? next : returnPathHere();
    return hubApiUrl(`/linked-role/mole?next=${encodeURIComponent(target)}`);
  }

  window.WinLEWAuth = {
    AuthKeys,
    getAuth,
    getIdentityKind,
    discordSignInUrl,
    getCachedWallet,
    setCachedWallet,
    clearSession,
    logout,
    hubApiUrl,
    hubApiFetch,
    readHubApiJson,
    isMobileDevice,
    getHubWalletProviders,
    walletProviderHelp,
    newOAuthClaim,
    claimPendingHandoff,
    returnPathHere,
    describeWalletDetection,
    waitForWalletProviders,
    providerWalletAddress,
    connectHubWalletProvider,
    buildPhantomBrowseUrl,
    buildSolflareBrowseUrl,
    buildGeoWalletBrowseUrl,
    openMobileWalletBrowser,
    showMobileWalletPicker,
    closeMobileWalletPicker,
    setConnectedUi,
    walletLogin: walletLoginOnce,
    refreshWalletBalance,
    isNativeWrapper,
    beginNativeHandoff,
    completeNativeHandoff,
    hasPendingNativeHandoff,
  };
})();
