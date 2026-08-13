// ===================================================================
//  MARKETPLACE — parents browse & book approved Pro Trainers
//  Trainers only see a minimal, parent-approved snapshot of the child
//  (first name / age / sport), stored on the booking. Payments are
//  arranged directly for now — Stripe Connect is a later step.
// ===================================================================
let mpSport = ''; // sport filter key

function money(cents){ return cents!=null ? '$'+(cents/100).toFixed(cents%100?2:0) : '—'; }
function fmtWhen(ts){ if(!ts) return 'Flexible'; try{ return new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){ return 'Flexible'; } }
const BK_STATUS={ requested:['var(--line)','var(--ink)','Requested'], confirmed:['#E9F1EF','var(--good)','Confirmed'],
  declined:['#FBE9DC','var(--danger)','Declined'], cancelled:['#FBE9DC','#9a4a12','Cancelled'],
  completed:['#E9F1EF','var(--good)','Completed'], no_show:['#FBE9DC','var(--danger)','No-show'] };
function bkPill(s){ const [bg,col,txt]=BK_STATUS[s]||BK_STATUS.requested; return `<span class="pill" style="background:${bg};color:${col}">${txt}</span>`; }

// ---- Stripe + push helpers (shared) ----
async function fnError(error,fallback){ let m=fallback; try{ const j=await error.context.json(); if(j&&j.error) m=j.error; }catch(_){} return m; }
async function notifyBooking(bookingId,kind){ try{ await sb.functions.invoke('notify-booking',{ body:{ booking_id:bookingId, kind } }); }catch(e){ console.error(e); } }
async function payBooking(bookingId){
  toast('Opening secure checkout…');
  try{
    const { data, error }=await sb.functions.invoke('stripe-checkout',{ body:{ booking_id:bookingId } });
    if(error){ toast(await fnError(error,'Payment unavailable')); return; }
    if(data&&data.url){ location.href=data.url; } else { toast((data&&data.error)||'Payment unavailable'); }
  }catch(e){ console.error(e); toast('Payment unavailable'); }
}
async function startPayout(){
  toast('Opening Stripe…');
  try{
    const { data, error }=await sb.functions.invoke('stripe-connect',{ body:{} });
    if(error){ toast(await fnError(error,'Could not open Stripe')); return; }
    if(data&&data.url){ location.href=data.url; } else { toast('Could not open Stripe'); }
  }catch(e){ console.error(e); toast('Could not open Stripe'); }
}

