<?php
// Only mounted in a fresh --network none, read-only test container.
header('Content-Type: application/json');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/api/mock-unavailable') { http_response_code(502); echo '<html>synthetic upstream outage</html>'; return; }
if ($path === '/api/mock-redirect') { header('Location: https://unapproved.invalid/', true, 302); return; }
if ($path === '/api/mock-unauthorized') { http_response_code(401); echo '{"error":"session_expired"}'; return; }
echo json_encode(['ok' => true, 'path' => $path, 'method' => $_SERVER['REQUEST_METHOD'],
  'session' => $_SERVER['HTTP_X_WINLEW_SESSION'] ?? '',
  'proxySecret' => $_SERVER['HTTP_X_WINLEW_PROXY_SECRET'] ?? '',
  'body' => json_decode(file_get_contents('php://input'), true)]);
