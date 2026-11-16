import { createHash } from 'node:crypto';
import { redis } from './redis.js';

/* Fixed-window counters in Redis.
   ponytail: fixed window, not token bucket — 2x burst at window edges
   is acceptable at these limits; swap to sliding window if abuse data
   says otherwise. */
async function hit(key, limit, windowSec, failOpen = false) {
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSec);
    return n <= limit;
  } catch (err) {
    /* Write-path limits fail CLOSED (losing them enables abuse). The scan gate
       passes failOpen: it's only anti-enumeration, and the scan handler already
       falls back to Postgres — a Redis blip must not 500 the core "someone at a
       car" path. */
    if (failOpen) { console.error('ratelimit: redis unreachable, failing open —', err.code || err.message); return true; }
    throw err;
  }
}

/* req.ip honours `trust proxy` (1 hop = Caddy/Render), i.e. the address the proxy
   SAW. The leftmost X-Forwarded-For entry is client-supplied — keying on it let any
   request rotate its "identity" and bypass every limit below. Keyed on IP only:
   User-Agent is free to rotate, so mixing it in multiplied an attacker's budget. */
export const fingerprintOf = (req) =>
  createHash('sha256').update(ipKey(String(req.ip || req.socket.remoteAddress || ''))).digest('base64url').slice(0, 24);

/* One IPv6 customer controls a whole /64 (2^64 addresses), so per-address keys are
   no limit at all — key IPv6 on its /64 network. IPv4 (and v4-mapped) stay per-address. */
export function ipKey(ip) {
  ip = ip.replace(/^::ffff:(?=\d+\.)/i, '').split('%')[0];
  if (!ip.includes(':')) return ip;
  const [h, t] = ip.split('::');
  const head = h ? h.split(':') : [], tail = t ? t.split(':') : [];
  const full = t === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return full.slice(0, 4).map(x => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}

/* SMS-pumping guard: an OTP request sends a paid SMS to an attacker-chosen number.
   Cap per tag (activation) and per destination number, independent of the caller. */
export async function checkOtpLimits(phoneHmac, tagId) {
  const checks = [hit(`rl:otpdst:${phoneHmac}`, 3, 3600)];
  if (tagId) checks.push(hit(`rl:otptag:${tagId}`, 5, 3600));
  if (!(await Promise.all(checks)).every(Boolean)) { const e = new Error('rate_limited'); e.status = 429; throw e; }
}

/* Limits from the design doc §4.1. Throws { status:429 } on breach. */
export async function checkMessageLimits(tagId, fp) {
  const ok = (await Promise.all([
    hit(`rl:tag:h:${tagId}`, 5, 3600),
    hit(`rl:tag:d:${tagId}`, 15, 86400),
    hit(`rl:obs:${fp}`, 3, 600),
    hit(`rl:pair:${tagId}:${fp}`, 2, 3600),
  ])).every(Boolean);
  if (!ok) { const e = new Error('rate_limited'); e.status = 429; throw e; }
}

export async function checkCallLimits(tagId, fp) {
  const ok = (await Promise.all([
    hit(`rl:call:${tagId}`, 2, 3600),
    hit(`rl:obs:${fp}`, 3, 600),
  ])).every(Boolean);
  if (!ok) { const e = new Error('rate_limited'); e.status = 429; throw e; }
}

export async function checkScanLimits(fp) {
  if (!await hit(`rl:scan:${fp}`, 30, 600, true)) {   // anti-enumeration; fails open on Redis outage
    const e = new Error('rate_limited'); e.status = 429; throw e;
  }
}
