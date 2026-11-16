/* Activation: number → code → live. Everything else is optional and comes after. */
const TAG = new URLSearchParams(location.search).get('tag');
const $ = id => document.getElementById(id);
const DE = (navigator.language || 'de').startsWith('de');
const T = (de, en) => (DE ? de : en);

/* One language on screen, not two side by side */
document.documentElement.lang = DE ? 'de' : 'en';
document.querySelectorAll('[data-de]').forEach(el => { el.textContent = el.dataset[DE ? 'de' : 'en'] || el.dataset.de; });
document.querySelectorAll('[data-lang]').forEach(el => el.classList.toggle('hidden', el.dataset.lang !== (DE ? 'de' : 'en')));

/* Server error codes → sentences. Never show a raw code to a customer. */
const ERR = {
  bad_phone: T('Bitte eine gültige Handynummer eingeben, z. B. +49 151 …', 'Please enter a valid mobile number, e.g. +49 151 …'),
  country_unsupported: T('Aktivierung ist derzeit nur mit Nummern aus Deutschland, Österreich und der Schweiz möglich.', 'Activation currently works only with German, Austrian and Swiss numbers.'),
  bad_code: T('Der Code ist falsch oder abgelaufen. Bitte prüfen oder neu anfordern.', 'That code is wrong or expired. Check it or request a new one.'),
  too_many_attempts: T('Zu viele Fehlversuche. Bitte fordern Sie einen neuen Code an.', 'Too many wrong attempts. Please request a new code.'),
  rate_limited: T('Zu viele Anfragen. Bitte warten Sie eine Minute und versuchen Sie es erneut.', 'Too many requests. Please wait a minute and try again.'),
  already_active: T('Dieser Tag ist bereits aktiviert. Melden Sie sich im Dashboard an.', 'This tag is already activated. Sign in to the dashboard.'),
  not_found: T('Dieser Tag existiert nicht. Bitte scannen Sie den QR-Code auf Ihrem Aufkleber erneut.', 'This tag does not exist. Please scan the QR code on your sticker again.'),
  bad_email: T('Bitte eine gültige E-Mail-Adresse eingeben oder das Feld leer lassen.', 'Please enter a valid email address or leave the field empty.'),
  default: T('Etwas ist schiefgelaufen. Bitte erneut versuchen.', 'Something went wrong. Please try again.'),
};
const status = (msg, ok = false) => { const el = $('status'); el.textContent = msg; el.className = 'inline ' + (ok ? 'ok' : 'err'); };
const fail = (e) => status(ERR[e.message] || ERR.default);
const showStep = (id) => ['step1', 'step2', 'done'].forEach(s => $(s).classList.toggle('hidden', s !== id));

let token = '';
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'default');
  return d;
};
/* Run `fn` with the button disabled, so a double tap can't send two SMS. */
async function guarded(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch (e) { fail(e); }
  btn.disabled = false;
}

async function sendCode() {
  const phone = $('phone').value.trim();
  await post('/api/activate/start', { tagId: TAG, phone });
  showStep('step2');
  $('sentTo').textContent = T(`Wir haben eine SMS an ${phone} gesendet. Der Code ist 5 Minuten gültig.`, `We sent an SMS to ${phone}. The code is valid for 5 minutes.`);
  status(''); $('code').value = ''; $('code').focus();
}
async function verify() {
  const d = await post('/api/activate/verify', {
    tagId: TAG, phone: $('phone').value.trim(), code: $('code').value.trim(),
    locale: DE ? 'de' : 'en',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  token = d.ownerToken;
  try { localStorage.setItem('ot_owner', token); } catch { /* private mode: they log in by SMS later */ }
  showStep('done'); status('');
}

$('otpBtn').onclick = () => guarded($('otpBtn'), sendCode);
$('phone').onkeydown = (e) => { if (e.key === 'Enter') $('otpBtn').click(); };
$('resendBtn').onclick = () => guarded($('resendBtn'), sendCode);
$('backBtn').onclick = () => { showStep('step1'); status(''); $('phone').focus(); };
$('verifyBtn').onclick = () => guarded($('verifyBtn'), verify);
/* The sixth digit submits — also covers iOS/Android filling the code from the SMS. */
$('code').oninput = () => {
  $('code').value = $('code').value.replace(/\D/g, '').slice(0, 6);
  if ($('code').value.length === 6) $('verifyBtn').click();
};

/* Optional extras, after the tag is already live */
let vtype = 'car';
document.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-type]').forEach(x => x.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true'); vtype = b.dataset.type;
});
$('saveBtn').onclick = () => guarded($('saveBtn'), async () => {
  await post('/api/owner/details', { tagId: TAG, email: $('email').value.trim() || undefined, vehicleType: vtype });
  $('extras').classList.add('hidden');
  $('dashLink').textContent = T('Zum Dashboard', 'Go to dashboard');
  status(T('Gespeichert.', 'Saved.'), true);
});

if (!TAG) { $('step1').classList.add('hidden'); status(ERR.not_found); }
