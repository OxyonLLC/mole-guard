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

$WINLEW_API_BASE = getenv('WINLEW_API_BASE') ?: 'https://orthomorphic-laevorotatory-trista.ngrok-free.dev';

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
if (preg_match('#(?:^|/)\.\.?(?:/|$)#', $pathInfo)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'invalid_proxy_path']);
    exit;
}

if (!preg_match('#^/(?:api|health|linked-role)(?:/|$)#', $pathInfo)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'invalid_proxy_path']);
    exit;
}

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
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '';
if (filter_var($clientIp, FILTER_VALIDATE_IP)) {
    // Set (never append) — an inbound X-Forwarded-For is attacker-controlled
    // and must not be carried through to a backend that trusts this header.
    $headers[] = 'X-Forwarded-For: ' . $clientIp;
}

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 25);
if ($method !== 'GET' && $method !== 'HEAD') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'error' => 'proxy_request_failed',
        'detail' => curl_error($ch),
    ]);
    curl_close($ch);
    exit;
}

$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$statusCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$rawHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);
curl_close($ch);

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
header('Content-Type: application/json');
header('Cache-Control: no-store');
echo $responseBody;
