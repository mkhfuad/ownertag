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

export const fingerprintOf = (req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  return createHash('sha256').update(`${ip}|${ua}`).digest('base64url').slice(0, 24);
};

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
