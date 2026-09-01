/* Shop: order intake + admin list. No payment gateway yet —
   ponytail: Rechnung/Vorkasse manual flow; add Stripe Checkout when volume
   justifies it (one endpoint + webhook, the orders table already fits). */
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { q } from './db.js';
import { redis } from './redis.js';
import { encrypt, decrypt, newTagId, hmacOf } from './crypto.js';
import { asPhone } from './routes.js';
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

const escHtml = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* Branded HTML order-confirmation email (dark header + logo, order card,
   Vorkasse bank block when applicable). Plain text is sent alongside as fallback. */
function orderEmailHtml({ id, name, qty, totalStr, pay }) {
  const base = process.env.BASE_URL || '';
  const payLabel = pay === 'vorkasse' ? 'Vorkasse (Überweisung)' : 'Kauf auf Rechnung';
  const bankBlock = `
      <tr><td style="padding:16px 40px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e6;border:1px solid #f0d98a;border-radius:12px;">
          <tr><td style="padding:16px 22px;font-size:14px;color:#5a4a1a;line-height:1.75;">
            <strong style="color:#8a6d16;">Zahlung per Überweisung — bitte überweisen Sie ${totalStr} €</strong><br>
            Empfänger: <strong>BookBuch UG</strong><br>
            IBAN: <strong>BE17 9059 3129 8421</strong><br>
            BIC: TRWIBEB1XXX (Wise, Brüssel)<br>
            Verwendungszweck: <strong>OwnerTag #${id}</strong><br>
            <span style="color:#7a6a3a;">Sobald die Zahlung eingegangen ist, versenden wir Ihren Tag.</span>
          </td></tr>
        </table>
      </td></tr>`;
  return `<!DOCTYPE html><html lang="de"><body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td align="center" style="background:#0b0d0f;padding:26px 0;">
        <img src="${base}/email-logo.png" alt="OwnerTag" width="190" style="display:block;border:0;height:auto;">
      </td></tr>
      <tr><td style="padding:34px 40px 4px;">
        <h1 style="margin:0 0 14px;font-size:21px;color:#0b1c36;">Bestätigung Ihrer OwnerTag-Bestellung</h1>
        <p style="margin:0 0 4px;font-size:15px;color:#3a4453;line-height:1.6;">Hallo ${escHtml(name)},</p>
        <p style="margin:0 0 20px;font-size:15px;color:#3a4453;line-height:1.6;">vielen Dank für Ihre Bestellung bei <strong>OwnerTag</strong>! Ihre Bestellung ist erfolgreich bei uns eingegangen.</p>
      </td></tr>
      <tr><td style="padding:0 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;border-radius:12px;"><tr><td style="padding:18px 22px;">
          <p style="margin:0 0 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a8598;">Ihre Bestellung</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;color:#0b1c36;">
            <tr><td style="padding:5px 0;color:#5a6474;">Bestellnummer</td><td align="right" style="padding:5px 0;font-weight:bold;">#${id}</td></tr>
            <tr><td style="padding:5px 0;color:#5a6474;">Produkt</td><td align="right" style="padding:5px 0;">${qty} × OwnerTag</td></tr>
            <tr><td style="padding:5px 0;color:#5a6474;">Zahlungsart</td><td align="right" style="padding:5px 0;">${payLabel}</td></tr>
            <tr><td style="padding:11px 0 0;border-top:1px solid #e2e7ee;color:#5a6474;">Gesamtbetrag</td><td align="right" style="padding:11px 0 0;border-top:1px solid #e2e7ee;font-weight:bold;font-size:17px;color:#2f6fe4;">${totalStr} €</td></tr>
          </table>
        </td></tr></table>
      </td></tr>${bankBlock}
      <tr><td style="padding:26px 40px 6px;">
        <h2 style="margin:0 0 10px;font-size:16px;color:#0b1c36;">Wie geht es weiter?</h2>
        <p style="margin:0 0 14px;font-size:15px;color:#3a4453;line-height:1.6;">Ihre Bestellung wird innerhalb von <strong>2–3 Werktagen</strong> versendet. Sobald Sie Ihren OwnerTag erhalten, aktivieren Sie ihn in unter einer Minute:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;color:#3a4453;line-height:1.9;">
          <tr><td valign="top" style="color:#2f6fe4;font-weight:bold;padding-right:10px;">1.</td><td>OwnerTag auf das Fahrzeug kleben</td></tr>
          <tr><td valign="top" style="color:#2f6fe4;font-weight:bold;padding-right:10px;">2.</td><td>QR-Code auf dem OwnerTag scannen</td></tr>
          <tr><td valign="top" style="color:#2f6fe4;font-weight:bold;padding-right:10px;">3.</td><td>Tag in weniger als einer Minute aktivieren</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 40px 30px;">
        <p style="margin:0 0 2px;font-size:15px;color:#3a4453;line-height:1.6;">Vielen Dank für Ihr Vertrauen! Bei Fragen sind wir gerne für Sie da.</p>
        <p style="margin:14px 0 0;font-size:15px;color:#0b1c36;"><strong>Ihr OwnerTag-Team</strong></p>
      </td></tr>
      <tr><td style="background:#0b0d0f;padding:20px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:14px;color:#ffffff;font-weight:bold;">OwnerTag</p>
        <p style="margin:0 0 8px;font-size:12px;color:#8b95a5;">Sicher. Einfach. Vernetzt.</p>
        <p style="margin:0;font-size:11px;color:#69727f;">© 2026 OwnerTag · BookBuch UG · <a href="${base}/impressum" style="color:#8b95a5;">Impressum</a> · <a href="${base}/datenschutz" style="color:#8b95a5;">Datenschutz</a></p>
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
}

/* Build + send the branded confirmation (HTML + plain-text fallback) for an
   order to `to`. Shared by order creation and admin resend. */
async function sendOrderConfirmation({ id, name, qty, payment }, to) {
  const { sendEmail } = await import('./notify.js');
  const totalStr = (qty * PRICE_CENTS / 100).toFixed(2).replace('.', ',');
  const bankInfo =
    `\nZahlung per Überweisung — bitte überweisen Sie ${totalStr} €:\n` +
    `Empfänger: BookBuch UG\nIBAN: BE17 9059 3129 8421\nBIC: TRWIBEB1XXX (Wise, Brüssel)\n` +
    `Verwendungszweck: OwnerTag #${id}\nSobald die Zahlung eingegangen ist, versenden wir Ihren Tag.\n`;
  const text = `Vielen Dank für Ihre Bestellung!\n\n` +
    `Bestellung #${id}: ${qty}× OwnerTag — ${totalStr} €\n` +
    `Zahlungsart: ${payment === 'vorkasse' ? 'Vorkasse (Überweisung)' : 'Kauf auf Rechnung'}\n` +
    bankInfo +
    `\nVersand innerhalb von 2–3 Werktagen. Nach dem Aufkleben aktivieren Sie Ihren Tag in unter einer Minute — ` +
    `einfach den QR-Code scannen.\n\nIhr OwnerTag-Team`;
  return sendEmail(to, `Ihre OwnerTag-Bestellung #${id}`, text,
    orderEmailHtml({ id, name, qty, totalStr, pay: payment }));
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
  sendOrderConfirmation({ id: o.id, name: String(name).trim(), qty: quantity, payment: pay }, String(email).trim())
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

/* Admin: correct an owner's phone number (e.g. a customer typo like the German
   trunk-0). Re-normalizes via asPhone, re-encrypts, and updates the routing HMAC.
   POST /api/admin/owner/phone  { tag, phone } */
shop.post('/admin/owner/phone', wrap(async (req, res) => {
  requireAdmin(req, res);
  // Accept the dashed display form too (e.g. "N2V5-9NKY-67" → "N2V59NKY67").
  const tag = String(req.body?.tag || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!tag) throw bad(400, 'bad_tag');
  const phone = asPhone(req.body?.phone);   // normalizes + validates (auto-fixes +49 0…)
  const { rows: [row] } = await q(
    `SELECT o.id FROM owners o JOIN vehicles v ON v.owner_id=o.id JOIN tags t ON t.vehicle_id=v.id WHERE t.tag_id=$1`,
    [tag]);
  if (!row) throw bad(404, 'owner_not_found');
  try {
    await q(`UPDATE owners SET phone_enc=$1, phone_hmac=$2 WHERE id=$3`, [encrypt(phone), hmacOf(phone), row.id]);
  } catch (e) {
    throw bad(409, 'phone_in_use');   // phone_hmac is UNIQUE — another owner already uses this number
  }
  res.json({ ok: true, phone });
}));

/* Admin: one-shot repair of every stored owner number — re-normalizes each
   (fixes legacy German trunk-0 like +49 0174…). Valid numbers are left as-is.
   Safe to run repeatedly. POST /api/admin/fix-phones */
shop.post('/admin/fix-phones', wrap(async (req, res) => {
  requireAdmin(req, res);
  const { rows } = await q(`SELECT id, phone_enc FROM owners`);
  let fixed = 0;
  for (const o of rows) {
    let plain, normalized;
    try { plain = decrypt(o.phone_enc); normalized = asPhone(plain); } catch { continue; }
    if (normalized !== plain) {
      try { await q(`UPDATE owners SET phone_enc=$1, phone_hmac=$2 WHERE id=$3`, [encrypt(normalized), hmacOf(normalized), o.id]); fixed++; }
      catch { /* skip HMAC collisions */ }
    }
  }
  res.json({ ok: true, fixed, total: rows.length });
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

/* Localized copy for the printed tag. */
const TAG_COPY = {
  en: { scan: 'SCAN WITH YOUR CAMERA', reach: 'SCAN TO REACH THE OWNER',
        b1: 'Blocked in? Lights left on? Point', b2: 'your camera at the code — no app.',
        b3: 'Calls &amp; messages are masked. The', b4: "owner's number stays private.", tid: 'TAG ID' },
  de: { scan: 'MIT DER KAMERA SCANNEN', reach: 'SCANNEN &amp; KONTAKTIEREN',
        b1: 'Zugeparkt? Licht an? Kamera auf', b2: 'den Code richten — keine App.',
        b3: 'Anrufe &amp; Nachrichten sind anonym.', b4: 'Die Halter-Nummer bleibt privat.', tid: 'TAG-ID' },
};

/* ?lang= query → which language card(s) to render. */
function parseTagLangs(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'both' || s === 'de,en' || s === 'en,de') return ['de', 'en'];
  if (s === 'de') return ['de'];
  return ['en'];
}

/* Build ONE branded 3.5×2in card SVG for a tag in the given language.
   Shared by the print page and the ZIP/PDF export so the design has one source. */
async function buildCardSvg(id, lang) {
  const base = process.env.BASE_URL || '';
  const { default: QRCode } = await import('qrcode');
  let qr = await QRCode.toString(`${base}/t/${id}`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0B1C36', light: '#FFFFFF' } });
  qr = qr.replace(/<svg\b[^>]*>/, m =>
    m.replace(/\s(?:width|height)="[^"]*"/g, '')
     .replace('<svg', '<svg x="92" y="102" width="396" height="396" preserveAspectRatio="xMidYMid meet"'));
  const c = TAG_COPY[lang] || TAG_COPY.en;
  const fmt = `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`;
  const u = `${id}-${lang}`;   // unique suffix so gradient/clip ids never collide
  return `
<svg class="tag" width="3.5in" height="2in" viewBox="0 0 1050 600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="navy-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B3357"/><stop offset="1" stop-color="#0B1C36"/></linearGradient>
    <linearGradient id="steel-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCE1E6"/><stop offset="0.5" stop-color="#A9B3BE"/><stop offset="0.65" stop-color="#E3E7EB"/><stop offset="1" stop-color="#939FAB"/></linearGradient>
    <clipPath id="card-${u}"><rect width="1050" height="600" rx="42"/></clipPath>
  </defs>
  <g clip-path="url(#card-${u})">
    <rect width="1050" height="600" fill="url(#navy-${u})"/>
    <g fill="none" stroke="#5E8FE6" stroke-opacity="0.08" stroke-width="3"><circle cx="1050" cy="600" r="180"/><circle cx="1050" cy="600" r="260"/><circle cx="1050" cy="600" r="340"/></g>
  </g>
  <rect x="4" y="4" width="1042" height="592" rx="38" fill="none" stroke="url(#steel-${u})" stroke-width="3"/>
  <rect x="55" y="65" width="470" height="470" rx="28" fill="#FFFFFF"/>
  ${qr}
  <text x="290" y="572" text-anchor="middle" font-family="Jura,sans-serif" font-size="24" letter-spacing="6" fill="#93A0AD">${c.scan}</text>
  <g transform="translate(572,78) scale(0.60)">
    <path d="M54 4 L104 20 V80 C104 116 82 136 54 146 C26 136 4 116 4 80 V20 Z" fill="none" stroke="url(#steel-${u})" stroke-width="9"/>
    <g transform="scale(0.5) translate(-452,-398)">
      <path d="M474 588 C468 588 464 583 464 577 C464 567 471 560 483 556 L502 551 L520 531 C528 519 541 513 556 513 L586 513 C600 513 612 519 620 530 L633 549 C650 552 660 560 660 571 C660 581 654 588 644 588 L626 588 A18 18 0 0 0 590 588 L526 588 A18 18 0 0 0 490 588 Z" fill="url(#steel-${u})"/>
      <circle cx="506" cy="588" r="11" fill="none" stroke="url(#steel-${u})" stroke-width="12"/>
      <circle cx="606" cy="588" r="11" fill="none" stroke="url(#steel-${u})" stroke-width="12"/>
    </g>
  </g>
  <text x="655" y="148" font-family="Outfit,sans-serif" font-weight="bold" font-size="62" letter-spacing="-1" fill="#F2F4F8">Owner<tspan fill="url(#steel-${u})">Tag</tspan></text>
  <text x="572" y="206" font-family="Jura,sans-serif" font-size="22" letter-spacing="5" fill="#82ABF2">${c.reach}</text>
  <line x1="572" y1="242" x2="990" y2="242" stroke="#93A0AD" stroke-width="1.5" stroke-opacity="0.4"/>
  <text x="572" y="296" font-family="'Instrument Sans',sans-serif" font-size="26" fill="#C6CDD6">${c.b1}</text>
  <text x="572" y="333" font-family="'Instrument Sans',sans-serif" font-size="26" fill="#C6CDD6">${c.b2}</text>
  <text x="572" y="392" font-family="'Instrument Sans',sans-serif" font-size="26" fill="#C6CDD6">${c.b3}</text>
  <text x="572" y="429" font-family="'Instrument Sans',sans-serif" font-size="26" fill="#C6CDD6">${c.b4}</text>
  <text x="572" y="500" font-family="Jura,sans-serif" font-size="24" letter-spacing="4" fill="#93A0AD">${c.tid}</text>
  <text x="680" y="500" font-family="Jura,sans-serif" font-size="28" letter-spacing="5" fill="#F2F4F8">${fmt}</text>
  <text x="572" y="552" font-family="Jura,sans-serif" font-size="20" letter-spacing="4" fill="#5C6472">MADE IN GERMANY · OWNERTAG.DE</text>
</svg>`;
}

/* ?ids= (existing) and/or ?mint=N (fresh) → the tag_ids to render/export. */
async function resolveTags(req, cap = 500) {
  let tags = [];
  if (req.query.ids) {
    const asked = String(req.query.ids).split(',').map(s => s.toUpperCase().replace(/[^0-9A-Z]/g, '')).filter(Boolean).slice(0, cap);
    const { rows } = await q(`SELECT tag_id FROM tags WHERE tag_id = ANY($1)`, [asked]);
    const have = new Set(rows.map(r => r.tag_id));
    tags = asked.filter(t => have.has(t));
  }
  const mintN = Math.min(Math.max(Number(req.query.mint) || 0, 0), cap);
  for (let i = 0; i < mintN; i++) {
    const id = newTagId();
    const r = await q(`INSERT INTO tags (tag_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING tag_id`, [id]);
    if (r.rowCount) tags.push(id); else i--;
  }
  return tags;
}

/* Shared QR-label renderer: print-ready HTML page of branded cards.
   `key` (admin key from the opening URL) powers the direct download links. */
async function renderTagLabels(res, tags, heading, langs = ['en'], key = '') {
  const base = process.env.BASE_URL || '';
  if (!/^https?:\/\//.test(base)) throw bad(500, 'base_url_not_set');   // else QRs encode an unscannable relative path
  const use = langs.filter(l => TAG_COPY[l]);
  if (!use.length) use.push('en');
  const cards = [];
  for (const id of tags) for (const lang of use) cards.push(await buildCardSvg(id, lang));
  const k = encodeURIComponent(key), ids = tags.join(','), lp = use.length > 1 ? 'both' : use[0];
  const dl = `${tags.length === 1 && use.length === 1
      ? `<a href="/api/admin/tags/card.png?id=${tags[0]}&lang=${use[0]}&key=${k}" download>⬇ PNG</a> · ` : ''}`
    + `<a href="/api/admin/tags/export.zip?ids=${ids}&lang=${lp}&key=${k}" download>⬇ ZIP (SVG+PNG)</a> · `
    + `<a href="/api/admin/tags/export.pdf?ids=${ids}&lang=${lp}&key=${k}" download>⬇ PDF</a> · Press ⌘P to print`;
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${heading} — ${tags.length} tags</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@700&family=Jura:wght@400;600&family=Instrument+Sans&display=swap');
    @page { size: 3.5in 2in; margin: 0; }
    body { margin: 0; background: #e9edf1; }
    .tag { display: block; width: 3.5in; height: 2in; page-break-after: always; margin: .12in auto; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
    .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #fff; padding: 10px 16px; font: 13px -apple-system, sans-serif; box-shadow: 0 1px 4px rgba(0,0,0,.15); z-index: 9; }
    .toolbar b { margin-right: 12px; } .toolbar a { color: #1B3357; font-weight: 600; text-decoration: none; }
    .spacer { height: 46px; }
    @media print { .toolbar, .spacer { display: none; } body { background: #fff; } .tag { margin: 0; box-shadow: none; } }
  </style></head><body>
  <div class="toolbar"><b>${heading}</b> · ${tags.length} tag(s) · ${dl}</div>
  <div class="spacer"></div>
  ${cards.join('\n')}
  </body></html>`);
}

/* Admin: QR labels for loose tags — the QR generator/preview tool.
   ?ids=CODE1,CODE2  → preview/print existing tags' QR codes
   ?mint=N           → mint N fresh tags and print their QR codes
   GET /api/admin/tags/print?key=ADMIN_KEY */
shop.get('/admin/tags/print', wrap(async (req, res) => {
  requireAdmin(req, res);
  const tags = await resolveTags(req, 200);
  if (!tags.length) throw bad(400, 'no_tags');
  await renderTagLabels(res, tags, 'OwnerTag — QR labels', parseTagLangs(req.query.lang), req.query.key);
}));

/* Admin: export tags as a ZIP of per-tag SVG (vector) + PNG (2100px raster).
   ?ids=CODE1,CODE2 and/or ?mint=N, ?lang=en|de|both. GET /api/admin/tags/export.zip */
shop.get('/admin/tags/export.zip', wrap(async (req, res) => {
  requireAdmin(req, res);
  const base = process.env.BASE_URL || '';
  if (!/^https?:\/\//.test(base)) throw bad(500, 'base_url_not_set');
  const langs = parseTagLangs(req.query.lang);
  const tags = await resolveTags(req, 500);
  if (!tags.length) throw bad(400, 'no_tags');
  const { Resvg } = await import('@resvg/resvg-js');
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const id of tags) for (const lang of langs) {
    const svg = await buildCardSvg(id, lang);
    const name = langs.length > 1 ? `${id}-${lang}` : id;
    zip.file(`${name}.svg`, svg);
    zip.file(`${name}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 2100 } }).render().asPng());
  }
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="ownertag-tags-${tags.length}.zip"`);
  res.send(await zip.generateAsync({ type: 'nodebuffer' }));
}));

/* Admin: export tags as a print-ready PDF, one 3.5×2in card per page.
   ?ids= / ?mint=N / ?lang=. GET /api/admin/tags/export.pdf */
shop.get('/admin/tags/export.pdf', wrap(async (req, res) => {
  requireAdmin(req, res);
  const base = process.env.BASE_URL || '';
  if (!/^https?:\/\//.test(base)) throw bad(500, 'base_url_not_set');
  const langs = parseTagLangs(req.query.lang);
  const tags = await resolveTags(req, 500);
  if (!tags.length) throw bad(400, 'no_tags');
  const { Resvg } = await import('@resvg/resvg-js');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const id of tags) for (const lang of langs) {
    const svg = await buildCardSvg(id, lang);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1050 } }).render().asPng();
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([252, 144]);   // 3.5×2in at 72pt/in
    page.drawImage(img, { x: 0, y: 0, width: 252, height: 144 });
  }
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="ownertag-tags-${tags.length}.pdf"`);
  res.send(Buffer.from(await pdf.save()));
}));

/* Admin: single tag card as a PNG (direct save). ?id=CODE&lang=en|de */
shop.get('/admin/tags/card.png', wrap(async (req, res) => {
  requireAdmin(req, res);
  const base = process.env.BASE_URL || '';
  if (!/^https?:\/\//.test(base)) throw bad(500, 'base_url_not_set');
  const id = String(req.query.id || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!id) throw bad(400, 'bad_tag');
  const { rows } = await q(`SELECT tag_id FROM tags WHERE tag_id=$1`, [id]);
  if (!rows.length) throw bad(404, 'not_found');
  const svg = await buildCardSvg(id, parseTagLangs(req.query.lang)[0]);
  const { Resvg } = await import('@resvg/resvg-js');
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `attachment; filename="ownertag-${id}.png"`);
  res.send(new Resvg(svg, { fitTo: { mode: 'width', value: 2100 } }).render().asPng());
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

  await renderTagLabels(res, tags, `Order #${order.id} — ${order.name}`, parseTagLangs(req.query.lang), req.query.key);
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

/* Admin: permanently delete an order. Unlinks any minted tags first (keeps the
   tags valid) so the FK doesn't block the delete. DELETE /api/admin/orders/:id */
shop.delete('/admin/orders/:id', wrap(async (req, res) => {
  requireAdmin(req, res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw bad(404, 'not_found');
  await q(`UPDATE tags SET order_id=NULL WHERE order_id=$1`, [id]);
  const r = await q(`DELETE FROM orders WHERE id=$1`, [id]);
  if (!r.rowCount) throw bad(404, 'not_found');
  res.json({ ok: true });
}));

/* Admin: resend the branded confirmation email for an order.
   Defaults to the order's stored email; ?to=addr overrides. POST /api/admin/orders/:id/resend */
shop.post('/admin/orders/:id/resend', wrap(async (req, res) => {
  requireAdmin(req, res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw bad(404, 'not_found');
  const { rows: [o] } = await q(`SELECT * FROM orders WHERE id=$1`, [id]);
  if (!o) throw bad(404, 'not_found');
  const to = (String(req.query.to || req.body?.to || '').trim()) || decrypt(o.email_enc);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw bad(400, 'bad_to');
  const sent = await sendOrderConfirmation({ id: o.id, name: o.name, qty: o.qty, payment: o.payment }, to);
  res.json({ ok: !!sent, to });
}));
