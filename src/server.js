import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { q } from './db.js';
import { redis } from './redis.js';
import { api } from './routes.js';
import { shop } from './shop.js';
import { webhooks } from './webhooks.js';
import { startCleanup } from './cleanup.js';

const app = express();
const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));   // Twilio webhooks are form-encoded

/* Minimal cookie parsing — one cookie, no dependency needed */
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]));
  next();
});

/* Security headers */
app.use((_req, res, next) => {
  res.set({
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    // ponytail: 'unsafe-inline' because activate/owner pages use inline scripts;
    // proper fix = extract them to .js files, then drop it. User content is escaped.
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' data:",
  });
  next();
});

/* Cache policy: API responses are personal/ephemeral → never cached;
   static assets are fingerprint-free but small → 1 h browser/CDN cache */
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', api);
app.use('/api', shop);
app.use('/webhooks', webhooks);
app.get('/shop', (_req, res) => res.sendFile(join(pub, 'shop.html')));
app.use(express.static(pub, { maxAge: '1h' }));

/* Scan URL: /t/{tagId} → scan page (PWA fetches /api/tags/{tagId}) */
app.get('/t/:tagId', (_req, res) => res.sendFile(join(pub, 'scan.html')));
app.get('/owner', (_req, res) => res.sendFile(join(pub, 'owner.html')));
app.get('/admin', (_req, res) => res.sendFile(join(pub, 'admin.html')));
for (const page of ['impressum', 'datenschutz', 'agb'])
  app.get(`/${page}`, (_req, res) => res.sendFile(join(pub, `${page}.html`)));
/* Liveness: process is up (for orchestrator restarts). Readiness: dependencies
   answer — the load balancer must drain an instance whose DB/Redis is dead
   instead of serving 500s. Render's healthCheckPath points at /healthz. */
app.get('/livez', (_req, res) => res.json({ ok: true }));
app.get('/healthz', async (_req, res) => {
  try {
    await q('SELECT 1');
    await redis.ping();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.code || 'unavailable' });
  }
});

/* Error handler — generic messages out, details stay in logs (never PII) */
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'internal' : err.message });
});

app.listen(config.port, () => {
  console.log(`ownertag listening on :${config.port}`);
  startCleanup();
});
