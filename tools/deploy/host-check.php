<?php
// Owner-run private PHP preflight. CLI only, never install in document root.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$checks = ['curl' => extension_loaded('curl'), 'openssl' => extension_loaded('openssl')];
foreach (['WINLEW_API_BASE', 'GEOHACKERS_API_BASE', 'GEOAGORA_API_BASE'] as $key) {
    $value = getenv($key) ?: '';
    $parts = parse_url($value);
    $checks[$key] = is_array($parts) && ($parts['scheme'] ?? '') === 'https'
        && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['query'])
        && !isset($parts['fragment']) && !preg_match('/example|invalid|REPLACE/i', $parts['host'] ?? 'invalid');
}
$secret = getenv('WINLEW_PROXY_SECRET') ?: '';
$checks['proxy_secret_configured'] = (bool)preg_match('/^[\x21-\x7e]{8,256}$/', $secret)
    && strpos($secret, 'REPLACE') === false;
echo json_encode(['ok' => !in_array(false, $checks, true), 'checks' => $checks], JSON_PRETTY_PRINT) . "\n";
exit(in_array(false, $checks, true) ? 1 : 0);
