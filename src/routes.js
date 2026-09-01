import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { config } from './config.js';
import { q, pool } from './db.js';
import { redis } from './redis.js';
import { encrypt, decrypt, hmacOf, newSessionId, signToken, verifyToken } from './crypto.js';
import { checkMessageLimits, checkCallLimits, checkScanLimits, fingerprintOf } from './ratelimit.js';
import { moderateFreeText, TEMPLATES } from './moderation.js';
import { notifyOwner, startMaskedCall, sendSms } from './notify.js';
import { verifyTurnstile } from './turnstile.js';
import { verifyEnabled, startVerification, checkVerification } from './twilio-verify.js';
import { createSubscriptionCheckout } from './stripe.js';

export const api = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (status, error) => { const e = new Error(error); e.status = status; return e; };

const TAG_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/* Freemium gate. When config.freemium is off → always true (today's behaviour:
   every channel free). When on → true only if the tag is covered by an 'active'
   subscription. Free tier keeps web-portal + email; SMS/voice are premium. */
async function billingActive(tagId) {
  if (!config.freemium) return true;
  // Gate by the tag OWNER's subscription — robust to whether they subscribed
  // before or after activating the tag (no per-tag linking to keep in sync).
  const { rows: [r] } = await q(
    `SELECT 1 FROM tags t
       JOIN vehicles v ON v.id = t.vehicle_id
       JOIN subscriptions s ON s.owner_id = v.owner_id
      WHERE t.tag_id = $1 AND s.status = 'active' LIMIT 1`, [tagId]);
  return !!r;
}

/* Accept human formatting (+49 151 123-4567, 0049…), store E.164.
   One normalizer for every phone field — OTP keys and HMAC lookups
   stay consistent regardless of how the user typed the number. */
function asPhone(input) {
  let n = String(input || '').replace(/[\s\-()\/.]/g, '');
  if (n.startsWith('00')) n = '+' + n.slice(2);          // 0049… → +49…
  else if (n.startsWith('0')) n = '+49' + n.slice(1);    // German national 0174… → +49174…
  // Strip the German trunk "0" if it was kept after the country code
  // (+49 0174… is a very common user error and is unroutable in E.164).
  n = n.replace(/^\+490+/, '+49');
  if (!/^\+[1-9]\d{6,14}$/.test(n)) throw bad(400, 'bad_phone');
  return n;
}

/* ── helpers ──────────────────────────────────────────────────────── */
async function loadTag(tagId) {
  if (!TAG_RE.test(tagId || '')) throw bad(404, 'not_found');
  const { rows } = await q('SELECT * FROM tags WHERE tag_id=$1', [tagId]);
  if (!rows[0]) throw bad(404, 'not_found');
  return rows[0];
}

async function ownerOfTag(tagId) {
  const { rows } = await q(
    `SELECT o.* FROM owners o JOIN vehicles v ON v.owner_id=o.id
     JOIN tags t ON t.vehicle_id=v.id WHERE t.tag_id=$1`, [tagId]);
  return rows[0] || null;
}

function requireOwner(req) {
  const p = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!p?.owner_id) throw bad(401, 'unauthorized');
  return p.owner_id;
}

function observerSession(req) {
  const p = verifyToken(req.cookies?.ot_s || '');
  if (!p?.sid) throw bad(401, 'session_expired');
  return p;
}

async function sendOtp(phone) {
  // Preferred: Twilio Verify (official SDK) generates + sends + tracks the code.
  if (verifyEnabled()) { await startVerification(phone); return; }
  // Fallback (unchanged): our own CSPRNG code stored in Redis, sent via SMS.
  const code = String(randomInt(100000, 1000000));   // CSPRNG — never Math.random for an auth code
  await redis.set(`otp:${hmacOf(phone)}`, code, 'EX', 300);
  await sendSms(phone, `OwnerTag Code: ${code}`);
  if (process.env.NODE_ENV !== 'production') console.log(`[dev-otp] ${code}`);
}

