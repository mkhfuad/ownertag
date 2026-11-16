const TAG = new URLSearchParams(location.search).get('tag');
const $ = id => document.getElementById(id);
const DE = (navigator.language || 'de').startsWith('de');
const T = (de, en) => (DE ? de : en);
document.documentElement.lang = DE ? 'de' : 'en';

/* Server error codes → sentences. Never show a raw code to a customer. */
const ERR = {
  bad_phone: T('Bitte eine gültige Mobilnummer eingeben, z. B. +49 151 …', 'Please enter a valid mobile number, e.g. +49 151 …'),
  country_unsupported: T('Aktivierung ist derzeit nur mit Nummern aus Deutschland, Österreich und der Schweiz möglich.', 'Activation currently works only with German, Austrian and Swiss numbers.'),
  bad_code: T('Der Code ist falsch oder abgelaufen. Bitte prüfen oder neu anfordern.', 'That code is wrong or expired. Check it or request a new one.'),
  too_many_attempts: T('Zu viele Fehlversuche — bitte fordern Sie einen neuen Code an.', 'Too many wrong attempts — please request a new code.'),
  rate_limited: T('Zu viele Anfragen — bitte warten Sie eine Minute und versuchen Sie es erneut.', 'Too many requests — please wait a minute and try again.'),
  already_active: T('Dieser Tag ist bereits aktiviert. Melden Sie sich im Dashboard an.', 'This tag is already activated. Sign in to the dashboard.'),
  not_found: T('Dieser Tag existiert nicht. Bitte scannen Sie den QR-Code auf Ihrem Aufkleber erneut.', 'This tag does not exist. Please scan the QR code on your sticker again.'),
  bad_email: T('Bitte eine gültige E-Mail-Adresse eingeben (oder das Feld leer lassen).', 'Please enter a valid email address (or leave it empty).'),
  bad_plate: T('Das Kennzeichen ist zu lang.', 'The plate is too long.'),
  default: T('Etwas ist schiefgelaufen. Bitte erneut versuchen.', 'Something went wrong. Please try again.'),
};
const status = (msg) => { $('status').textContent = msg; };
const fail = (e) => status(ERR[e.message] || ERR.default);

let vtype = 'car';
document.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-type]').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); });
  b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); vtype = b.dataset.type;
});

const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'default');
  return d;
};
/* Run `fn` with the button disabled, so a double tap can't send two SMS. */
async function guarded(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { fail(e); }
  btn.disabled = false;
}

async function sendCode() {
  await post('/api/activate/start', { tagId: TAG, phone: $('phone').value.trim() });
  $('step1').classList.add('hidden'); $('step2').classList.remove('hidden');
  status(T('Code per SMS gesendet. Er ist 5 Minuten gültig.', 'Code sent by SMS. It is valid for 5 minutes.'));
  $('code').focus();
}
$('otpBtn').onclick = () => guarded($('otpBtn'), sendCode);
$('resendBtn').onclick = () => guarded($('resendBtn'), sendCode);
$('backBtn').onclick = () => {
  $('step2').classList.add('hidden'); $('step1').classList.remove('hidden'); status(''); $('phone').focus();
};
$('verifyBtn').onclick = () => guarded($('verifyBtn'), async () => {
  const d = await post('/api/activate/verify', {
    tagId: TAG, phone: $('phone').value.trim(), code: $('code').value.trim(),
    plate: $('plate').value.trim() || undefined, email: $('email').value.trim() || undefined,
    vehicleType: vtype,
    locale: DE ? 'de' : 'en',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  try { localStorage.setItem('ot_owner', d.ownerToken); } catch { /* private mode: they log in via SMS */ }
  $('step2').classList.add('hidden'); $('done').classList.remove('hidden');
  status('');
});

if (!TAG) { $('step1').classList.add('hidden'); status(ERR.not_found); }
