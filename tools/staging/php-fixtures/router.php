<?php
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/verify/api-proxy.php') { require '/work/api-proxy.php'; return; }
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/xl1/verify/api-proxy.php') { require '/work/geo-api-proxy.php'; return; }
http_response_code(404);
