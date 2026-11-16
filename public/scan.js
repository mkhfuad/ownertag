/* Observer scan page — no framework, <6 KB. */
const TAG = location.pathname.split('/').pop();
const LANG = (navigator.language || 'de').startsWith('de') ? 'de' : 'en';
const T = (de, en) => (LANG === 'de' ? de : en);
const $ = (id) => document.getElementById(id);
/* What the finder taps (short). The owner receives the full sentence from the server. */
const LABEL = {
  blocked: ['Zugeparkt', 'Blocked in'], lights: ['Licht an', 'Lights on'], damage: ['Schaden', 'Damage'],
  emergency: ['Notfall', 'Emergency'], alarm: ['Alarm läuft', 'Alarm ringing'], window: ['Fenster offen', 'Window open'],
  towing: ['Wird abgeschleppt', 'Being towed'],
};
const PRIMARY = ['blocked', 'lights', 'damage', 'emergency'];   // four choices first; the rest behind "Etwas anderes"
let selectedTemplate = null;
let turnstileToken = '';

/* Localize static strings (and tell screen readers which language this is) */
document.documentElement.lang = LANG;
document.querySelectorAll('[data-de]').forEach(el => { el.textContent = el.dataset[LANG] || el.dataset.de; });

function show(id) {
  ['loading', 'inactive', 'composer', 'done', 'error'].forEach(s => $(s).classList.toggle('hidden', s !== id));
}

/* Full-screen error: only when the page can't work at all (bad tag, no network). */
function fail(msg) {
  $('errorText').textContent = msg;
  show('error');
}
$('retryBtn').onclick = () => location.reload();

/* Inline feedback: the form (and whatever the person typed) stays on screen. */
const say = (err, ok = '') => { $('formErr').textContent = err; $('formOk').textContent = ok; };

const ERR = {
  rate_limited: { de: 'Zu viele Anfragen — bitte später erneut versuchen.', en: 'Too many requests — try again later.' },
  captcha_failed: { de: 'Sicherheitsprüfung fehlgeschlagen — bitte erneut versuchen.', en: 'Security check failed — please try again.' },
  delivery_failed: { de: 'Zustellung fehlgeschlagen — bitte später erneut.', en: 'Delivery failed — please try again later.' },
  message_blocked: { de: 'Nachricht konnte nicht gesendet werden.', en: 'Message could not be sent.' },
  tag_muted: { de: 'Der Halter pausiert Benachrichtigungen gerade.', en: 'The owner has paused notifications.' },
  tag_inactive: { de: 'Der Halter ist über diesen Tag gerade nicht erreichbar.', en: 'The owner is not reachable via this tag right now.' },
  not_found: { de: 'Dieser Tag existiert nicht. Bitte den QR-Code erneut scannen.', en: 'This tag does not exist. Please scan the QR code again.' },
  session_expired: { de: 'Sitzung abgelaufen — bitte QR-Code erneut scannen.', en: 'Session expired — please rescan the QR code.' },
  calls_unavailable: { de: 'Anrufe sind gerade nicht verfügbar — bitte senden Sie eine Nachricht.', en: 'Calls are unavailable right now — please send a message.' },
  call_failed: { de: 'Der Anruf konnte nicht aufgebaut werden — bitte senden Sie eine Nachricht.', en: 'The call could not be placed — please send a message.' },
  calls_disabled: { de: 'Der Halter nimmt keine Anrufe an — bitte senden Sie eine Nachricht.', en: 'The owner does not accept calls — please send a message.' },
  subscription_required: { de: 'Anrufe sind für diesen Tag nicht freigeschaltet — bitte senden Sie eine Nachricht.', en: 'Calls are not enabled for this tag — please send a message.' },
  bad_phone: { de: 'Bitte eine gültige Rufnummer eingeben, z. B. +49 151 …', en: 'Please enter a valid number, e.g. +49 151 …' },
  country_unsupported: { de: 'Rückrufe sind nur an Nummern aus Deutschland, Österreich und der Schweiz möglich — bitte senden Sie eine Nachricht.', en: 'Calls and callbacks only work for German, Austrian and Swiss numbers — please send a message instead.' },
  default: { de: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.', en: 'Something went wrong. Please try again.' },
};
const errText = (code) => (ERR[code] || ERR.default)[LANG];

/* fetch + JSON that never throws a raw parse error at the user */
async function call(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'default');
  return d;
}
const postJson = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* While a request runs: disable the button and show progress. Returns the undo. */
function busy(btn, label) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  return () => { btn.disabled = false; btn.textContent = old; };
}
/* A Turnstile token is single-use — get a fresh one after every attempt. */
function resetCaptcha() { turnstileToken = ''; try { window.turnstile?.reset(); } catch { /* not mounted */ } }

