<?php
/**
 * WinLEW shared-host API proxy
 *
 * Deploy this file at: /verify/api-proxy.php
 * Then set your verify page to:
 *   <html data-api-base="/verify/api-proxy.php">
 *
 * This keeps browser requests same-origin on winlew.co while forwarding
 * verification API calls to your live Mole Guard backend (ngrok or future API domain).
 */

// The GeoHackers verification server, not the WinLEW API. Same proxy, a
// different upstream -- this file is a copy of ../../verify/api-proxy.php with
// the base and the allowlist changed, deliberately rather than a second, weaker
// proxy written from scratch. The hard parts here (dot-segment rejection before
// the prefix check, header stripping, the redirect allowlist, the breaker) were
// already reasoned about once.
//
// Where that server is reachable, in the order this host can actually supply it:
//
//   1. GEOHACKERS_API_BASE in the environment, if the host allows setting one
//   2. api-proxy-upstream.php beside this file returning the string -- the same
//      shape as api-proxy-secret.php next to the WinLEW proxy, because shared
//      hosting frequently cannot set per-directory environment variables.
//      That file is git-ignored (it names the bot machine's Tailscale Funnel
//      address); copy api-proxy-upstream.example.php to create it.
//
// There is deliberately no hard-coded fallback. It used to be the funnel
// address of the developer's own laptop, tracked in git; a missing config now
// fails loudly with a generic 503 instead of quietly pointing somewhere.
$WINLEW_API_BASE = getenv('GEOHACKERS_API_BASE') ?: getenv('WINLEW_API_BASE') ?: '';
if ($WINLEW_API_BASE === '' && is_readable(__DIR__ . '/api-proxy-upstream.php')) {
    $loadedUpstream = include __DIR__ . '/api-proxy-upstream.php';
    if (is_string($loadedUpstream)) { $WINLEW_API_BASE = trim($loadedUpstream); }
}
if ($WINLEW_API_BASE === '') {
    http_response_code(503);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'error' => 'verification_upstream_not_configured']);
    exit;
}

$pathInfo = $_SERVER['PATH_INFO'] ?? '';
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
if ($pathInfo === '' && strpos($requestUri, 'api-proxy.php/') !== false) {
    $parts = explode('api-proxy.php', $requestUri, 2);
    $pathInfo = $parts[1] ?? '';
}
if ($pathInfo === '' && isset($_GET['path'])) {
    $pathInfo = $_GET['path'];
}
if ($pathInfo === '' || $pathInfo === '/') {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'error' => 'Missing proxied API path. Expected /api/wallet/challenge or /api/wallet/link'
    ]);
    exit;
}

// /linked-role is the Discord OAuth *start* (a 302 to discord.com) — allowed
// so winlew.co can begin verification itself instead of needing the backend's
// raw URL in the browser; see the redirect pass-through below.
$pathInfo = '/' . ltrim(parse_url($pathInfo, PHP_URL_PATH) ?: '', '/');

// Reject dot-segments BEFORE the prefix check. curl normalises "/a/../b" to
// "/b" when it builds the request line, so "/api/../../admin" would satisfy
// the allowlist below and still reach "/admin" on the backend — the prefix
// restriction has to be enforced on the path curl will actually send.
$decodedPath = rawurldecode($pathInfo);
if (preg_match('#(?:^|/)\.\.?(?:/|$)#', $decodedPath)
    || strpos($decodedPath, '\\') !== false
    || preg_match('#%(?:25|2e|2f|5c)#i', $decodedPath)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'invalid_proxy_path']);
    exit;
}

