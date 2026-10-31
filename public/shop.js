const $ = id => document.getElementById(id);

/* Order form — only on /bestellen */
if ($('orderBtn')) {
  const PRICE = 24.90;
  let qty = 1, pay = 'rechnung';
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
    document.querySelectorAll('[data-pay]').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel'); pay = b.dataset.pay;
  });
  const ERR = {
    bad_name: 'Bitte Namen angeben.', bad_email: 'Bitte gültige E-Mail angeben.',
    bad_address: 'Bitte vollständige Lieferadresse angeben.', bad_qty: 'Ungültige Menge.',
    rate_limited: 'Zu viele Bestellversuche — bitte später erneut.',
    card_unavailable: 'Kartenzahlung ist gerade nicht verfügbar — bitte Rechnung oder Vorkasse wählen.',
    default: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
  };

  /* Card option appears only when the server has Stripe configured */
  fetch('/api/pay/config').then(r => r.json()).then(c => { if (c.card) $('payCard').classList.remove('hidden'); }).catch(() => {});

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
          name: $('name').value, email: $('email').value, phone: $('phone').value || undefined,
          address: $('address').value, qty, payment: pay,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.checkoutUrl) { location.href = d.checkoutUrl; return; }   // Stripe hosted page
      $('orderId').textContent = '#' + d.orderId;
      if (pay === 'vorkasse') {
        $('bankAmount').textContent = (d.amount / 100).toFixed(2).replace('.', ',') + ' €';
        $('bankRef').textContent = 'OwnerTag #' + d.orderId;
        $('bankinfo').classList.remove('hidden');
      }
      $('form').classList.add('hidden'); $('success').classList.remove('hidden');
    } catch (e) { $('orderErr').textContent = ERR[e.message] || ERR.default; }
    $('orderBtn').disabled = false;
  };
}

/* Scroll reveal — all pages */
document.documentElement.classList.add('js');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach((e, i) => {
    if (e.isIntersecting) { e.target.style.animationDelay = (i % 3) * 70 + 'ms'; e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: .12 });
  document.querySelectorAll('.rv').forEach(el => io.observe(el));
} else document.querySelectorAll('.rv').forEach(el => el.style.opacity = 1);
