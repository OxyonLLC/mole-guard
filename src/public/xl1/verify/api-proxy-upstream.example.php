<?php

// Template for api-proxy-upstream.php (git-ignored; never commit the real one).
//
// Copy this file to api-proxy-upstream.php next to it, on the web host, and put
// the address where the GeoHackers verification server is reachable from that
// host. api-proxy.php includes it and uses the returned string as its upstream.
//
// A plain (non-Funnel) *.ts.net address will NOT work: the web host is not on
// the tailnet. Use a Tailscale Funnel URL (public HTTPS, no tailnet needed) or a
// real API domain. No trailing path: the proxy appends the request path itself.
//
// If the funnel stops working, check `tailscale funnel` is still running on the
// bot machine (it is not boot-persistent) before assuming the hostname changed.
return 'https://your-bot-host.example.ts.net';
