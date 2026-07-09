/* Observer scan page — no framework, <5 KB. */
const TAG = location.pathname.split('/').pop();
const LANG = (navigator.language || 'de').startsWith('de') ? 'de' : 'en';
const $ = (id) => document.getElementById(id);
let selectedTemplate = null;
let turnstileToken = '';

/* Localize static strings */
document.querySelectorAll('[data-de]').forEach(el => { el.textContent = el.dataset[LANG] || el.dataset.de; });

function show(id) {
  ['loading', 'inactive', 'composer', 'done', 'error'].forEach(s => $(s).classList.toggle('hidden', s !== id));
}

function fail(msg) {
  $('errorText').textContent = msg;
  show('error');
}

const ERR = {
  rate_limited: { de: 'Zu viele Anfragen — bitte später erneut versuchen.', en: 'Too many requests — try again later.' },
  captcha_failed: { de: 'Sicherheitsprüfung fehlgeschlagen — Seite neu laden.', en: 'Security check failed — reload the page.' },
  delivery_failed: { de: 'Zustellung fehlgeschlagen — bitte später erneut.', en: 'Delivery failed — please try again later.' },
  message_blocked: { de: 'Nachricht konnte nicht gesendet werden.', en: 'Message could not be sent.' },
  tag_muted: { de: 'Der Halter pausiert Benachrichtigungen gerade.', en: 'The owner has paused notifications.' },
  session_expired: { de: 'Sitzung abgelaufen — bitte QR-Code erneut scannen.', en: 'Session expired — please rescan the QR code.' },
  default: { de: 'Etwas ist schiefgelaufen.', en: 'Something went wrong.' },
};
const errText = (code) => (ERR[code] || ERR.default)[LANG];

async function init() {
  try {
    const r = await fetch(`/api/tags/${TAG}`);
    if (!r.ok) throw new Error((await r.json()).error);
    const d = await r.json();

    if (d.state === 'unactivated') {
      $('inactiveTitle').textContent = LANG === 'de' ? 'Tag noch nicht aktiviert' : 'Tag not activated yet';
      $('inactiveText').textContent = LANG === 'de'
        ? 'Wenn dieser Tag Ihnen gehört, aktivieren Sie ihn jetzt.'
        : 'If this tag belongs to you, activate it now.';
      $('activateBtn').classList.remove('hidden');
      window.TAG = TAG;
      return show('inactive');
    }
    if (d.state !== 'active' || d.muted) {
      $('inactiveTitle').textContent = LANG === 'de' ? 'Vorübergehend nicht erreichbar' : 'Temporarily unreachable';
      $('inactiveText').textContent = LANG === 'de'
        ? 'Der Halter ist über diesen Tag gerade nicht erreichbar.'
        : 'The owner is not reachable via this tag right now.';
      return show('inactive');
    }

    $('tagChip').textContent = `${d.vehicleType === 'bike' ? '🏍' : '🚗'} Tag •••${d.suffix}`;
    for (const [key, t] of Object.entries(d.templates)) {
      const b = document.createElement('button');
      b.className = 'tpl'; b.textContent = t[LANG]; b.dataset.key = key;
      b.onclick = () => {
        document.querySelectorAll('.tpl').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel'); selectedTemplate = key;
      };
      $('templates').appendChild(b);
    }
    mountTurnstile(d.turnstileSiteKey);
    show('composer');
  } catch (e) { fail(errText(e.message)); }
}

$('sendBtn').onclick = async () => {
  if (!selectedTemplate) return alert(LANG === 'de' ? 'Bitte wählen Sie eine Nachricht.' : 'Please pick a message.');
  const btn = $('sendBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = LANG === 'de' ? 'Wird gesendet…' : 'Sending…';
  try {
    const r = await fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: selectedTemplate,
        note: $('note').value,
        callbackPhone: $('callback').value.trim() || undefined,
        turnstileToken,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    localStorage.setItem(`ot_inbox_${TAG}`, d.inboxToken);
    show('done');
    pollInbox(d.inboxToken);
  } catch (e) { fail(errText(e.message)); }
  btn.disabled = false;
  btn.textContent = label;
};

$('callBtn').onclick = async () => {
  const phone = prompt(LANG === 'de'
    ? 'Ihre Nummer für den maskierten Rückruf (wird dem Halter NIE angezeigt):'
    : 'Your number for the masked call (NEVER shown to the owner):', '+49');
  if (!phone) return;
  try {
    const r = await fetch('/api/call', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim(), turnstileToken }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    alert(LANG === 'de' ? 'Sie werden gleich angerufen und verbunden.' : 'You will receive a call shortly and be connected.');
  } catch (e) { fail(errText(e.message)); }
};

async function pollInbox(token) {
  const render = (msgs) => {
    $('inbox').innerHTML = msgs.map(m =>
      `<div class="msg ${m.direction === 'to_owner' ? 'mine' : ''}">${m.direction === 'to_owner' ? '→ ' : '← '}${m.body.replace(/</g, '&lt;')}</div>`
    ).join('');
  };
  const tick = async () => {
    const r = await fetch(`/api/inbox?token=${encodeURIComponent(token)}`);
    if (r.ok) render((await r.json()).messages);
  };
  await tick();
  setInterval(tick, 15000);   // ponytail: polling; SSE/websocket when reply volume justifies it
}

/* Turnstile: auto-enabled when the server provides a site key.
   Without keys configured, the server skips verification (rate limits still apply). */
window.onTurnstile = (t) => { turnstileToken = t; };
function mountTurnstile(siteKey) {
  if (!siteKey) return;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=otTsReady';
  window.otTsReady = () => window.turnstile.render('#ts-widget', {
    sitekey: siteKey, theme: 'dark', callback: window.onTurnstile,
  });
  document.head.appendChild(s);
}

init();
