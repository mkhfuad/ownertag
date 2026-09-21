const $ = id => document.getElementById(id);
let KEY = sessionStorage.getItem('ot_admin') || '';
const esc = s => String(s ?? '').replace(/</g, '&lt;');

async function api(path, opts = {}) {
  // Key travels in the Authorization header — never the URL/query (stays out of logs/history).
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${KEY}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
}

$('loginBtn').onclick = () => { KEY = $('key').value.trim(); load(); };
function logout() { sessionStorage.removeItem('ot_admin'); location.reload(); }

async function load() {
  try {
    const d = await api('/api/admin/orders');
    sessionStorage.setItem('ot_admin', KEY);
    $('login').classList.add('hidden'); $('dash').classList.remove('hidden');
    $('status').textContent = '';
    const open = d.orders.filter(o => o.status === 'new' || o.status === 'paid').length;
    $('stat').textContent = `${d.orders.length} orders · ${open} open`;
    $('orders').innerHTML = d.orders.length ? d.orders.map(o => `
      <div class="order ${o.status}">
        <div class="ohead">
          <b>#${o.id} — ${esc(o.name)}</b>
          <span class="badge ${o.status}">${o.status}</span>
          ${o.qr_sent_at ? `<span class="badge paid" title="QR-E-Mail gesendet">✉ QR ${new Date(o.qr_sent_at).toLocaleDateString('de-DE')}</span>` : ''}
        </div>
        <div class="odata">
          <b>${o.qty}× OwnerTag</b> · ${o.amount_eur} € · ${esc(o.payment)}<br>
          ${esc(o.email)}${o.phone ? ' · ' + esc(o.phone) : ''}<br>
          ${esc(o.address).replace(/\n/g, '<br>')}<br>
          <span style="color:var(--t3)">${new Date(o.created_at).toLocaleString()}</span>
        </div>
        <div class="row">
          <button class="tpl" data-act="openPrint" data-id="${o.id}">🖨 QR labels</button>
          <button class="tpl" data-act="resendOrder" data-id="${o.id}" data-email="${esc(o.email)}">✉ Resend email</button>
          ${o.status !== 'shipped' && o.status !== 'cancelled' ? `<button class="tpl" data-act="approveOrder" data-id="${o.id}">✅ Approve &amp; send QR</button>` : ''}
          ${o.status === 'new' && o.payment === 'vorkasse' ? `<button class="tpl" data-act="setStatus" data-id="${o.id}" data-status="paid">✓ Mark paid</button>` : ''}
          ${o.status !== 'shipped' && o.status !== 'cancelled' ? `<button class="tpl" data-act="setStatus" data-id="${o.id}" data-status="shipped">📦 Mark shipped</button>` : ''}
          ${o.status !== 'cancelled' && o.status !== 'shipped' ? `<button class="tpl" data-act="setStatus" data-id="${o.id}" data-status="cancelled" style="color:#e07a7a">✕ Cancel</button>` : ''}
          ${o.status === 'cancelled' ? `<button class="tpl" data-act="setStatus" data-id="${o.id}" data-status="new">↩ Reactivate</button>` : ''}
          <button class="tpl" data-act="delOrder" data-id="${o.id}" style="color:#e07a7a">🗑 Delete</button>
        </div>
      </div>`).join('') : '<p class="sub">No orders yet.</p>';
  } catch (e) {
    $('status').textContent = e.message === 'unauthorized' ? 'Wrong admin key.' : 'Error: ' + e.message;
  }
}

