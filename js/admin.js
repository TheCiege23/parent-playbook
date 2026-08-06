// ===================================================================
//  ADMIN — Pro Trainer review queue (admins only)
//  Gated by app_admins RLS: non-admins can't read the data or reach here.
//  Approving a trainer requires all three screening checks marked passed.
// ===================================================================
let adminFilter = 'pending'; // 'pending' | 'all'
const ADMIN_PENDING = ['submitted','in_review','needs_info'];

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
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading queue…</div></div>`;
  let rows=[];
  try{
    let q=sb.from('trainer_profiles').select('id,display_name,city,region,status,submitted_at').order('submitted_at',{ascending:true,nullsFirst:false});
    if(adminFilter==='pending') q=q.in('status',ADMIN_PENDING);
    const { data, error }=await q;
    if(error) throw error; rows=data||[];
  }catch(err){ console.error(err); return bootError(); }
  const pendingCount = rows.filter(r=>ADMIN_PENDING.includes(r.status)).length;
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h1 style="font-size:22px">Trainer review</h1>
      <button class="pill" id="adminDone">Done</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">${adminFilter==='pending'?`${rows.length} awaiting review`:`${pendingCount} pending · ${rows.length} total`}</p>
    <div class="chipgrid" id="afilter" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
      <div class="chip ${adminFilter==='pending'?'on':''}" data-f="pending">Pending</div>
      <div class="chip ${adminFilter==='all'?'on':''}" data-f="all">All</div>
    </div>
    ${rows.length? rows.map(r=>H`
      <button class="card app-pad" data-id="${esc(r.id)}" style="width:100%;text-align:left;display:block;margin-bottom:10px;border:none;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0">
            <b style="font-size:15px">${esc(r.display_name||'(no name)')}</b>
            <div style="color:var(--muted);font-size:12.5px;margin-top:2px">${esc([r.city,r.region].filter(Boolean).join(', ')||'—')} · applied ${adminFmt(r.submitted_at)}</div>
          </div>
          ${adminStatusPill(r.status)}
        </div>
      </button>`).join('')
      : `<div class="card app-pad"><div class="empty">${adminFilter==='pending'?'Nothing awaiting review. 🎉':'No trainer applications yet.'}</div></div>`}
  </div>`;
  $("#adminDone").onclick=()=>renderApp('profile');
  $("#afilter").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{ adminFilter=c.dataset.f; openAdminQueue(); });
  root.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>adminReviewTrainer(b.dataset.id));
}

async function adminSignDoc(path){
  if(!path) return null;
  try{ const { data }=await sb.storage.from('trainer-verification-docs').createSignedUrl(path,3600); return data?.signedUrl||null; }
  catch(err){ console.error(err); return null; }
}

// ---- single application detail ----
async function adminReviewTrainer(id){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
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
  }catch(err){ console.error(err); return bootError(); }
  if(!prof){ toast('Not found'); return openAdminQueue(); }

  // sign private docs
  const docUrls={};
  for(const c of creds){ if(c.doc_path) docUrls['cred_'+c.id]=await adminSignDoc(c.doc_path); }
  const idVer=vers.find(v=>v.kind==='identity');
  const idUrl = idVer?.doc_path ? await adminSignDoc(idVer.doc_path) : null;

  const sportName=k=>state.ref?.sports.find(x=>x.key===k)?.name||k;
  const KIND=[['identity','Identity'],['background_check','Background check'],['safesport','SafeSport training']];
  const vstatus=k=>(vers.find(v=>v.kind===k)?.status)||'not_started';
  const allPassed=KIND.every(([k])=>vstatus(k)==='passed');
  const att=prof.attestations||{};

  const verRow=([k,label])=>{ const st=vstatus(k);
    const pill=adminVerPill(st);
    return H`<div style="padding:10px 0;border-bottom:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b style="font-size:13.5px">${esc(label)}</b> ${pill}
          ${k==='identity'&&idUrl?` · <a href="${esc(idUrl)}" target="_blank" rel="noopener" style="font-size:12.5px;color:var(--green)">View ID</a>`:''}</div>
      </div>
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
      <p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">All three must be marked <b>passed</b> before this trainer can be approved.</p>
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

async function adminSetVerification(id,kind,status){
  const patch={ status, reviewed_by:state.user.id };
  if(status==='passed'||status==='failed') patch.completed_at=new Date().toISOString();
  const { error }=await sb.from('trainer_verifications').update(patch).eq('trainer_id',id).eq('kind',kind);
  if(error){ console.error(error); toast('Could not update'); return; }
  adminReviewTrainer(id);
}

async function adminLog(id,action,note){
  try{ await sb.from('trainer_review_actions').insert({ trainer_id:id, admin_id:state.user.id, action, note:note||null }); }
  catch(err){ console.error(err); }
}

async function adminApprove(id){
  const now=new Date().toISOString();
  const { error }=await sb.from('trainer_profiles').update({ status:'approved', approved_at:now, approved_by:state.user.id, updated_at:now }).eq('id',id);
  if(error){ console.error(error); toast('Could not approve'); return; }
  await adminLog(id,'approved',null);
  toast('Trainer approved ✅');
  adminReviewTrainer(id);
}
async function adminReinstate(id){
  const now=new Date().toISOString();
  const { error }=await sb.from('trainer_profiles').update({ status:'approved', suspended_reason:null, updated_at:now }).eq('id',id);
  if(error){ console.error(error); toast('Could not reinstate'); return; }
  await adminLog(id,'reinstated',null);
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
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const patch={ status, updated_at:new Date().toISOString() };
    if(status==='suspended') patch.suspended_reason=note||null;
    const { error }=await sb.from('trainer_profiles').update(patch).eq('id',id);
    if(error){ console.error(error); toast('Could not update'); e.target.innerHTML='Confirm'; e.target.disabled=false; return; }
    await adminLog(id,status,note);
    bg.remove(); toast('Saved'); adminReviewTrainer(id);
  };
}
