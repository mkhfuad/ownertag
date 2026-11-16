/* Smallest checks that fail if core logic breaks. No framework. */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.MASTER_KEY = 'a'.repeat(64);
process.env.HMAC_KEY = 'b'.repeat(64);
process.env.TOKEN_KEY = 'c'.repeat(64);

const { encrypt, decrypt, hmacOf, newTagId, signToken, verifyToken } = await import('../src/crypto.js');
const { moderateFreeText } = await import('../src/moderation.js');

/* crypto roundtrip */
assert.equal(decrypt(encrypt('+4915112345678')), '+4915112345678');
assert.equal(decrypt(null), null);
assert.notEqual(encrypt('x'), encrypt('x'));                    // random IV
assert.equal(hmacOf('a'), hmacOf('a'));
assert.notEqual(hmacOf('a'), hmacOf('b'));

/* tag ids */
const id = newTagId();
assert.match(id, /^[0-9A-HJKMNP-TV-Z]{10}$/);
assert.notEqual(newTagId(), newTagId());

/* tokens */
const t = signToken({ sid: 's1', exp: Math.floor(Date.now() / 1000) + 60 });
assert.equal(verifyToken(t).sid, 's1');
assert.equal(verifyToken(t + 'x'), null);                       // tamper
assert.equal(verifyToken(signToken({ sid: 's1', exp: 1 })), null); // expired

/* moderation: strip attack surface, block abuse, pass benign */
const m1 = moderateFreeText('Call me at +49 151 2345678 or http://evil.de/x now');
assert.ok(m1.ok && !m1.clean.includes('151') && !m1.clean.includes('evil'));
assert.equal(moderateFreeText('du hurensohn').ok, false);
assert.equal(moderateFreeText('kill you tomorrow').ok, false);
const m2 = moderateFreeText('Ihr Kofferraum steht offen, Ecke Hauptstraße');
assert.ok(m2.ok && m2.clean.includes('Kofferraum'));
assert.ok(!moderateFreeText('<script>x</script>hi').clean.includes('<'));  // markup stripped

/* OTP uses CSPRNG and is always 6 digits (C2) */
const { randomInt } = await import('node:crypto');
for (let i = 0; i < 50; i++) assert.match(String(randomInt(100000, 1000000)), /^\d{6}$/);

/* C1: production must REFUSE to boot on the insecure dev master key.
   Runs config.js in a subprocess with NODE_ENV=production + the zero key. */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const refuse = spawnSync(process.execPath, ['-e', "import('./src/config.js').catch(e=>{console.error(e.message);process.exit(1)})"], {
  cwd: appRoot, encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'production',
         MASTER_KEY: '0'.repeat(64), HMAC_KEY: 'b'.repeat(64), TOKEN_KEY: 'c'.repeat(64),
         DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' },
});
assert.notEqual(refuse.status, 0, 'config must refuse the dev master key in production');
assert.match(refuse.stderr, /insecure dev default/);

/* Legacy plaintext rows (written before a column was encrypted) still read back */
const { decryptMaybe } = await import('../src/crypto.js');
assert.equal(decryptMaybe('Max Mustermann'), 'Max Mustermann');
assert.equal(decryptMaybe(encrypt('Max')), 'Max');

/* Rate-limit identity: IPv6 collapses to its /64, IPv4 stays per-address.
   (Importing these modules builds lazy DB/Redis clients; nothing here uses them.) */
process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x';
process.env.REDIS_URL ||= 'redis://127.0.0.1:1';
const { ipKey } = await import('../src/ratelimit.js');
assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), ipKey('2001:db8:1:2::1'));       // same /64 → same key
assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));                      // different /64
assert.equal(ipKey('2001:0db8::1'), ipKey('2001:db8:0:0:ffff::9'));                       // compressed vs expanded
assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');                                 // v4-mapped = plain v4
assert.notEqual(ipKey('203.0.113.7'), ipKey('203.0.113.8'));

/* Only DE/AT/CH numbers may be dialled or texted on an unverified request */
const { asDialable } = await import('../src/routes.js');
assert.equal(asDialable('0151 2345678'), '+491512345678');
assert.equal(asDialable('+43 664 1234567'), '+436641234567');
assert.equal(asDialable('0041 79 123 45 67'), '+41791234567');
for (const n of ['+18005551234', '+919876543210', '+882312345678'])
  assert.throws(() => asDialable(n), /country_unsupported/);

console.log('selfcheck: all passed');
process.exit(0);
