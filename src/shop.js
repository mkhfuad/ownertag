/* Shop: order intake + admin list. No payment gateway yet —
   ponytail: Rechnung/Vorkasse manual flow; add Stripe Checkout when volume
   justifies it (one endpoint + webhook, the orders table already fits). */
import { Router } from 'express';
import { q } from './db.js';
import { redis } from './redis.js';
import { encrypt, decrypt, newTagId } from './crypto.js';
import { fingerprintOf } from './ratelimit.js';

export const shop = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (status, error) => { const e = new Error(error); e.status = status; return e; };

const PRICE_CENTS = 2490;

shop.post('/orders', wrap(async (req, res) => {
  const fp = fingerprintOf(req);
  const n = await redis.incr(`rl:order:${fp}`);
  if (n === 1) await redis.expire(`rl:order:${fp}`, 3600);
  if (n > 3) throw bad(429, 'rate_limited');

  const { name, email, phone, address, qty, payment } = req.body || {};
  const quantity = Math.floor(Number(qty));
  if (!name || String(name).trim().length < 2) throw bad(400, 'bad_name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw bad(400, 'bad_email');
  if (!address || String(address).trim().length < 10) throw bad(400, 'bad_address');
  if (!(quantity >= 1 && quantity <= 20)) throw bad(400, 'bad_qty');
  const pay = payment === 'vorkasse' ? 'vorkasse' : 'rechnung';

  const { rows: [o] } = await q(
    `INSERT INTO orders (name, email_enc, phone_enc, address_enc, qty, amount_cents, payment)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [String(name).trim().slice(0, 120), encrypt(String(email).trim()),
     phone ? encrypt(String(phone).trim()) : null,
     encrypt(String(address).trim().slice(0, 500)), quantity, quantity * PRICE_CENTS, pay]);

  /* Notify shop ops if configured; order is safely stored either way */
  if (process.env.ORDER_NOTIFY_EMAIL) {
    const { sendEmail } = await import('./notify.js');
    sendEmail(process.env.ORDER_NOTIFY_EMAIL, `OwnerTag Bestellung #${o.id}`,
      `${quantity}x Tag — ${(quantity * PRICE_CENTS / 100).toFixed(2)} € (${pay})\nAdmin: /api/admin/orders`)
      .catch(() => {});          // best effort — the order is already stored
  }
  if (process.env.NODE_ENV !== 'production')
    console.log(`[dev-order] #${o.id} — ${quantity}x tag, ${(quantity * PRICE_CENTS / 100).toFixed(2)} €, ${pay}`);

  res.json({ ok: true, orderId: o.id, amount: quantity * PRICE_CENTS });
}));

/* Admin: list orders (decrypted). Guard: ADMIN_KEY env, query param `key`. */
shop.get('/admin/orders', wrap(async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) throw bad(401, 'unauthorized');
  const { rows } = await q(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`);
  res.json({
    orders: rows.map(o => ({
      id: o.id, name: o.name, email: decrypt(o.email_enc),
      phone: o.phone_enc ? decrypt(o.phone_enc) : null,
      address: decrypt(o.address_enc),
      qty: o.qty, amount_eur: (o.amount_cents / 100).toFixed(2),
      payment: o.payment, status: o.status, created_at: o.created_at,
    })),
  });
}));

/* Admin: mint unactivated tags (free tier has no shell for scripts/mint-tags.js).
   GET /api/admin/mint?key=ADMIN_KEY&n=5 */
shop.get('/admin/mint', wrap(async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) throw bad(401, 'unauthorized');
  const n = Math.min(Math.max(Number(req.query.n) || 5, 1), 500);
  const base = process.env.BASE_URL || '';
  const tags = [];
  for (let i = 0; i < n; i++) {
    const id = newTagId();
    const r = await q(`INSERT INTO tags (tag_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING tag_id`, [id]);
    if (r.rowCount) tags.push({ tag_id: id, url: `${base}/t/${id}` });
    else i--;
  }
  res.json({ minted: tags.length, tags });
}));

/* Admin: clear all rate-limit counters (testing/support tool).
   GET /api/admin/reset-limits?key=ADMIN_KEY */
shop.get('/admin/reset-limits', wrap(async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) throw bad(401, 'unauthorized');
  let cursor = '0', cleared = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 200);
    cursor = next;
    if (keys.length) cleared += await redis.del(...keys);
  } while (cursor !== '0');
  res.json({ ok: true, cleared });
}));

shop.patch('/admin/orders/:id', wrap(async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) throw bad(401, 'unauthorized');
  const status = ['new', 'paid', 'shipped', 'cancelled'].includes(req.body?.status) ? req.body.status : null;
  if (!status) throw bad(400, 'bad_status');
  await q(`UPDATE orders SET status=$1 WHERE id=$2`, [status, req.params.id]);
  res.json({ ok: true });
}));
