import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

/* Derive 32-byte keys by hashing the env value — any sufficiently random
   string works (hex, base64, password-manager output), nothing can be
   the wrong length. */
const kdf = (s) => createHash('sha256').update(s).digest();
const MASTER = kdf(config.masterKey);
const HMAC = kdf(config.hmacKey);
const TOKEN = kdf(config.tokenKey);

/* ── Field encryption ──────────────────────────────────────────────
   AES-256-GCM under the master key. Format: iv.tag.ciphertext (b64url).
   ponytail: direct master-key encryption; upgrade path is AWS KMS
   envelope encryption (GenerateDataKey per record, wrapped key stored
   alongside) when compliance review demands per-record keys. */
export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', MASTER, iv);
  const data = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
}

export function decrypt(blob) {
  if (blob == null) return null;
  const [iv, tag, data] = blob.split('.').map(s => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', MASTER, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

/* Keyed HMAC for equality lookups (phone dedup) — never index plaintext */
export const hmacOf = (v) => createHmac('sha256', HMAC).update(String(v)).digest('base64url');

/* ── Tag IDs: 10-char Crockford base32, ~50 bits from CSPRNG ─────── */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const newTagId = () =>
  Array.from(randomBytes(10), b => ALPHABET[b % 32]).join('');

export const newSessionId = () => randomBytes(16).toString('base64url');

/* ── Compact signed tokens (HMAC, stdlib — no JWT dependency) ──────
   payload: any JSON object with `exp` (unix seconds). */
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', TOKEN).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = createHmac('sha256', TOKEN).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now() / 1000) return null;
  return payload;
}