function openPrint(id) { window.open(`/api/admin/orders/${id}/print?lang=${langVal()}&key=${encodeURIComponent(KEY)}`, '_blank'); }
async function setStatus(id, status) {
  try {
    await api(`/api/admin/orders/${id}`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    load();
  } catch (e) { $('status').textContent = 'Error: ' + e.message; }
}
async function approveOrder(id) {
  if (!confirm(`Approve order #${id}? This mints the tag(s), emails the customer their QR code, and marks it paid.`)) return;
  try {
    const d = await api(`/api/admin/orders/${id}/approve`, { method: 'POST' });
    $('status').textContent = d.ok ? `✓ Approved — QR emailed to ${d.to} (${d.tags.length} tag(s)).` : 'Approved, but email not sent — check SMTP.';
    load();
  } catch (e) { $('status').textContent = 'Error: ' + (e.message || 'failed'); }
}
async function resendOrder(id, email) {
  const to = prompt(`Resend the confirmation email for order #${id} to:`, email || '');
  if (!to) return;
  try {
    const d = await api(`/api/admin/orders/${id}/resend?to=${encodeURIComponent(to.trim())}`, { method: 'POST' });
    $('status').textContent = d.ok ? `✓ Confirmation resent to ${d.to}.` : 'Email not sent — check SMTP settings.';
  } catch (e) {
    $('status').textContent = e.message === 'bad_to' ? 'Invalid email address.' : 'Error: ' + (e.message || 'failed');
  }
}
async function delOrder(id) {
  if (!confirm(`Permanently delete order #${id}? This cannot be undone.`)) return;
  try { await api(`/api/admin/orders/${id}`, { method: 'DELETE' }); load(); }
  catch (e) { $('status').textContent = 'Error: ' + e.message; }
}
const langVal = () => ($('lang') && $('lang').value) || 'en';
// Mint N fresh tags and open a print-ready page of their QR codes (in the chosen language).
function mintPrint(n) { window.open(`/api/admin/tags/print?mint=${n}&lang=${langVal()}&key=${encodeURIComponent(KEY)}`, '_blank'); }
// Preview/print the QR of one or more existing tag codes (comma-separated).
function previewCode() {
  const codes = ($('tagcode').value || '').trim();
  if (!codes) { $('status').textContent = 'Enter a tag code first.'; return; }
  window.open(`/api/admin/tags/print?ids=${encodeURIComponent(codes)}&lang=${langVal()}&key=${encodeURIComponent(KEY)}`, '_blank');
}
// Admin: correct an owner's phone number for a given tag.
async function setOwnerPhone() {
  const tag = ($('ownTag').value || '').trim(), phone = ($('ownPhone').value || '').trim();
  if (!tag || !phone) { $('status').textContent = 'Enter both a tag code and a number.'; return; }
  try {
    const d = await api('/api/admin/owner/phone', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, phone }) });
    $('status').textContent = `✓ Owner number for ${tag} updated to ${d.phone}.`;
    $('ownTag').value = ''; $('ownPhone').value = '';
  } catch (e) {
    $('status').textContent = e.message === 'owner_not_found' ? 'No active owner for that tag code.'
      : e.message === 'phone_in_use' ? 'That number is already used by another owner.'
      : e.message === 'bad_phone' ? 'Invalid phone number.'
      : 'Error: ' + (e.message || 'failed');
  }
}
// Mint N fresh tags and download them as a ZIP (SVG+PNG) or print-ready PDF.
function exportBatch(fmt, shape) {
  const n = Math.max(1, Math.min(500, Number($('expN').value) || 20));
  const s = shape ? `&shape=${shape}` : '';
  window.open(`/api/admin/tags/export.${fmt}?mint=${n}&lang=${langVal()}${s}&key=${encodeURIComponent(KEY)}`, '_blank');
}
async function resetLimits() {
  const d = await api('/api/admin/reset-limits', { method: 'POST' });
  $('status').textContent = `Rate limits cleared (${d.cleared} counters).`;
}
async function fixPhones() {
  try {
    const d = await api('/api/admin/fix-phones', { method: 'POST' });
    $('status').textContent = `✓ Fixed ${d.fixed} of ${d.total} owner numbers.`;
  } catch (e) { $('status').textContent = 'Error: ' + (e.message || 'failed'); }
}

// One delegated click handler replaces every inline onclick (CSP: no 'unsafe-inline').
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'load': return load();
    case 'logout': return logout();
    case 'mintPrint': return mintPrint(Number(el.dataset.n));
    case 'resetLimits': return resetLimits();
    case 'fixPhones': return fixPhones();
    case 'previewCode': return previewCode();
    case 'setOwnerPhone': return setOwnerPhone();
    case 'exportBatch': return exportBatch(el.dataset.fmt, el.dataset.shape);
    case 'openPrint': return openPrint(id);
    case 'resendOrder': return resendOrder(id, el.dataset.email);
    case 'approveOrder': return approveOrder(id);
    case 'setStatus': return setStatus(id, el.dataset.status);
    case 'delOrder': return delOrder(id);
  }
});

if (KEY) load();