async function checkOtp(phone, code) {
  // Verify path: Twilio owns expiry + attempt limits. Wrong/expired → bad_code.
  if (verifyEnabled()) {
    if (!await checkVerification(phone, code)) throw bad(400, 'bad_code');
    return;
  }
  // Fallback (unchanged): compare against the Redis-stored code with attempt cap.
  const key = `otp:${hmacOf(phone)}`;
  const tries = await redis.incr(`${key}:n`); await redis.expire(`${key}:n`, 300);
  if (tries > 5) throw bad(429, 'too_many_attempts');
  const real = await redis.get(key);
  if (!real || real !== String(code)) throw bad(400, 'bad_code');
  await redis.del(key, `${key}:n`);
}

/* ── Observer: scan ───────────────────────────────────────────────── */
/* The latency-critical path: someone is standing at a car. Tag state is
   cached 30 s in Redis (invalidated on mute/pause/activation), so warm
   scans skip Postgres entirely. */
const tagCacheKey = (id) => `tagcache:${id}`;
export const bustTagCache = (id) => redis.del(tagCacheKey(id)).catch(() => {});

api.get('/tags/:tagId', wrap(async (req, res) => {
  const fp = fingerprintOf(req);
  await checkScanLimits(fp);
  if (!TAG_RE.test(req.params.tagId || '')) throw bad(404, 'not_found');

  let info = null;
  const cached = await redis.get(tagCacheKey(req.params.tagId)).catch(() => null);
  if (cached) info = JSON.parse(cached);
  else {
    const tag = await loadTag(req.params.tagId);
    const { rows } = await q('SELECT v.type FROM vehicles v JOIN tags t ON t.vehicle_id=v.id WHERE t.tag_id=$1', [tag.tag_id]);
    info = { state: tag.state, vehicleType: rows[0]?.type || null,
             muted: !!(tag.muted_until && new Date(tag.muted_until) > new Date()) };
    redis.set(tagCacheKey(req.params.tagId), JSON.stringify(info), 'EX', 30).catch(() => {});
  }

  if (info.state === 'active') {
    const sid = newSessionId();
    res.cookie('ot_s', signToken({ sid, tag: req.params.tagId, exp: Math.floor(Date.now() / 1000) + 900 }),
      { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 900_000 });
  }
  res.json({
    ...info,
    suffix: req.params.tagId.slice(-4),
    templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, v])),
    turnstileSiteKey: config.turnstileSiteKey || null,
  });
}));

/* ── Observer: send message ───────────────────────────────────────── */
api.post('/messages', wrap(async (req, res) => {
  const sess = observerSession(req);
  const fp = fingerprintOf(req);
  const { template, note, turnstileToken, callbackPhone } = req.body || {};

  if (!await verifyTurnstile(turnstileToken, req.ip)) throw bad(403, 'captcha_failed');
  await checkMessageLimits(sess.tag, fp);

  const tag = await loadTag(sess.tag);
  if (tag.state !== 'active') throw bad(410, 'tag_inactive');
  if (tag.muted_until && new Date(tag.muted_until) > new Date()) throw bad(423, 'tag_muted');

  const owner = await ownerOfTag(sess.tag);
  if (!owner) throw bad(410, 'tag_inactive');

  const tpl = TEMPLATES[template];
  if (!template || !tpl) throw bad(400, 'unknown_template');
  const mod = moderateFreeText(note);
  if (!mod.ok) throw bad(422, 'message_blocked');          // generic — don't teach attackers the rules

  const lang = owner.locale === 'en' ? 'en' : 'de';
  const body = tpl[lang] + (mod.clean ? `\n„${mod.clean}"` : '');

  await q(`INSERT INTO relay_sessions (session_id, tag_id, observer_endpoint_enc, channel)
           VALUES ($1,$2,$3,'message') ON CONFLICT (session_id) DO NOTHING`,
    [sess.sid, sess.tag, callbackPhone ? encrypt(asPhone(callbackPhone)) : null]);
  await q(`INSERT INTO messages (session_id, direction, body) VALUES ($1,'to_owner',$2)`, [sess.sid, body]);

  const text = `OwnerTag (•••${sess.tag.slice(-4)}): ${body}\nAntworten: ${process.env.BASE_URL || ''}/owner`;
  const paid = await billingActive(sess.tag);   // free tier → email/portal only, no paid SMS
  const channel = await notifyOwner(owner, text, { freeOnly: !paid });
  if (!channel && paid) throw bad(502, 'delivery_failed');   // free tier still stored in portal above
  await q(`UPDATE messages SET delivered_at=now() WHERE session_id=$1 AND delivered_at IS NULL`, [sess.sid]);

  /* 24 h inbox token so the observer can read replies after the 15-min scan session dies */
  res.json({ ok: true, inboxToken: signToken({ sid: sess.sid, inbox: 1, exp: Math.floor(Date.now() / 1000) + 86400 }) });
}));

