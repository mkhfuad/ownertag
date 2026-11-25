/* Sales CRM API. Three keys (Bearer):
   ADMIN_KEY       — everything, same key as /admin
   CRM_EDITOR_KEY  — read, add, edit and import companies (e.g. a mentor); no delete
   CRM_VIEWER_KEY  — read only
   The CRM keys open nothing else (no orders, no /admin).
   GET  /api/admin/crm          all companies (seeds the prospect list on first use)
   PUT  /api/admin/crm/:id      create or replace one company
   POST /api/admin/crm/bulk     import many companies (CSV import from the page)
   DELETE /api/admin/crm/:id    remove one company */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q, pool } from './db.js';
import { timingSafeEqual } from 'node:crypto';
import { requireAdmin } from './shop.js';

export const crm = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (status, error) => { const e = new Error(error); e.status = status; return e; };
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_DOC = 64 * 1024;

/* Who is calling: 'admin', 'editor' or 'viewer' (throws 401 otherwise). */
const keyMatches = (bearer, key) => {
  const b = Buffer.from(bearer), k = Buffer.from(String(key || ''));
  return !!key && key.length >= 12 && b.length === k.length && timingSafeEqual(b, k);
};
function crmRole(req, res) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
  for (const [role, key] of [['editor', process.env.CRM_EDITOR_KEY], ['viewer', process.env.CRM_VIEWER_KEY]])
    if (keyMatches(bearer, key)) { res.set('Cache-Control', 'no-store'); return role; }
  requireAdmin(req, res);
  return 'admin';
}
function requireCrmWriter(req, res) {
  if (crmRole(req, res) === 'viewer') throw bad(403, 'read_only');
}

/* Keep only known string fields (+ activity log) so the table can't hold junk. */
const FIELDS = ['name', 'segment', 'priority', 'status', 'city', 'info', 'why', 'role', 'source',
  'contact', 'email', 'phone', 'nextStep', 'nextDate', 'notes', 'updated'];
function clean(id, body) {
  if (!body || typeof body !== 'object') throw bad(400, 'invalid_body');
  const c = { id };
  for (const k of FIELDS) c[k] = String(body[k] ?? '').slice(0, k === 'notes' ? 5000 : 500);
  if (!c.name.trim()) throw bad(400, 'name_required');
  c.acts = (Array.isArray(body.acts) ? body.acts : []).slice(-100)
    .map(a => ({ d: String(a?.d ?? '').slice(0, 10), t: String(a?.t ?? '').slice(0, 20), x: String(a?.x ?? '').slice(0, 1000) }));
  if (JSON.stringify(c).length > MAX_DOC) throw bad(413, 'too_large');
  return c;
}

/* First open: load the bundled prospect list (src/data, not public). */
async function seedIfEmpty() {
  const { rows } = await q('SELECT count(*)::int AS n FROM crm_companies');
  if (rows[0].n > 0) return;
  let list = [];
  try { list = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'data', 'crm-seed.json'), 'utf8')); }
  catch { return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of list) {
      if (!ID.test(c.id)) continue;
      await client.query('INSERT INTO crm_companies (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [c.id, clean(c.id, c)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

crm.get('/admin/crm', wrap(async (req, res) => {
  const role = crmRole(req, res), readOnly = role === 'viewer';
  if (!readOnly) await seedIfEmpty();
  const { rows } = await q('SELECT data FROM crm_companies ORDER BY id');
  res.json({ companies: rows.map(r => r.data), readOnly, role });
}));

crm.put('/admin/crm/:id', wrap(async (req, res) => {
  requireCrmWriter(req, res);
  const id = req.params.id;
  if (!ID.test(id)) throw bad(400, 'invalid_id');
  const c = clean(id, { ...req.body, updated: new Date().toISOString() });
  await q(`INSERT INTO crm_companies (id, data, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [id, c]);
  res.json({ company: c });
}));

crm.post('/admin/crm/bulk', wrap(async (req, res) => {
  requireCrmWriter(req, res);
  const list = Array.isArray(req.body?.companies) ? req.body.companies.slice(0, 5000) : null;
  if (!list) throw bad(400, 'invalid_body');
  let added = 0;
  for (const raw of list) {
    const id = String(raw?.id ?? '');
    if (!ID.test(id) || !String(raw?.name ?? '').trim()) continue;
    const r = await q('INSERT INTO crm_companies (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, clean(id, raw)]);
    added += r.rowCount;
  }
  res.json({ added });
}));

crm.delete('/admin/crm/:id', wrap(async (req, res) => {
  requireAdmin(req, res);
  if (!ID.test(req.params.id)) throw bad(400, 'invalid_id');
  await q('DELETE FROM crm_companies WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));
