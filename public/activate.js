const TAG = new URLSearchParams(location.search).get('tag');
const $ = id => document.getElementById(id);
let vtype = 'car';
document.querySelectorAll('[data-type]').forEach(b => b.onclick = (e) => {
  e.preventDefault();
  document.querySelectorAll('[data-type]').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel'); vtype = b.dataset.type;
});
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
};
$('otpBtn').onclick = async () => {
  try {
    await post('/api/activate/start', { tagId: TAG, phone: $('phone').value.trim() });
    $('step1').classList.add('hidden'); $('step2').classList.remove('hidden');
    $('status').textContent = 'Code gesendet / Code sent';
  } catch (e) { $('status').textContent = 'Fehler: ' + e.message; }
};
$('verifyBtn').onclick = async () => {
  try {
    const d = await post('/api/activate/verify', {
      tagId: TAG, phone: $('phone').value.trim(), code: $('code').value.trim(),
      plate: $('plate').value.trim() || undefined, email: $('email').value.trim() || undefined,
      vehicleType: vtype,
      locale: (navigator.language || 'de').startsWith('de') ? 'de' : 'en',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    localStorage.setItem('ot_owner', d.ownerToken);
    $('step2').classList.add('hidden'); $('done').classList.remove('hidden');
    $('status').textContent = '';
  } catch (e) { $('status').textContent = 'Fehler: ' + e.message; }
};
