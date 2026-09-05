// ===================================================================
//  ACCOUNT & SETTINGS — where the junk drawer went
// ===================================================================
// Design handoff, app screens §5. screenProfile was doing eight jobs; household,
// password, notifications, export, legal, deletion and log out all moved one level
// down into this route. Reachable, never in the way.
async function screenAccount(){
  const a=state.active;
  const [{data:fam},{data:adminRows},{data:prefRows}] = await Promise.all([
    sb.from('families').select('id,name').limit(1),
    sb.from('app_admins').select('guardian_id').limit(1),   // RLS: a row comes back only if the viewer is an admin
    sb.from('notification_prefs').select('*').eq('guardian_id',state.user.id).limit(1),
  ]);
  // Invites are the only growth mechanism left, and every one of them says who sent it.
  // With no display_name they all read "A parent wants you to follow…", which is a
  // worse email and a worse first impression than the product deserves.
  const { data:me } = await sb.from('guardians').select('display_name,birthdate').eq('id',state.user.id).maybeSingle();
  const myName=(me&&me.display_name||'').trim();
  const isAdmin=!!(adminRows&&adminRows.length);
  const household=(fam&&fam[0])||null;
  // No row means both on — this table records preference, not permission.
  const prefs=(prefRows&&prefRows[0])||{weekly:true,game_day:true};

  $("#screen").innerHTML = H`
    <div class="top">
      <button class="pill" id="acctBack" aria-label="Back to profile">← Back</button>
      <h3 style="font-size:17px">Account &amp; settings</h3>
      <span style="width:62px"></span>
    </div>
    <div class="app-pad" style="padding-top:6px">

      <div class="sec-title">Your household</div>
      <div class="card app-pad">
        <div class="mrow"><span>Household</span>
          <b style="display:flex;gap:8px;align-items:center">${esc(household?.name||'My Family')}
            ${household?'<button class="btn sm ghost" id="renameFam">Rename</button>':''}</b></div>
        <div class="mrow"><span>Your name</span>
          <b style="display:flex;gap:8px;align-items:center">${myName?esc(myName):'<span style="font-weight:500;color:var(--muted)">Not set</span>'}
            <button class="btn sm ghost" id="editName">${myName?'Change':'Add'}</button></b></div>
        <div class="mrow"><span>Email</span><b style="font-weight:500;max-width:60%;text-align:right;word-break:break-all">${esc(state.user?.email||'—')}</b></div>
        <div class="mrow"><span>Password</span><b><button class="btn sm ghost" id="changePw">Change</button></b></div>
        <div class="mrow"><span>Athletes</span><b>${state.athletes.length}</b></div>
      </div>

      <div class="sec-title">Notifications</div>
      <div class="card app-pad">
        <div class="tgl">
          <div class="gt"><b>The week ahead</b><span>One message on Sunday, when the new week is ready</span></div>
          <button class="sw ${prefs.weekly?'on':''}" id="prefWeekly" role="switch" aria-checked="${prefs.weekly?'true':'false'}" aria-label="The week ahead"><i></i></button>
        </div>
        <div class="tgl">
          <div class="gt"><b>Game day reminder</b><span>The night before, with what to say on the way there</span></div>
          <button class="sw ${prefs.game_day?'on':''}" id="prefGame" role="switch" aria-checked="${prefs.game_day?'true':'false'}" aria-label="Game day reminder"><i></i></button>
        </div>
        <div id="pushState"></div>
      </div>

      <!-- Adult-only by construction: openBodyScan refuses below 18 and says so on screen.
           It sits here rather than on a child's Growth screen precisely because it is not
           part of the child-facing product. -->
      <div class="sec-title">Body scan <span class="bs-tag">Adults only</span></div>
      <div class="card app-pad">
        <div class="navrow" id="bodyScanRow" role="button" tabindex="0"><div class="gi"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
          <div class="gt"><b>Scan yourself</b><span>Four photos, never saved. Measurements only, and only for adults.</span></div><i>›</i></div>
      </div>

      <div class="sec-title">Your data</div>
      <div class="card app-pad">
        <div class="navrow" id="exportAll" role="button" tabindex="0"><div class="gi">📦</div>
          <div class="gt"><b>Export everything</b><span>Every profile, game, milestone and measurement as a file</span></div><i>›</i></div>
        <div class="navrow" id="toLegal" role="button" tabindex="0"><div class="gi">📄</div>
          <div class="gt"><b>Privacy &amp; terms</b><span>What we store, and what we never do with it</span></div><i>›</i></div>
        <div class="navrow" id="helpRow" role="button" tabindex="0"><div class="gi">✉️</div>
          <div class="gt"><b>Need help?</b><span>support@chimaura.com — we read every message</span></div><i>›</i></div>
      </div>

      ${isAdmin?H`<div class="sec-title">Admin</div>
      <div class="card app-pad">
        <div class="navrow" id="adminQueue" role="button" tabindex="0"><div class="gi">🛡️</div>
          <div class="gt"><b>Trainer review queue</b><span>Review and approve Pro Trainer applications</span></div><i>›</i></div>
        <div class="navrow" id="adminDrills" role="button" tabindex="0"><div class="gi">📚</div>
          <div class="gt"><b>Drill library</b><span>Add and edit training content with its source</span></div><i>›</i></div>
      </div>`:''}

      ${MARKETPLACE_ENABLED?H`<div class="sec-title">Coaching</div>
      <div class="card app-pad">
        <div class="navrow" id="beTrainer" role="button" tabindex="0"><div class="gi">🏅</div>
          <div class="gt"><b>Become a Pro Trainer</b><span>Get verified and coach families for pay</span></div><i>›</i></div>
      </div>`:''}

      <div class="sec-title">Danger zone</div>
      <div class="card app-pad">
        <div class="navrow danger" id="delAthlete" role="button" tabindex="0"><div class="gi">🗑️</div>
          <div class="gt"><b>Delete ${esc(a.first_name)}'s profile</b><span>Removes them and everything in their journey, for everyone</span></div><i>›</i></div>
        <div class="navrow danger" id="delAccount" role="button" tabindex="0"><div class="gi">⚠️</div>
          <div class="gt"><b>Delete my account</b><span>Your account, every child's profile, and every photo</span></div><i>›</i></div>
      </div>
      <p class="muted-note">Deleting can't be undone. Export first if you want a copy.</p>

      <button class="logout-plain" id="acctLogout">Log out</button>
    </div>`;

  const go=(id,fn)=>{ const el=$('#'+id); if(!el) return;
    el.onclick=fn; el.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } }; };
  $("#acctBack").onclick=()=>renderApp('profile');
  // Deliberately plain text, not a button: on a shared family phone nobody should hit
  // log out by accident reaching for something else.
  $("#acctLogout").onclick=async()=>{ await sb.auth.signOut(); state.user=null;state.athletes=[];state.active=null; renderAuth('login'); };
  { const r=$("#renameFam"); if(r&&household) r.onclick=()=>openRenameHousehold(household); }
  { const c=$("#changePw"); if(c) c.onclick=openChangePassword; }
  { const n=$("#editName"); if(n) n.onclick=()=>openEditMyName(myName); }
  // The subject is the SIGNED-IN ADULT, never state.active — that is a child, and
  // passing it here is the one mistake that would defeat the age guard.
  // A null birthdate is not a refusal: the consent step asks for it.
  go('bodyScanRow', ()=>openBodyScan({ id:state.user.id, first_name:'You',
      birthdate:(me&&me.birthdate)||null }));
  go('exportAll', openExportEverything);
  go('toLegal', ()=>window.open('/privacy','_blank','noopener'));
  go('helpRow', ()=>{ location.href='mailto:support@chimaura.com'; });
  go('adminQueue', openAdminQueue);
  go('adminDrills', openAdminDrills);
  go('beTrainer', startTrainerOnboarding);
  go('delAthlete', confirmDelete);
  go('delAccount', confirmDeleteAccount);
  bindNotifPrefs(prefs);
}