// The OAuth CALLBACKS are allowlisted so Discord and X can return the visitor
// to winlew.co instead of to the raw tunnel host.
//
// WHY THIS MATTERS BEYOND TIDINESS (2026-08-21). DISCORD_REDIRECT_URI pointed
// at https://<tunnel>.ngrok-free.dev/discord-oauth-callback, so every single
// sign-in walked a user's address bar through an ngrok-free.dev hostname on a
// site that then asks them to sign a message. That is the exact shape of a
// wallet drainer, `*.ngrok-free.dev` is one of the most abused hostname
// families there is, and Phantom now blocks winlew.co as "malicious". Keeping
// every hop on winlew.co removes the strongest trigger and is the concrete
// change an appeal reviewer can verify.
//
// It also removes a whole class of webview bug: the hand-off secret lives in
// sessionStorage on the origin that STARTED the flow (wallet-auth.js), so a
// callback landing on a different origin can never redeem its own hand-off.
// Only what verification needs:
//   /verify/<session>        the page the bot serves, rendered on winlew.co
//   /api/session/<session>   the nonce and signing domain for that session
//   /api/verify              the signed result going back
//   /health                  so a check can tell "down" from "misconfigured"
// Nothing else on that backend is reachable through this file.
if (!preg_match('#^/(?:verify|api/session)/[A-Za-z0-9_-]{1,64}$|^/api/verify$|^/health$#', $pathInfo)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'invalid_proxy_path']);
    exit;
}

// PUBLIC SUPPLY ENDPOINTS — the only paths this proxy answers with CORS.
//
// External listing services (Jupiter's verified.jup.ag token review, CoinGecko,
// CMC) read circulating supply from a URL, and a validator running in a browser
// cannot read a response with no Access-Control-Allow-Origin header. The Node
// backend already sends one for these two routes, but this proxy forwards NO
// upstream headers at all — it stamps its own Content-Type and Cache-Control on
// every response — so the header never reached the caller and the whole point
// of setting it was lost.
//
// SCOPED ON PURPOSE. A blanket wildcard here would let any origin read every
// proxied API response, including the authenticated ones. These two paths are
// public, read-only, carry no credentials and expose one number each, so they
// are safe to open and nothing else is.
$isPublicSupplyPath = (bool) preg_match('#^/api/supply/(?:circulating|total)$#', $pathInfo);

// The OAuth callbacks answer with a 302 on the happy path, which the redirect
// branch below handles. Their ERROR branch renders HTML (htmlPage() in
// src/mole/web.js), and this file stamps `Content-Type: application/json` on
// every non-redirect response — so an OAuth failure would reach the browser as
// a page of HTML mislabelled as JSON, i.e. as gibberish exactly when something
// has already gone wrong. Relay the upstream type for these two paths only,
// scoped for the same reason $isPublicSupplyPath is.
$isOAuthCallbackPath = (bool) preg_match('#^/(?:discord|x)-oauth-callback(?:/|$)#', $pathInfo);
// The verify page is HTML by design; everything else here is JSON. The
// content-type allowlist below still applies, so this cannot become a
// file-download or script-hosting surface on winlew.co.
$isVerifyPagePath = (bool) preg_match('#^/verify/#', $pathInfo);
// The verify page's FALLBACK SCRIPT (R2, 2026-11-12). When the oxyon.io copy of
// the ~3 MB client cannot load, the page appends
//   <script type="module" integrity="sha384-…" src="<this file>/verify/client-<hex16>">
// and the bot answers that path with the bundle as text/javascript. The branch
// below used to relabel it text/html, and with nosniff the browser refuses an
// HTML-typed module, so the fallback downloaded 3 MB and never ran: members saw
// "Loading verification…" forever.
//
// Still not a script-hosting surface. The name is content-addressed: <hex16> is
// the first 16 hex digits of the SHA-256 of the exact bytes (verifyClientAsset()
// in the bot), and this file checks that before calling the body JavaScript. Any
// other body on this path is refused, and the page's SRI pins the bytes as well.
$verifyClientHash = preg_match('#^/verify/client-([0-9a-f]{16})$#', $pathInfo, $vcm) ? $vcm[1] : '';
$wantsPlainText = $isPublicSupplyPath
    && isset($_GET['format'])
    && strtolower((string) $_GET['format']) === 'plain';

