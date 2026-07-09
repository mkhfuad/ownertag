import { config } from './config.js';

/* Cloudflare Turnstile server-side verification.
   Empty TURNSTILE_SECRET = captcha disabled (rate limits still protect) — allowed,
   but never SILENTLY in production: warn loudly at boot so it can't slip past launch. */
if (process.env.NODE_ENV === 'production' && !config.turnstileSecret)
  console.warn('⚠ TURNSTILE_SECRET is unset in production — captcha is DISABLED. Set it before public launch (README).');

export async function verifyTurnstile(token, ip) {
  if (!config.turnstileSecret) return true;
  /* Once configured, this is a real security control: any failure — bad token,
     malformed response, or Cloudflare unreachable — fails CLOSED, never open. */
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstileSecret, response: token || '', remoteip: ip || '' }),
    });
    return (await r.json()).success === true;
  } catch {
    return false;
  }
}
