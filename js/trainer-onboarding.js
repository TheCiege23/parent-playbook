// ===================================================================
//  PRO TRAINER — application / onboarding flow
//  A trainer is a logged-in user who applies to sell services to parents.
//  Nothing here lists them publicly — an admin approves first. This flow
//  only collects the profile + credentials + safety attestations and
//  submits the application for review.
// ===================================================================
const tr = {
  i:0,
  profile:{ display_name:'', legal_name:'', city:'', region:'', postal_code:'',
            years_experience:'', service_radius_km:'', offers_virtual:false,
            base_rate:'', headline:'', bio:'' },
  sports:[],        // [{sport_key, specialty, years}]
  credentials:[],   // [{name, issuer, credential_number, issued_on, expires_on, file, existing_doc}]
  idFile:null,
  attest:{},
};
function trReset(){
  tr.i=0;
  tr.profile={ display_name:'', legal_name:'', city:'', region:'', postal_code:'',
               years_experience:'', service_radius_km:'', offers_virtual:false,
               base_rate:'', headline:'', bio:'' };
  tr.sports=[]; tr.credentials=[]; tr.idFile=null; tr.attest={};
}
const TR_STEPS = ['intro','about','sports','credentials','review'];
const TR_ATTEST = [
  {key:'background', req:true,  label:"I consent to a background check — including national criminal and sex-offender registry screening — as a condition of being listed."},
  {key:'safesport', req:true,  label:"I agree to complete SafeSport-style abuse-prevention training and to follow the code of conduct for working with minors."},
  {key:'accuracy',  req:true,  label:"Everything I've provided is accurate, and I understand my profile stays hidden until an admin approves it."},
  {key:'terms',     req:true,  label:"I agree to the Pro Trainer Terms and the independent-contractor agreement."},
];

// ---- entry point (from the Profile screen card) ----
async function startTrainerOnboarding(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Opening…</div></div>`;
  try{ await loadRef(); }catch(err){ console.error(err); return bootError(); }
  let prof=null;
  try{ const { data }=await sb.from('trainer_profiles').select('*').eq('id',state.user.id).maybeSingle(); prof=data; }
  catch(err){ console.error(err); return bootError(); }
  // Already under review / approved / suspended → show status, not the form.
  if(prof && ['in_review','approved','suspended'].includes(prof.status)) return trainerStatusScreen(prof);
  trReset();
  if(prof){
    Object.assign(tr.profile,{
      display_name:prof.display_name||'', legal_name:prof.legal_name||'',
      city:prof.city||'', region:prof.region||'', postal_code:prof.postal_code||'',
      years_experience:prof.years_experience??'', service_radius_km:prof.service_radius_km??'',
      offers_virtual:!!prof.offers_virtual, headline:prof.headline||'', bio:prof.bio||'',
      base_rate: prof.base_rate_cents? (prof.base_rate_cents/100) : '' });
    try{
      const { data:ts }=await sb.from('trainer_sports').select('*').eq('trainer_id',state.user.id);
      tr.sports=(ts||[]).map(s=>({sport_key:s.sport_key, specialty:s.specialty||'', years:s.years??''}));
      const { data:tc }=await sb.from('trainer_credentials').select('*').eq('trainer_id',state.user.id);
      tr.credentials=(tc||[]).map(c=>({name:c.name, issuer:c.issuer||'', credential_number:c.credential_number||'',
        issued_on:c.issued_on||'', expires_on:c.expires_on||'', file:null, existing_doc:c.doc_path||null}));
    }catch(err){ console.error(err); }
  }
  trStep();
}

function trStep(){
  const name=TR_STEPS[tr.i];
  const dots=TR_STEPS.map((_,k)=>`<i class="${k<=tr.i?'on':''}"></i>`).join('');
  const inner=({intro:trIntro,about:trAbout,sports:trSports,credentials:trCredentials,review:trReview})[name]();
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div class="steps">${dots}</div>
    ${inner}
  </div>`;
  ({intro:trIntroBind,about:trAboutBind,sports:trSportsBind,credentials:trCredentialsBind,review:trReviewBind})[name]();
}
function trNext(){ if(tr.i<TR_STEPS.length-1){ tr.i++; trStep(); } }
function trBack(){ if(tr.i>0){ tr.i--; trStep(); } else { renderApp('profile'); } }

