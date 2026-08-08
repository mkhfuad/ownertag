/* Twilio Verify — official SDK path for phone verification (OTP).
   OPTIONAL and backward-compatible: only used when TWILIO_VERIFY_SERVICE_SID
   is set. If it isn't, routes.js keeps its existing Redis+SMS OTP unchanged.

   Why Verify: Twilio generates, sends, rate-limits, expires and checks the
   code for you — no SMS sender/DID pool needed, and it works in countries
   where alphanumeric senders (e.g. "OWNERTAG") are rejected. */
import twilio from 'twilio';
import { config } from './config.js';

let client = null;
function getClient() {
  // Lazily build one authenticated client. Reused across requests.
  if (!client) client = twilio(config.twilio.sid, config.twilio.token);
  return client;
}

/** True when Verify is configured (SID + credentials all present). */
export function verifyEnabled() {
  return Boolean(config.twilio.verifyServiceSid && config.twilio.sid && config.twilio.token);
}

/** Send an OTP to `phone` (E.164). Resolves on success; throws on hard failure. */
export async function startVerification(phone) {
  await getClient()
    .verify.v2.services(config.twilio.verifyServiceSid)
    .verifications.create({ to: phone, channel: 'sms' });
}

/** Check the code the user entered. Returns true if approved, false otherwise.
    Never throws on a wrong code — caller decides the HTTP response. */
export async function checkVerification(phone, code) {
  try {
    const res = await getClient()
      .verify.v2.services(config.twilio.verifyServiceSid)
      .verificationChecks.create({ to: phone, code: String(code) });
    return res.status === 'approved';
  } catch (e) {
    // 20404 = no pending/expired verification for this number → treat as "not approved".
    if (e && e.status === 404) return false;
    throw e;
  }
}
