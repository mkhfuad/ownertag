/* Notification/relay service — the ONLY module that decrypts contact data.
   Decrypt in memory at send time, deliver, discard. Never log plaintext. */
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { decrypt } from './crypto.js';

const twilioAuth = 'Basic ' + Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString('base64');

async function sendWhatsApp(phone, text) {
  if (!config.whatsapp.accessToken) return false;
  const r = await fetch(`https://graph.facebook.com/v20.0/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: phone.replace('+', ''),
      type: 'template',
      template: { name: config.whatsapp.template, language: { code: 'de' },
                  components: [{ type: 'body', parameters: [{ type: 'text', text }] }] },
    }),
  });
  return r.ok;
}

let mailer = null;
export async function sendEmail(email, subject, text) {
  if (!config.smtp.host || !config.smtp.user) return false;
  mailer ??= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: false,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  await mailer.sendMail({ from: config.smtp.from, to: email, subject, text });
  return true;
}

export async function sendSms(phone, text, from = config.twilio.smsSender) {
  if (!config.twilio.sid) return false;
  // Tolerate human formatting in the sender ("+1 (555) 123-4567" → "+15551234567");
  // leave alpha senders like OWNERTAG untouched.
  if (/\d{5,}/.test(from)) from = from.replace(/[\s\-().]/g, '');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: twilioAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: from, Body: text }),
  });
  if (!r.ok) {
    // Log Twilio's error code + message only — never the phone number
    const err = await r.json().catch(() => ({}));
    console.error(`twilio sms failed: http ${r.status}, code ${err.code || '?'} — ${err.message || ''}`);
  }
  return r.ok;
}

/* Notify owner over the cheapest adequate channel they allow.
   Channel order per Germany doc §3.3: whatsapp → email → sms.
   (Push = later, when the native owner app exists.) */
export async function notifyOwner(owner, text) {
  const prefs = owner.prefs_json?.channels || ['whatsapp', 'email', 'sms'];
  const quiet = owner.prefs_json?.quiet;               // e.g. {from:22,to:7}
  if (quiet) {
    const h = new Date().getHours();
    const inQuiet = quiet.from > quiet.to ? (h >= quiet.from || h < quiet.to) : (h >= quiet.from && h < quiet.to);
    if (inQuiet) prefs.splice(0, prefs.length, 'email'); // quiet hours: email only
  }
  for (const ch of prefs) {
    try {
      if (ch === 'whatsapp' && await sendWhatsApp(decrypt(owner.phone_enc), text)) return ch;
      if (ch === 'email' && owner.email_enc && await sendEmail(decrypt(owner.email_enc), 'OwnerTag — Nachricht zu Ihrem Fahrzeug', text)) return ch;
      if (ch === 'sms' && await sendSms(decrypt(owner.phone_enc), text)) return ch;
    } catch { /* fall through to next channel */ }
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[dev-notify] would deliver: ${text}`);   // body only — never contact data
    return 'dev';
  }
  return null;
}

/* ── Masked voice: two-leg bridge (BNetzA-compliant) ────────────────
   Leg A: call the observer from a German relay DID.
   On answer, TwiML (webhooks.js) whispers to the owner and bridges.
   Both sides only ever see the relay number. */
export async function startMaskedCall(sessionId, observerPhone) {
  const relay = config.twilio.relayNumbers[0];
  if (!relay || !config.twilio.sid) { const e = new Error('calls_unavailable'); e.status = 503; throw e; }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: twilioAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      To: observerPhone,
      From: relay,                                        // real German DID — no CLI overstamping
      Url: `${config.baseUrl}/webhooks/voice/bridge?session=${sessionId}`,
      Timeout: '25',
    }),
  });
  if (!r.ok) { const e = new Error('call_failed'); e.status = 502; throw e; }
}