// ---- step: intro ----
function trIntro(){ return H`
  <div class="ob-head"><div class="k">Pro Trainer</div><h2>Coach families on Parent Playbook</h2>
  <p>Set up a verified trainer profile and let parents book you for their young athletes — across any sport, boys and girls.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Trust is the whole thing</h4>
    <p>Because you'll be working with children, every trainer is screened — identity, a background check, and SafeSport-style training — and stays hidden until we approve you. Parents see a verified badge, never your documents.</p></div></div>
  <div class="card app-pad" style="margin-top:6px">
    <div class="grow"><div class="gi">🛡️</div><div class="gt"><b>Get verified once</b><span>ID, background check, and safety training.</span></div></div>
    <div class="grow"><div class="gi">📣</div><div class="gt"><b>List your services</b><span>Private sessions, small groups, in-person or virtual.</span></div></div>
    <div class="grow"><div class="gi">💵</div><div class="gt"><b>Get paid securely</b><span>Parents book and pay in-app; payouts to you.</span></div></div>
  </div>
  <p class="muted-note">Takes about 5 minutes. You can save and finish later.</p>
  <div class="row2" style="margin-top:14px">
    <button class="btn ghost" id="b">Not now</button><button class="btn" id="n">Start application</button>
  </div>`; }
function trIntroBind(){ $("#b").onclick=()=>renderApp('profile'); $("#n").onclick=trNext; }

// ---- step: about you ----
function trAbout(){ const p=tr.profile; return H`
  <div class="ob-head"><div class="k">About you</div><h2>Tell parents who you are</h2>
  <p>Your public profile, plus a few details we use only for screening.</p></div>
  <div class="field"><label>Display name (public)</label><input id="dn" placeholder="Coach Marcus" value="${esc(p.display_name)}"/></div>
  <div class="field"><label>Full legal name (private, for screening)</label><input id="ln" placeholder="Marcus J. Henson" value="${esc(p.legal_name)}"/></div>
  <div class="row2">
    <div class="field"><label>City</label><input id="city" placeholder="Atlanta" value="${esc(p.city)}"/></div>
    <div class="field"><label>State / region</label><input id="region" placeholder="GA" value="${esc(p.region)}"/></div>
  </div>
  <div class="row2">
    <div class="field"><label>ZIP / postal</label><input id="zip" placeholder="30301" value="${esc(p.postal_code)}"/></div>
    <div class="field"><label>Years coaching</label><input id="yrs" type="number" inputmode="numeric" placeholder="5" value="${esc(p.years_experience)}"/></div>
  </div>
  <div class="row2">
    <div class="field"><label>Travel radius (mi)</label><input id="rad" type="number" inputmode="numeric" placeholder="20" value="${esc(p.service_radius_km)}"/></div>
    <div class="field"><label>Base rate ($/hr)</label><input id="rate" type="number" inputmode="decimal" placeholder="40" value="${esc(p.base_rate)}"/></div>
  </div>
  <div class="field"><label>Also offer virtual sessions?</label>
    <div class="chipgrid" id="virt" style="grid-template-columns:1fr 1fr">
      <div class="chip ${p.offers_virtual?'on':''}" data-v="1">Yes, virtual too</div>
      <div class="chip ${!p.offers_virtual?'on':''}" data-v="0">In-person only</div>
    </div></div>
  <div class="field"><label>Headline</label><input id="hl" maxlength="80" placeholder="Speed & agility for ages 8–14" value="${esc(p.headline)}"/></div>
  <div class="field"><label>About your coaching</label><textarea id="bio" rows="4" placeholder="Your approach, experience, and what parents can expect.">${esc(p.bio)}</textarea></div>
  <div class="err" id="trerr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`; }
function trAboutBind(){
  $("#b").onclick=trBack;
  $("#virt").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    tr.profile.offers_virtual = c.dataset.v==='1';
    $("#virt").querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
  });
  $("#n").onclick=()=>{
    const p=tr.profile;
    p.display_name=$("#dn").value.trim(); p.legal_name=$("#ln").value.trim();
    p.city=$("#city").value.trim(); p.region=$("#region").value.trim(); p.postal_code=$("#zip").value.trim();
    p.years_experience=$("#yrs").value.trim(); p.service_radius_km=$("#rad").value.trim();
    p.base_rate=$("#rate").value.trim(); p.headline=$("#hl").value.trim(); p.bio=$("#bio").value.trim();
    const e=$("#trerr");
    if(!p.display_name){ e.textContent="Add a display name parents will see."; return; }
    if(!p.legal_name){ e.textContent="Your full legal name is required for screening."; return; }
    if(!p.city){ e.textContent="Add your city."; return; }
    trNext();
  };
}