$target = rtrim($WINLEW_API_BASE, '/') . $pathInfo;
$forwardQuery = $_GET;
unset($forwardQuery['path']);
if (!empty($forwardQuery)) {
    $target .= '?' . http_build_query($forwardQuery);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = file_get_contents('php://input');

$headers = [
    'Content-Type: application/json',
    'Accept: application/json',
    // ngrok free-tier serves an HTML interstitial to browser-looking requests
    // without this header — harmless on any other backend host.
    'ngrok-skip-browser-warning: true',
];

// Forward the real client IP. Without this every proxied visitor reaches the
// backend as this one shared host, so express's per-IP simpleRateLimit()
// buckets them all together and one busy user can rate-limit everybody.
//
// The backend cannot simply believe a forwarded-IP header: its ngrok origin is
// publicly reachable, so anyone can send one. It therefore only honours our
// claim when we also present a shared secret — set WINLEW_PROXY_SECRET (or drop
// an api-proxy-secret.php next to this file returning the string) matching the
// backend's WEB_PROXY_SHARED_SECRET. Without it the backend safely falls back
// to bucketing this whole host together.
//
// Note this request is built from a fresh $headers list, so nothing the browser
// sent — including its own X-Forwarded-For or X-WinLEW-* headers — is carried
// through. Every value below is one we observed ourselves.
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '';
$proxySecret = getenv('WINLEW_PROXY_SECRET') ?: '';
if ($proxySecret === '' && is_readable(__DIR__ . '/api-proxy-secret.php')) {
    $loadedSecret = include __DIR__ . '/api-proxy-secret.php';
    if (is_string($loadedSecret)) {
        $proxySecret = trim($loadedSecret);
    }
}
// A secret carrying CR/LF would inject extra lines into the request curl
// builds, so only a plain printable token is ever sent.
if ($proxySecret !== '' && !preg_match('/^[\x21-\x7e]{8,256}$/', $proxySecret)) {
    $proxySecret = '';
}
if (filter_var($clientIp, FILTER_VALIDATE_IP)) {
    // Set (never append) — an inbound X-Forwarded-For is attacker-controlled
    // and must not be carried through to a backend that trusts this header.
    $headers[] = 'X-Forwarded-For: ' . $clientIp;
    if ($proxySecret !== '') {
        $headers[] = 'X-WinLEW-Proxy-Secret: ' . $proxySecret;
        $headers[] = 'X-WinLEW-Client-IP: ' . $clientIp;
    }
}

// The ONE browser header this proxy forwards (content-audit register #28).
//
// Everything above is a claim the proxy makes about the browser, which is why
// nothing the browser sent is carried through: a visitor who could set
// X-WinLEW-Proxy-Secret or X-WinLEW-Client-IP would forge their own rate-limit
// identity. X-WinLEW-Session is categorically different. It is a bearer
// credential the browser already holds and can already present as ?session= on
// any request, so forwarding it grants no authority the visitor did not have —
// it only changes where the token travels.
//
// Why that matters: as a query parameter the session lands in the shared host's
// access log, in the backend's own logs, in Referer headers and in anything
// that copies a URL. As a header it lands in none of them. The client
// (wallet-auth.js hubApiFetch) has been sending this header for a while; this
// file was silently dropping it, which is why ~16 call sites still append
// ?session= as well and why the token is still in the logs today.
//
// DEPLOY ORDER MATTERS. This change is safe on its own — the query parameter
// keeps working, so requests simply carry both. Removing ?session= from those
// call sites must come LATER, only once this file is confirmed live, or a
// partial upload (JS up, PHP not) authenticates nobody.
$sessionHeader = trim($_SERVER['HTTP_X_WINLEW_SESSION'] ?? '');
// Same printable-ASCII rule the secret above uses, for the same reason: a value
// containing CR/LF would inject extra header lines into the request curl
// builds. Tokens are nanoid(32) today; the bound is loose enough to survive a
// format change and tight enough to make injection impossible.
if ($sessionHeader !== '' && preg_match('/^[\x21-\x7e]{16,512}$/', $sessionHeader)) {
    $headers[] = 'X-WinLEW-Session: ' . $sessionHeader;
}

// ── Circuit breaker ──────────────────────────────────────────────────────────
//
// Why this exists, 2026-08-15: winlew.co went down while the backend behind the
// tunnel was healthy. On shared hosting the account gets a small number of
// concurrent worker processes, and EVERY api call parks one here until curl
// returns. When the tunnel stops answering, each request holds a worker for the
// full timeout; enough of them and the account has no workers left, at which
// point the host stops serving the whole site — static files and FTP included.
// The owner watched exactly that: stop the bot, the website dies with it.
//
// A breaker converts "the backend is down, so the site is down" into "the
// backend is down, so the API returns errors for 30 seconds". Once a few
// requests in a row have failed, the rest are refused in MICROSECONDS without
// opening a socket, so workers stay free for the pages that need no backend.
//
// THE BREAKER MUST NEVER BE ABLE TO BREAK THE SITE. Every failure path here —
// unwritable directory, malformed state, missing file, a lock we cannot take —
// falls through to "closed", i.e. the request proceeds exactly as it did
// before. A breaker that fails open costs one slow request; a breaker that
// fails closed takes the API offline for a reason nobody can see.
define('WINLEW_BREAKER_THRESHOLD', 3);        // consecutive failures before opening
define('WINLEW_BREAKER_COOLDOWN_SEC', 30);    // how long it stays open

function winlew_breaker_path() {
    $dir = sys_get_temp_dir();
    if (!is_string($dir) || $dir === '' || !is_dir($dir) || !is_writable($dir)) {
        return null;
    }
    // A DIFFERENT file from the WinLEW proxy's. This file is a copy of that one,
    // and copying it verbatim meant both shared a single breaker state -- so
    // GeoHackers being unreachable could open the breaker in front of WinLEW
    // verification, and the other way round. Coupling two backends through one
    // breaker is the exact failure a breaker exists to prevent.
    return $dir . DIRECTORY_SEPARATOR . 'geohackers-proxy-breaker.json';
}

function winlew_breaker_read() {
    $path = winlew_breaker_path();
    if ($path === null || !is_file($path)) {
        return ['failures' => 0, 'openedAt' => 0];
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return ['failures' => 0, 'openedAt' => 0];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return ['failures' => 0, 'openedAt' => 0];
    }
    return [
        'failures' => isset($data['failures']) ? (int) $data['failures'] : 0,
        'openedAt' => isset($data['openedAt']) ? (int) $data['openedAt'] : 0,
    ];
}

// Best effort by design. A missed write costs one extra attempt through a dead
// backend; blocking on a lock would cost the worker this whole thing exists to
// protect, so LOCK_NB and move on.
function winlew_breaker_write($state) {
    $path = winlew_breaker_path();
    if ($path === null) {
        return;
    }
    $fh = @fopen($path, 'c+');
    if ($fh === false) {
        return;
    }
    if (@flock($fh, LOCK_EX | LOCK_NB)) {
        @ftruncate($fh, 0);
        @rewind($fh);
        @fwrite($fh, json_encode($state));
        @fflush($fh);
        @flock($fh, LOCK_UN);
    }
    @fclose($fh);
}

/** Open == refuse immediately. Once the cooldown passes the breaker is
 *  half-open: the next request is allowed through to test the backend, and its
 *  result either closes the breaker or re-opens it. */
function winlew_breaker_is_open($now) {
    $state = winlew_breaker_read();
    if ($state['openedAt'] <= 0) {
        return false;
    }
    return ($now - $state['openedAt']) < WINLEW_BREAKER_COOLDOWN_SEC;
}

function winlew_breaker_record_failure($now) {
    $state = winlew_breaker_read();
    $failures = $state['failures'] + 1;
    $openedAt = $failures >= WINLEW_BREAKER_THRESHOLD ? $now : $state['openedAt'];
    winlew_breaker_write(['failures' => $failures, 'openedAt' => (int) $openedAt]);
}

function winlew_breaker_record_success() {
    $state = winlew_breaker_read();
    // Only write when something actually changes. A healthy site would
    // otherwise do a file write on every single API call.
    if ($state['failures'] !== 0 || $state['openedAt'] !== 0) {
        winlew_breaker_write(['failures' => 0, 'openedAt' => 0]);
    }
}

if (winlew_breaker_is_open(time())) {
    // No socket, no worker held. This is the entire point.
    http_response_code(503);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    header('Retry-After: ' . WINLEW_BREAKER_COOLDOWN_SEC);
    echo json_encode([
        'ok' => false,
        'error' => 'backend_unavailable',
    ]);
    exit;
}

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
// Bound how long a PHP worker can be held hostage by a slow backend.
//
// 2026-08-15: the site returned 502 for everything, static files included,
// while the ngrok backend itself answered in 0.34s when queried directly. The
// shape of that failure is worker-pool exhaustion at the host, and this proxy
// is the one place that can cause it: shared hosting allows a small number of
// concurrent PHP processes, and every API request parks one here until curl
// gives up.
//
// CONNECTTIMEOUT is the important half and was missing entirely. With no
// connect timeout, a backend that is DOWN — not slow, down — held a worker for
// the full 25s per request. Five seconds is generous for a TCP+TLS handshake to
// a tunnel that normally answers in under half of one.
//
// The overall timeout stays longer than a read needs because the claim path is
// genuinely slow: the funding-cluster walk alone budgets 8s before any transfer
// is attempted. Cutting this to a few seconds would refuse legitimate claims.
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
curl_setopt($ch, CURLOPT_TIMEOUT, 25);
if ($method !== 'GET' && $method !== 'HEAD') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
if ($response === false) {
    // Content-audit register #26. This echoed curl_error() straight to the
    // client, which names the backend tunnel host every time the tunnel is
    // down — i.e. it published the private origin precisely when the site was
    // broken and people were most likely to be looking. Logged server-side
    // instead, so nothing is lost for debugging and nothing is disclosed.
    //
    // The fix was written once before and deliberately reverted: no PHP parser
    // existed in the dev environment, and this file gates EVERY API call on the
    // site, so an unverified edit here takes the whole site down. php-cli was
    // installed 2026-08-12 and this is `php -l` clean.
    //
    // The /geoagora/ copies already carried this change and their comment said
    // it matched this file — it did not, until now. Keep the three in step.
    error_log('[verify-proxy] request failed: ' . curl_error($ch) . ' target=' . $target);
    curl_close($ch);
    winlew_breaker_record_failure(time());

    http_response_code(502);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode([
        'ok' => false,
        'error' => 'proxy_request_failed',
    ]);
    exit;
}

$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$statusCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$rawHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);
curl_close($ch);

