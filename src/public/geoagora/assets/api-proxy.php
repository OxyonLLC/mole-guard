<?php
/**
 * GeoAgora shared-host API proxy
 *
 * Deploy at: /geoagora/api-proxy.php
 * Then rewrite /geoagora/api/* to this file.
 */

$GEOAGORA_API_BASE = getenv('GEOAGORA_API_BASE') ?: 'https://orthomorphic-laevorotatory-trista.ngrok-free.dev/geoagora-api';

/**
 * Build a normalized proxy path from PATH_INFO, rewritten query param, or REQUEST_URI.
 */
function getProxyPath(): string
{
    $pathInfo = $_SERVER['PATH_INFO'] ?? '';
    $requestUri = $_SERVER['REQUEST_URI'] ?? '';

    if ($pathInfo === '' && strpos($requestUri, 'api-proxy.php/') !== false) {
        $parts = explode('api-proxy.php', $requestUri, 2);
        $pathInfo = $parts[1] ?? '';
    }

    if ($pathInfo === '' && isset($_GET['path'])) {
        $pathInfo = (string) $_GET['path'];
    }

    // Treat bare proxy hits as the API root instead of an error.
    if ($pathInfo === '') {
        return '/';
    }

    // Normalize to a single leading slash.
    if ($pathInfo[0] !== '/') {
        $pathInfo = '/' . $pathInfo;
    }

    // Collapse accidental double slashes in the path only.
    $pathInfo = preg_replace('#/+#', '/', $pathInfo);

    // Reject dot-segments. Without this, ?path=/../api/whatever produced a
    // target of "<base>/geoagora-api/../api/whatever", and curl normalises
    // that to "<base>/api/whatever" when it builds the request line — so the
    // /geoagora-api prefix could be escaped and any backend route reached
    // through this file, bypassing the allowlist that /verify/api-proxy.php
    // enforces for exactly this reason. That proxy was hardened against this
    // in cca23fa; these sibling copies were not, which left the control
    // undone by a file next door. Found 2026-08-05 during the /verify/ audit.
    if (preg_match('#(?:^|/)\.\.?(?:/|$)#', $pathInfo)) {
        http_response_code(400);
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
        echo json_encode(['ok' => false, 'error' => 'invalid_proxy_path']);
        exit;
    }

    return $pathInfo ?: '/';
}

/**
 * Forward query params except the internal rewrite helper param `path`.
 */
function buildForwardQueryString(): string
{
    $query = $_GET;
    unset($query['path']);

    if (empty($query)) {
        return '';
    }

    return http_build_query($query);
}

$pathInfo = getProxyPath();
$queryString = buildForwardQueryString();

$target = rtrim($GEOAGORA_API_BASE, '/') . $pathInfo;
if ($queryString !== '') {
    $target .= (strpos($target, '?') === false ? '?' : '&') . $queryString;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = file_get_contents('php://input');

// Forward a minimal but useful header set.
$headers = [];
if (!empty($_SERVER['HTTP_ACCEPT'])) {
    $headers[] = 'Accept: ' . $_SERVER['HTTP_ACCEPT'];
} else {
    $headers[] = 'Accept: application/json';
}

if (!empty($_SERVER['CONTENT_TYPE'])) {
    $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
} elseif ($method !== 'GET' && $method !== 'HEAD') {
    $headers[] = 'Content-Type: application/json';
}

if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $headers[] = 'Authorization: ' . $_SERVER['HTTP_AUTHORIZATION'];
}

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);

if ($method !== 'GET' && $method !== 'HEAD') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);

if ($response === false) {
    // Was echoing both curl's message and the full $target, which published
    // the backend tunnel URL to any visitor the moment the tunnel was down.
    // Logged server-side instead, matching /verify/api-proxy.php.
    error_log('[geoagora-proxy] request failed: ' . curl_error($ch) . ' target=' . $target);
    curl_close($ch);

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

// Default content type if upstream does not provide one.
$contentType = 'application/json';

// Try to preserve upstream content type.
foreach (explode("\r\n", $rawHeaders) as $line) {
    if (stripos($line, 'Content-Type:') === 0) {
        $contentType = trim(substr($line, strlen('Content-Type:')));
        break;
    }
}

http_response_code($statusCode ?: 200);
header('Content-Type: ' . $contentType);
header('Cache-Control: no-store');
echo $responseBody;