// A preference toggle is not a permission grant. Turning either switch ON has to
// secure the browser permission first, or we'd store "yes please" against a device
// that can never receive anything — which is how you end up with a settings screen
// that lies.
function bindNotifPrefs(prefs){
  const box=document.getElementById('pushState');
  if(typeof pushNeedsInstall==='function' && pushNeedsInstall() && box){
    box.innerHTML='<p class="muted-note" style="text-align:left;margin:10px 2px 0">On iPhone, reminders need Parent Playbook saved to your Home Screen first — tap Share, then Add to Home Screen.</p>';
  }
  const save=async(key,val,btn)=>{
    const row={ guardian_id:state.user.id, weekly:prefs.weekly, game_day:prefs.game_day,
                updated_at:new Date().toISOString() };
    row[key]=val;
    const { error }=await sb.from('notification_prefs').upsert(row,{ onConflict:'guardian_id' });
    if(error){ console.error(error); reportError(error,'account:notifPref'); toast('Could not save'); return false; }
    prefs[key]=val;
    btn.classList.toggle('on',val); btn.setAttribute('aria-checked',String(val));
    return true;
  };
  const wire=(id,key)=>{
    const btn=document.getElementById(id); if(!btn) return;
    btn.onclick=async()=>{
      const turningOn=!btn.classList.contains('on');
      btn.disabled=true;
      if(turningOn){
        if(typeof pushNeedsInstall==='function' && pushNeedsInstall()){ showIosPushHelp(); btn.disabled=false; return; }
        const already=await pushIsOn();
        if(!already){ const ok=await enablePush(); if(!ok){ btn.disabled=false; return; } }
      }
      await save(key,turningOn,btn);
      btn.disabled=false;
    };
  };
  wire('prefWeekly','weekly'); wire('prefGame','game_day');
}