// ---------- browse ----------
async function openMarketplace(){
  if(marketplaceOff()) return;
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Finding trainers…</div></div>`;
  try{ await loadRef(); }catch(err){ console.error(err); return bootError(); }
  let trainers=[];
  try{
    const { data, error }=await sb.from('trainer_profiles')
      .select('id,display_name,headline,city,region,offers_virtual,base_rate_cents,trainer_sports(sport_key),services(id,title,price_cents,sport_key),reviews(rating)')
      .eq('status','approved');
    if(error) throw error; trainers=data||[];
  }catch(err){ console.error(err); return bootError(); }
  const sports=(state.ref&&state.ref.sports)||[];
  const shown = mpSport ? trainers.filter(t=>(t.trainer_sports||[]).some(s=>s.sport_key===mpSport)) : trainers;
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 style="font-size:22px">Find a Pro Trainer</h1>
      <button class="pill" id="mpDone">Done</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Verified coaches for your young athlete — filter by sport.</p>
    <div class="chipgrid" id="mpsports" style="margin-bottom:12px">
      <div class="chip ${!mpSport?'on':''}" data-s="">All</div>
      ${sports.map(s=>`<div class="chip ${mpSport===s.key?'on':''}" data-s="${s.key}">${esc(s.name)}</div>`).join('')}
    </div>
    ${shown.length? shown.map(mpTrainerCard).join('')
      : `<div class="card app-pad"><div class="empty">${mpSport?'No trainers for this sport yet.':'No approved trainers yet — check back soon.'}</div></div>`}
    <p class="muted-note" style="margin-top:16px">Every listed trainer has a verified photo ID, a background check, and SafeSport training on file — all three reviewed by our team and currently in date. A trainer whose background check or certificate lapses is unlisted automatically until it is renewed. Even so: meet in a public place, stay for sessions with young athletes, and check references yourself.</p>
  </div>`;
  $("#mpDone").onclick=()=>renderApp('profile');
  $("#mpsports").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{ mpSport=c.dataset.s; openMarketplace(); });
  root.querySelectorAll('[data-tid]').forEach(b=>b.onclick=()=>viewTrainer(b.dataset.tid));
}
function mpTrainerCard(t){
  const ratings=(t.reviews||[]).map(r=>r.rating);
  const avg=ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length):null;
  const sportNames=(t.trainer_sports||[]).map(s=>state.ref.sports.find(x=>x.key===s.sport_key)?.name||s.sport_key);
  const from=(t.services||[]).reduce((m,s)=>s.price_cents!=null&&(m==null||s.price_cents<m)?s.price_cents:m, t.base_rate_cents);
  return H`<button class="card app-pad" data-tid="${esc(t.id)}" style="width:100%;text-align:left;display:block;margin-bottom:10px;border:none;cursor:pointer">
    <div style="display:flex;justify-content:space-between;gap:10px">
      <div style="min-width:0">
        <b style="font-size:16px">${esc(t.display_name||'Trainer')}</b>
        ${t.headline?`<div style="font-size:13px;color:var(--ink);margin-top:2px">${esc(t.headline)}</div>`:''}
        <div style="font-size:12.5px;color:var(--muted);margin-top:4px">${esc([sportNames.slice(0,3).join(', '),[t.city,t.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ')||'—')}${t.offers_virtual?' · virtual ok':''}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        ${avg?`<div style="font-size:13px">⭐ ${avg.toFixed(1)}</div>`:''}
        ${from!=null?`<div style="font-size:12.5px;color:var(--muted);margin-top:2px">from ${money(from)}</div>`:''}
      </div>
    </div></button>`;
}

