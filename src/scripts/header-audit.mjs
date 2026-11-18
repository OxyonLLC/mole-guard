#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Moved 2026-08-05 from src/public/scripts/ to here, alongside every other dev
// tool. It had been living inside the published web root, so this build script
// was downloadable at https://winlew.co/scripts/header-audit.mjs — harmless to
// read (no secrets, and nothing on the site loads it) but it is tooling, not
// site content, and the web root should only hold things meant to be served.
const publicRoot = path.resolve(__dirname, '../public');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
};

// Must cover every internal path in nav.js's NAV_GROUPS — this list is what
// the header audit actually visits, so anything absent here is a page whose
// nav can break without any tool noticing. It had drifted by 13 routes,
// including /home/, /proof-of-value/, /links/, /merch/, /mole-link/ and all
// seven /ecosystem/ pages; seven of those turned out to be rendering the
// wrong nav identity entirely. test/nav/navRouteCoverage.test.mjs now fails
// if NAV_GROUPS gains a route this list doesn't have.
const DEFAULT_ROUTES = [
  '/about/',
  '/',
  '/bounties/',
  '/news/',
  '/ecosystem/geoagora/',
  '/ecosystem/geohackers/',
  '/ecosystem/geojustice/',
  '/ecosystem/geopresence/',
  '/ecosystem/geoproof/',
  '/ecosystem/geowallet/',
  '/ecosystem/ublock/',
  '/home/',
  '/links/',
  '/merch/',
  '/mole-link/',
  '/xl1/',
  '/xl1/arcade/',
  '/community/',
  '/hodl/',
  '/no-thank-you/promotions/',
  '/proof-of-value/',
  '/burn/',
  '/contact/',
  '/contribute/',
  '/discord-bots/',
  '/events/',
  '/faucet/',
  '/governance/',
  '/governance/proposal/',
  '/governance/submit/',
  '/health/',
  '/leaderboards/',
  '/modules/',
  '/mole-hub/',
  '/partners/',
  '/policies/',
  '/quiz/',
  '/roadmap/',
  '/transparency/',
  '/giveaways/',
  '/verify/',
  '/verify/profile.html',
  '/who-we-are/',
  '/whitepaper/',
  '/winlew-forge/',
  '/xyo/',
];

const DEFAULT_WIDTHS = [1920, 1440, 1280, 1024, 768, 430, 390, 360];
const DEFAULT_ZOOMS = [0.8, 1, 1.25, 1.5, 2];

function parseList(value, mapFn) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(mapFn);
}

function parseArgs(argv) {
  const options = {
    chrome: process.env.CHROME_BIN || '',
    output: '',
    port: 8137,
    quick: false,
    routes: DEFAULT_ROUTES.slice(),
    widths: DEFAULT_WIDTHS.slice(),
    zooms: DEFAULT_ZOOMS.slice(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--chrome') options.chrome = argv[index + 1] || options.chrome;
    if (arg === '--chrome') index += 1;
    else if (arg === '--output') { options.output = argv[index + 1] || ''; index += 1; }
    else if (arg === '--port') { options.port = Number(argv[index + 1] || options.port); index += 1; }
    else if (arg === '--quick') options.quick = true;
    else if (arg === '--routes') { options.routes = parseList(argv[index + 1], (entry) => entry); index += 1; }
    else if (arg === '--widths') { options.widths = parseList(argv[index + 1], (entry) => Number(entry)); index += 1; }
    else if (arg === '--zooms') { options.zooms = parseList(argv[index + 1], (entry) => Number(entry)); index += 1; }
  }

  if (options.quick) {
    options.widths = [1440, 1024, 390];
    options.zooms = [1, 1.5];
  }

  return options;
}

function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? 'msedge.exe' : '',
    process.platform === 'linux' ? 'google-chrome' : '',
    process.platform === 'linux' ? 'chromium-browser' : '',
    process.platform === 'linux' ? 'chromium' : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && fs.existsSync(candidate)) return candidate;
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('No Chrome/Chromium executable found. Pass --chrome /path/to/chrome.');
}

function withinRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === publicRoot || resolved.startsWith(`${publicRoot}${path.sep}`);
}