// ---- sheets ----

// Where in the year this athlete is. Asked in onboarding, changed here whenever a
// season moves — which it always does. SEASON_STATE in program.js is what each one
// actually does to the week.
function openSeasonState(sportRow, onSaved){
  const cur=sportRow?.season_state||null;
  let picked=cur;
  const opts=[
    ['in_season','In season','Games every week. Home work stays light, recovery is protected.'],
    ['offseason','Offseason','No games. Where kids actually get better — more skill work, more strength.'],
    ['between_sports','Between sports',"One just ended, the next hasn't started. Athletic base and rest."],
  ];
  const bg=sheet(H`<h3>Where are you in the year?</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">A week in October shouldn't look like a week in February.</p>
    <div role="radiogroup" aria-label="Season">
      ${opts.map(o=>H`<div class="pickcard ${cur===o[0]?'on':''}" data-v="${esc(o[0])}" role="radio" tabindex="0" aria-checked="${cur===o[0]?'true':'false'}">
        <b>${esc(o[1])}</b><span>${esc(o[2])}</span></div>`).join('')}
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:12px 2px 14px">Whichever you pick, you get a week. Change it any time — seasons move.</p>
    <div class="err" id="sserr"></div>
    <button class="btn" id="ssSave">Save</button>`);
  const pick=el=>{ picked=el.dataset.v;
    bg.querySelectorAll('.pickcard').forEach(x=>{ const on=(x===el);
      x.classList.toggle('on',on); x.setAttribute('aria-checked',String(on)); }); };
  bg.querySelectorAll('.pickcard').forEach(el=>{
    el.onclick=()=>pick(el);
    el.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pick(el); } };
  });
  bg.querySelector('#ssSave').onclick=async e=>{
    const errEl=bg.querySelector('#sserr'); errEl.textContent='';
    if(!picked){ errEl.textContent='Pick one — it changes what the week looks like.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.from('athlete_sports').update({ season_state:picked })
      .eq('athlete_id',state.active.id).eq('sport_key',sportRow.sport_key);
    if(error){ console.error(error); reportError(error,'sheet:seasonState');
      errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save'; e.target.disabled=false; return; }
    bg.remove(); toast('Season updated');
    if(onSaved) onSaved(); else renderApp('week');
  };
}

// The name on every invite you send. Worth asking for exactly once, here, rather than
// in onboarding — at signup it's a field with no visible purpose; here it has one.
function openEditMyName(current){
  const bg=sheet(H`<h3>What should we call you?</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">This is the name on invites you send. Without it they read "A parent wants you to follow…", which is a stranger asking a grandparent for an account.</p>
    <div class="field"><label>Your name</label>
      <input id="gname" value="${esc(current||'')}" maxlength="60" placeholder="e.g. Chris"/></div>
    <div class="err" id="gnerr"></div>
    <button class="btn" id="gnSave">Save</button>`);
  bg.querySelector('#gnSave').onclick=async e=>{
    const v=bg.querySelector('#gname').value.trim();
    const errEl=bg.querySelector('#gnerr'); errEl.textContent='';
    if(!v){ errEl.textContent='Give us something to call you.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.from('guardians').update({ display_name:v }).eq('id',state.user.id);
    if(error){ console.error(error); reportError(error,'account:displayName');
      errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save'; e.target.disabled=false; return; }
    bg.remove(); toast('Saved'); renderApp('account');
  };
}

function openRenameHousehold(household){
  const bg=sheet(H`<h3>Rename your household</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Only you and the people you invite ever see this.</p>
    <div class="field"><label>Household name</label>
      <input id="fname" value="${esc(household.name||'')}" maxlength="60" placeholder="The Johnson Family"/></div>
    <div class="err" id="fnerr"></div>
    <button class="btn" id="fnSave">Save</button>`);
  bg.querySelector('#fnSave').onclick=async e=>{
    const v=bg.querySelector('#fname').value.trim();
    const errEl=bg.querySelector('#fnerr'); errEl.textContent='';
    if(!v){ errEl.textContent='Give it a name.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.from('families').update({ name:v }).eq('id',household.id);
    if(error){ console.error(error); reportError(error,'sheet:renameFamily');
      errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save'; e.target.disabled=false; return; }
    bg.remove(); toast('Household renamed'); renderApp('account');
  };
}

function openChangePassword(){
  const bg=sheet(H`<h3>Change your password</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">You'll stay signed in on this device.</p>
    <div class="field"><label>New password</label>
      <input id="pw1" type="password" autocomplete="new-password" placeholder="At least 8 characters"/></div>
    <div class="field"><label>Type it again</label>
      <input id="pw2" type="password" autocomplete="new-password" placeholder="Confirm"/></div>
    <div class="err" id="pwerr"></div>
    <button class="btn" id="pwSave">Update password</button>`);
  bg.querySelector('#pwSave').onclick=async e=>{
    const p1=bg.querySelector('#pw1').value, p2=bg.querySelector('#pw2').value;
    const errEl=bg.querySelector('#pwerr'); errEl.textContent='';
    if(p1.length<8){ errEl.textContent='At least 8 characters.'; return; }
    if(p1!==p2){ errEl.textContent="Those two don't match."; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.auth.updateUser({ password:p1 });
    if(error){ console.error(error); errEl.textContent=error.message||'Could not update.';
      e.target.innerHTML='Update password'; e.target.disabled=false; return; }
    bg.remove(); toast('Password updated');
  };
}

// "Your data is yours" is only true if you can take it.
// Built entirely client-side from rows this guardian can already read — no new
// endpoint, nothing emailed, and nothing uploaded anywhere to produce it. Media are
// signed links rather than bundled bytes: the files are large and a JSON blob of
// base64 video is not a useful thing to hand anyone.
async function openExportEverything(){
  const bg=sheet(H`<h3>Export everything</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">One file with every athlete, game, milestone, measurement and logged session you have access to — plus links to your photos and videos.</p>
    <div id="exStatus"><div class="center-screen" style="min-height:90px"><span class="spinner"></span></div></div>`);
  const out=bg.querySelector('#exStatus');
  try{
    const ids=state.athletes.map(x=>x.id);
    if(!ids.length){ out.innerHTML='<p class="empty">No athletes to export yet.</p>'; return; }
    const grab=t=>sb.from(t).select('*').in('athlete_id',ids);
    const [ath,sp,goals,meas,games,miles,sess,media]=await Promise.all([
      sb.from('athletes').select('*').in('id',ids),
      grab('athlete_sports'), grab('goals'), grab('measurements'),
      grab('games'), grab('milestones'), grab('sessions'), grab('media'),
    ]);
    const errs=[ath,sp,goals,meas,games,miles,sess,media].map(r=>r.error).filter(Boolean);
    if(errs.length){ console.error(errs); reportError(errs[0],'account:export'); }
    let mediaOut=(media.data||[]);
    if(mediaOut.length){
      // 6 hours, matching the Journey. These are links to photographs of a child, and a
      // week is long enough for one to be forwarded, sit unread in an inbox, or end up
      // in a screenshot — all while still resolving for anyone holding it. An export is
      // something a parent does and uses in one sitting; it does not need to outlive the
      // afternoon. Re-export for fresh links.
      const { data:signed }=await sb.storage.from('athlete-media')
        .createSignedUrls(mediaOut.map(m=>m.path), 60*60*6);
      const byPath={}; (signed||[]).forEach(s=>{ if(s.signedUrl&&!s.error) byPath[s.path]=s.signedUrl; });
      mediaOut=mediaOut.map(m=>({ ...m, download_url:byPath[m.path]||null,
        note:byPath[m.path]?'Link expires 6 hours after export — re-export for fresh links'
                           :'Could not sign — open the app to view' }));
    }
    const payload={
      exported_at:new Date().toISOString(),
      exported_by:state.user?.email||null,
      about:'Parent Playbook export. Photo and video links expire seven days after this file was made — download anything you want to keep.',
      athletes:ath.data||[], sports:sp.data||[], goals:goals.data||[],
      measurements:meas.data||[], games:games.data||[], milestones:miles.data||[],
      sessions:sess.data||[], media:mediaOut,
    };
    const counts=[['athletes',payload.athletes.length],['games',payload.games.length],
      ['milestones',payload.milestones.length],['measurements',payload.measurements.length],
      ['sessions logged',payload.sessions.length],['photos & videos',payload.media.length]];
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const name='parent-playbook-export-'+isoDay(new Date())+'.json';
    out.innerHTML=H`
      <div class="card app-pad" style="margin-bottom:14px">
        ${counts.map(c=>`<div class="mrow"><span>${esc(c[0])}</span><b>${c[1]}</b></div>`).join('')}
      </div>
      <a class="btn" id="exDl" download="${esc(name)}" href="${url}" style="text-decoration:none">Download the file</a>
      <p class="muted-note" style="margin-top:12px">Photo and video links inside expire in seven days.${errs.length?' Some sections could not be read and came back empty — contact support if that looks wrong.':''}</p>`;
    const dl=out.querySelector('#exDl');
    if(dl) dl.addEventListener('click',()=>setTimeout(()=>{ toast('Saved to your downloads'); URL.revokeObjectURL(url); },600));
  }catch(err){
    console.error(err); reportError(err,'account:export');
    out.innerHTML='<p class="empty">Could not build the export. Check your connection and try again.</p>';
  }
}
