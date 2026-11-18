<?php
/**
 * TEMPORARY. Upload to the web root, load it ONCE over https AND once over
 * http, write down what it says, then DELETE IT.
 *
 * Why it exists: winlew.co serves plain http:// with a 200 instead of
 * redirecting, and src/public/.htaccess deliberately does NOT force HTTPS —
 * "many shared hosts/CDN setups already terminate SSL upstream, which can cause
 * redirect loops". That warning is correct and this answers whether it applies
 * here: if TLS is terminated at the openresty edge, Apache sees a plain HTTP
 * request on BOTH visits, `%{HTTPS}` reads "off" every time, and a naive force
 * rule redirects forever.
 *
 * It prints only what is needed to decide, and nothing about the visitor.
 */
header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

$keys = [
    'HTTPS',
    'SERVER_PORT',
    'REQUEST_SCHEME',
    'HTTP_X_FORWARDED_PROTO',
    'HTTP_X_FORWARDED_SSL',
    'HTTP_X_FORWARDED_PORT',
    'HTTP_FRONT_END_HTTPS',
    'HTTP_CF_VISITOR',
];

foreach ($keys as $k) {
    printf("%-24s %s\n", $k, isset($_SERVER[$k]) ? var_export($_SERVER[$k], true) : '(not set)');
}

echo "\n";
echo "READ IT LIKE THIS\n";
echo "  Over https, HTTPS='on'                  -> Apache sees the real scheme.\n";
echo "     A plain `RewriteCond %{HTTPS} off` force rule is SAFE.\n";
echo "  Over https, HTTPS not set BUT\n";
echo "  HTTP_X_FORWARDED_PROTO='https'          -> TLS ends at the edge.\n";
echo "     Key the rule off X-Forwarded-Proto, never off %{HTTPS}.\n";
echo "  Over https, neither is set              -> Apache CANNOT tell.\n";
echo "     Do NOT write a force rule at all; use the hosting panel toggle.\n";
