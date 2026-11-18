<?php
// Oxyon Lab — read-only hosting capability probe.
// Prints capabilities only: no secrets, env vars, credentials, or filesystem paths.
// Runs no shell commands and changes nothing outside a temp file it deletes immediately.
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function line(string $k, string $v): void { echo str_pad($k, 26) . $v . "\n"; }
function yn(bool $b): string { return $b ? 'YES' : 'NO'; }

echo "=== OXYON LAB: HOSTING CAPABILITY PROBE ===\n";
line('Generated (UTC)', gmdate('Y-m-d H:i:s'));

echo "\n=== RUNTIME ===\n";
line('PHP version', PHP_VERSION);
line('SAPI', PHP_SAPI);
$sw = (string)($_SERVER['SERVER_SOFTWARE'] ?? 'unknown');
line('Server family', preg_split('#[/ ]#', $sw)[0] ?: 'unknown'); // e.g. "Apache", no version/modules
line('max_execution_time', (string)ini_get('max_execution_time') . 's');
line('memory_limit', (string)ini_get('memory_limit'));
line('upload_max_filesize', (string)ini_get('upload_max_filesize'));
line('post_max_size', (string)ini_get('post_max_size'));
line('allow_url_fopen', yn((bool)ini_get('allow_url_fopen')));
line('open_basedir', ini_get('open_basedir') ? 'restricted' : 'not set');
$disabled = array_filter(array_map('trim', explode(',', (string)ini_get('disable_functions'))));
line('disable_functions', count($disabled) . ' disabled');

echo "\n=== FUNCTIONS ===\n";
foreach (['exec', 'shell_exec', 'system', 'passthru', 'proc_open', 'popen',
          'curl_init', 'fsockopen', 'stream_socket_client', 'ignore_user_abort',
          'set_time_limit', 'mail'] as $fn) {
    line($fn, function_exists($fn) && !in_array($fn, $disabled, true) ? 'AVAILABLE' : 'DISABLED');
}

echo "\n=== EXTENSIONS ===\n";
foreach (['curl', 'openssl', 'sodium', 'json', 'mbstring', 'gd', 'pdo', 'pdo_mysql',
          'pdo_sqlite', 'mysqli', 'sqlite3', 'session', 'zip'] as $ext) {
    line($ext, yn(extension_loaded($ext)));
}
line('hash sha256', yn(in_array('sha256', hash_algos(), true)));
line('hash sha3-256', yn(in_array('sha3-256', hash_algos(), true)));

echo "\n=== OUTBOUND HTTPS (cURL) ===\n";
// External hosts first. The old probe only tried winlew.co itself, which can fail
// from inside the host (hairpin routing) even when outbound HTTPS works fine.
$targets = [
    'XL1 RPC (mainnet)'   => 'https://api.chain.xyo.network/rpc',
    'XL1 RPC (sequence)'  => 'https://beta.api.chain.xyo.network/rpc',
    'XL1 data lake'       => 'https://api.archivist.xyo.network/dataLake',
    'Generic (Google)'    => 'https://www.google.com/generate_204',
    'Self (winlew.co)'    => 'https://winlew.co/',
];
if (function_exists('curl_init')) {
    foreach ($targets as $label => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_NOBODY         => true,
            CURLOPT_TIMEOUT        => 6,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT      => 'OxyonLabProbe/1.0',
        ]);
        $t = microtime(true);
        $ok = curl_exec($ch) !== false;
        $ms = (int)round((microtime(true) - $t) * 1000);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        // Any HTTP status (even 404/405) proves the TLS connection succeeded.
        line($label, $ok ? "REACHED (HTTP $code, {$ms}ms)" : 'FAILED (' . curl_errno($ch) . ')');
        curl_close($ch);
    }
} else {
    echo "cURL unavailable.\n";
}

echo "\n=== XL1 JSON-RPC ROUND TRIP ===\n";
if (function_exists('curl_init')) {
    $ch = curl_init('https://api.chain.xyo.network/rpc');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode(['jsonrpc' => '2.0', 'id' => 1,
                                   'method' => 'blockViewer_currentBlock', 'params' => []]),
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_USERAGENT      => 'OxyonLabProbe/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false) {
        line('RPC POST', 'FAILED');
    } else {
        $j = json_decode((string)$body, true);
        $blk = is_array($j) ? ($j['result'][0]['block'] ?? null) : null;
        $res = $blk !== null ? 'live XL1 block #' . (int)$blk
             : (is_array($j) && array_key_exists('result', $j) ? 'result received'
             : (is_array($j) && isset($j['error']) ? 'JSON-RPC error (server reachable)' : 'non-JSON reply'));
        line('RPC POST', "HTTP $code, $res");
    }
}

echo "\n=== RAW SOCKET ===\n";
if (function_exists('fsockopen')) {
    $errno = 0; $errstr = '';
    $s = @fsockopen('ssl://api.chain.xyo.network', 443, $errno, $errstr, 4);
    line('fsockopen ssl:443', $s ? 'CONNECTED' : "FAILED ($errno)");
    if ($s) fclose($s);
}

echo "\n=== FILE WRITE (temp file, deleted at once) ===\n";
$tmp = __DIR__ . '/.probe-' . bin2hex(random_bytes(6)) . '.tmp';
$w = @file_put_contents($tmp, 'oxyon lab write test');
line('Write in web dir', $w !== false ? 'SUCCESS' : 'FAILED');
if ($w !== false) line('Delete', @unlink($tmp) ? 'SUCCESS' : 'FAILED (remove .probe-*.tmp manually)');

echo "\n=== SQLITE (in-memory, nothing stored) ===\n";
try {
    $db = new PDO('sqlite::memory:');
    $db->exec('CREATE TABLE t (h TEXT)');
    $db->exec("INSERT INTO t VALUES ('" . hash('sha256', 'oxyon') . "')");
    line('PDO SQLite', $db->query('SELECT COUNT(*) FROM t')->fetchColumn() == 1 ? 'WORKS' : 'UNEXPECTED');
} catch (Throwable $e) {
    line('PDO SQLite', 'UNAVAILABLE');
}

echo "\n=== NOT TESTABLE FROM PHP ===\n";
echo "Node.js runtime   -> open node-test.js; plain source text = not executed\n";
echo "Persistent workers / websockets / cron -> check the hosting control panel\n";

echo "\n=== COMPLETE ===\n";
