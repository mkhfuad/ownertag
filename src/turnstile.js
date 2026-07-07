import { config } from './config.js';

/* Cloudflare Turnstile server-side verification.
   Empty TURNSTILE_SECRET = disabled (dev). Fail closed in production. */
export async function verifyTurnstile(token, ip) {
  if (!config.turnstileSecret) return process.env.NODE_ENV !== 'production';
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.turnstileSecret, response: token || '', remoteip: ip || '' }),
  });
  return (await r.json()).success === true;
}
