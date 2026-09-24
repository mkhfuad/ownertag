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
    rate_limited: 'Zu viele Bestellversuche — bitte später erneut.', default: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
  };
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