async function init() {
  try {
    const d = await call(`/api/tags/${encodeURIComponent(TAG)}`);

    if (d.state === 'unactivated') {
      $('inactiveTitle').textContent = T('Tag noch nicht aktiviert', 'Tag not activated yet');
      $('inactiveText').textContent = T('Wenn dieser Tag Ihnen gehört, aktivieren Sie ihn jetzt.', 'If this tag belongs to you, activate it now.');
      $('activateBtn').classList.remove('hidden');
      $('activateBtn').onclick = () => { location.href = '/activate.html?tag=' + TAG; };
      return show('inactive');
    }
    if (d.state !== 'active' || d.muted) {
      $('inactiveTitle').textContent = T('Vorübergehend nicht erreichbar', 'Temporarily unreachable');
      $('inactiveText').textContent = errText('tag_inactive');
      return show('inactive');
    }

    $('tagChip').textContent = `OwnerTag •••${d.suffix}`;
    for (const [key, t] of Object.entries(d.templates)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tpl'; b.dataset.key = key;
      b.setAttribute('aria-pressed', 'false');
      b.textContent = LABEL[key] ? LABEL[key][LANG === 'de' ? 0 : 1] : t[LANG];
      b.onclick = () => {
        document.querySelectorAll('.tpl').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true'); selectedTemplate = key; say('');
      };
      (PRIMARY.includes(key) ? $('templates') : $('templatesMore')).appendChild(b);
    }
    $('moreBtn').onclick = () => {
      $('templatesMore').classList.remove('hidden'); $('moreBtn').classList.add('hidden');
      $('templatesMore').querySelector('button')?.focus();
    };
    if (!$('templatesMore').children.length) $('moreBtn').classList.add('hidden');
    mountTurnstile(d.turnstileSiteKey);
    show('composer');
  } catch (e) { fail(errText(e.message)); }
}

$('sendBtn').onclick = async () => {
  if (!selectedTemplate) return say(T('Bitte wählen Sie oben aus, was passiert ist.', 'Please pick what happened above.'));
  say('');
  const done = busy($('sendBtn'), T('Wird gesendet…', 'Sending…'));
  try {
    const d = await postJson('/api/messages', {
      template: selectedTemplate,
      note: $('note').value,
      callbackPhone: $('callback').value.trim() || undefined,
      turnstileToken,
    });
    try { localStorage.setItem(`ot_inbox_${TAG}`, d.inboxToken); } catch { /* private mode */ }
    show('done');
    pollInbox(d.inboxToken);
  } catch (e) { say(errText(e.message)); resetCaptcha(); }
  done();
};

/* Masked call: inline number field (no browser prompt — blocked in many in-app browsers) */
$('callBtn').onclick = () => {
  const open = $('callPanel').classList.toggle('hidden') === false;
  $('callBtn').setAttribute('aria-expanded', String(open));
  if (open) $('callPhone').focus();
};
$('callGo').onclick = async () => {
  const phone = $('callPhone').value.trim();
  if (phone.replace(/\D/g, '').length < 7) return say(errText('bad_phone'));
  say('');
  const done = busy($('callGo'), T('Verbinde…', 'Connecting…'));   // disabled → no double call
  try {
    await postJson('/api/call', { phone, turnstileToken });
    say('', T('Ihr Telefon klingelt gleich — nehmen Sie ab, wir verbinden Sie mit dem Halter.', 'Your phone will ring in a moment — pick up and we connect you to the owner.'));
    $('callPanel').classList.add('hidden'); $('callBtn').setAttribute('aria-expanded', 'false');
  } catch (e) { say(errText(e.message)); }
  resetCaptcha();
  done();
};

const escText = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
async function pollInbox(token) {
  const render = (msgs) => {
    $('inbox').innerHTML = msgs.map(m =>
      `<div class="msg ${m.direction === 'to_owner' ? 'mine' : ''}">${m.direction === 'to_owner' ? '→ ' : '← '}${escText(m.body)}</div>`
    ).join('');
  };
  let timer = null;
  const tick = async () => {
    if (document.hidden) return;                      // don't poll a background tab
    const r = await fetch(`/api/inbox?token=${encodeURIComponent(token)}`).catch(() => null);
    if (!r) return;                                   // offline blip — try again next tick
    if (r.status === 401) return clearInterval(timer); // token expired (24 h) — stop for good
    if (r.ok) render((await r.json()).messages);
  };
  await tick();
  timer = setInterval(tick, 15000);   // ponytail: polling; SSE/websocket when reply volume justifies it
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

/* Turnstile: auto-enabled when the server provides a site key.
   Without keys configured, the server skips verification (rate limits still apply). */
function mountTurnstile(siteKey) {
  if (!siteKey) return;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=otTsReady';
  window.otTsReady = () => window.turnstile.render('#ts-widget', {
    sitekey: siteKey, theme: 'light', appearance: 'interaction-only', callback: (t) => { turnstileToken = t; },
  });
  document.head.appendChild(s);
}

init();
