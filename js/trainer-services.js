// ===================================================================
//  TRAINER SERVICES & BOOKINGS (approved trainers)
//  Depends on marketplace.js helpers: money(), fmtWhen(), bkPill(),
//  openBookingThread().
// ===================================================================
const SVC_FORMATS=[['in_person','In-person'],['virtual','Virtual'],['hybrid','Both']];

// ---------- manage services ----------
async function openTrainerServices(){
  if(marketplaceOff()) return;
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  try{ await loadRef(); }catch(err){ console.error(err); return bootError(); }
  let svcs=[];
  try{ const { data, error }=await sb.from('services').select('*').eq('trainer_id',state.user.id).order('created_at',{ascending:false});
    if(error) throw error; svcs=data||[]; }
  catch(err){ console.error(err); return bootError(); }
  const sportName=k=>state.ref?.sports.find(x=>x.key===k)?.name||k;
  const fmtLabel={in_person:'In-person',virtual:'Virtual',hybrid:'Both'};
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="font-size:22px">My services</h1>
      <button class="pill" id="done">Done</button>
    </div>
    ${svcs.length? svcs.map(s=>H`
      <div class="card app-pad" style="margin-bottom:10px;${s.is_active?'':'opacity:.6'}">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div style="min-width:0"><b style="font-size:15px">${esc(s.title)}</b>
            <div style="font-size:12.5px;color:var(--muted);margin-top:3px">${esc(fmtLabel[s.format]||s.format)} · ${s.duration_min} min · ${money(s.price_cents)}${s.sport_key?' · '+esc(sportName(s.sport_key)):''}${s.is_active?'':' · hidden'}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn sm ghost" data-edit="${esc(s.id)}">Edit</button>
          <button class="btn sm ghost" data-toggle="${esc(s.id)}" data-on="${s.is_active?1:0}">${s.is_active?'Hide':'Show'}</button>
          <button class="btn sm danger ghost" data-del="${esc(s.id)}">Delete</button>
        </div></div>`).join('')
      : `<div class="card app-pad"><div class="empty">No services yet. Add your first session so parents can book you.</div></div>`}
    <button class="btn" id="addSvc" style="margin-top:6px">＋ Add a service</button>
    <button class="btn ghost" id="toBookings" style="margin-top:10px">View booking requests</button>
    <div class="teach" style="margin-top:14px"><div class="ic">💳</div><div><h4>Get paid</h4>
      <p>Set up secure payouts with Stripe so parents can pay you in-app. You keep your earnings minus the platform fee.</p></div></div>
    <button class="btn ghost" id="payout" style="margin-top:8px">Set up / manage payouts</button>
  </div>`;
  $("#done").onclick=()=>renderApp('profile');
  $("#addSvc").onclick=()=>serviceSheet(null);
  $("#toBookings").onclick=openTrainerBookings;
  $("#payout").onclick=startPayout;
  root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>serviceSheet(svcs.find(s=>s.id===b.dataset.edit)));
  root.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>trainerToggleService(b.dataset.toggle,b.dataset.on!=='1'));
  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>trainerDeleteService(b.dataset.del));
}
async function trainerToggleService(id,active){
  const { error }=await sb.from('services').update({ is_active:active }).eq('id',id);
  if(error){ console.error(error); toast('Could not update'); return; }
  openTrainerServices();
}
function trainerDeleteService(id){
  const bg=sheet(H`<h3>Delete this service?</h3>
    <p style="color:var(--muted);font-size:14px;margin:8px 0 16px">Parents won't be able to book it. Existing bookings are unaffected.</p>
    <button class="btn danger" id="yes">Delete</button>
    <button class="btn ghost" id="no" style="margin-top:8px">Keep it</button>`);
  bg.querySelector('#no').onclick=()=>bg.remove();
  bg.querySelector('#yes').onclick=async(e)=>{ e.target.disabled=true;
    const { error }=await sb.from('services').delete().eq('id',id);
    if(error){ console.error(error); toast('Could not delete'); return; }
    bg.remove(); toast('Deleted'); openTrainerServices();
  };
}
function serviceSheet(existing){
  const s=existing||{ title:'',sport_key:'',format:'in_person',duration_min:60,price_cents:'',max_group_size:1,location_text:'',description:'',is_active:true };
  const sports=state.ref?.sports||[];
  const bg=sheet(H`<h3>${existing?'Edit service':'New service'}</h3>
    <div class="field"><label>Title</label><input id="svTitle" placeholder="Private speed & agility session" value="${esc(s.title)}"/></div>
    <div class="field"><label>Sport</label>
      <select id="svSport"><option value="">Any / general</option>
        ${sports.map(x=>`<option value="${x.key}" ${s.sport_key===x.key?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Format</label>
      <div class="chipgrid" id="svFmt" style="grid-template-columns:repeat(3,1fr)">
        ${SVC_FORMATS.map(([k,l])=>`<div class="chip ${s.format===k?'on':''}" role="button" tabindex="0" data-f="${k}">${l}</div>`).join('')}</div></div>
    <div class="row2">
      <div class="field"><label>Duration (min)</label><input id="svDur" type="number" inputmode="numeric" value="${esc(s.duration_min)}"/></div>
      <div class="field"><label>Price ($)</label><input id="svPrice" type="number" inputmode="decimal" placeholder="40" value="${s.price_cents!==''&&s.price_cents!=null?(s.price_cents/100):''}"/></div>
    </div>
    <div class="row2">
      <div class="field"><label>Max group size</label><input id="svGrp" type="number" inputmode="numeric" value="${esc(s.max_group_size||1)}"/></div>
      <div class="field"><label>Where (general)</label><input id="svLoc" placeholder="Piedmont Park area" value="${esc(s.location_text||'')}"/></div>
    </div>
    <div class="field"><label>Description</label><textarea id="svDesc" rows="3" placeholder="What the session covers, who it's for.">${esc(s.description||'')}</textarea></div>
    <div class="err" id="svErr"></div>
    <button class="btn" id="svSave">${existing?'Save changes':'Create service'}</button>`);
  let fmt=s.format;
  bg.querySelectorAll('#svFmt .chip').forEach(c=>c.onclick=()=>{ fmt=c.dataset.f; bg.querySelectorAll('#svFmt .chip').forEach(x=>x.classList.toggle('on',x===c)); });
  bg.querySelector('#svSave').onclick=async(e)=>{
    const errEl=bg.querySelector('#svErr'); errEl.textContent='';
    const title=bg.querySelector('#svTitle').value.trim();
    const priceV=bg.querySelector('#svPrice').value;
    if(!title){ errEl.textContent='Give the session a title.'; return; }
    if(priceV===''||isNaN(parseFloat(priceV))){ errEl.textContent='Set a price.'; return; }
    e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled=true;
    const row={ trainer_id:state.user.id, title,
      sport_key:bg.querySelector('#svSport').value||null, format:fmt,
      duration_min:parseInt(bg.querySelector('#svDur').value,10)||60,
      price_cents:Math.round(parseFloat(priceV)*100),
      max_group_size:parseInt(bg.querySelector('#svGrp').value,10)||1,
      location_text:bg.querySelector('#svLoc').value.trim()||null,
      description:bg.querySelector('#svDesc').value.trim()||null };
    let error;
    if(existing){ ({ error }=await sb.from('services').update(row).eq('id',existing.id)); }
    else { ({ error }=await sb.from('services').insert({ ...row, is_active:true })); }
    if(error){ console.error(error); errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML=existing?'Save changes':'Create service'; e.target.disabled=false; return; }
    bg.remove(); toast('Saved'); openTrainerServices();
  };
}

// ---------- incoming bookings ----------
async function openTrainerBookings(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let rows=[];
  try{ const { data, error }=await sb.from('bookings').select('*, services(title)').eq('trainer_id',state.user.id).order('created_at',{ascending:false});
    if(error) throw error; rows=data||[]; }
  catch(err){ console.error(err); return bootError(); }
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="font-size:22px">Booking requests</h1>
      <button class="pill" id="done">Done</button>
    </div>
    ${rows.length? rows.map(b=>{ const c=b.child_shared||{};
      return H`<div class="card app-pad" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div style="min-width:0"><b>${esc(b.services?.title||'Session')}</b>
            <div style="font-size:12.5px;color:var(--muted);margin-top:2px">${esc(c.first_name||'Athlete')}${c.age!=null?', age '+c.age:''}${c.sport?' · '+esc(c.sport):''} · ${fmtWhen(b.scheduled_at)}</div>
          </div>${bkPill(b.status)}
        </div>
        ${b.parent_note?`<p style="font-size:13px;margin:8px 0 0;line-height:1.5">"${esc(b.parent_note)}"</p>`:''}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn sm ghost" data-msg="${esc(b.id)}">Messages</button>
          ${b.status==='requested'?`<button class="btn sm" data-confirm="${esc(b.id)}">Confirm</button><button class="btn sm danger ghost" data-decline="${esc(b.id)}">Decline</button>`:''}
          ${b.status==='confirmed'?`<button class="btn sm" data-complete="${esc(b.id)}">Mark completed</button>`:''}
        </div></div>`;}).join('')
      : `<div class="card app-pad"><div class="empty">No booking requests yet.</div></div>`}
  </div>`;
  $("#done").onclick=()=>renderApp('profile');
  root.querySelectorAll('[data-msg]').forEach(b=>b.onclick=()=>openBookingThread(b.dataset.msg,()=>openTrainerBookings()));
  root.querySelectorAll('[data-confirm]').forEach(b=>b.onclick=()=>trainerSetBooking(b.dataset.confirm,'confirmed'));
  root.querySelectorAll('[data-decline]').forEach(b=>b.onclick=()=>trainerSetBooking(b.dataset.decline,'declined'));
  root.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>trainerSetBooking(b.dataset.complete,'completed'));
}
async function trainerSetBooking(id,status){
  const { error }=await sb.from('bookings').update({ status, updated_at:new Date().toISOString() }).eq('id',id);
  if(error){ console.error(error); toast('Could not update'); return; }
  notifyBooking(id,status); // 'confirmed' | 'declined' | 'completed' → parent
  toast(status==='confirmed'?'Confirmed ✅':status==='completed'?'Marked completed':'Declined');
  openTrainerBookings();
}
