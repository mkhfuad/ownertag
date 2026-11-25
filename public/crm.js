{
const STATUS=["Not contacted","Contacted","In talks","Pilot","Customer","Not a fit"];
const SC={"Not contacted":"#9CA3AF","Contacted":"#60A5FA","In talks":"#FBBF24","Pilot":"#FB923C","Customer":"#34D399","Not a fit":"#F87171"};
const PC={A:"#BBF7D0",B:"#FEF08A",C:"#E5E7EB"};
let all=[],canWrite=true,page=0;
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const url=u=>/^https:\/\//.test(u||"")?u:"";

/* storage: the OwnerTag server (admin key, Postgres) */
let KEY="",RO=false;try{KEY=sessionStorage.getItem("ot_admin")||""}catch(e){}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...(opts.headers||{}),"Content-Type":"application/json",Authorization:"Bearer "+KEY}});
  const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||r.status);e.status=r.status;throw e}return d}
async function save(c){if(RO){toast("Read-only access: changes are not saved");return}c.updated=new Date().toISOString();
  try{await api("/api/admin/crm/"+encodeURIComponent(c.id),{method:"PUT",body:JSON.stringify(c)});toast("Saved · "+all.length+" companies")}
  catch(e){toast("Could not save: "+e.message)}render()}
async function start(){
  try{const d=await api("/api/admin/crm");all=d.companies||[];
    try{sessionStorage.setItem("ot_admin",KEY)}catch(e){}
    $("#login").hidden=true;$("#app").hidden=false;
    RO=!!d.readOnly;document.body.classList.toggle("ro",RO);$("#mode").textContent=(RO?"Read-only view · ":d.role=="editor"?"Editor access · ":"Live on ownertag.de · ")+all.length+" companies";fillFilters();render();if(openId)drawer(openId)}
  catch(e){$("#login").hidden=false;$("#app").hidden=true;if(KEY)$("#lerr").textContent=e.status==401?"Wrong access key.":"Server error: "+e.message}}
