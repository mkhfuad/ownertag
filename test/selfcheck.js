/* Smallest checks that fail if core logic breaks. No framework. */
import assert from 'node:assert';

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

console.log('selfcheck: all passed');
process.exit(0);