/* ── Observer: masked call ────────────────────────────────────────── */
api.post('/call', wrap(async (req, res) => {
  const sess = observerSession(req);
  const fp = fingerprintOf(req);
  const { phone: rawPhone, turnstileToken } = req.body || {};
  if (!await verifyTurnstile(turnstileToken, req.ip)) throw bad(403, 'captcha_failed');
  const phone = asPhone(rawPhone);
  await checkCallLimits(sess.tag, fp);

  /* Anti-harassment: the destination is attacker-supplied and unverified, so cap
     how often OwnerTag will dial ANY single number — independent of tag/fingerprint,
     which are both cheap to rotate. Keyed on the HMAC, never the plaintext number. */
  const dkey = `rl:calldst:${hmacOf(phone)}`;
  const dn = await redis.incr(dkey);
  if (dn === 1) await redis.expire(dkey, 3600);
  if (dn > 3) throw bad(429, 'rate_limited');

  const owner = await ownerOfTag(sess.tag);
  const tag = await loadTag(sess.tag);
  if (!owner || tag.state !== 'active') throw bad(410, 'tag_inactive');
  if (!await billingActive(sess.tag)) throw bad(402, 'subscription_required');   // masked voice is premium
  if (owner.prefs_json?.calls === false) throw bad(403, 'calls_disabled');

  await q(`INSERT INTO relay_sessions (session_id, tag_id, observer_endpoint_enc, channel)
           VALUES ($1,$2,$3,'voice')
           ON CONFLICT (session_id) DO UPDATE SET observer_endpoint_enc=$3, channel='voice'`,
    [sess.sid, sess.tag, encrypt(phone)]);
  await startMaskedCall(sess.sid, phone);
  res.json({ ok: true });
}));

/* ── Observer: inbox (replies from owner) ─────────────────────────── */
api.get('/inbox', wrap(async (req, res) => {
  const p = verifyToken(req.query.token || '');
  if (!p?.inbox) throw bad(401, 'session_expired');
  const { rows } = await q(
    `SELECT direction, body, created_at FROM messages WHERE session_id=$1 ORDER BY created_at`, [p.sid]);
  res.json({ messages: rows });
}));

/* ── Owner: activation ────────────────────────────────────────────── */
api.post('/activate/start', wrap(async (req, res) => {
  const { tagId, phone } = req.body || {};
  const tag = await loadTag(tagId);
  if (tag.state !== 'unactivated') throw bad(409, 'already_active');
  if (!await redis.set(`otpstart:${fingerprintOf(req)}`, 1, 'EX', 60, 'NX')) throw bad(429, 'rate_limited');
  await sendOtp(asPhone(phone));
  res.json({ ok: true });
}));

