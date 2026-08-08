/* Consolidated Twilio integration — official SDK for SMS, Verify (OTP) and
   masked calls, replacing the two ad-hoc paths (raw REST in notify.js + the
   Verify SDK bolt-on). Every call is guarded: unconfigured Twilio degrades
   gracefully instead of throwing at import or crashing a request. */
import twilio, { Twilio } from "twilio";
import { config } from "../config.js";

let client: Twilio | null = null;
function getClient(): Twilio {
  if (!config.twilio.sid || !config.twilio.token) {
    throw new Error("twilio_not_configured");
  }
  if (!client) client = twilio(config.twilio.sid, config.twilio.token);
  return client;
}

export function twilioReady(): boolean {
  return Boolean(config.twilio.sid && config.twilio.token);
}
export function verifyEnabled(): boolean {
  return Boolean(config.twilio.verifyServiceSid && twilioReady());
}

/** Send an SMS. Returns true on success, false if unconfigured or rejected —
    never throws, so a failed text can't 500 the caller. */
export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!twilioReady()) return false;
  const from = config.twilio.phoneNumber || config.twilio.smsSender;
  try {
    await getClient().messages.create({ to, from, body });
    return true;
  } catch (err) {
    logTwilio("sms", err);
    return false;
  }
}

/** Twilio Verify — start an OTP challenge. */
export async function startVerification(to: string): Promise<void> {
  await getClient()
    .verify.v2.services(config.twilio.verifyServiceSid)
    .verifications.create({ to, channel: "sms" });
}

/** Twilio Verify — check a code. True if approved. Never throws on wrong code. */
export async function checkVerification(to: string, code: string): Promise<boolean> {
  try {
    const r = await getClient()
      .verify.v2.services(config.twilio.verifyServiceSid)
      .verificationChecks.create({ to, code });
    return r.status === "approved";
  } catch (err) {
    if (isNotFound(err)) return false; // 20404: expired/no pending verification
    throw err;
  }
}

/** Two-leg masked call: ring the observer from a relay DID; TwiML bridges to
    the owner. Both sides only ever see the relay number. Throws {status} on
    failure so the route can return a clean 502/503. */
export async function startMaskedCall(sessionId: string, observerPhone: string): Promise<void> {
  const relay = config.twilio.relayNumbers[0];
  if (!relay || !twilioReady()) throw httpError(503, "calls_unavailable");
  try {
    await getClient().calls.create({
      to: observerPhone,
      from: relay,
      url: `${config.baseUrl}/webhooks/voice/bridge?session=${encodeURIComponent(sessionId)}`,
      timeout: 25
    });
  } catch (err) {
    logTwilio("call", err);
    throw httpError(502, "call_failed");
  }
}

// ── helpers ──────────────────────────────────────────────────────────
interface TwilioErr { status?: number; code?: number | string; message?: string; }
function isNotFound(err: unknown): boolean {
  return (err as TwilioErr)?.status === 404;
}
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}
function logTwilio(kind: string, err: unknown): void {
  const e = err as TwilioErr;
  // Log code/message only — never the recipient number.
  console.error(`twilio ${kind} failed: code ${e?.code ?? "?"} — ${e?.message ?? "unknown"}`);
}