function resolveStaticPath(urlPath) {
  const safePath = decodeURIComponent(urlPath.split('?')[0] || '/');
  let target = path.join(publicRoot, safePath);
  if (!withinRoot(target)) return null;

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  } else if (!fs.existsSync(target) && safePath.endsWith('/')) {
    target = path.join(target, 'index.html');
  }

  if (!withinRoot(target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return null;
  return target;
}

function auditHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WinLEW Header Audit</title>
  <style>
    html, body { margin: 0; padding: 0; background: #111; color: #eee; font: 14px/1.4 system-ui, sans-serif; }
    iframe { display: block; border: 0; width: 100%; height: 100vh; }
    pre { margin: 0; padding: 16px; white-space: pre-wrap; }
  </style>
</head>
<body>
<pre id="out">Loading…</pre>
<iframe id="frame" title="audit target"></iframe>
<script>
  const params = new URLSearchParams(window.location.search);
  const route = params.get('route') || '/';
  const width = Math.max(320, Number(params.get('width') || 1024));
  const height = Math.max(320, Number(params.get('height') || 768));
  const zoom = Math.max(0.5, Number(params.get('zoom') || 1));
  const token = params.get('token') || '';
  const frame = document.getElementById('frame');
  frame.style.width = width + 'px';
  frame.style.height = height + 'px';
  frame.src = route;

  function text(el) {
    return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  }

  function postResult(report) {
    document.getElementById('out').textContent = JSON.stringify(report, null, 2);
    if (!token) return;
    fetch('/.header-audit/report?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(report),
    }).catch((error) => {
      document.getElementById('out').textContent = JSON.stringify({
        route,
        width,
        height,
        zoom,
        error: 'report_post_failed',
        detail: String(error && error.message || error),
      }, null, 2);
    });
  }

  function collectReport() {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      postResult({ route, width, height, zoom, error: 'no_document' });
      return;
    }

    doc.documentElement.style.zoom = String(zoom);

    const nav = doc.querySelector('.nav');
    const brand = nav && nav.querySelector('.navBrandShell, .brandMark.arcadeBrand, .navBrand, .brandMark');
    const subtitle = brand && brand.querySelector('.brandSub');
    const navPrimary = nav && nav.querySelector('.navPrimary');
    const arcadeLinks = nav && nav.querySelector('.arcadeLinks');
    const navRight = nav && nav.querySelector('.navRight');
    const toggle = nav && nav.querySelector('.navToggle');
    const dashboard = nav && nav.querySelector('.navProfile');
    const wallet = nav && nav.querySelector('#navWalletConnect');
    const metric = nav && nav.querySelector('#navWalletAmount, #navPointsAmount');
    const metricChip = metric && metric.closest('.navMetricChip, .navBalanceChip, .walletPill');
    const metricKind = metricChip && metricChip.querySelector('.navMetricKind');
    const activeLinks = nav ? nav.querySelectorAll('.pill.active').length : 0;
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const brandRect = brand ? brand.getBoundingClientRect() : null;
    const rightRect = navRight ? navRight.getBoundingClientRect() : null;
    const navStyles = navPrimary ? win.getComputedStyle(navPrimary) : null;
    const arcadeStyles = arcadeLinks ? win.getComputedStyle(arcadeLinks) : null;
    const subtitleStyles = subtitle ? win.getComputedStyle(subtitle) : null;

    postResult({
      route,
      width,
      height,
      zoom,
      scrollWidth: doc.documentElement.scrollWidth,
      clientWidth: doc.documentElement.clientWidth,
      navExists: Boolean(nav),
      navHeight: navRect ? Math.round(navRect.height) : null,
      brandText: text(brand),
      brandVisible: brandRect ? brandRect.width > 0 && brandRect.left >= -1 : false,
      brandLeft: brandRect ? Math.round(brandRect.left) : null,
      brandRight: brandRect ? Math.round(brandRect.right) : null,
      subtitle: text(subtitle),
      subtitleDisplay: subtitleStyles ? subtitleStyles.display : null,
      primaryDisplay: navStyles ? navStyles.display : null,
      arcadeDisplay: arcadeStyles ? arcadeStyles.display : null,
      primaryCount: navPrimary ? navPrimary.querySelectorAll('a').length : 0,
      arcadeCount: arcadeLinks ? arcadeLinks.querySelectorAll('a').length : 0,
      activeLinks,
      dashboardVisible: Boolean(dashboard && dashboard.getBoundingClientRect().width > 0),
      walletVisible: Boolean(wallet && wallet.getBoundingClientRect().width > 0),
      walletText: text(wallet),
      metricKind: text(metricKind),
      metricText: text(metric),
      toggleVisible: Boolean(toggle && toggle.getBoundingClientRect().width > 0),
      navRightLeft: rightRect ? Math.round(rightRect.left) : null,
      navRightRight: rightRect ? Math.round(rightRect.right) : null
    });
  }

  frame.addEventListener('load', () => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(collectReport);
      });
    }, 300);
  });
