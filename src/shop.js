/* Shop: order intake + admin list. No payment gateway yet —
   ponytail: Rechnung/Vorkasse manual flow; add Stripe Checkout when volume
   justifies it (one endpoint + webhook, the orders table already fits). */
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { q } from './db.js';
import { redis } from './redis.js';
import { encrypt, decrypt, newTagId } from './crypto.js';
import { fingerprintOf } from './ratelimit.js';

export const shop = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (status, error) => { const e = new Error(error); e.status = status; return e; };

const PRICE_CENTS = 2490;

/* Admin auth. Prefer `Authorization: Bearer <key>` (keeps the secret out of URLs
   and access logs); fall back to `?key=` only for the browser-openable order list
   and print pages, which can't set headers. Constant-time compare either way, and
   admin responses are never cached. Throws 401 on failure. */
function requireAdmin(req, res) {
  const key = process.env.ADMIN_KEY;
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
  const given = bearer || req.query.key || '';
  const a = Buffer.from(String(given)), b = Buffer.from(String(key || ''));
  if (!key || a.length !== b.length || !timingSafeEqual(a, b)) throw bad(401, 'unauthorized');
  res.set('Cache-Control', 'no-store');
}

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

  /* Emails are best effort — the order is already stored either way */
  const { sendEmail } = await import('./notify.js');
  if (process.env.ORDER_NOTIFY_EMAIL) {
    sendEmail(process.env.ORDER_NOTIFY_EMAIL, `OwnerTag Bestellung #${o.id}`,
      `${quantity}x Tag — ${(quantity * PRICE_CENTS / 100).toFixed(2)} € (${pay})\nAdmin: /admin`)
      .catch(() => {});
  }
  /* Customer confirmation (lifecycle step 1) */
  sendEmail(String(email).trim(), `Ihre OwnerTag-Bestellung #${o.id}`,
    `Vielen Dank für Ihre Bestellung!\n\n` +
    `Bestellung #${o.id}: ${quantity}× OwnerTag — ${(quantity * PRICE_CENTS / 100).toFixed(2).replace('.', ',')} €\n` +
    `Zahlungsart: ${pay === 'vorkasse' ? 'Vorkasse (Überweisung)' : 'Kauf auf Rechnung'}\n\n` +
    `Versand innerhalb von 2–3 Werktagen. Nach dem Aufkleben aktivieren Sie Ihren Tag in unter einer Minute — ` +
    `einfach den QR-Code scannen.\n\nIhr OwnerTag-Team`)
    .catch(() => {});
  if (process.env.NODE_ENV !== 'production')
    console.log(`[dev-order] #${o.id} — ${quantity}x tag, ${(quantity * PRICE_CENTS / 100).toFixed(2)} €, ${pay}`);

  res.json({ ok: true, orderId: o.id, amount: quantity * PRICE_CENTS });
}));