$("#lf").onsubmit=e=>{e.preventDefault();KEY=$("#key").value.trim();start()};
/* filters */
function opts(el,label,vals){const cur=el.value;el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option>${esc(v)}</option>`).join("");el.value=vals.includes(cur)?cur:""}
function fillFilters(){
  opts($("#fs"),"All segments",[...new Set(all.map(c=>c.segment))].sort());
  opts($("#fc"),"All cities",[...new Set(all.map(c=>c.city))].sort());
  opts($("#fst"),"All statuses",STATUS)}
function filtered(){
  const q=$("#q").value.trim().toLowerCase(),s=$("#fs").value,ci=$("#fc").value,p=$("#fp").value,st=$("#fst").value;
  return all.filter(c=>(!s||c.segment==s)&&(!ci||c.city==ci)&&(!p||c.priority==p)&&(!st||c.status==st)&&
    (!q||[c.name,c.city,c.info,c.contact,c.notes,c.segment].join(" ").toLowerCase().includes(q)))
   .sort((a,b)=>(a.priority||"Z").localeCompare(b.priority||"Z")||a.name.localeCompare(b.name))}

/* header */
function header(){
  const n=s=>all.filter(c=>c.status==s).length;
  const due=all.filter(c=>c.nextDate&&c.nextDate<=today()&&!["Customer","Not a fit"].includes(c.status)).length;
  const k=[["Companies",all.length],["Priority A",all.filter(c=>c.priority=="A").length],["Contacted",n("Contacted")],["In talks + pilot",n("In talks")+n("Pilot")],["Customers",n("Customer")],["Follow-ups due",due]];
  $("#kpis").innerHTML=k.map(([l,v])=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#funnel").innerHTML=STATUS.map(s=>`<div style="width:${all.length?n(s)/all.length*100:0}%;background:${SC[s]}"></div>`).join("");
  $("#legend").innerHTML=STATUS.map(s=>`<span><i style="background:${SC[s]}"></i>${s} ${n(s)}</span>`).join("")}

/* views */
const pill=s=>`<span class="pill" style="background:${SC[s]}33;border:1px solid ${SC[s]}">${esc(s)}</span>`;
const ppill=p=>p?`<span class="pill" style="background:${PC[p]||"#eee"};color:#0E1116">${esc(p)}</span>`:"";
function view(){return (location.hash||"#list").slice(1)}
function render(){
  header();const v=["list","board","followups"].includes(view())?view():"list";
  for(const x of ["list","board","followups"])$("#t-"+x).classList.toggle("on",x==v);
  const rows=filtered(),el=$("#view");
  if(!all.length){el.innerHTML=`<div class="empty"><p>No companies yet. Add one, import a CSV, or load the OwnerTag prospect list.</p></div>`;return}
  if(v=="board"){
    el.innerHTML=`<div class="board">${STATUS.map(s=>{const L=rows.filter(c=>c.status==s);
      return `<section class="col"><h3><span>${s}</span><span>${L.length}</span></h3>${L.slice(0,60).map(card).join("")}${L.length>60?`<p class="note">+${L.length-60} more, narrow with filters</p>`:""}</section>`}).join("")}</div>`;return}
  let L=rows;
  if(v=="followups"){L=rows.filter(c=>c.nextDate&&!["Customer","Not a fit"].includes(c.status)).sort((a,b)=>a.nextDate.localeCompare(b.nextDate));
    if(!L.length){el.innerHTML=`<div class="empty">No follow-ups planned. Open a company and set a next step with a date.</div>`;return}}
  const per=50,max=Math.max(0,Math.ceil(L.length/per)-1);page=Math.min(page,max);
  const P=L.slice(page*per,page*per+per);
  el.innerHTML=`<div class="scroll"><table><thead><tr><th>Company</th><th>Priority</th><th>Status</th><th>City</th><th class="hide-s">Segment</th><th>Next step</th></tr></thead><tbody>${
    P.map(c=>`<tr class="row" data-id="${esc(c.id)}" tabindex="0"><td><b>${esc(c.name)}</b><div class="note">${esc(c.info).slice(0,90)}</div></td><td>${ppill(c.priority)}</td><td>${pill(c.status)}</td><td>${esc(c.city)}</td><td class="hide-s">${esc(c.segment)}</td><td>${c.nextDate?`<span class="${c.nextDate<=today()?"due":""}">${esc(c.nextDate)}</span> `:""}${esc(c.nextStep)}</td></tr>`).join("")
  }</tbody></table></div><div class="pg"><span>${L.length} shown · page ${page+1} of ${max+1}</span><button id="prev" ${page?"":"disabled"}>Previous</button><button id="next" ${page<max?"":"disabled"}>Next</button></div>`;
}
function card(c){return `<div class="cardi" data-id="${esc(c.id)}" tabindex="0"><b>${esc(c.name)}</b><small>${esc(c.city)} · ${esc(c.segment)}</small><div style="margin-top:6px">${ppill(c.priority)} ${c.nextDate?`<small class="${c.nextDate<=today()?"due":""}">${esc(c.nextDate)}</small>`:""}</div></div>`}

/* drawer */
let openId=null;
function drawer(id){openId=id;const c=all.find(x=>x.id==id);if(!c)return;const d=$("#drawer");const ro=canWrite?"":"disabled";
  d.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:start"><h2>${esc(c.name)}</h2><button id="close" aria-label="Close">Close</button></div>
  <p class="meta">${esc(c.segment)} · ${esc(c.city)}</p><p class="meta">${esc(c.info)}</p>
  ${c.why?`<p style="margin:8px 0">${esc(c.why)}</p>`:""}
  ${url(c.source)?`<p class="note"><a href="${esc(url(c.source))}" target="_blank" rel="noopener">Source</a></p>`:""}
  <form id="ef" class="f">
   <label>Status<select name="status" ${ro}>${STATUS.map(s=>`<option ${s==c.status?"selected":""}>${s}</option>`).join("")}</select></label>
   <label>Priority<select name="priority" ${ro}>${["A","B","C"].map(s=>`<option ${s==c.priority?"selected":""}>${s}</option>`).join("")}</select></label>
   <label>Contact person<input name="contact" value="${esc(c.contact)}" ${ro}></label>
   <label>Role<input name="role" value="${esc(c.role)}" ${ro}></label>
   <label>Email<input name="email" type="email" value="${esc(c.email)}" ${ro}></label>
   <label>Phone<input name="phone" value="${esc(c.phone)}" ${ro}></label>
   <label>Next step<input name="nextStep" value="${esc(c.nextStep)}" ${ro}></label>
   <label>Next step date<input name="nextDate" type="date" value="${esc(c.nextDate)}" ${ro}></label>
   <label class="w">Notes<textarea name="notes" ${ro}>${esc(c.notes)}</textarea></label>
   <div class="w" style="display:flex;gap:8px;flex-wrap:wrap"><button class="pri" ${ro}>Save changes</button><span id="saved" class="note" aria-live="polite"></span></div>
  </form>
  <h3 style="font-size:17px;margin-top:8px">Activity</h3>
  <form id="af" class="bar" style="margin:10px 0"><select name="t" ${ro}><option>Call</option><option>Email</option><option>Meeting</option><option>Demo</option><option>Note</option></select><input name="x" placeholder="What happened?" style="flex:1 1 200px" ${ro}><button ${ro}>Log</button></form>
  ${(c.acts||[]).slice().reverse().map(a=>`<div class="act"><b>${esc(a.d)} · ${esc(a.t)}</b><div>${esc(a.x)}</div></div>`).join("")||`<p class="note">No activity yet.</p>`}`;
  d.classList.add("open");
  $("#close").onclick=()=>{d.classList.remove("open");openId=null};
  $("#ef").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);for(const [k,v] of f)c[k]=v;await save(c);const s=$("#saved");if(s)s.textContent="Saved"};
  $("#af").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const x=f.get("x").trim();if(!x)return;
    c.acts=[...(c.acts||[]),{d:today(),t:f.get("t"),x}].slice(-100);if(c.status=="Not contacted")c.status="Contacted";await save(c);drawer(c.id)};
}

/* modal helpers */
function modal(html){$("#mbody").innerHTML=html;$("#modal").classList.add("open")}
function closeModal(){$("#modal").classList.remove("open")}
function toast(t){$("#mode").textContent=t}

/* add */
$("#add").onclick=()=>{if(!canWrite)return toast("View only");
  modal(`<h2>Add company</h2><form id="nf" class="f"><label class="w">Company name<input name="name" required></label>
  <label>Segment<input name="segment" list="segs" required></label><label>City<input name="city" required></label>
  <label>Priority<select name="priority"><option>A</option><option selected>B</option><option>C</option></select></label>
  <label>Phone<input name="phone"></label><label class="w">Address / key fact<input name="info"></label>
  <div class="w" style="display:flex;gap:8px"><button class="pri">Add</button><button type="button" id="cx">Cancel</button></div></form>
  <datalist id="segs">${[...new Set(all.map(c=>c.segment))].map(s=>`<option value="${esc(s)}">`).join("")}</datalist>`);
  $("#cx").onclick=closeModal;
  $("#nf").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));
    const c={id:"n"+Date.now().toString(36),name:f.name,segment:f.segment,priority:f.priority,status:"Not contacted",city:f.city,info:f.info,why:"",role:"",source:"",contact:"",email:"",phone:f.phone,nextStep:"",nextDate:"",notes:"",acts:[],updated:""};
    all.push(c);closeModal();fillFilters();await save(c);drawer(c.id)}};

/* export */
const COLS=["name","segment","priority","status","city","info","contact","role","email","phone","nextStep","nextDate","notes","why","source"];
const csvCell=v=>{v=String(v??"");if(/^[=+\-@]/.test(v))v="'"+v;return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
$("#exp").onclick=()=>{const L=filtered();const csv=[COLS.join(","),...L.map(c=>COLS.map(k=>csvCell(c[k])).join(","))].join("\n");
  try{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv"}));a.download="ownertag-crm.csv";document.body.appendChild(a);a.click();a.remove()}catch(e){}
  modal(`<h2>Export (${L.length} companies)</h2><p class="note">If no download started, copy the CSV below and paste it into Excel or Google Sheets.</p><textarea id="ct" style="min-height:240px" readonly></textarea><div style="display:flex;gap:8px;margin-top:10px"><button class="pri" id="cp">Copy</button><button id="cx">Close</button></div>`);
  $("#ct").value=csv;$("#cx").onclick=closeModal;$("#cp").onclick=async()=>{try{await navigator.clipboard.writeText(csv);$("#cp").textContent="Copied"}catch(e){$("#ct").select()}}};

/* import */
function parseCSV(t){const R=[];let r=[],v="",q=false;for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch=='"'){if(t[i+1]=='"'){v+='"';i++}else q=false}else v+=ch}
  else if(ch=='"')q=true;else if(ch==","||ch==";"){r.push(v);v=""}else if(ch=="\n"){r.push(v);R.push(r);r=[];v=""}else if(ch!="\r")v+=ch}
  if(v||r.length){r.push(v);R.push(r)}return R}
$("#imp").onchange=async e=>{const file=e.target.files[0];if(!file)return;
  const R=parseCSV((await file.text()).replace(/^\ufeff/,""));const H=R.shift().map(h=>h.trim());
  const pick=(row,names)=>{for(const n of names){const i=H.findIndex(h=>h.toLowerCase()==n.toLowerCase());if(i>=0&&row[i])return row[i].replace(/^'/,"")}return ""};
  const names=new Set(all.map(c=>(c.name+"|"+c.city).toLowerCase()));const add=[];
  for(const row of R){const name=pick(row,["name","company","firma","Company name"]);if(!name)continue;
    const city=pick(row,["city","ort","stadt","City / HQ"]);if(names.has((name+"|"+city).toLowerCase()))continue;
    const c={id:"i"+Date.now().toString(36)+add.length,name,segment:pick(row,["segment","branche","industry"])||"Imported",priority:pick(row,["priority"])||"B",status:pick(row,["status"])||"Not contacted",city,info:pick(row,["info","address","adresse","Key fact / address & phone"]),why:pick(row,["why"]),role:pick(row,["role"]),source:pick(row,["source"]),contact:pick(row,["contact"]),email:pick(row,["email","e-mail"]),phone:pick(row,["phone","telefon"]),nextStep:"",nextDate:"",notes:pick(row,["notes"]),acts:[],updated:""};
    if(!STATUS.includes(c.status))c.status="Not contacted";add.push(c);names.add((name+"|"+city).toLowerCase())}
  e.target.value="";if(!add.length)return toast("Nothing new to import");
  try{const r=await api("/api/admin/crm/bulk",{method:"POST",body:JSON.stringify({companies:add})});all.push(...add);fillFilters();render();toast(r.added+" companies imported")}
  catch(err){toast("Import failed: "+err.message)}};

/* events */
for(const id of ["#q","#fs","#fc","#fp","#fst"])$(id).addEventListener("input",()=>{page=0;render()});
$("#view").addEventListener("click",e=>{if(e.target.id=="prev"){page--;render();return}if(e.target.id=="next"){page++;render();return}
  const r=e.target.closest("[data-id]");if(r)drawer(r.dataset.id)});
$("#view").addEventListener("keydown",e=>{if(e.key=="Enter"){const r=e.target.closest("[data-id]");if(r)drawer(r.dataset.id)}});
addEventListener("hashchange",()=>{page=0;render()});
addEventListener("keydown",e=>{if(e.key=="Escape"){closeModal();$("#drawer").classList.remove("open");openId=null}});
start();
}