api.post('/activate/verify', wrap(async (req, res) => {
  const { tagId, phone: rawPhone, code, email, plate, vehicleType, locale, tz } = req.body || {};
  const phone = asPhone(rawPhone);
  const tag = await loadTag(tagId);
  if (tag.state !== 'unactivated') throw bad(409, 'already_active');
  await checkOtp(phone, code);

  const prefs = { channels: ['whatsapp', 'email', 'sms'], calls: true, quiet: null,
                  tz: typeof tz === 'string' && tz.length < 64 ? tz : null };
  const ph = hmacOf(phone);
  let { rows: [owner] } = await q('SELECT * FROM owners WHERE phone_hmac=$1', [ph]);
  if (!owner)
    /* ON CONFLICT makes concurrent first-time activations idempotent instead of
       one racing the phone_hmac UNIQUE constraint into a 500. The no-op DO UPDATE
       (vs DO NOTHING) guarantees a row is RETURNED even when the conflict fires. */
    ({ rows: [owner] } = await q(
      `INSERT INTO owners (phone_enc, phone_hmac, email_enc, locale, prefs_json) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (phone_hmac) DO UPDATE SET phone_hmac=EXCLUDED.phone_hmac RETURNING *`,
      [encrypt(phone), ph, email ? encrypt(email) : null, locale === 'en' ? 'en' : 'de', JSON.stringify(prefs)]));

  const { rows: [vehicle] } = await q(
    `INSERT INTO vehicles (owner_id, plate_enc, type) VALUES ($1,$2,$3) RETURNING id`,
    [owner.id, plate ? encrypt(plate) : null, vehicleType || 'car']);
  await q(`UPDATE tags SET state='active', vehicle_id=$1, activated_at=now() WHERE tag_id=$2`, [vehicle.id, tagId]);
  bustTagCache(tagId);

  res.json({ ok: true, ownerToken: signToken({ owner_id: owner.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }) });
}));

/* ── Owner: login (existing owners, dashboard) ────────────────────── */
api.post('/owner/login/start', wrap(async (req, res) => {
  const phone = asPhone((req.body || {}).phone);
  if (!await redis.set(`otpstart:${fingerprintOf(req)}`, 1, 'EX', 60, 'NX')) throw bad(429, 'rate_limited');
  const { rows } = await q('SELECT 1 FROM owners WHERE phone_hmac=$1', [hmacOf(phone)]);
  if (rows[0]) await sendOtp(phone);           // uniform response either way — no account enumeration
  res.json({ ok: true });
}));

api.post('/owner/login/verify', wrap(async (req, res) => {
  const { phone: rawPhone, code } = req.body || {};
  const phone = asPhone(rawPhone);
  await checkOtp(phone, code);
  const { rows: [owner] } = await q('SELECT id FROM owners WHERE phone_hmac=$1', [hmacOf(phone)]);
  if (!owner) throw bad(400, 'bad_code');
  res.json({ ok: true, ownerToken: signToken({ owner_id: owner.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }) });
}));

/* ── Owner: dashboard ─────────────────────────────────────────────── */
api.get('/owner/me', wrap(async (req, res) => {
  const oid = requireOwner(req);
  const { rows: [o] } = await q('SELECT id, locale, prefs_json, created_at, phone_enc, email_enc FROM owners WHERE id=$1', [oid]);
  if (!o) throw bad(401, 'unauthorized');
  const { rows: tags } = await q(
    `SELECT t.tag_id, t.state, t.muted_until, v.type FROM tags t JOIN vehicles v ON v.id=t.vehicle_id WHERE v.owner_id=$1`, [oid]);
  const phone = decrypt(o.phone_enc);
  res.json({
    locale: o.locale, prefs: o.prefs_json, created_at: o.created_at,
    phoneMasked: phone.slice(0, 3) + '•••••' + phone.slice(-3),      // masked even for the owner's own view
    tags,
  });
}));

