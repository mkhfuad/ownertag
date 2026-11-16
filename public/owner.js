const $=id=>document.getElementById(id);
let TOKEN=localStorage.getItem('ot_owner')||'';let ME=null,SESS=[];
const CAT={blocked:['🅿️','Zugeparkt / blockiert','blue'],lights:['💡','Licht an','amber'],alarm:['🔔','Alarm','amber'],window:['🪟','Fenster offen','blue'],damage:['💥','Schaden gemeldet','red'],towing:['🚙','Wird abgeschleppt','red'],emergency:['🚨','Notfall','red'],'':['💬','Nachricht','blue']};
const esc=s=>String(s??'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
function ago(d){const s=(Date.now()-new Date(d))/1000;if(s<90)return 'gerade eben';if(s<3600)return Math.round(s/60)+' Min';if(s<86400)return Math.round(s/3600)+' Std';return Math.round(s/86400)+' Tg';}
async function api(p,o={}){const r=await fetch(p,{...o,headers:{...(o.headers||{}),Authorization:`Bearer ${TOKEN}`}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||r.status);return d;}
function logout(){localStorage.removeItem('ot_owner');location.reload();}
// Server error codes → sentences. Never show a raw code to a customer.
const ERR={bad_phone:'Bitte eine gültige Nummer eingeben, z. B. +49 151 …',country_unsupported:'Nur Nummern aus Deutschland, Österreich und der Schweiz werden unterstützt.',bad_code:'Falscher oder abgelaufener Code.',too_many_attempts:'Zu viele Fehlversuche — bitte neuen Code anfordern.',rate_limited:'Zu viele Anfragen — bitte kurz warten und erneut versuchen.',message_blocked:'Diese Nachricht kann nicht gesendet werden (keine Links, Nummern oder Beleidigungen).',session_gone:'Dieser Vorfall ist abgelaufen oder gesperrt — Antworten ist nicht mehr möglich.',not_found:'Nicht gefunden — bitte Seite neu laden.',unauthorized:'Sitzung abgelaufen — bitte neu anmelden.',billing_cancel_failed:'Ihr Abo konnte nicht gekündigt werden — bitte später erneut versuchen. Das Konto wurde nicht gelöscht.',billing_not_configured:'Abos sind derzeit nicht verfügbar.'};
const msg=e=>ERR[e&&e.message]||'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
let toastT;function toast(t){const el=$('toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),4000);}

$('sendCode').onclick=async()=>{const b=$('sendCode');b.disabled=true;try{const r=await fetch('/api/owner/login/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:$('phone').value.trim()})});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error);$('step1').classList.add('hidden');$('step2').classList.remove('hidden');$('loginErr').textContent='';$('code').focus();}catch(e){$('loginErr').textContent=msg(e);}b.disabled=false;};
$('verify').onclick=async()=>{try{const r=await fetch('/api/owner/login/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:$('phone').value.trim(),code:$('code').value.trim()})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error);TOKEN=d.ownerToken;localStorage.setItem('ot_owner',TOKEN);boot();}catch(e){$('loginErr').textContent=msg(e);}};

function tab(btn){document.querySelectorAll('.side button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');const t=btn.dataset.tab;document.querySelectorAll('.tabpane').forEach(p=>p.classList.toggle('hidden',p.id!==t));}
function addTag(){alert('Neuen OwnerTag aktivieren:\n\n1. Kleben Sie den neuen Aufkleber an.\n2. Scannen Sie den QR-Code mit der Handy-Kamera.\n3. Bestätigen Sie Ihre Nummer per SMS-Code.\n\nDer Tag erscheint danach automatisch hier.');}

async function boot(){if(!TOKEN)return;try{ME=await api('/api/owner/me');}catch(e){if(e.message==='unauthorized')return logout();$('loginErr').textContent='Keine Verbindung — bitte Seite neu laden.';return;}
  $('login').classList.add('hidden');$('app').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');
  const h=new Date().getHours();$('hello').textContent=(h<12?'Guten Morgen':h<18?'Guten Tag':'Guten Abend')+'!';
  try{SESS=(await api('/api/owner/sessions')).sessions||[];}catch{SESS=[];}render();}
function isOpen(s){return s.status!=='resolved'&&s.state!=='blocked';}
function lastMsg(s){const m=(s.messages||[]).filter(x=>x.direction==='to_owner').pop();return m?m.body.split('\n')[0]:'—';}

function render(){
  const tags=ME.tags||[];const active=tags.filter(t=>t.state==='active').length;const now=new Date();
  const scans=SESS.filter(s=>{const d=new Date(s.created_at);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();}).length;
  const open=SESS.filter(isOpen).length;
  $('sTags').textContent=active;$('sScans').textContent=scans;$('sOpen').textContent=open;
  if(open){$('incBadge').textContent=open;$('incBadge').classList.remove('hidden');}else $('incBadge').classList.add('hidden');

  const card=t=>{const muted=t.muted_until&&new Date(t.muted_until)>new Date();
    const pill=t.state==='paused'?'<span class="pill paused">Pausiert</span>':muted?'<span class="pill muted">Stumm</span>':t.state==='active'?'<span class="pill active">Aktiv</span>':'<span class="pill inactive">Inaktiv</span>';
    const icon=t.type==='bike'?'🏍':'🚗';const last=SESS.find(s=>s.tag_id===t.tag_id);
    return `<div class="tag"><div class="t"><span class="name">${icon} •••${t.tag_id.slice(-4)}</span>${pill}</div>
      <div class="meta">${t.tag_id} · ${last?'Letzter Scan '+ago(last.created_at):'Noch nicht gescannt'}</div>
      <div><button class="mini" data-act="mute" data-id="${t.tag_id}">${muted?'Stumm aus':'24h stumm'}</button><button class="mini" data-act="pause" data-id="${t.tag_id}">${t.state==='paused'?'Fortsetzen':'Pausieren'}</button></div></div>`;};
  $('tagsMini').innerHTML=tags.length?tags.map(card).join(''):'<p class="empty">Noch keine aktiven Tags. Aktivieren Sie Ihren ersten Tag über „+ Tag hinzufügen".</p>';
  $('tagsFull').innerHTML=$('tagsMini').innerHTML;

  const evt=s=>{const[ic,lbl,col]=CAT[s.category||'']||CAT[''];return `<div class="event"><div class="ico ${col}">${ic}</div><div class="b"><b>${lbl}</b><div class="msg">${esc(lastMsg(s))}</div><small>•••${s.tag_id.slice(-4)} · vor ${ago(s.created_at)}</small></div></div>`;};
  $('recent').innerHTML=SESS.length?SESS.slice(0,4).map(evt).join(''):'<p class="empty">Noch keine Aktivität. 🎉</p>';

  const inc=s=>{const[ic,lbl,col]=CAT[s.category||'']||CAT[''];const stt=s.state==='blocked'?'<span class="st blocked">Blockiert</span>':s.status==='resolved'?'<span class="st resolved">Erledigt</span>':'<span class="st open">Offen</span>';
    return `<div class="event"><div class="ico ${col}">${ic}</div><div class="b"><div class="row"><b>${lbl} · •••${s.tag_id.slice(-4)}</b>${stt}</div><div class="msg">${esc(lastMsg(s))}</div><small>vor ${ago(s.created_at)}</small>
      <div style="margin-top:9px"><button class="mini" data-act="reply" data-sid="${s.session_id}">Antworten</button><button class="mini" data-act="resolve" data-sid="${s.session_id}">${s.status==='resolved'?'Wieder öffnen':'Erledigt'}</button><button class="mini warn" data-act="report" data-sid="${s.session_id}">Melden</button></div></div></div>`;};
  $('incList').innerHTML=SESS.length?SESS.map(inc).join(''):'<p class="empty">Noch keine Vorfälle. 🎉</p>';

  const emg=ME.emergencyMasked?('Sie + Notfallkontakt ('+ME.emergencyMasked+')'):'Sie · <span style="color:#b5701a">Notfallkontakt nicht gesetzt</span>';
  $('routing').innerHTML=
    `<div class="route"><div class="ico blue">👤</div><div class="b"><b>Normale Nachricht</b><small>→ Sie (${ME.phoneMasked})</small></div></div>`+
    `<div class="route"><div class="ico red">🚨</div><div class="b"><b>Notfall</b><small>→ ${emg}</small></div></div>`+
    `<div class="route"><div class="ico green">📞</div><div class="b"><b>Anruf</b><small>→ maskiert über OwnerTag-Relay</small></div></div>`;

  $('ownerPhone').textContent='Nummer: '+(ME.phoneMasked||'—');
  $('emailState').textContent=ME.hasEmail?'Aktiv':'Keine E-Mail hinterlegt';
  $('emgState').textContent=ME.emergencyMasked?('Gesetzt: '+ME.emergencyMasked):'Nicht gesetzt';
  const chs=(ME.prefs&&ME.prefs.channels)||[];document.querySelectorAll('#channels .chk').forEach(c=>setChk(c,chs.includes(c.dataset.ch)));
  setChk($('callsChk'),ME.prefs?.calls!==false);
}
function setChk(c,on){c.classList.toggle('on',on);c.setAttribute('aria-pressed',String(on));}
document.querySelectorAll('.chk').forEach(c=>c.onclick=()=>setChk(c,!c.classList.contains('on')));
async function muteTag(id){try{const d=await api(`/api/owner/tags/${id}/mute`,{method:'POST'});ME=await api('/api/owner/me');render();toast(d.muted?'Tag ist 24 Stunden stumm.':'Stummschaltung aufgehoben.');}catch(e){toast(msg(e));}}
async function pauseTag(id){try{const d=await api(`/api/owner/tags/${id}/pause`,{method:'POST'});ME=await api('/api/owner/me');render();toast(d.state==='paused'?'Tag pausiert — niemand kann Sie darüber erreichen.':'Tag ist wieder aktiv.');}catch(e){toast(msg(e));}}
async function resolve(sid){try{await api(`/api/owner/sessions/${sid}/resolve`,{method:'POST'});SESS=(await api('/api/owner/sessions')).sessions;render();}catch(e){toast(msg(e));}}
async function reply(sid){const t=prompt('Antwort an den Finder (anonym):');if(!t)return;try{await api('/api/owner/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid,text:t})});toast('Antwort gesendet ✓');}catch(e){toast(msg(e));}}
async function report(sid){if(!confirm('Diesen Vorfall als Missbrauch melden und sperren?'))return;try{await api('/api/owner/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sid})});SESS=(await api('/api/owner/sessions')).sessions;render();}catch(e){toast(msg(e));}}
async function saveEmergency(){const p=$('emgPhone').value.trim();if(!p)return;try{const d=await api('/api/owner/emergency',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:p})});ME.emergencyMasked=d.masked;$('emgPhone').value='';render();}catch(e){toast(msg(e));}}
async function clearEmergency(){try{await api('/api/owner/emergency',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:''})});ME.emergencyMasked=null;render();}catch(e){toast(msg(e));}}
async function savePrefs(){const channels=[...document.querySelectorAll('#channels .chk.on')].map(c=>c.dataset.ch);const calls=$('callsChk').classList.contains('on');try{await api('/api/owner/prefs',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({channels,calls,locale:ME.locale})});$('prefsNote').textContent=' Gespeichert ✓';setTimeout(()=>$('prefsNote').textContent='',2000);}catch(e){$('prefsNote').textContent=' '+msg(e);}}
async function exportData(){try{const d=await api('/api/owner/export');const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='ownertag-daten.json';a.click();}catch(e){toast(msg(e));}}
async function delAccount(){if(!confirm('Konto und alle Daten endgültig löschen? Dies kann nicht rückgängig gemacht werden.'))return;try{await api('/api/owner/account',{method:'DELETE'});alert('Konto gelöscht.');logout();}catch(e){toast(msg(e));}}

// One delegated click handler replaces every inline onclick (CSP: no 'unsafe-inline').
document.addEventListener('click',(e)=>{
  const el=e.target.closest('[data-act]');if(!el)return;
  switch(el.dataset.act){
    case 'logout':return logout();
    case 'reload':return location.reload();
    case 'tab':return tab(el);
    case 'addTag':return addTag();
    case 'mute':return muteTag(el.dataset.id);
    case 'pause':return pauseTag(el.dataset.id);
    case 'reply':return reply(el.dataset.sid);
    case 'resolve':return resolve(el.dataset.sid);
    case 'report':return report(el.dataset.sid);
    case 'saveEmergency':return saveEmergency();
    case 'clearEmergency':return clearEmergency();
    case 'savePrefs':return savePrefs();
    case 'exportData':return exportData();
    case 'delAccount':return delAccount();
  }
});
boot();