// A 4xx is the application answering and must NOT trip the breaker — only
// the tunnel or the origin being unreachable does. ngrok replies 502 when
// nothing is listening behind it, which is precisely the outage case.
if ($statusCode === 502 || $statusCode === 503 || $statusCode === 504) {
    winlew_breaker_record_failure(time());

    // Never relay a gateway error body. When the bot is not listening, ngrok
    // answers with its OWN branded HTML page — ERR_NGROK_8012, naming
    // localhost:8787 and the tunnel host — and this file used to echo it
    // straight to the browser under a JSON content type. Observed live on
    // 2026-08-15; it is what the owner saw when the site "took me to ngrok".
    //
    // Two problems in one: it publishes the private origin exactly when the
    // site is broken and people are looking (the same rule as register #26,
    // which covered the curl-failure branch but not a successful response
    // carrying someone else's error page), and it hands a client expecting
    // JSON a page of HTML.
    http_response_code(503);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    header('Retry-After: ' . WINLEW_BREAKER_COOLDOWN_SEC);
    echo json_encode([
        'ok' => false,
        'error' => 'backend_unavailable',
    ]);
    exit;
} else {
    winlew_breaker_record_success();
}

// Pass real redirects through to the browser (the /linked-role OAuth start
// answers with a 302 to discord.com/oauth2/authorize) instead of wrapping
// them in a JSON body nothing can follow. Only to hosts we actually expect:
// relaying an arbitrary upstream Location would turn winlew.co into an open
// redirect the moment any backend route reflects user input into one.
$REDIRECT_ALLOWED_HOSTS = ['discord.com', 'discordapp.com', 'winlew.co', 'www.winlew.co'];
if ($statusCode >= 300 && $statusCode < 400 && preg_match('/^Location:\s*(\S+)/mi', $rawHeaders, $m)) {
    $location = trim($m[1]);
    $host = strtolower(parse_url($location, PHP_URL_HOST) ?: '');
    // A relative Location (no host) stays on winlew.co, so it is safe.
    if ($host === '' || in_array($host, $REDIRECT_ALLOWED_HOSTS, true)) {
        header('Cache-Control: no-store');
        header('Location: ' . $location, true, $statusCode);
        exit;
    }
    http_response_code(502);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'error' => 'blocked_redirect_host', 'host' => $host]);
    exit;
}