api.patch('/owner/prefs', wrap(async (req, res) => {
  const oid = requireOwner(req);
  const { channels, calls, quiet, locale } = req.body || {};
  const { rows: [cur] } = await q('SELECT prefs_json FROM owners WHERE id=$1', [oid]);
  const allowed = ['whatsapp', 'email', 'sms'];
  const prefs = {
    channels: Array.isArray(channels) ? channels.filter(c => allowed.includes(c)) : allowed,
    calls: calls !== false,
    quiet: quiet && Number.isInteger(quiet.from) && Number.isInteger(quiet.to) ? quiet : null,
    tz: cur?.prefs_json?.tz || null,          // preserved across pref updates
  };
  await q('UPDATE owners SET prefs_json=$1, locale=$2 WHERE id=$3',
    [JSON.stringify(prefs), locale === 'en' ? 'en' : 'de', oid]);
  res.json({ ok: true });
}));

api.post('/owner/tags/:tagId/mute', wrap(async (req, res) => {   // toggle 24 h mute
  const oid = requireOwner(req);
  const r = await q(
    `UPDATE tags t SET muted_until = CASE WHEN t.muted_until > now() THEN NULL
                                          ELSE now()+interval '24 hours' END
     FROM vehicles v
     WHERE t.tag_id=$1 AND t.vehicle_id=v.id AND v.owner_id=$2
     RETURNING t.muted_until`, [req.params.tagId, oid]);
  if (!r.rowCount) throw bad(404, 'not_found');
  bustTagCache(req.params.tagId);
  res.json({ ok: true, muted: !!r.rows[0].muted_until });
}));

api.post('/owner/tags/:tagId/pause', wrap(async (req, res) => {  // panic pause / unpause
  const oid = requireOwner(req);
  const r = await q(
    `UPDATE tags t SET state = CASE state WHEN 'paused' THEN 'active' ELSE 'paused' END
     FROM vehicles v WHERE t.tag_id=$1 AND t.vehicle_id=v.id AND v.owner_id=$2 AND t.state<>'unactivated'
     RETURNING t.state`, [req.params.tagId, oid]);
  if (!r.rowCount) throw bad(404, 'not_found');
  bustTagCache(req.params.tagId);
  res.json({ ok: true, state: r.rows[0].state });
}));

api.get('/owner/sessions', wrap(async (req, res) => {
  const oid = requireOwner(req);
  const { rows } = await q(
    `SELECT rs.session_id, rs.tag_id, rs.created_at, rs.expires_at, rs.state,
            (SELECT json_agg(json_build_object('direction',m.direction,'body',m.body,'at',m.created_at) ORDER BY m.created_at)
             FROM messages m WHERE m.session_id=rs.session_id) AS messages
     FROM relay_sessions rs JOIN tags t ON t.tag_id=rs.tag_id JOIN vehicles v ON v.id=t.vehicle_id
     WHERE v.owner_id=$1 AND rs.expires_at>now() ORDER BY rs.created_at DESC`, [oid]);
  res.json({ sessions: rows });
}));

api.post('/owner/reply', wrap(async (req, res) => {
  const oid = requireOwner(req);
  const { sessionId, text } = req.body || {};
  const mod = moderateFreeText(text);
  if (!mod.ok || !mod.clean) throw bad(422, 'message_blocked');
  const { rows: [rs] } = await q(
    `SELECT rs.* FROM relay_sessions rs JOIN tags t ON t.tag_id=rs.tag_id
     JOIN vehicles v ON v.id=t.vehicle_id
     WHERE rs.session_id=$1 AND v.owner_id=$2 AND rs.expires_at>now() AND rs.state='open'`, [sessionId, oid]);
  if (!rs) throw bad(404, 'session_gone');

  await q(`INSERT INTO messages (session_id, direction, body) VALUES ($1,'to_observer',$2)`, [sessionId, mod.clean]);
  if (rs.observer_endpoint_enc)      // masked SMS back through the pool; else observer reads via inbox
    await sendSms(decrypt(rs.observer_endpoint_enc), `OwnerTag: ${mod.clean}`);
  res.json({ ok: true });
}));

