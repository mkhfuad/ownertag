/* Twilio voice webhooks — the two-leg masked bridge.
   Leg A (observer) is placed by notify.startMaskedCall with Url=/voice/bridge.
   When the observer answers, we <Dial> the owner with a whisper prompt;
   the owner presses 1 to accept. Both legs only ever see the relay DID. */
import { Router } from 'express';
import { q } from './db.js';
import { decrypt } from './crypto.js';
import { config } from './config.js';

export const webhooks = Router();
const xml = (res, body) => res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);

async function ownerPhoneForSession(sessionId) {
  const { rows: [r] } = await q(
    `SELECT o.phone_enc FROM relay_sessions rs
     JOIN tags t ON t.tag_id=rs.tag_id JOIN vehicles v ON v.id=t.vehicle_id JOIN owners o ON o.id=v.owner_id
     WHERE rs.session_id=$1 AND rs.expires_at>now() AND rs.state='open'`, [sessionId]);
  return r ? decrypt(r.phone_enc) : null;
}

webhooks.post('/voice/bridge', async (req, res) => {
  const owner = await ownerPhoneForSession(req.query.session);
  if (!owner) return xml(res, `<Say language="de-DE">Diese Sitzung ist abgelaufen.</Say><Hangup/>`);
  const relay = config.twilio.relayNumbers[0];
  xml(res, `
    <Say language="de-DE">Sie werden mit dem Fahrzeughalter verbunden.</Say>
    <Dial callerId="${relay}" timeout="25">
      <Number url="${config.baseUrl}/webhooks/voice/whisper">${owner}</Number>
    </Dial>
    <Say language="de-DE">Der Halter ist nicht erreichbar.</Say>`);
});

webhooks.post('/voice/whisper', (req, res) => {
  xml(res, `
    <Gather numDigits="1" action="${config.baseUrl}/webhooks/voice/accept" timeout="8">
      <Say language="de-DE">OwnerTag-Anruf zu Ihrem Fahrzeug. Drücken Sie die Eins, um anzunehmen.</Say>
    </Gather>
    <Hangup/>`);
});

webhooks.post('/voice/accept', (req, res) => {
  if ((req.body?.Digits || '') === '1') return xml(res, '');   // empty response = bridge the call
  xml(res, '<Hangup/>');
});
