// ===================================================================
//  CAMPS & PROGRAMS — a directory, not a marketplace
// ===================================================================
// No booking, no payment, no per-athlete access grant — every listing points OUT to
// the organization's own signup. The one real safety measure is the review gate: a
// listing is invisible to other families until an admin approves it, the same
// admin_camps-review shape the trainer queue already uses, just without the
// background-check machinery a 1:1 trainer booking needs and a program listing
// doesn't. See TEAM-CONNECT-EXPANSION-PLAN.md, Part A.

function campWhen(c){
  if(!c.start_date) return 'Dates TBD';
  const s=new Date(c.start_date+'T00:00:00'), opts={month:'short',day:'numeric'};
  if(!c.end_date || c.end_date===c.start_date) return s.toLocaleDateString(undefined,opts);
  return s.toLocaleDateString(undefined,opts)+' – '+new Date(c.end_date+'T00:00:00').toLocaleDateString(undefined,opts);
}
function campAges(c){
  if(c.age_min==null && c.age_max==null) return 'All ages';
  if(c.age_min!=null && c.age_max!=null) return `Ages ${c.age_min}–${c.age_max}`;
  return c.age_min!=null ? `Ages ${c.age_min}+` : `Up to age ${c.age_max}`;
}

let campSport = '';

async function openCamps(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Finding camps…</div></div>`;
  try{ await loadRef(); }catch(err){ console.error(err); return bootError(); }
  let camps=[];
  try{
    const { data, error } = await sb.from('camps')
      .select('id,org_name,sport_key,age_min,age_max,location_text,start_date,end_date,description,external_signup_url')
      .eq('status','approved').order('start_date',{ascending:true,nullsFirst:false});
    if(error) throw error; camps=data||[];
  }catch(err){ console.error(err); return bootError(); }
  const sports=(state.ref&&state.ref.sports)||[];
  const shown = campSport ? camps.filter(c=>c.sport_key===campSport) : camps;
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 style="font-size:22px">Camps &amp; programs</h1>
      <button class="pill" id="cpDone">Done</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Sign-up happens with the organization directly — nothing here is booked or paid through Parent Playbook.</p>
    <div class="chipgrid" id="cpsports" style="margin-bottom:12px">
      <div class="chip ${!campSport?'on':''}" data-s="">All</div>
      ${sports.map(s=>`<div class="chip ${campSport===s.key?'on':''}" data-s="${s.key}">${esc(s.name)}</div>`).join('')}
    </div>
    ${shown.length ? shown.map(campCard).join('')
      : `<div class="card app-pad"><div class="empty">${campSport?'No listings for this sport yet.':'No approved listings yet — check back soon.'}</div></div>`}
    <div class="navrow" id="cpSubmit" role="button" tabindex="0" style="margin-top:18px">
      <div class="gi">＋</div><div class="gt"><b>Know a camp that should be here?</b>
        <span>List it — reviewed before other families see it.</span></div><i>›</i></div>
  </div>`;
  $("#cpDone").onclick=()=>renderApp('profile');
  $("#cpsports").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{ campSport=c.dataset.s; openCamps(); });
  $("#cpSubmit").onclick=openSubmitCamp;
}

function campCard(c){
  const sportName = state.ref?.sports.find(s=>s.key===c.sport_key)?.name || '';
  return H`<div class="card app-pad" style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;gap:10px">
      <div style="min-width:0">
        <b style="font-size:16px">${esc(c.org_name)}</b>
        <div style="font-size:12.5px;color:var(--muted);margin-top:4px">
          ${esc([sportName,c.location_text].filter(Boolean).join(' · '))}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:2px">${esc(campWhen(c))} · ${esc(campAges(c))}</div>
        ${c.description?H`<p style="font-size:13.5px;margin:8px 0 0">${esc(c.description)}</p>`:''}
      </div>
    </div>
    <a href="${esc(c.external_signup_url)}" target="_blank" rel="noopener noreferrer"
       class="btn sm ghost" style="margin-top:10px;display:inline-block;text-decoration:none">Sign up on their site ↗</a>
  </div>`;
}