// ---- step: sports & specialties ----
function trSports(){
  const sports=state.ref.sports;
  const picked=k=>tr.sports.some(s=>s.sport_key===k);
  return H`
  <div class="ob-head"><div class="k">Your sports</div><h2>What do you coach?</h2>
  <p>Pick every sport you train — add a specialty for each if you like.</p></div>
  <div class="field"><label>Sports</label>
    <div class="chipgrid" id="trsports">
      ${sports.map(s=>`<div class="chip ${picked(s.key)?'on':''}" data-s="${s.key}">${esc(s.name)}</div>`).join('')}
    </div></div>
  ${tr.sports.length?H`<div class="card app-pad">
    ${tr.sports.map(s=>{const nm=sports.find(x=>x.key===s.sport_key)?.name||s.sport_key; return H`
      <div style="margin-bottom:10px">
        <div class="sec-title" style="margin:2px 0 6px">${esc(nm)}</div>
        <div class="row2">
          <input class="tr-spec" data-k="${esc(s.sport_key)}" placeholder="Specialty (optional)" value="${esc(s.specialty)}" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/>
          <input class="tr-yrs" data-k="${esc(s.sport_key)}" type="number" inputmode="numeric" placeholder="Years" value="${esc(s.years)}" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/>
        </div>
      </div>`;}).join('')}
  </div>`:''}
  <div class="err" id="trerr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`;
}
function trSportsBind(){
  $("#b").onclick=trBack;
  $("#trsports").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    const k=c.dataset.s, i=tr.sports.findIndex(s=>s.sport_key===k);
    if(i>=0) tr.sports.splice(i,1); else tr.sports.push({sport_key:k, specialty:'', years:''});
    trStep();
  });
  document.querySelectorAll('.tr-spec').forEach(el=>el.oninput=()=>{ const s=tr.sports.find(x=>x.sport_key===el.dataset.k); if(s) s.specialty=el.value; });
  document.querySelectorAll('.tr-yrs').forEach(el=>el.oninput=()=>{ const s=tr.sports.find(x=>x.sport_key===el.dataset.k); if(s) s.years=el.value; });
  $("#n").onclick=()=>{ if(!tr.sports.length){ $("#trerr").textContent="Pick at least one sport."; return; } trNext(); };
}

// ---- step: credentials (with optional doc upload) ----
function trCredentials(){ return H`
  <div class="ob-head"><div class="k">Credentials</div><h2>Certifications & training</h2>
  <p>Add any coaching certs, CPR/First Aid, or SafeSport completion. Attach a file where you can — it speeds up review.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Private by default</h4>
    <p>Documents you upload here are visible only to you and our review team — never to parents.</p></div></div>
  <div id="credlist">
    ${tr.credentials.length? tr.credentials.map((c,idx)=>trCredCard(c,idx)).join('')
      : `<div class="card app-pad"><div class="empty">No credentials added yet. You can add them now or after applying.</div></div>`}
  </div>
  <button class="btn ghost" id="addCred" style="margin-top:10px">＋ Add a credential</button>
  <div class="err" id="trerr"></div>
  <div class="row2" style="margin-top:14px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`; }