// ---------- trainer detail ----------
async function viewTrainer(id){
  if(marketplaceOff()) return;
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let t,services,sportsRows,reviews;
  try{
    const [p,sv,sp,rv]=await Promise.all([
      sb.from('trainer_profiles').select('*').eq('id',id).maybeSingle(),
      sb.from('services').select('*').eq('trainer_id',id),
      sb.from('trainer_sports').select('*').eq('trainer_id',id),
      sb.from('reviews').select('rating,body,created_at').eq('trainer_id',id).eq('is_published',true).order('created_at',{ascending:false}),
    ]);
    t=p.data; services=(sv.data||[]).filter(s=>s.is_active); sportsRows=sp.data||[]; reviews=rv.data||[];
  }catch(err){ console.error(err); return bootError(); }
  if(!t){ toast('Trainer not found'); return openMarketplace(); }
  const sportName=k=>state.ref?.sports.find(x=>x.key===k)?.name||k;
  const ratings=reviews.map(r=>r.rating);
  const avg=ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length):null;
  const fmtLabel={in_person:'In-person',virtual:'Virtual',hybrid:'In-person / virtual'};
  root.innerHTML = H`<div class="app-pad" style="padding-top:22px">
    <button class="pill" id="back" style="margin-bottom:10px">‹ Back</button>
    <h1 style="font-size:24px;margin:0 0 2px">${esc(t.display_name||'Trainer')}</h1>
    <p style="color:var(--muted);font-size:13px;margin:0 0 4px">${esc([t.city,t.region].filter(Boolean).join(', ')||'—')}${t.offers_virtual?' · virtual sessions ok':''}${avg?` · ⭐ ${avg.toFixed(1)} (${ratings.length})`:''}</p>
    <div class="card app-pad" style="margin-top:10px">
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <span class="pill" style="background:#E9F1EF;color:var(--good)">✓ Screened</span>
        ${sportsRows.map(s=>`<span class="pill">${esc(sportName(s.sport_key))}${s.specialty?' · '+esc(s.specialty):''}</span>`).join('')}
      </div>
      ${t.headline?`<b style="font-size:14px">${esc(t.headline)}</b>`:''}
      ${t.bio?`<p style="font-size:13.5px;color:var(--ink);margin:8px 0 0;line-height:1.55">${esc(t.bio)}</p>`:''}
    </div>

    <div class="sec-title">Sessions</div>
    ${services.length? services.map(s=>H`
      <div class="card app-pad" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div style="min-width:0"><b style="font-size:15px">${esc(s.title)}</b>
            <div style="font-size:12.5px;color:var(--muted);margin-top:3px">${esc(fmtLabel[s.format]||s.format)} · ${s.duration_min} min${s.max_group_size>1?' · up to '+s.max_group_size:''}${s.sport_key?' · '+esc(sportName(s.sport_key)):''}</div>
            ${s.description?`<p style="font-size:13px;margin:8px 0 0;line-height:1.5">${esc(s.description)}</p>`:''}
          </div>
          <div style="text-align:right;flex:0 0 auto"><b>${money(s.price_cents)}</b></div>
        </div>
        <button class="btn sm" data-book="${esc(s.id)}" style="margin-top:10px">Request booking</button>
      </div>`).join('')
      : `<div class="card app-pad"><div class="empty">This trainer hasn't listed sessions yet.</div></div>`}

    ${reviews.length?H`<div class="sec-title">Reviews</div>
      <div class="card app-pad">
        ${reviews.slice(0,8).map(r=>H`<div style="padding:9px 0;border-bottom:1px solid var(--line)">
          <div style="font-size:13px">${'⭐'.repeat(r.rating)}</div>
          ${r.body?`<p style="font-size:13px;margin:4px 0 0;line-height:1.5">${esc(r.body)}</p>`:''}</div>`).join('')}
      </div>`:''}
  </div>`;
  $("#back").onclick=openMarketplace;
  root.querySelectorAll('[data-book]').forEach(b=>b.onclick=()=>{
    const s=services.find(x=>x.id===b.dataset.book); if(s) openBookingSheet(s,t);
  });
}

// ---------- booking ----------
function openBookingSheet(service,trainer){
  const kids=state.athletes||[];
  if(!kids.length){ toast('Add your athlete first'); return; }
  const bg=sheet(H`<h3>Request a session</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">with <b>${esc(trainer.display_name)}</b> — ${esc(service.title)} · ${money(service.price_cents)}</p>
    <div class="field"><label>For which athlete?</label>
      <select id="bkid">${kids.map(k=>`<option value="${k.id}">${esc(k.first_name)}</option>`).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Preferred date</label><input id="bkdate" type="date" min="${new Date().toISOString().slice(0,10)}"/></div>
      <div class="field"><label>Time</label><input id="bktime" type="time"/></div>
    </div>
    <div class="field"><label>Note to the trainer (optional)</label><textarea id="bknote" rows="2" placeholder="Goals, experience, anything helpful."></textarea></div>
    <div class="teach" style="margin-top:4px"><div class="ic">🔒</div><div><h4>What the trainer sees</h4>
      <p>Only your athlete's first name, age, and sport — plus your note. Nothing else from their profile is shared.</p></div></div>
    <div class="err" id="bkerr"></div>
    <button class="btn" id="bksend">Send request</button>`);
  bg.querySelector('#bksend').onclick=async(e)=>{
    const errEl=bg.querySelector('#bkerr'); errEl.textContent='';
    const child=kids.find(k=>k.id===bg.querySelector('#bkid').value);
    if(!child){ errEl.textContent='Pick an athlete.'; return; }
    const d=bg.querySelector('#bkdate').value, tm=bg.querySelector('#bktime').value;
    const scheduled_at = d ? new Date(`${d}T${tm||'09:00'}`).toISOString() : null;
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    try{
      const bookingId=uuid();
      const age=ageFrom(child.birthdate);
      let sportKey=null;
      try{ const { data:as }=await sb.from('athlete_sports').select('sport_key,is_primary').eq('athlete_id',child.id);
        sportKey=(as||[]).find(x=>x.is_primary)?.sport_key || (as||[])[0]?.sport_key || null; }catch(_){}
      const child_shared={ first_name:child.first_name, age, sport: sportKey?(state.ref?.sports.find(s=>s.key===sportKey)?.name||sportKey):null };
      const { error:be }=await sb.from('bookings').insert({ id:bookingId, service_id:service.id, trainer_id:trainer.id,
        parent_id:state.user.id, athlete_id:child.id, status:'requested', scheduled_at,
        duration_min:service.duration_min, price_cents:service.price_cents, currency:service.currency||'usd',
        location_text:service.location_text||null, parent_note:bg.querySelector('#bknote').value.trim()||null,
        child_shared });
      if(be) throw be;
      // consent/audit grant (scoped + expiring). Non-fatal if it fails.
      try{
        const exp=scheduled_at?new Date(new Date(scheduled_at).getTime()+30*864e5).toISOString():null;
        await sb.from('trainer_athlete_grants').insert({ booking_id:bookingId, trainer_id:trainer.id, athlete_id:child.id,
          scope:{first_name:true,sport:true,age_band:true}, granted_by:state.user.id, expires_at:exp });
      }catch(ge){ console.error(ge); }
      notifyBooking(bookingId,'new_request');
      bg.remove(); toast('Request sent 🎉'); openMyBookings();
    }catch(err){ console.error(err); errEl.textContent='Could not send. '+(err.message||''); e.target.innerHTML='Send request'; e.target.disabled=false; }
  };
}

// ---------- parent's bookings ----------
async function openMyBookings(){
  if(marketplaceOff()) return;
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let rows=[];
  try{
    const { data, error }=await sb.from('bookings')
      .select('*, services(title), trainer_profiles(display_name), reviews(id)')
      .eq('parent_id',state.user.id).order('created_at',{ascending:false});
    if(error) throw error; rows=data||[];
  }catch(err){ console.error(err); return bootError(); }
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h1 style="font-size:22px">My bookings</h1>
      <button class="pill" id="done">Done</button>
    </div>
    ${rows.length? rows.map(b=>{
      const canReview=b.status==='completed' && !(b.reviews&&b.reviews.length);
      return H`<div class="card app-pad" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div style="min-width:0"><b>${esc(b.trainer_profiles?.display_name||'Trainer')}</b>
            <div style="font-size:12.5px;color:var(--muted);margin-top:2px">${esc(b.services?.title||'Session')} · ${fmtWhen(b.scheduled_at)}</div>
          </div>${bkPill(b.status)}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
          <button class="btn sm ghost" data-msg="${esc(b.id)}">Messages</button>
          ${(b.status==='confirmed'&&!b.paid_at)?`<button class="btn sm" data-pay="${esc(b.id)}">Pay ${money(b.price_cents)}</button>`:''}
          ${b.paid_at?`<span class="pill" style="background:#E9F1EF;color:var(--good)">Paid ✓</span>`:''}
          ${(b.status==='requested'||b.status==='confirmed')?`<button class="btn sm ghost" data-cancel="${esc(b.id)}">Cancel</button>`:''}
          ${canReview?`<button class="btn sm" data-review="${esc(b.id)}" data-tid="${esc(b.trainer_id)}">Leave review</button>`:''}
        </div></div>`;}).join('')
      : `<div class="card app-pad"><div class="empty">No bookings yet. Find a trainer to get started.</div></div>`}
  </div>`;
  $("#done").onclick=()=>renderApp('profile');
  root.querySelectorAll('[data-msg]').forEach(b=>b.onclick=()=>openBookingThread(b.dataset.msg,()=>openMyBookings()));
  root.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>payBooking(b.dataset.pay));
  root.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>parentCancelBooking(b.dataset.cancel));
  root.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>leaveReview(b.dataset.review,b.dataset.tid));
}
async function parentCancelBooking(id){
  const { error }=await sb.from('bookings').update({ status:'cancelled', cancelled_by:state.user.id, updated_at:new Date().toISOString() }).eq('id',id);
  if(error){ console.error(error); toast('Could not cancel'); return; }
  toast('Cancelled'); openMyBookings();
}
function leaveReview(bookingId,trainerId){
  const bg=sheet(H`<h3>Leave a review</h3>
    <div class="field" style="margin-top:8px"><label>Rating</label>
      <div class="chipgrid" id="rvstars" style="grid-template-columns:repeat(5,1fr)">
        ${[1,2,3,4,5].map(n=>`<div class="chip" data-n="${n}">${n}★</div>`).join('')}</div></div>
    <div class="field"><label>Comments (optional)</label><textarea id="rvbody" rows="3" placeholder="How was the session?"></textarea></div>
    <div class="err" id="rverr"></div>
    <button class="btn" id="rvsave">Post review</button>`);
  let rating=0;
  bg.querySelectorAll('#rvstars .chip').forEach(c=>c.onclick=()=>{ rating=+c.dataset.n;
    bg.querySelectorAll('#rvstars .chip').forEach(x=>x.classList.toggle('on',+x.dataset.n<=rating)); });
  bg.querySelector('#rvsave').onclick=async(e)=>{
    if(!rating){ bg.querySelector('#rverr').textContent='Pick a rating.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.from('reviews').insert({ booking_id:bookingId, trainer_id:trainerId, parent_id:state.user.id,
      rating, body:bg.querySelector('#rvbody').value.trim()||null });
    if(error){ console.error(error); bg.querySelector('#rverr').textContent='Could not post. '+(error.message||''); e.target.innerHTML='Post review'; e.target.disabled=false; return; }
    bg.remove(); toast('Thanks for the review ⭐'); openMyBookings();
  };
}

