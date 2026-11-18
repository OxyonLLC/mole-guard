<?php
// Real PHP/cURL transport, local fixture upstream, no production networking.
if (!function_exists('curl_init')) { fwrite(STDERR, "curl extension unavailable\n"); exit(1); }
$processes = [];
function request($query, $method = 'GET', $body = null, $headers = [], $surface = '/verify/api-proxy.php') {
  $ch = curl_init('http://127.0.0.1:19092' . $surface . $query);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 5,
    CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
  $raw = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
  $result = ['code' => $code, 'headers' => substr($raw, 0, $size), 'body' => substr($raw, $size)]; curl_close($ch); return $result;
}
function check($condition, $name, &$results) { $results[] = ['name' => $name, 'pass' => (bool)$condition]; if (!$condition) throw new Exception($name); }
$results = [];
try {
  foreach ([['19091', '/work/upstream.php'], ['19092', '/work/router.php']] as [$port, $router]) {
    $processes[] = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . $port, $router],
      [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/tmp/server-' . $port . '.log', 'a'], 2 => ['file', '/tmp/server-' . $port . '.log', 'a']], $pipes);
  }
  for ($i = 0; $i < 30; $i++) { $r = request('?path=/api/mock'); if ($r['code'] === 200) break; usleep(100000); }
  check($r['code'] === 200, 'startup uses only local fixture upstream', $results);
  check(stripos($r['headers'], 'Cache-Control: no-store') !== false, 'account API responses never cache', $results);
  check(request('')['code'] === 400, 'missing proxy path rejected', $results);
  check(request('?path=' . urlencode('/api/../admin'))['code'] === 400, 'literal traversal rejected', $results);
  check(request('?path=/admin')['code'] === 400, 'non-API paths rejected', $results);
  check(request('?path=' . urlencode('/api/%2e%2e/admin'))['code'] === 400, 'encoded traversal rejected', $results);
  check(request('?path=' . urlencode('/api/%252e%252e/admin'))['code'] === 400, 'double-encoded traversal rejected', $results);
  $post = request('?path=/api/mock', 'POST', ['synthetic' => true], ['Content-Type: application/json', 'x-winlew-session: synthetic-local-session', 'x-winlew-proxy-secret: forged']);
  $data = json_decode($post['body'], true);
  check($post['code'] === 200 && $data['method'] === 'POST' && $data['body']['synthetic'] === true, 'JSON POST forwarded', $results);
  check($data['session'] === 'synthetic-local-session', 'session header forwarded', $results);
  check($data['proxySecret'] === 'synthetic-local-proxy-secret', 'client secret cannot override proxy credential', $results);
  check(request('?path=/api/mock-unauthorized')['code'] === 401, 'expired session status preserved', $results);
  $outage = request('?path=/api/mock-unavailable');
  check($outage['code'] === 503 && json_decode($outage['body'], true)['error'] === 'backend_unavailable' && strpos($outage['body'], '<html>') === false, 'upstream outage body sanitized', $results);
  check(request('?path=/api/mock-redirect')['code'] === 502, 'unapproved redirect host blocked', $results);
  check(request('?path=/health', 'GET', null, [], '/xl1/verify/api-proxy.php')['code'] === 200, 'GeoHackers proxy uses configured local upstream', $results);
  check(request('?path=' . urlencode('/api/%2e%2e/admin'), 'GET', null, [], '/xl1/verify/api-proxy.php')['code'] === 400, 'GeoHackers encoded traversal rejected', $results);
  echo json_encode(['ok' => true, 'php' => PHP_VERSION, 'tests' => $results]);
} catch (Throwable $error) { echo json_encode(['ok' => false, 'failed' => $error->getMessage(), 'tests' => $results]); exit(1); }
finally { foreach ($processes as $process) if (is_resource($process)) { proc_terminate($process); proc_close($process); } }