// ---------- submit ----------
function openSubmitCamp(){
  const sports=(state.ref&&state.ref.sports)||[];
  const bg = sheet(H`<h3>List a camp or program</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Reviewed before it's shown to other families —
      usually within a couple of days. Sign-up itself always stays on the organization's own site; this is a
      listing, not a booking.</p>

    <div class="field"><label>Organization name</label><input id="cOrg" placeholder="e.g. Riverside Youth Football Camp"/></div>
    <div class="field"><label>Your name</label><input id="cContactName" placeholder="Who we can reach about this listing"/></div>
    <div class="field"><label>Contact email</label><input id="cContactEmail" type="email" placeholder="camp@example.com"/></div>
    <div class="field"><label>Sport</label>
      <select id="cSport"><option value="">Not sport-specific</option>
        ${sports.map(s=>`<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field" style="display:flex;gap:10px">
      <div style="flex:1"><label>Youngest age</label><input id="cAgeMin" type="number" min="0" max="19" inputmode="numeric"/></div>
      <div style="flex:1"><label>Oldest age</label><input id="cAgeMax" type="number" min="0" max="19" inputmode="numeric"/></div>
    </div>
    <div class="field"><label>Location</label><input id="cLoc" placeholder="City, State"/></div>
    <div class="field" style="display:flex;gap:10px">
      <div style="flex:1"><label>Starts</label><input id="cStart" type="date"/></div>
      <div style="flex:1"><label>Ends</label><input id="cEnd" type="date"/></div>
    </div>
    <div class="field"><label>Description</label><textarea id="cDesc" rows="3" maxlength="2000"></textarea></div>
    <div class="field"><label>Sign-up link</label><input id="cUrl" type="url" placeholder="https://…"/></div>

    <div class="err" id="cErr"></div>
    <button class="btn amber" id="cSend">Submit for review</button>`);

  bg.querySelector('#cSend').onclick = async e => {
    const val = id => (bg.querySelector(id).value||'').trim();
    const err = bg.querySelector('#cErr'); err.textContent='';
    const org=val('#cOrg'), cname=val('#cContactName'), cemail=val('#cContactEmail'),
          loc=val('#cLoc'), url=val('#cUrl');
    if(!org) return err.textContent='Add the organization\'s name.';
    if(!cname) return err.textContent='Add your name.';
    if(!/.+@.+\..+/.test(cemail)) return err.textContent='That email address doesn\'t look right.';
    if(!loc) return err.textContent='Add a location.';
    if(!/^https?:\/\/.+/.test(url)) return err.textContent='Add a sign-up link starting with https://';

    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const ageMin = val('#cAgeMin'), ageMax = val('#cAgeMax');
    const { error } = await sb.from('camps').insert({
      org_name: org, contact_name: cname, contact_email: cemail,
      sport_key: val('#cSport')||null,
      age_min: ageMin?Number(ageMin):null, age_max: ageMax?Number(ageMax):null,
      location_text: loc,
      start_date: val('#cStart')||null, end_date: val('#cEnd')||null,
      description: val('#cDesc')||null, external_signup_url: url,
      created_by: state.user.id,
    });
    if(error){
      console.error(error);
      err.textContent = 'Could not submit that. ' + (error.message||'');
      e.target.innerHTML='Submit for review'; e.target.disabled=false;
      return;
    }
    bg.remove();
    toast('Submitted — we\'ll review it soon');
  };
}

// ---------- admin review ----------
async function openCampsAdminQueue(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let rows=[];
  try{
    const { data, error } = await sb.from('camps')
      .select('id,org_name,contact_name,contact_email,sport_key,age_min,age_max,location_text,start_date,end_date,description,external_signup_url,status,created_at')
      .order('created_at',{ascending:true}).limit(200);
    if(error) throw error; rows=data||[];
  }catch(err){ console.error(err); return adminError(openCampsAdminQueue); }
  const pending = rows.filter(r=>r.status==='pending');
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 style="font-size:22px">Camps &amp; programs review</h1>
      <button class="pill" id="ccDone">Done</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">${pending.length} awaiting review · ${rows.length} total</p>
    ${rows.length ? rows.map(campAdminCard).join('') : H`<div class="card app-pad"><div class="empty">Nothing submitted yet.</div></div>`}
  </div>`;
  $("#ccDone").onclick=()=>renderApp('profile');
  rows.forEach(c=>{
    const ap=$("#cAppr"+c.id.replace(/[^a-zA-Z0-9]/g,'')), rj=$("#cRej"+c.id.replace(/[^a-zA-Z0-9]/g,''));
    if(ap) ap.onclick=()=>campAdminSet(c.id,'approved');
    if(rj) rj.onclick=()=>campAdminSet(c.id,'rejected');
  });
}
function campAdminCard(c){
  const idc = c.id.replace(/[^a-zA-Z0-9]/g,'');
  const map={ pending:['var(--line)','var(--ink)','Pending'], approved:['#E9F1EF','var(--good)','Approved'],
    rejected:['#FBE9DC','var(--danger)','Rejected'] };
  const [bg,col,txt]=map[c.status]||map.pending;
  return H`<div class="card app-pad" style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div style="min-width:0">
        <b style="font-size:15px">${esc(c.org_name)}</b>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px">${esc(c.location_text)} · ${esc(campWhen(c))} · ${esc(campAges(c))}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:2px">Contact: ${esc(c.contact_name)} · ${esc(c.contact_email)}</div>
        ${c.description?H`<p style="font-size:13px;margin:6px 0 0">${esc(c.description)}</p>`:''}
        <a href="${esc(c.external_signup_url)}" target="_blank" rel="noopener noreferrer" style="font-size:12.5px">${esc(c.external_signup_url)}</a>
      </div>
      <span class="pill" style="background:${bg};color:${col};flex:none">${txt}</span>
    </div>
    ${c.status==='pending'?H`<div class="row2" style="margin-top:12px">
        <button class="btn danger ghost" id="cRej${idc}">Reject</button>
        <button class="btn" id="cAppr${idc}">Approve</button>
      </div>`:''}
  </div>`;
}
async function campAdminSet(id,status){
  const { error } = await sb.from('camps')
    .update({ status, reviewed_by: state.user.id, reviewed_at: new Date().toISOString() }).eq('id',id);
  if(error){ console.error(error); toast('Could not update that'); return; }
  toast(status==='approved'?'Approved':'Rejected');
  openCampsAdminQueue();
}