// ---------- shared: booking message thread ----------
async function openBookingThread(bookingId,onClose){
  const bg=sheet(H`<h3>Messages</h3><div id="thread" style="max-height:46dvh;overflow:auto;margin:8px 0">
      <div class="center-screen" style="min-height:80px"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div></div>
    </div>
    <div class="row2" style="grid-template-columns:1fr auto;gap:8px">
      <input id="msgin" placeholder="Write a message…" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/>
      <button class="btn sm" id="msgsend">Send</button>
    </div>`);
  async function load(){
    let msgs=[];
    try{ const { data }=await sb.from('booking_messages').select('*').eq('booking_id',bookingId).order('created_at'); msgs=data||[]; }
    catch(err){ console.error(err); }
    const box=bg.querySelector('#thread'); if(!box) return;
    box.innerHTML = msgs.length? msgs.map(m=>{ const mine=m.sender_id===state.user.id;
      return `<div style="display:flex;justify-content:${mine?'flex-end':'flex-start'};margin:6px 0">
        <div style="max-width:78%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.4;background:${mine?'var(--green)':'var(--line)'};color:${mine?'#fff':'var(--ink)'}">${esc(m.body)}</div>
      </div>`; }).join('')
      : `<div class="empty">No messages yet. Say hello 👋</div>`;
    box.scrollTop=box.scrollHeight;
  }
  await load();
  const send=async()=>{
    const inp=bg.querySelector('#msgin'); const body=inp.value.trim(); if(!body) return;
    inp.value='';
    const { error }=await sb.from('booking_messages').insert({ booking_id:bookingId, sender_id:state.user.id, body });
    if(error){ console.error(error); toast('Could not send'); inp.value=body; return; }
    notifyBooking(bookingId,'message');
    load();
  };
  bg.querySelector('#msgsend').onclick=send;
  bg.querySelector('#msgin').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } });
  const _rm=bg.remove; bg.remove=()=>{ _rm.call(bg); if(onClose) onClose(); };
}