</script>
</body>
</html>`;
}

function decodeAuditResult(html) {
  const match = html.match(/<pre id="out">([\s\S]*?)<\/pre>/i);
  if (!match) return { error: 'no_pre' };
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  try {
    return JSON.parse(decoded);
  } catch (error) {
    return { error: `parse:${error.message}`, raw: decoded };
  }
}

function startServer(port) {
  const pendingReports = new Map();

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (requestUrl.pathname === '/.header-audit') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(auditHtml());
      return;
    }

    if (requestUrl.pathname === '/.header-audit/report') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
      }
      const token = requestUrl.searchParams.get('token') || '';
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: `invalid_json:${error.message}` }));
          return;
        }
        const pending = pendingReports.get(token);
        if (pending) {
          pending.resolve(payload);
          pendingReports.delete(token);
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    const staticPath = resolveStaticPath(requestUrl.pathname + requestUrl.search);
    if (!staticPath) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(staticPath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(staticPath).pipe(res);
  });

  function waitForReport(token, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingReports.delete(token);
        reject(new Error(`audit_timeout:${token}`));
      }, timeoutMs);

      pendingReports.set(token, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, waitForReport }));
  });
}

function stopChrome(proc) {
  if (!proc || proc.killed) return;
  proc.kill();
}

async function runChromeAudit(chrome, harness, port, route, width, height, zoom) {
  const token = crypto.randomUUID();
  const launchWidth = Math.max(480, Math.min(2400, width + 80));
  const launchHeight = Math.max(480, height + 120);
  const url = `http://127.0.0.1:${port}/.header-audit/?route=${encodeURIComponent(route)}&width=${width}&height=${height}&zoom=${zoom}&token=${encodeURIComponent(token)}`;
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--virtual-time-budget=8000',
    `--window-size=${launchWidth},${launchHeight}`,
    '--dump-dom',
    url,
  ];
  const chromeProc = spawn(chrome, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  chromeProc.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  chromeProc.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const waitForExit = new Promise((resolve) => {
    chromeProc.once('exit', (code, signal) => resolve({ code, signal }));
  });

  try {
    const report = await harness.waitForReport(token, 15000);
    stopChrome(chromeProc);
    await Promise.race([
      waitForExit,
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
    return report;
  } catch (error) {
    stopChrome(chromeProc);
    const exit = await Promise.race([
      waitForExit,
      new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
    ]);
    const parsed = stdout ? decodeAuditResult(stdout) : null;
    if (parsed && !parsed.error) return parsed;
    return {
      route,
      width,
      height,
      zoom,
      error: stderr.trim() || error.message || (exit ? `chrome_exit_${exit.code}` : 'audit_failed'),
    };
  }
}

function evaluateAudit(result) {
  const failures = [];
  if (!result.navExists) failures.push('missing_nav');
  if (!result.brandVisible) failures.push('brand_hidden');
  if (result.activeLinks !== 1) failures.push(`active_links_${result.activeLinks}`);
  if (!result.dashboardVisible) failures.push('missing_dashboard');
  if (!result.walletVisible) failures.push('missing_wallet');
  if (!result.toggleVisible) failures.push('missing_menu');
  if (result.scrollWidth > result.clientWidth) failures.push('horizontal_overflow');
  if (result.primaryDisplay !== 'none' && result.primaryCount > 5) failures.push(`primary_count_${result.primaryCount}`);
  if (result.arcadeDisplay && result.arcadeDisplay !== 'none' && result.arcadeCount > 5) failures.push(`arcade_count_${result.arcadeCount}`);
  return failures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const chrome = findChrome(options.chrome);
  const harness = await startServer(options.port);
  const summary = {
    generatedAt: new Date().toISOString(),
    chrome,
    port: options.port,
    publicRoot,
    routes: options.routes,
    widths: options.widths,
    zooms: options.zooms,
    checks: [],
    failures: [],
  };

  try {
    for (const route of options.routes) {
      for (const width of options.widths) {
        const height = width >= 768 ? 900 : 844;
        const result = await runChromeAudit(chrome, harness, options.port, route, width, height, 1);
        const issues = evaluateAudit(result);
        summary.checks.push({ route, width, height, zoom: 1, issues, result });
        if (issues.length || result.error) summary.failures.push({ route, width, height, zoom: 1, issues, result });
      }
    }

    for (const route of options.routes.filter((entry) => ['/quiz/', '/health/', '/burn/', '/whitepaper/', '/roadmap/', '/about/'].includes(entry))) {
      for (const zoom of options.zooms) {
        const result = await runChromeAudit(chrome, harness, options.port, route, 1024, 768, zoom);
        const issues = evaluateAudit(result);
        summary.checks.push({ route, width: 1024, height: 768, zoom, issues, result });
        if (issues.length || result.error) summary.failures.push({ route, width: 1024, height: 768, zoom, issues, result });
      }
    }
  } finally {
    await new Promise((resolve) => harness.server.close(resolve));
  }

  summary.totalChecks = summary.checks.length;
  summary.failureCount = summary.failures.length;

  const output = JSON.stringify(summary, null, 2);
  if (options.output) fs.writeFileSync(path.resolve(options.output), output);
  process.stdout.write(`${output}\n`);
  process.exitCode = summary.failureCount ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
