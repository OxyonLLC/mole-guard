import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getForgeCatalog, normalizeForgeRequest, routeForgePrompt } from './winlew-forge/ai-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PUBLIC_PORT || 8788);
const PRIMARY_PORT = Number(process.env.PORT || 8787);
const HOST = process.env.PUBLIC_HOST || process.env.HOST || '127.0.0.1';
const PRIMARY_TARGET = `http://127.0.0.1:${PRIMARY_PORT}`;

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan('dev'));
app.use((_req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/forge/health', (_req, res) => {
  res.json({ ok: true, service: 'winlew-forge', port: PORT });
});

app.get('/api/forge/catalog', (_req, res) => {
  res.json({ ok: true, catalog: getForgeCatalog() });
});

app.post('/api/forge/ai', async (req, res) => {
  try {
    const input = normalizeForgeRequest(req.body || {});
    const result = await routeForgePrompt(input);
    res.json({ ok: true, result });
  } catch (error) {
    const message = error?.message || 'Forge AI routing failed.';
    res.status(500).json({ ok: false, error: message });
  }
});

// Keep the auxiliary public server scoped to Forge instead of exposing a
// second copy of every WinLEW page on a different port.
app.use('/api', createProxyMiddleware({
  target: PRIMARY_TARGET,
  changeOrigin: false,
  logLevel: 'warn',
}));

app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use('/winlew-forge', express.static(path.join(PUBLIC_DIR, 'winlew-forge'), { extensions: ['html'] }));
app.get('/winlew-forge.html', (_req, res) => res.redirect(301, '/winlew-forge/'));
app.get('/', (_req, res) => res.redirect(302, '/winlew-forge/'));
app.get('/health', (_req, res) => res.json({ ok: true, port: PORT }));

function buildPrimaryUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const hostHeader = req.get('host') || 'localhost';
  let url;
  try {
    url = new URL(`${protocol}://${hostHeader}`);
  } catch {
    url = new URL(`http://localhost:${PORT}`);
  }
  url.port = String(PRIMARY_PORT);
  url.pathname = req.path;
  url.search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return url.toString();
}

app.use((req, res) => {
  res.redirect(302, buildPrimaryUrl(req));
});
app.listen(PORT, HOST, () => {
  console.log(`🌐 Public site on http://${HOST}:${PORT}`);
  console.log(`📁 Serving static from: ${PUBLIC_DIR}`);
  console.log(`🧭 Primary Mole web/API target: ${PRIMARY_TARGET}`);
});