http_response_code($statusCode ?: 200);
if ($isPublicSupplyPath) {
    header('Access-Control-Allow-Origin: *');
    // A supply figure is worth caching for a minute; `no-store` on a value that
    // changes only when tokens are burned just makes every poller do more work.
    header('Cache-Control: public, max-age=60');
    // ?format=plain returns a bare number for CoinGecko/CMC-style consumers.
    // Announcing that as application/json would be a lie about the body.
    header('Content-Type: ' . ($wantsPlainText ? 'text/plain; charset=utf-8' : 'application/json'));
} elseif ($verifyClientHash !== '') {
    // Only a 200 whose bytes hash to the name is ever JavaScript. Anything else
    // (the bot's 404 for a stale hash, an error) is passed on as an empty,
    // uncacheable response, so a miss can never be cached the way oxyon.io's
    // immutable 404 was.
    $upstreamType = preg_match('/^Content-Type:\s*([^\r\n]+)/mi', $rawHeaders, $ct) ? trim($ct[1]) : '';
    $isScript = preg_match('#^(?:text|application)/javascript\b#i', $upstreamType);
    if ($statusCode === 200 && $isScript
        && strncmp(hash('sha256', $responseBody), $verifyClientHash, 16) === 0) {
        header('Content-Type: text/javascript; charset=utf-8');
        // Content-addressed, so a day of caching is safe; kept short rather than
        // immutable so a mistake here can never outlive a day.
        header('Cache-Control: public, max-age=86400');
        echo $responseBody;
        exit;
    }
    if ($statusCode === 200) {
        error_log('[verify-proxy] client fallback refused: type=' . $upstreamType . ' hash mismatch or not a script');
        http_response_code(502);
    }
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    exit;
} elseif ($isOAuthCallbackPath || $isVerifyPagePath) {
    $upstreamType = '';
    if (preg_match('/^Content-Type:\s*([^\r\n]+)/mi', $rawHeaders, $ct)) {
        $upstreamType = trim($ct[1]);
    }
    // Only a type we recognise, and never one that could turn this path into a
    // file-download or script-hosting surface on winlew.co.
    if (!preg_match('#^(?:text/html|text/plain|application/json)\b#i', $upstreamType)) {
        $upstreamType = 'text/html; charset=utf-8';
    }
    header('Content-Type: ' . $upstreamType);
    header('Cache-Control: no-store');
} else {
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
}
echo $responseBody;