function trCredCard(c,idx){ return H`
  <div class="card app-pad" style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="sec-title" style="margin:0 0 8px">Credential ${idx+1}</div>
      <button class="btn sm ghost" data-rm="${idx}">Remove</button>
    </div>
    <div class="field"><label>Name</label><input class="c-name" data-i="${idx}" placeholder="USA Football Certified Coach" value="${esc(c.name)}"/></div>
    <div class="row2">
      <div class="field"><label>Issuer</label><input class="c-iss" data-i="${idx}" placeholder="USA Football" value="${esc(c.issuer)}"/></div>
      <div class="field"><label>ID # (optional)</label><input class="c-num" data-i="${idx}" placeholder="—" value="${esc(c.credential_number)}"/></div>
    </div>
    <div class="row2">
      <div class="field"><label>Issued</label><input class="c-iss-on" data-i="${idx}" type="date" value="${esc(c.issued_on)}"/></div>
      <div class="field"><label>Expires (optional)</label><input class="c-exp" data-i="${idx}" type="date" value="${esc(c.expires_on)}"/></div>
    </div>
    <div class="field"><label>Document (PDF or image)</label><input class="c-file" data-i="${idx}" type="file" accept="image/*,application/pdf"/>
      ${c.existing_doc?`<p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">A file is already on record — upload again only to replace it.</p>`:''}
    </div>
  </div>`; }
function trCredentialsBind(){
  $("#b").onclick=trBack;
  const syncText=()=>{
    document.querySelectorAll('.c-name').forEach(el=>tr.credentials[+el.dataset.i].name=el.value);
    document.querySelectorAll('.c-iss').forEach(el=>tr.credentials[+el.dataset.i].issuer=el.value);
    document.querySelectorAll('.c-num').forEach(el=>tr.credentials[+el.dataset.i].credential_number=el.value);
    document.querySelectorAll('.c-iss-on').forEach(el=>tr.credentials[+el.dataset.i].issued_on=el.value);
    document.querySelectorAll('.c-exp').forEach(el=>tr.credentials[+el.dataset.i].expires_on=el.value);
  };
  document.querySelectorAll('.c-name,.c-iss,.c-num,.c-iss-on,.c-exp').forEach(el=>el.oninput=syncText);
  document.querySelectorAll('.c-file').forEach(el=>el.onchange=()=>{ const f=el.files[0]; if(!f) return;
    if(f.size>25*1024*1024){ toast('File is over 25 MB — use a smaller one'); el.value=''; return; }
    tr.credentials[+el.dataset.i].file=f; });
  document.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ syncText(); tr.credentials.splice(+b.dataset.rm,1); trStep(); });
  $("#addCred").onclick=()=>{ syncText(); tr.credentials.push({name:'',issuer:'',credential_number:'',issued_on:'',expires_on:'',file:null,existing_doc:null}); trStep(); };
  $("#n").onclick=()=>{ syncText();
    const bad=tr.credentials.find(c=>!c.name.trim());
    if(bad){ $("#trerr").textContent="Give each credential a name, or remove the empty one."; return; }
    trNext();
  };
}

// ---- step: review + attestations + submit ----
function trReview(){ const p=tr.profile;
  const sportNames=tr.sports.map(s=>state.ref.sports.find(x=>x.key===s.sport_key)?.name||s.sport_key).join(', ');
  return H`
  <div class="ob-head"><div class="k">Review & submit</div><h2>One last check</h2>
  <p>Confirm your details and agree to the safety requirements.</p></div>
  <div class="card app-pad">
    <div class="mrow"><span>Display name</span><b>${esc(p.display_name||'—')}</b></div>
    <div class="mrow"><span>Location</span><b>${esc([p.city,p.region].filter(Boolean).join(', ')||'—')}</b></div>
    <div class="mrow"><span>Sports</span><b>${esc(sportNames||'—')}</b></div>
    <div class="mrow"><span>Credentials</span><b>${tr.credentials.length}</b></div>
    <div class="mrow"><span>Rate</span><b>${p.base_rate?('$'+esc(p.base_rate)+'/hr'):'—'}</b></div>
  </div>
  <div class="field" style="margin-top:14px"><label>Photo ID for verification (optional now)</label>
    <input id="idfile" type="file" accept="image/*,application/pdf"/>
    <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Government ID, private to the review team. You can also add it later.</p>
  </div>
  <div class="sec-title">Safety agreements</div>
  <div class="card app-pad">
    ${TR_ATTEST.map(a=>H`
      <label style="display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" data-a="${a.key}" style="width:20px;height:20px;margin-top:1px;flex:0 0 auto"/>
        <span style="font-size:13.5px;line-height:1.45">${esc(a.label)} <b style="color:var(--danger)">*</b></span>
      </label>`).join('')}
  </div>
  <div class="err" id="trerr"></div>
  <div class="row2" style="margin-top:16px">
    <button class="btn ghost" id="b">Back</button><button class="btn amber" id="n">Submit application</button>
  </div>
  <p class="muted-note">Submitting sends your application for review. Your profile stays hidden until an admin approves it.</p>`;
}
function trReviewBind(){
  $("#b").onclick=trBack;
  $("#idfile").onchange=e=>{ const f=e.target.files[0]; if(!f) return;
    if(f.size>25*1024*1024){ toast('File is over 25 MB — use a smaller one'); e.target.value=''; return; }
    tr.idFile=f; };
  document.querySelectorAll('input[data-a]').forEach(x=>x.onchange=()=>tr.attest[x.dataset.a]=x.checked);
  $("#n").onclick=submitTrainerApplication;
}

async function uploadTrainerDoc(prefix,file){
  const ext=(file.name.split('.').pop()||'').toLowerCase().replace(/[^a-z0-9]/g,'')||'pdf';
  const path=`${state.user.id}/${prefix}_${uuid()}.${ext}`;
  const up=await sb.storage.from('trainer-verification-docs').upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(up.error) throw up.error;
  return path;
}

async function submitTrainerApplication(e){
  const errEl=$("#trerr"); errEl.textContent="";
  const missing=TR_ATTEST.filter(a=>a.req && !tr.attest[a.key]);
  if(missing.length){ errEl.textContent="Please agree to all four safety requirements."; return; }
  const btn=e.target; const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
  const uid=state.user.id;
  try{
    // 1. profile (submitted). upsert so a returning applicant resubmits cleanly.
    const p=tr.profile;
    const profRow={ id:uid, status:'submitted', submitted_at:new Date().toISOString(),
      display_name:p.display_name, legal_name:p.legal_name,
      city:p.city||null, region:p.region||null, postal_code:p.postal_code||null,
      years_experience:p.years_experience?parseInt(p.years_experience,10):null,
      service_radius_km:p.service_radius_km?parseInt(p.service_radius_km,10):null,
      offers_virtual:!!p.offers_virtual,
      base_rate_cents:p.base_rate?Math.round(parseFloat(p.base_rate)*100):null,
      headline:p.headline||null, bio:p.bio||null,
      attestations:{ ...tr.attest, accepted_at:new Date().toISOString() },
      updated_at:new Date().toISOString() };
    const { error:pe }=await sb.from('trainer_profiles').upsert(profRow,{ onConflict:'id' });
    if(pe) throw pe;

    // 2. sports — replace set
    await sb.from('trainer_sports').delete().eq('trainer_id',uid);
    if(tr.sports.length){
      const rows=tr.sports.map(s=>({ trainer_id:uid, sport_key:s.sport_key,
        specialty:(s.specialty||'').trim()||null, years:s.years?parseInt(s.years,10):null }));
      const { error:se }=await sb.from('trainer_sports').insert(rows); if(se) throw se;
    }

    // 3. credentials — replace set (uploading any new files first)
    await sb.from('trainer_credentials').delete().eq('trainer_id',uid);
    for(const c of tr.credentials){
      if(!c.name.trim()) continue;
      let doc_path=c.existing_doc||null;
      if(c.file){ btn.innerHTML='<span class="spinner"></span> Uploading…'; doc_path=await uploadTrainerDoc('cred',c.file); }
      const { error:ce }=await sb.from('trainer_credentials').insert({ trainer_id:uid, name:c.name.trim(),
        issuer:(c.issuer||'').trim()||null, credential_number:(c.credential_number||'').trim()||null,
        issued_on:c.issued_on||null, expires_on:c.expires_on||null, doc_path, status:'submitted' });
      if(ce) throw ce;
    }

    // 4. verification placeholders (identity / background / safesport)
    let idPath=null;
    if(tr.idFile){ btn.innerHTML='<span class="spinner"></span> Uploading…'; idPath=await uploadTrainerDoc('id',tr.idFile); }
    await sb.from('trainer_verifications').delete().eq('trainer_id',uid).in('kind',['identity','background_check','safesport']);
    const now=new Date().toISOString();
    const checks=[
      { trainer_id:uid, kind:'identity',        status:idPath?'submitted':'pending', doc_path:idPath, submitted_at:now },
      { trainer_id:uid, kind:'background_check', status:'pending', submitted_at:now },
      { trainer_id:uid, kind:'safesport',        status:'pending', submitted_at:now },
    ];
    const { error:ve }=await sb.from('trainer_verifications').insert(checks); if(ve) throw ve;

    toast('Application submitted 🎉');
    trainerStatusScreen({ status:'submitted' });
  }catch(err){
    console.error(err);
    errEl.textContent="Could not submit. "+(err.message||''); btn.innerHTML=label; btn.disabled=false;
  }
}

// ---- post-submit status screen ----
const TR_STATUS_COPY={
  draft:      { t:'Application in progress', s:'Pick up where you left off to finish and submit.', ic:'📝' },
  submitted:  { t:'Application submitted', s:"Thanks! Our team will review your details and screening. We'll be in touch — this usually takes a few days.", ic:'⏳' },
  in_review:  { t:'Under review', s:"We're verifying your credentials and background check now. Hang tight.", ic:'🔎' },
  needs_info: { t:'A little more needed', s:'We need something updated before we can approve you. Edit your application and resubmit.', ic:'✏️' },
  approved:   { t:"You're approved 🎉", s:'Your trainer profile is live. Next: set up your services and payouts.', ic:'✅' },
  suspended:  { t:'Profile paused', s:'Your profile is temporarily unlisted. Reach out to support for details.', ic:'⏸️' },
  rejected:   { t:'Not approved', s:'We were unable to approve this application at this time.', ic:'🚫' },
};
async function trainerStatusScreen(prof){
  document.body.classList.remove('auth'); setAppBg();
  if(!prof || !prof.status){
    root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
    try{ const { data }=await sb.from('trainer_profiles').select('*').eq('id',state.user.id).maybeSingle(); prof=data; }
    catch(err){ console.error(err); return bootError(); }
  }
  if(!prof){ return startTrainerOnboarding(); }
  const c=TR_STATUS_COPY[prof.status]||TR_STATUS_COPY.submitted;
  let checks=[];
  try{ const { data }=await sb.from('trainer_verifications').select('kind,status').eq('trainer_id',state.user.id); checks=data||[]; }catch(err){ console.error(err); }
  const KIND_LABEL={identity:'Identity',background_check:'Background check',safesport:'SafeSport training'};
  const badge=st=>{ const ok=st==='passed'; const bad=st==='failed'; const col=ok?'var(--good)':bad?'var(--danger)':'var(--muted)';
    const bg=ok?'#E9F1EF':bad?'#FBE9DC':'var(--line)'; const txt=ok?'Passed':bad?'Action needed':(st==='submitted'?'Submitted':'Pending');
    return `<span class="pill" style="background:${bg};color:${col}">${txt}</span>`; };
  const canEdit=['draft','submitted','needs_info'].includes(prof.status);
  root.innerHTML = H`<div class="app-pad" style="padding-top:40px">
    <div style="text-align:center;margin-bottom:18px">
      <div class="avatar" style="width:60px;height:60px;border-radius:18px;font-size:28px;margin:0 auto 14px">${c.ic}</div>
      <h1 style="font-size:24px">${esc(c.t)}</h1>
      <p style="color:var(--muted);margin:8px auto 0;max-width:340px;line-height:1.5">${esc(c.s)}</p>
    </div>
    <div class="sec-title">Verification checklist</div>
    <div class="card app-pad">
      ${['identity','background_check','safesport'].map(k=>{ const v=checks.find(x=>x.kind===k);
        return H`<div class="mrow"><span>${esc(KIND_LABEL[k])}</span>${badge(v?v.status:'not_started')}</div>`; }).join('')}
    </div>
    <div style="margin-top:18px;display:grid;gap:10px">
      ${prof.status==='approved'?`<button class="btn" id="svcs">Manage my services</button><button class="btn ghost" id="bkgs">Booking requests</button><button class="btn ghost" id="payout">Set up / manage payouts</button>`:''}
      ${canEdit?`<button class="btn" id="edit">Edit & resubmit</button>`:''}
      <button class="btn ghost" id="done">Back to app</button>
    </div>
  </div>`;
  { const el=$("#svcs"); if(el) el.onclick=openTrainerServices; }
  { const el=$("#bkgs"); if(el) el.onclick=openTrainerBookings; }
  { const el=$("#payout"); if(el) el.onclick=startPayout; }
  const ed=$("#edit"); if(ed) ed.onclick=startTrainerOnboarding;
  $("#done").onclick=()=>renderApp('profile');
}
