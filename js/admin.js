// ===================================================================
//  ADMIN — Pro Trainer review queue (admins only)
//  Gated by app_admins RLS: non-admins can't read the data or reach here.
//  Approving a trainer requires all three screening checks marked passed.
// ===================================================================
let adminFilter = 'pending'; // 'pending' | 'all'
let adminQuery = '';
const ADMIN_PENDING = ['submitted','in_review','needs_info'];
const ADMIN_PAGE = 200;

// Inline failure inside the admin screen. bootError() replaced the whole app with a
// reload screen, so one flaky request threw the admin out of everything with no way back.
function adminError(retry){
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h1 style="font-size:22px">Trainer review</h1><button class="pill" id="adminDone">Done</button>
    </div>
    <div class="card app-pad"><div class="empty">Couldn't load. Check your connection and retry.</div>
      <button class="btn ghost" id="adminRetry" style="margin-top:12px">Retry</button></div>
  </div>`;
  $("#adminDone").onclick=()=>renderApp('profile');
  $("#adminRetry").onclick=retry;
}

function adminFmt(ts){ if(!ts) return '—'; try{ return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }catch(e){ return '—'; } }
function adminStatusPill(s){
  const map={ draft:['#eee','var(--muted)','Draft'], submitted:['var(--line)','var(--ink)','Submitted'],
    in_review:['#FBE9DC','#9a4a12','In review'], needs_info:['#FBE9DC','#9a4a12','Needs info'],
    approved:['#E9F1EF','var(--good)','Approved'], suspended:['#FBE9DC','#9a4a12','Suspended'],
    rejected:['#FBE9DC','var(--danger)','Rejected'] };
  const [bg,col,txt]=map[s]||map.submitted;
  return `<span class="pill" style="background:${bg};color:${col}">${txt}</span>`;
}

// ---- queue list ----
async function openAdminQueue(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading queue…</div></div>`;
  let rows=[];
  try{
    let q=sb.from('trainer_profiles').select('id,display_name,city,region,status,submitted_at')
      .order('submitted_at',{ascending:true,nullsFirst:false}).limit(ADMIN_PAGE);
    if(adminFilter==='pending') q=q.in('status',ADMIN_PENDING);
    const { data, error }=await q;
    if(error) throw error; rows=data||[];
  }catch(err){ console.error(err); return adminError(openAdminQueue); }
  const capped = rows.length>=ADMIN_PAGE;
  const pendingCount = rows.filter(r=>ADMIN_PENDING.includes(r.status)).length;
  const needle = adminQuery.trim().toLowerCase();
  const shown = needle
    ? rows.filter(r=>[r.display_name,r.city,r.region].filter(Boolean).join(' ').toLowerCase().includes(needle))
    : rows;
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 style="font-size:22px">Trainer review</h1>
      <button class="pill" id="adminDone">Done</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">${adminFilter==='pending'?`${rows.length} awaiting review`:`${pendingCount} pending · ${rows.length} total`}</p>
    <div class="chipgrid" id="afilter" style="grid-template-columns:1fr 1fr;margin-bottom:10px">
      <div class="chip ${adminFilter==='pending'?'on':''}" role="button" tabindex="0" data-f="pending">Pending</div>
      <div class="chip ${adminFilter==='all'?'on':''}" role="button" tabindex="0" data-f="all">All</div>
    </div>
    <div class="field" style="margin-bottom:10px"><input id="asearch" placeholder="Search name or city…" value="${esc(adminQuery)}"/></div>
    ${capped?`<p style="font-size:11.5px;color:#9a4a12;margin:0 0 10px">Showing the oldest ${ADMIN_PAGE} — narrow with search or the Pending filter.</p>`:''}
    ${shown.length? shown.map(r=>H`
      <button class="card app-pad" data-id="${esc(r.id)}" style="width:100%;text-align:left;display:block;margin-bottom:10px;border:none;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0">
            <b style="font-size:15px">${esc(r.display_name||'(no name)')}</b>
            <div style="color:var(--muted);font-size:12.5px;margin-top:2px">${esc([r.city,r.region].filter(Boolean).join(', ')||'—')} · applied ${adminFmt(r.submitted_at)}</div>
          </div>
          ${adminStatusPill(r.status)}
        </div>
      </button>`).join('')
      : `<div class="card app-pad"><div class="empty">${needle?'No match for “'+esc(adminQuery)+'”.':(adminFilter==='pending'?'Nothing awaiting review. 🎉':'No trainer applications yet.')}</div></div>`}
  </div>`;
  $("#adminDone").onclick=()=>renderApp('profile');
  $("#afilter").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{ adminFilter=c.dataset.f; openAdminQueue(); });
  { const s=$("#asearch"); if(s){ s.oninput=()=>{ adminQuery=s.value; };
      s.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); openAdminQueue().then(()=>{ const n=$("#asearch"); if(n){ n.focus(); n.setSelectionRange(n.value.length,n.value.length); } }); } }; } }
  root.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>adminReviewTrainer(b.dataset.id));
}

async function adminSignDoc(path){
  if(!path) return null;
  try{ const { data }=await sb.storage.from('trainer-verification-docs').createSignedUrl(path,3600); return data?.signedUrl||null; }
  catch(err){ console.error(err); return null; }
}

// ---- single application detail ----
async function adminReviewTrainer(id){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let prof,sports,creds,vers,actions;
  try{
    const [p,s,c,v,a]=await Promise.all([
      sb.from('trainer_profiles').select('*').eq('id',id).maybeSingle(),
      sb.from('trainer_sports').select('*').eq('trainer_id',id),
      sb.from('trainer_credentials').select('*').eq('trainer_id',id),
      sb.from('trainer_verifications').select('*').eq('trainer_id',id),
      sb.from('trainer_review_actions').select('*').eq('trainer_id',id).order('created_at',{ascending:false}),
    ]);
    prof=p.data; sports=s.data||[]; creds=c.data||[]; vers=v.data||[]; actions=a.data||[];
  }catch(err){ console.error(err); return adminError(()=>adminReviewTrainer(id)); }
  if(!prof){ toast('Not found'); return openAdminQueue(); }

  // sign private docs
  const docUrls={};
  for(const c of creds){ if(c.doc_path) docUrls['cred_'+c.id]=await adminSignDoc(c.doc_path); }
  // Every screening kind can carry a document, not just identity.
  const verUrls={};
  for(const v of vers){ if(v.doc_path) verUrls[v.kind]=await adminSignDoc(v.doc_path); }

  const sportName=k=>state.ref?.sports.find(x=>x.key===k)?.name||k;
  const KIND=[['identity','Identity'],['background_check','Background check'],['safesport','SafeSport training']];
  const vrow=k=>vers.find(v=>v.kind===k)||null;
  // A passed check whose expiry has gone by is not passed any more. The database
  // takes the same view (private.trainer_screening_ok), so this mirrors exactly
  // what decides whether the trainer is visible to parents — no cron in between.
  const vstatus=k=>{ const v=vrow(k); if(!v) return 'not_started';
    if(v.status==='passed' && v.expires_at && new Date(v.expires_at)<=new Date()) return 'expired';
    return v.status; };
  const allPassed=KIND.every(([k])=>vstatus(k)==='passed');
  const att=prof.attestations||{};

  // Evidence, then the decision. The fields below are what the database requires
  // before it will accept "passed" — identity needs a document; SafeSport needs a
  // certificate and the date it lapses; a background check needs either a provider
  // result or an uploaded report, plus an expiry. Pass will be refused without them.
  // Resubmitting deletes and recreates the verification rows, so a check that was
  // failed once comes back as a clean "pending". The decision survives in the
  // review log — surface it here so it can't be missed by scrolling past.
  const priorFail=k=>actions.some(a=>a.action==='verification:'+k+':failed');

  const verRow=([k,label])=>{ const st=vstatus(k); const v=vrow(k)||{};
    const url=verUrls[k];
    const expVal=v.expires_at?localDay(new Date(v.expires_at)):'';
    const needsExp=(k!=='identity');
    return H`<div style="padding:10px 0;border-bottom:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b style="font-size:13.5px">${esc(label)}</b> ${adminVerPill(st)}
          ${url?` · <a href="${esc(url)}" target="_blank" rel="noopener" style="font-size:12.5px;color:var(--green-d)">View document</a>`
                :` · <span style="font-size:12px;color:var(--muted)">no document on file</span>`}</div>
      </div>
      ${priorFail(k)&&st!=='failed'?`<p style="font-size:12px;color:var(--danger);margin:6px 2px 0"><b>⚠ This check was failed on a previous submission.</b> Check the review history below before passing it.</p>`:''}
      ${k==='background_check'?H`<div style="display:flex;gap:6px;margin-top:8px">
        <input id="prov_${k}" placeholder="Provider (e.g. Checkr)" value="${esc(v.provider||'')}" style="flex:1;min-width:0"/>
        <input id="ref_${k}" placeholder="Report ID" value="${esc(v.external_ref||'')}" style="flex:1;min-width:0"/>
      </div>`:''}
      ${needsExp?H`<div class="field" style="margin-top:8px;margin-bottom:0">
        <label>Expires${k==='background_check'?' (re-screen by)':''}</label>
        <input type="date" id="exp_${k}" value="${esc(expVal)}"/>
      </div>`:''}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn sm ${st==='passed'?'':'ghost'}" data-vpass="${k}">Pass</button>
        <button class="btn sm ${st==='failed'?'danger':'ghost'}" data-vfail="${k}">Fail</button>
        <button class="btn sm ghost" data-vreset="${k}">Reset</button>
      </div></div>`; };

  root.innerHTML = H`<div class="app-pad" style="padding-top:22px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <button class="pill" id="back">‹ Queue</button>${adminStatusPill(prof.status)}
    </div>
    <h1 style="font-size:22px;margin:0 0 2px">${esc(prof.display_name||'(no name)')}</h1>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px">${esc([prof.city,prof.region,prof.postal_code].filter(Boolean).join(', ')||'—')} · applied ${adminFmt(prof.submitted_at)}</p>

    <div class="sec-title">Profile</div>
    <div class="card app-pad">
      <div class="mrow"><span>Legal name</span><b>${esc(prof.legal_name||'—')}</b></div>
      <div class="mrow"><span>Experience</span><b>${prof.years_experience!=null?esc(prof.years_experience)+' yrs':'—'}</b></div>
      <div class="mrow"><span>Rate</span><b>${prof.base_rate_cents!=null?'$'+(prof.base_rate_cents/100):'—'}${prof.base_rate_cents!=null?'/hr':''}</b></div>
      <div class="mrow"><span>Radius / virtual</span><b>${prof.service_radius_km!=null?esc(prof.service_radius_km)+' mi':'—'}${prof.offers_virtual?' · virtual':''}</b></div>
      ${prof.headline?`<div class="mrow"><span>Headline</span><b style="max-width:60%;text-align:right">${esc(prof.headline)}</b></div>`:''}
      ${prof.bio?`<p style="font-size:13px;color:var(--ink);margin:10px 0 0;line-height:1.5">${esc(prof.bio)}</p>`:''}
    </div>

    <div class="sec-title">Sports</div>
    <div class="card app-pad">
      ${sports.length? sports.map(s=>H`<div class="mrow"><span>${esc(sportName(s.sport_key))}</span><b>${esc([s.specialty,(s.years!=null?s.years+' yrs':'')].filter(Boolean).join(' · ')||'—')}</b></div>`).join('')
        : `<div class="empty">None listed.</div>`}
    </div>

    <div class="sec-title">Credentials</div>
    <div class="card app-pad">
      ${creds.length? creds.map(c=>H`<div class="mrow"><span>${esc(c.name)}${c.issuer?' · '+esc(c.issuer):''}</span>
        ${docUrls['cred_'+c.id]?`<a href="${esc(docUrls['cred_'+c.id])}" target="_blank" rel="noopener" class="btn sm ghost">View doc</a>`:'<b style="color:var(--muted)">no file</b>'}</div>`).join('')
        : `<div class="empty">None uploaded.</div>`}
    </div>

    <div class="sec-title">Screening checks</div>
    <div class="card app-pad">${KIND.map(verRow).join('')}
      <p id="verErr" style="font-size:12px;color:var(--danger);margin:10px 2px 0;display:none"></p>
      <p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">All three must be <b>passed</b> and in date before this trainer can be approved — enforced by the database, not just here. A check with an expiry in the past unlists the trainer automatically.</p>
    </div>

    <div class="sec-title">Attestations</div>
    <div class="card app-pad">
      <div class="mrow"><span>Background consent</span><b>${att.background?'✓':'—'}</b></div>
      <div class="mrow"><span>SafeSport / conduct</span><b>${att.safesport?'✓':'—'}</b></div>
      <div class="mrow"><span>Accuracy</span><b>${att.accuracy?'✓':'—'}</b></div>
      <div class="mrow"><span>Terms</span><b>${att.terms?'✓':'—'}</b></div>
      ${att.accepted_at?`<div class="mrow"><span>Agreed</span><b>${adminFmt(att.accepted_at)}</b></div>`:''}
    </div>

    ${actions.length?H`<div class="sec-title">Review history</div>
    <div class="card app-pad">
      ${actions.map(a=>H`<div class="mrow"><span>${esc(a.action)}${a.note?' · '+esc(a.note):''}</span><b style="color:var(--muted)">${adminFmt(a.created_at)}</b></div>`).join('')}
    </div>`:''}

    <div class="sec-title">Decision</div>
    <div class="card app-pad" style="display:grid;gap:10px">
      ${prof.status==='approved'
        ? `<button class="btn danger" id="suspend">Suspend profile</button>`
        : prof.status==='suspended'
          ? `<button class="btn" id="reinstate">Reinstate (approve)</button>`
          : H`<button class="btn" id="approve" ${allPassed?'':'disabled style="opacity:.5"'}>Approve trainer</button>
             <button class="btn amber" id="needinfo">Request more info</button>
             <button class="btn danger ghost" id="reject">Reject</button>`}
    </div>
    ${(!allPassed && !['approved','suspended'].includes(prof.status))?`<p class="muted-note">Approve unlocks once all three screening checks are passed.</p>`:''}
  </div>`;

  $("#back").onclick=openAdminQueue;
  root.querySelectorAll('[data-vpass]').forEach(b=>b.onclick=()=>adminSetVerification(id,b.dataset.vpass,'passed'));
  root.querySelectorAll('[data-vfail]').forEach(b=>b.onclick=()=>adminSetVerification(id,b.dataset.vfail,'failed'));
  root.querySelectorAll('[data-vreset]').forEach(b=>b.onclick=()=>adminSetVerification(id,b.dataset.vreset,'pending'));
  { const el=$("#approve"); if(el&&allPassed) el.onclick=()=>adminApprove(id); }
  { const el=$("#needinfo"); if(el) el.onclick=()=>adminNote(id,'needs_info','Request more info','What does the trainer need to fix or provide?'); }
  { const el=$("#reject"); if(el) el.onclick=()=>adminNote(id,'rejected','Reject application','Optional reason (kept internal).',true); }
  { const el=$("#suspend"); if(el) el.onclick=()=>adminNote(id,'suspended','Suspend profile','Reason for suspension.',true); }
  { const el=$("#reinstate"); if(el) el.onclick=()=>adminReinstate(id); }
}

function adminVerPill(st){
  const map={ passed:['#E9F1EF','var(--good)','Passed'], failed:['#FBE9DC','var(--danger)','Failed'],
    pending:['var(--line)','var(--muted)','Pending'], submitted:['var(--line)','var(--ink)','Submitted'],
    not_started:['var(--line)','var(--muted)','—'] };
  const [bg,col,txt]=map[st]||map.not_started;
  return `<span class="pill" style="background:${bg};color:${col}">${txt}</span>`;
}

function verErr(msg){
  const el=document.getElementById('verErr'); if(!el) return toast(msg||'Could not update');
  el.textContent=msg||''; el.style.display=msg?'block':'none';
}

async function adminSetVerification(id,kind,status){
  verErr('');
  const patch={ status, reviewed_by:state.user.id };
  if(status==='passed'||status==='failed') patch.completed_at=new Date().toISOString();
  if(status==='passed'){
    // Carry the evidence in with the decision. The database refuses "passed"
    // without it, so sending the status alone would just bounce.
    const exp=document.getElementById('exp_'+kind);
    if(exp){
      if(!exp.value){ verErr('Set an expiry date before passing this check — a screening is a snapshot, not a permanent fact.'); return; }
      // noon local so the stored instant can't slip to the previous day
      patch.expires_at=new Date(exp.value+'T12:00:00').toISOString();
    }
    if(kind==='background_check'){
      const p=document.getElementById('prov_'+kind), rf=document.getElementById('ref_'+kind);
      patch.provider=(p&&p.value.trim())||null;
      patch.external_ref=(rf&&rf.value.trim())||null;
    }
  }
  // Verification rows only exist once the trainer submits. On a draft application this
  // update matches 0 rows and returns NO error — the screen used to re-render unchanged,
  // so the button looked broken. Ask for the affected rows back and say what happened.
  const { data, error }=await sb.from('trainer_verifications')
    .update(patch).eq('trainer_id',id).eq('kind',kind).select('id');
  // The guard in the database speaks in full sentences on purpose — show it
  // rather than a generic failure, because it says exactly what evidence is missing.
  if(error){ console.error(error); verErr(error.message||'Could not update'); return; }
  if(!data || !data.length){ verErr('No screening record yet — the trainer has to submit first'); return; }
  // Log it. `reviewed_by` on the row is overwritten by the next admin who touches it,
  // so without this there's no durable record of who cleared a child-safety check.
  await adminLog(id,'verification:'+kind+':'+status,null);
  adminReviewTrainer(id);
}

// A review decision the applicant never hears about stalls the queue and leaves them
// guessing. Best-effort on purpose: the decision is already committed, so a push that
// fails must not make the admin think the update didn't save.
async function notifyTrainerReview(id,kind){
  try{ await sb.functions.invoke('notify-trainer-review',{ body:{ trainer_id:id, kind } }); }
  catch(e){ console.error(e); }
}

async function adminLog(id,action,note){
  // This is the durable record of who cleared a child-safety check (B2). supabase-js
  // returns {error} rather than throwing, so a bare try/catch would let the audit trail
  // fail silently — which is the one way this record is worse than useless.
  const { error }=await sb.from('trainer_review_actions').insert({ trainer_id:id, admin_id:state.user.id, action, note:note||null });
  if(error){ console.error('admin log failed',error); reportError(error,'admin:log'); toast('Warning: this decision was not logged'); }
}

async function adminApprove(id){
  const now=new Date().toISOString();
  // review_note cleared: whatever we last asked them for, they're approved now.
  const { error }=await sb.from('trainer_profiles').update({ status:'approved', approved_at:now, approved_by:state.user.id, review_note:null, updated_at:now }).eq('id',id);
  // Approval is gated in the database on all three checks being passed and in
  // date, so this can fail for a real reason. Say which.
  if(error){ console.error(error); verErr(error.message||'Could not approve'); toast('Could not approve'); return; }
  await adminLog(id,'approved',null);
  await notifyTrainerReview(id,'approved');
  toast('Trainer approved ✅');
  adminReviewTrainer(id);
}
async function adminReinstate(id){
  const now=new Date().toISOString();
  const { error }=await sb.from('trainer_profiles').update({ status:'approved', suspended_reason:null, review_note:null, updated_at:now }).eq('id',id);
  if(error){ console.error(error); toast('Could not reinstate'); return; }
  await adminLog(id,'reinstated',null);
  await notifyTrainerReview(id,'reinstated');
  toast('Reinstated');
  adminReviewTrainer(id);
}

// note/confirm dialog for needs_info / rejected / suspended
function adminNote(id,status,title,placeholder,danger){
  const bg=sheet(H`<h3>${esc(title)}</h3>
    <div class="field" style="margin-top:10px"><label>Note ${status==='needs_info'?'(sent context, internal)':'(optional)'}</label>
      <textarea id="anote" rows="3" placeholder="${esc(placeholder)}"></textarea></div>
    <button class="btn ${danger?'danger':'amber'}" id="ok">Confirm</button>
    <button class="btn ghost" id="cancel" style="margin-top:8px">Cancel</button>`);
  bg.querySelector('#cancel').onclick=()=>bg.remove();
  bg.querySelector('#ok').onclick=async(e)=>{
    const note=bg.querySelector('#anote').value.trim();
    if(status==='needs_info'&&!note){ toast('Add a note so they know what to fix'); return; }
    e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled=true;
    const patch={ status, updated_at:new Date().toISOString() };
    if(status==='suspended') patch.suspended_reason=note||null;
    // ONLY a needs_info note goes where the trainer can read it. This dialog promises the
    // admin that a rejection or suspension reason is "kept internal" — that reason lives in
    // trainer_review_actions (admin-only) and suspended_reason. Writing it to review_note
    // showed it to the rejected applicant under the heading "What we need from you".
    // Cleared on every other status so a stale request can't outlive what prompted it.
    patch.review_note = (status==='needs_info') ? (note||null) : null;
    const { error }=await sb.from('trainer_profiles').update(patch).eq('id',id);
    if(error){ console.error(error); toast('Could not update'); e.target.innerHTML='Confirm'; e.target.disabled=false; return; }
    await adminLog(id,status,note);
    await notifyTrainerReview(id,status);
    bg.remove(); toast('Saved'); adminReviewTrainer(id);
  };
}
