const $ = id => document.getElementById(id);

/* Order form — only on /bestellen */
if ($('orderBtn')) {
  let PRICE = 24.90;   // replaced by the server's price below — the server is the source of truth
  let qty = 1, pay = 'rechnung', turnstileToken = '';
  const eur = n => n.toFixed(2).replace('.', ',') + ' €';
  const renderSum = () => {
    $('qty').textContent = qty;
    $('sumLine').textContent = `${qty} × OwnerTag`;
    $('sumAmount').textContent = eur(qty * PRICE);
    $('total').textContent = eur(qty * PRICE);
  };
  $('minus').onclick = () => { qty = Math.max(1, qty - 1); renderSum(); };
  $('plus').onclick = () => { qty = Math.min(20, qty + 1); renderSum(); };
  document.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-pay]').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); pay = b.dataset.pay;
  });
  const ERR = {
    bad_name: 'Bitte Namen angeben.', bad_email: 'Bitte gültige E-Mail angeben.',
    bad_address: 'Bitte vollständige Lieferadresse angeben.', bad_qty: 'Ungültige Menge.',
    rate_limited: 'Zu viele Bestellversuche — bitte später erneut.',
    captcha_failed: 'Sicherheitsprüfung fehlgeschlagen — bitte erneut versuchen.',
    card_unavailable: 'Kartenzahlung ist gerade nicht verfügbar — bitte Rechnung oder Vorkasse wählen.',
    default: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
  };

  /* Card option appears only when the server has Stripe configured */
  fetch('/api/pay/config').then(r => r.json()).then(c => {
    if (c.card) $('payCard').classList.remove('hidden');
    if (c.priceCents) { PRICE = c.priceCents / 100; renderSum(); }
    if (c.turnstileSiteKey) {          // captcha only when the server has it configured
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=otTsReady';
      window.otTsReady = () => window.turnstile.render('#ts-widget', { sitekey: c.turnstileSiteKey, theme: 'light', callback: t => { turnstileToken = t; } });
      document.head.appendChild(s);
    }
  }).catch(() => {});

  /* Back from Stripe Checkout */
  const qs = new URLSearchParams(location.search);
  if (qs.get('bezahlt')) {
    $('orderId').textContent = '#' + qs.get('bezahlt');
    $('form').classList.add('hidden'); $('success').classList.remove('hidden');
    $('payNote').textContent = 'Zahlung erfolgreich — die Bestätigung kommt per E-Mail.';
  } else if (qs.get('abgebrochen')) {
    $('payNote').textContent = 'Zahlung abgebrochen — es wurde nichts abgebucht. Sie können es erneut versuchen oder eine andere Zahlungsart wählen.';
  }
  $('orderBtn').onclick = async () => {
    $('orderErr').textContent = ''; $('orderBtn').disabled = true;
    try {
      const r = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('name').value, email: $('email').value,
          address: $('address').value, qty, payment: pay, turnstileToken,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error);
      if (d.checkoutUrl) { location.href = d.checkoutUrl; return; }   // Stripe hosted page
      $('orderId').textContent = '#' + d.orderId;
      if (pay === 'vorkasse') {
        $('bankAmount').textContent = (d.amount / 100).toFixed(2).replace('.', ',') + ' €';
        $('bankRef').textContent = 'OwnerTag #' + d.orderId;
        $('bankinfo').classList.remove('hidden');
      }
      $('form').classList.add('hidden'); $('success').classList.remove('hidden');
    } catch (e) {
      $('orderErr').textContent = ERR[e.message] || ERR.default;
      turnstileToken = ''; try { window.turnstile?.reset(); } catch { /* not mounted */ }   // tokens are single-use
    }
    $('orderBtn').disabled = false;
  };
}

/* Price shown on the page always comes from the server (one source of truth). */
const priceEls = document.querySelectorAll('[data-price]');
if (priceEls.length && !$('orderBtn'))
  fetch('/api/pay/config').then(r => r.json()).then(c => {
    if (c.priceCents) priceEls.forEach(el => { el.textContent = (c.priceCents / 100).toFixed(2).replace('.', ',') + '\u00a0€'; });
  }).catch(() => {});

/* Home demo: the visitor plays the stranger; the owner's phone gets the message.
   Purely local — nothing is sent anywhere. */
if ($('demoSend')) {
  let picked = null;
  const opts = document.querySelectorAll('#demoFinder .opt');
  opts.forEach(b => b.onclick = () => {
    opts.forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true'); picked = b; $('demoSend').disabled = false;
  });
  $('demoSend').onclick = () => {
    if (!picked) return;
    $('demoForm').classList.add('hidden'); $('demoSent').classList.remove('hidden');
    $('demoIdle').classList.add('hidden');
    const n = $('demoNotif');
    n.textContent = '';
    const b = document.createElement('b'); b.textContent = 'OwnerTag · jetzt';
    n.append(b, picked.dataset.msg);
    n.classList.add('on');
    // Stacked on a phone, the owner's screen is below the fold — bring it into view.
    if (window.matchMedia('(max-width:640px)').matches)
      n.closest('.phone').scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
  };
  $('demoAgain').onclick = () => {
    opts.forEach(x => x.setAttribute('aria-pressed', 'false')); picked = null; $('demoSend').disabled = true;
    $('demoSent').classList.add('hidden'); $('demoForm').classList.remove('hidden');
    $('demoNotif').classList.remove('on'); $('demoIdle').classList.remove('hidden');
  };
}