/* Admin: list orders (decrypted). Auth: Bearer header (admin.html) or ?key= . */
shop.get('/admin/orders', wrap(async (req, res) => {
  requireAdmin(req, res);
  const { rows } = await q(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`);
  res.json({
    orders: rows.map(o => ({
      id: o.id, name: o.name, email: decrypt(o.email_enc),
      phone: o.phone_enc ? decrypt(o.phone_enc) : null,
      address: decrypt(o.address_enc),
      qty: o.qty, amount_eur: (o.amount_cents / 100).toFixed(2),
      payment: o.payment, status: o.status, created_at: o.created_at,
      /* print page is browser-opened (navigation can't set a header) so the key
         rides the query string here; response is no-store. */
      print_url: `${process.env.BASE_URL || ''}/api/admin/orders/${o.id}/print?key=${process.env.ADMIN_KEY}`,
    })),
  });
}));

/* Admin: mint unactivated tags (free tier has no shell for scripts/mint-tags.js).
   POST /api/admin/mint?n=5  (state-changing → POST, not a bookmarkable GET) */
shop.post('/admin/mint', wrap(async (req, res) => {
  requireAdmin(req, res);
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
   POST /api/admin/reset-limits  (state-changing → POST) */
shop.post('/admin/reset-limits', wrap(async (req, res) => {
  requireAdmin(req, res);
  let cursor = '0', cleared = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 200);
    cursor = next;
    if (keys.length) cleared += await redis.del(...keys);
  } while (cursor !== '0');
  res.json({ ok: true, cleared });
}));

/* Admin: SMTP diagnostic — send one test email and report the exact result.
   Surfaces the real SMTP error (which notifyOwner otherwise swallows) so email
   can be debugged without shell access.
   GET /api/admin/test-email?key=ADMIN_KEY&to=you@example.com */
shop.get('/admin/test-email', wrap(async (req, res) => {
  requireAdmin(req, res);
  const to = String(req.query.to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw bad(400, 'bad_to');
  const { sendEmail } = await import('./notify.js');
  try {
    const sent = await sendEmail(to, 'OwnerTag SMTP test', 'If you can read this, SMTP delivery works.');
    res.json(sent
      ? { ok: true, note: 'sendMail accepted — check the inbox (and spam)' }
      : { ok: false, reason: 'SMTP not configured: SMTP_HOST or SMTP_USER is empty' });
  } catch (e) {
    res.json({ ok: false, error: e.code || e.responseCode || e.message || 'unknown', detail: String(e.message || '').slice(0, 200) });
  }
}));

/* Admin: fulfillment — mint (or reuse) the order's tags and render a
   print-ready page. One 3.5in × 2in tag card per label; print via ⌘P.
   GET /api/admin/orders/:id/print?key=ADMIN_KEY */
shop.get('/admin/orders/:id/print', wrap(async (req, res) => {
  requireAdmin(req, res);

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw bad(404, 'not_found');   // non-numeric id → 404, not a pg-cast 500
  const { rows: [order] } = await q(`SELECT * FROM orders WHERE id=$1`, [id]);
  if (!order) throw bad(404, 'not_found');

  /* Idempotent: reuse tags already minted for this order, mint the rest */
  const { rows: existing } = await q(`SELECT tag_id FROM tags WHERE order_id=$1 ORDER BY tag_id`, [order.id]);
  const tags = existing.map(t => t.tag_id);
  while (tags.length < order.qty) {
    const id = newTagId();
    const r = await q(`INSERT INTO tags (tag_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING tag_id`, [id, order.id]);
    if (r.rowCount) tags.push(id);
  }

  const base = process.env.BASE_URL || '';
  // Fail loudly rather than print QRs that encode a relative "/t/..." path (unscannable).
  if (!/^https?:\/\//.test(base)) throw bad(500, 'base_url_not_set');
  const { default: QRCode } = await import('qrcode');
  const cards = [];
  for (const id of tags) {
    // margin:4 = the mandatory QR quiet zone; margin:0 made phone cameras fail to lock on.
    const qr = await QRCode.toString(`${base}/t/${id}`, { type: 'svg', margin: 4, errorCorrectionLevel: 'M', color: { dark: '#0B1C36', light: '#FFFFFF' } });
    const fmt = `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`;
    cards.push(`
    <div class="tag">
      <div class="qrbox">${qr}</div>
      <div class="right">
        <div class="brand">Owner<span>Tag</span></div>
        <div class="cap">SCAN TO REACH THE OWNER</div>
        <div class="hint">Blocked in? Lights on? Point your camera at the code — no app needed. Calls &amp; messages stay private.</div>
        <div class="tid">TAG ID&nbsp;&nbsp;${fmt}</div>
      </div>
    </div>`);
  }

  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Order #${order.id} — ${tags.length} tags</title>
  <style>
    @page { size: 3.5in 2in; margin: 0; }
    body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #eee; }
    .tag { width: 3.5in; height: 2in; box-sizing: border-box; display: flex; gap: .14in; align-items: center;
      padding: .16in; background: linear-gradient(160deg, #1B3357, #0B1C36); border-radius: .14in;
      page-break-after: always; margin: .1in auto;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .qrbox { background: #fff; border-radius: .1in; padding: .09in; width: 1.5in; height: 1.5in; box-sizing: border-box; flex-shrink: 0; }
    .qrbox svg { width: 100%; height: 100%; display: block; }
    .right { color: #F2F4F8; min-width: 0; }
    .brand { font-weight: 800; font-size: 15pt; letter-spacing: -.02em; }
    .brand span { color: #5E8FE6; }
    .cap { color: #82ABF2; font-size: 6pt; letter-spacing: .16em; margin: .04in 0 .07in; }
    .hint { color: #C6CDD6; font-size: 6.5pt; line-height: 1.45; margin-bottom: .08in; }
    .tid { color: #93A0AD; font-size: 7pt; letter-spacing: .08em; font-family: ui-monospace, monospace; }
    .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #fff; padding: 10px 16px;
      font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
    .toolbar b { margin-right: 12px; }
    @media print { .toolbar { display: none; } body { background: #fff; } .tag { margin: 0; border-radius: 0; } }
    .spacer { height: 48px; }
  </style></head><body>
  <div class="toolbar"><b>Order #${order.id}</b> ${order.name} · ${tags.length} tag(s) · Press ⌘P / Ctrl+P to print (3.5×2 in labels)</div>
  <div class="spacer"></div>
  ${cards.join('\n')}
  </body></html>`);
}));

shop.patch('/admin/orders/:id', wrap(async (req, res) => {
  requireAdmin(req, res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw bad(404, 'not_found');
  const status = ['new', 'paid', 'shipped', 'cancelled'].includes(req.body?.status) ? req.body.status : null;
  if (!status) throw bad(400, 'bad_status');
  const r = await q(`UPDATE orders SET status=$1 WHERE id=$2`, [status, id]);
  if (!r.rowCount) throw bad(404, 'not_found');
  res.json({ ok: true });
}));
