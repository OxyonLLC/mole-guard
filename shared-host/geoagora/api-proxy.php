<?php
$path = $_GET['path'] ?? '';
$targetBase = 'https://orthomorphic-laevorotatory-trista.ngrok-free.dev/geoagora-api'; // replace if your ngrok URL changes
$target = rtrim($targetBase, '/') . '/' . ltrim($path, '/');

if (!empty($_SERVER['QUERY_STRING'])) {
    $qs = preg_replace('/(^|&)path=[^&]*/', '', $_SERVER['QUERY_STRING']);
    $qs = trim($qs, '&');
    if ($qs !== '') {
        $target .= '?' . $qs;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

$headers = [];
foreach (function_exists('getallheaders') ? getallheaders() : [] as $k => $v) {
    $lk = strtolower($k);
    if ($lk === 'host' || $lk === 'origin' || $lk === 'referer') continue;
    $headers[] = "$k: $v";
}
$headers[] = 'ngrok-skip-browser-warning: true';
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$input = file_get_contents('php://input');
if ($input !== false && $input !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
}

$response = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
if ($response === false) {
    $error = curl_error($ch);
    curl_close($ch);
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'proxy_failed', 'detail' => $error]);
    exit;
}
curl_close($ch);

if ($contentType) header("Content-Type: $contentType");
http_response_code($code ?: 502);
echo $response;