api.post('/owner/report', wrap(async (req, res) => {   // freeze snapshot 30 d, block session
  const oid = requireOwner(req);
  const { sessionId } = req.body || {};
  const { rows: [rs] } = await q(
    `SELECT rs.session_id, rs.tag_id,
            (SELECT json_agg(json_build_object('direction',direction,'body',body,'at',created_at))
             FROM messages WHERE session_id=rs.session_id) AS msgs
     FROM relay_sessions rs JOIN tags t ON t.tag_id=rs.tag_id JOIN vehicles v ON v.id=t.vehicle_id
     WHERE rs.session_id=$1 AND v.owner_id=$2`, [sessionId, oid]);
  if (!rs) throw bad(404, 'not_found');
  await q(`INSERT INTO abuse_reports (session_id, snapshot_json) VALUES ($1,$2)`,
    [sessionId, JSON.stringify(rs)]);
  await q(`UPDATE relay_sessions SET state='blocked' WHERE session_id=$1`, [sessionId]);
  res.json({ ok: true });
}));

/* ── Owner: start a subscription (Stripe Checkout) ────────────────── */
api.post('/subscribe', wrap(async (req, res) => {
  const oid = requireOwner(req);                       // must be a logged-in owner
  const { rows: [o] } = await q('SELECT email_enc FROM owners WHERE id=$1', [oid]);
  const email = o?.email_enc ? decrypt(o.email_enc) : String(req.body?.email || '');
  const url = await createSubscriptionCheckout({ ownerId: oid, email });
  res.json({ url });                                   // frontend redirects the owner to Stripe
}));

/* ── Owner: GDPR — export (Art. 15/20) & erasure (Art. 17) ────────── */
api.get('/owner/export', wrap(async (req, res) => {
  const oid = requireOwner(req);
  const { rows: [o] } = await q('SELECT * FROM owners WHERE id=$1', [oid]);
  const { rows: vehicles } = await q('SELECT id, plate_enc, type FROM vehicles WHERE owner_id=$1', [oid]);
  const { rows: tags } = await q(
    'SELECT t.* FROM tags t JOIN vehicles v ON v.id=t.vehicle_id WHERE v.owner_id=$1', [oid]);
  res.json({
    exported_at: new Date().toISOString(),
    account: { phone: decrypt(o.phone_enc), email: decrypt(o.email_enc), locale: o.locale, prefs: o.prefs_json, created_at: o.created_at },
    vehicles: vehicles.map(v => ({ plate: decrypt(v.plate_enc), type: v.type })),
    tags: tags.map(t => ({ tag_id: t.tag_id, state: t.state, activated_at: t.activated_at })),
  });
}));

api.delete('/owner/account', wrap(async (req, res) => {
  const oid = requireOwner(req);
  /* GDPR Art. 17 erasure — atomic. Tags are physical inventory (kept, reset to
     unactivated), so their relay_sessions/messages are NOT reached by a tag
     cascade; delete them explicitly. All within ONE transaction so a mid-way
     failure can't leave the account half-erased. abuse_reports are a documented
     legal hold and intentionally survive (self-purge after 30 d). With KMS
     envelope encryption this becomes crypto-shredding (destroy wrapped keys). */
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownerTags = `SELECT t.tag_id FROM tags t JOIN vehicles v ON v.id=t.vehicle_id WHERE v.owner_id=$1`;
    await client.query(`DELETE FROM messages       WHERE session_id IN (SELECT session_id FROM relay_sessions WHERE tag_id IN (${ownerTags}))`, [oid]);
    await client.query(`DELETE FROM relay_sessions WHERE tag_id IN (${ownerTags})`, [oid]);
    await client.query(`UPDATE tags SET state='unactivated', vehicle_id=NULL, activated_at=NULL
                        WHERE vehicle_id IN (SELECT id FROM vehicles WHERE owner_id=$1)`, [oid]);
    await client.query('DELETE FROM owners WHERE id=$1', [oid]);   // vehicles cascade on owner delete
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));
