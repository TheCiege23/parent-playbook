async function screenProfile(){
  const a=state.active; const age=ageFrom(a.birthdate);
  const [{data:sports},{data:access},{data:invites},{data:trainer},{data:adminRows}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('athlete_access').select('*').eq('athlete_id',a.id).is('revoked_at',null),
    sb.from('athlete_invites').select('*').eq('athlete_id',a.id).is('accepted_at',null).is('revoked_at',null),
    sb.from('trainer_profiles').select('status').eq('id',state.user.id).maybeSingle(),
    sb.from('app_admins').select('guardian_id').limit(1),   // RLS: returns a row only if the viewer is an admin
  ]);
  const isAdmin = !!(adminRows && adminRows.length);
  const _primary=(sports||[]).find(s=>s.is_primary)||(sports||[])[0];
  state.activeSportKey=_primary?.sport_key||state.activeSportKey||'general'; setAppBg();
  const myAccess=(access||[]).find(x=>x.guardian_id===state.user.id);
  const myRole=myAccess?myAccess.role:'owner';
  const isOwner=(myRole==='owner');
  $("#screen").innerHTML = H`
    ${topBar('Athlete profile')}
    <div class="app-pad" style="padding-top:6px">
      ${isOwner?H`<div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title" style="margin:6px 2px 10px">Details</div>
        <button class="btn sm ghost" id="editAthlete">Edit</button>
      </div>`:''}
      <div class="card app-pad">
        <div class="mrow"><span>First name</span><b>${esc(a.first_name)}</b></div>
        ${a.nickname?`<div class="mrow"><span>Goes by</span><b>${esc(a.nickname)}</b></div>`:''}
        <div class="mrow"><span>Age</span><b>${age??'—'}</b></div>
        <div class="mrow"><span>Dominant hand</span><b>${esc(a.dominant_hand||'—')}</b></div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Sports</div>
        ${isOwner?'<button class="btn sm ghost" id="addSport">+ Add a sport</button>':''}
      </div>
      <div class="card app-pad">
        ${(sports||[]).map(s=>{const nm=state.ref?.sports.find(x=>x.key===s.sport_key)?.name||s.sport_key;
          return H`<div class="grow"><div class="gi">${s.is_primary?'⭐':'🏅'}</div>
            <div class="gt"><b>${esc(nm)}${s.is_primary?' · primary':''}</b>
              <span>${esc((s.positions||[]).join('/')||'no position')} · ${esc(s.level||'no level')}</span></div>
            <div style="display:flex;gap:5px">
              ${isOwner?`<button class="btn sm ghost" data-editsport="${esc(s.id)}" title="Positions & level">✎</button>`:''}
              ${isOwner?`<button class="btn sm ghost" data-schedsport="${esc(s.id)}" title="Practice schedule">📅</button>`:''}
              ${isOwner&&!s.is_primary?`<button class="btn sm ghost" data-primary="${esc(s.id)}" title="Make primary">⭐</button>`:''}
              ${isOwner&&(sports||[]).length>1?`<button class="btn sm ghost" data-rmsport="${esc(s.id)}" title="Remove">✕</button>`:''}
            </div></div>
            ${(s.practice_days||[]).length||s.game_day!=null?`<div style="font-size:11.5px;color:var(--muted);margin:-4px 2px 8px 44px">
              ${(s.practice_days||[]).length?'Practice '+esc(s.practice_days.map(i=>DAY_LABELS[i]).join(', ')):'No practice days'}${s.game_day!=null?' · games '+esc(DAY_LABELS[s.game_day]):''}${s.season_start?' · from '+esc(fmtDate(s.season_start)):''}
            </div>`:`<div style="font-size:11.5px;color:#9a4a12;margin:-4px 2px 8px 44px">No practice schedule set — tap 📅</div>`}`;}).join('')}
        ${(sports||[]).length>1?`<p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">Practices and games from every sport share one weekly load budget — adding a sport never doubles the training.</p>`:''}
      </div>

      ${_primary?H`<div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">${esc(state.ref?.sports.find(x=>x.key===_primary.sport_key)?.name||'Primary')} schedule</div>
        <button class="btn sm ghost" id="editSched">Edit</button>
      </div>
      <div class="card app-pad">
        <div class="mrow"><span>Practice days</span><b>${(_primary.practice_days||[]).length?esc(_primary.practice_days.map(i=>DAY_LABELS[i]).join(', ')):'Not set'}</b></div>
        <div class="mrow"><span>Game day</span><b>${_primary.game_day!=null?esc(DAY_LABELS[_primary.game_day]):'—'}</b></div>
        <div class="mrow"><span>Season</span><b>${_primary.season_start
          ? esc(fmtDate(_primary.season_start))+(_primary.season_end?' – '+esc(fmtDate(_primary.season_end)):' onward')
          : 'Not set'}</b></div>
        <p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">The weekly plan is built around these — update them whenever the season changes.</p>
      </div>`:''}

      ${_primary?H`<div class="sec-title">Coach's Corner</div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">🧠</div><div class="gt"><b>Did you play ${esc(state.ref?.sports.find(s=>s.key===_primary.sport_key)?.name||'this sport')}?</b><span>Get peer coaching notes on drills you already know.</span></div></div>
        <div class="chipgrid" id="pexpEdit" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
          ${PARENT_EXP.map(([v,l])=>`<div class="chip ${(_primary.parent_experience||'')===v?'on':''}" data-e="${v}">${esc(l)}</div>`).join('')}
        </div>
      </div>`:''}

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Who can help</div>
        ${isOwner?'<button class="btn sm ghost" id="invite">+ Invite</button>':''}
      </div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">👤</div><div class="gt"><b>You</b><span>${isOwner?'Owner · full access':esc(myRole)+' access'}</span></div></div>
        ${(access||[]).filter(x=>x.guardian_id!==state.user.id).map(x=>H`
          <div class="grow"><div class="gi">🤝</div><div class="gt"><b>Shared guardian</b><span>${esc(x.role)} access</span></div></div>`).join('')}
        ${(invites||[]).map(i=>H`
          <div class="grow"><div class="gi">✉️</div><div class="gt"><b>Invite pending</b><span>${esc(i.role)} · expires ${new Date(i.expires_at).toLocaleDateString()}</span></div>
            <button class="btn sm ghost" data-copy="${esc(inviteLink(i.token))}">Copy</button></div>`).join('')}
      </div>

      ${MARKETPLACE_ENABLED?H`
      <div class="sec-title">Coaching</div>
      ${trainer ? H`<div class="card app-pad">
        <div class="grow"><div class="gi">🏅</div><div class="gt"><b>Pro Trainer application</b><span>${esc(trainerStatusLabel(trainer.status))}</span></div>
          <button class="btn sm ghost" id="trainerStatus">View</button></div>
      </div>`
      : H`<div class="card app-pad">
        <div class="grow"><div class="gi">🏅</div><div class="gt"><b>Become a Pro Trainer</b><span>Get verified and coach families for pay.</span></div></div>
        <button class="btn sm" id="beTrainer" style="margin-top:10px">Start application</button>
      </div>`}
      <div class="card app-pad">
        <div class="grow"><div class="gi">🔎</div><div class="gt"><b>Find a Pro Trainer</b><span>Book a verified coach for ${esc(a.first_name)}.</span></div></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn sm" id="findTrainer">Browse trainers</button>
          <button class="btn sm ghost" id="myBookings">My bookings</button>
        </div>
      </div>`:''}
      <div class="card app-pad">
        <div class="grow"><div class="gi">🔔</div><div class="gt"><b>Weekly reminder</b><span>One message on Sunday when the new week is ready. Nothing else.</span></div>
          <button class="btn sm ghost" id="enableNotif">Turn on</button></div>
      </div>

      ${isAdmin?H`<div class="sec-title">Admin</div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">🛡️</div><div class="gt"><b>Trainer review queue</b><span>Review and approve Pro Trainer applications.</span></div></div>
        <button class="btn sm" id="adminQueue" style="margin-top:10px">Open review queue</button>
        <div class="grow" style="margin-top:14px"><div class="gi">📚</div><div class="gt"><b>Drill library</b><span>Add and edit training content with its source — no deploy needed.</span></div></div>
        <button class="btn sm" id="adminDrills" style="margin-top:10px">Open drill library</button>
      </div>`:''}

      ${isOwner?H`<div class="sec-title">Manage</div>
      <div class="card app-pad">
        <button class="btn ghost" id="addChild" style="margin-bottom:10px">+ Add another athlete</button>
        <button class="btn danger" id="del">Delete this athlete</button>
      </div>
      <p class="muted-note">Deleting removes this athlete and all their data for everyone. This can't be undone.</p>`:''}

      <div class="sec-title">Help &amp; legal</div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">✉️</div><div class="gt"><b>Need help?</b><span>Questions or problems — we read every message.</span></div></div>
        <a class="btn sm ghost" href="mailto:support@chimaura.com" style="margin-top:10px;display:inline-block;text-decoration:none">Email support</a>
        <p class="muted-note" style="margin-top:12px">
          <a href="/privacy" target="_blank" rel="noopener" style="color:var(--green-d)">Privacy Policy</a> ·
          <a href="/terms" target="_blank" rel="noopener" style="color:var(--green-d)">Terms of Service</a>
        </p>
      </div>

      <div class="card app-pad" style="margin-top:14px">
        <div class="grow"><div class="gi">🗑️</div><div class="gt"><b>Delete my account</b><span>Erases your account, your children's profiles and every photo.</span></div></div>
        <button class="btn sm danger" id="delAccount" style="margin-top:10px">Delete my account</button>
      </div>
    </div>`;
  bindTop();
  state.athleteSports = sports||[];   // openSportEditor needs to know what's already added
  { const ea=$("#editAthlete"); if(ea) ea.onclick=openEditAthlete; }
  { const as=$("#addSport"); if(as) as.onclick=()=>openSportEditor(null,()=>renderApp('profile')); }
  $("#screen").querySelectorAll('[data-editsport]').forEach(b=>b.onclick=()=>{
    const row=(sports||[]).find(s=>s.id===b.dataset.editsport);
    if(row) openSportEditor(row,()=>renderApp('profile'));
  });
  $("#screen").querySelectorAll('[data-schedsport]').forEach(b=>{
    const row=(sports||[]).find(s=>s.id===b.dataset.schedsport);
    if(row) b.onclick=()=>openPracticeSchedule(row.sport_key,
      { practiceDays:row.practice_days||[], gameDay:row.game_day,
        seasonStart:row.season_start, seasonEnd:row.season_end }, ()=>renderApp('profile'));
  });
  $("#screen").querySelectorAll('[data-primary]').forEach(b=>b.onclick=()=>setPrimarySport(b.dataset.primary));
  $("#screen").querySelectorAll('[data-rmsport]').forEach(b=>{
    const row=(sports||[]).find(s=>s.id===b.dataset.rmsport);
    const nm=state.ref?.sports.find(x=>x.key===row?.sport_key)?.name||'this sport';
    if(row) b.onclick=()=>confirmRemoveSport(row,nm);
  });
  { const es=$("#editSched"); if(es&&_primary) es.onclick=()=>openPracticeSchedule(_primary.sport_key,
      { practiceDays:_primary.practice_days||[], gameDay:_primary.game_day,
        seasonStart:_primary.season_start, seasonEnd:_primary.season_end }, ()=>renderApp('profile')); }
  { const iv=$("#invite"); if(iv) iv.onclick=openInvite; }
  { const ac=$("#addChild"); if(ac) ac.onclick=startAddChild; }
  { const dl=$("#del"); if(dl) dl.onclick=confirmDelete; }
  { const bt=$("#beTrainer"); if(bt) bt.onclick=startTrainerOnboarding; }
  { const ts=$("#trainerStatus"); if(ts) ts.onclick=()=>trainerStatusScreen(); }
  { const aq=$("#adminQueue"); if(aq) aq.onclick=openAdminQueue; }
  { const ad=$("#adminDrills"); if(ad) ad.onclick=openAdminDrills; }
  { const da=$("#delAccount"); if(da) da.onclick=confirmDeleteAccount; }
  { const ft=$("#findTrainer"); if(ft) ft.onclick=openMarketplace; }
  { const mb=$("#myBookings"); if(mb) mb.onclick=openMyBookings; }
  // The button used to say "Turn on" forever, even once they were on — so a parent had no
  // way to tell whether it had worked, and tapping again was the only way to find out.
  { const en=$("#enableNotif");
    if(en){
      const setOn=()=>{ en.textContent='On ✓'; en.disabled=true; en.style.opacity='.6'; };
      // On an iPhone that hasn't installed the app, "Turn on" can't succeed — say what
      // the tap will actually do rather than letting it look like a failure.
      if(typeof pushNeedsInstall==='function' && pushNeedsInstall()){
        en.textContent='How to enable';
        const note=document.createElement('p');
        note.className='muted-note';
        note.style.cssText='text-align:left;margin:8px 2px 0';
        note.textContent='On iPhone, reminders need the app saved to your Home Screen first.';
        en.parentElement && en.parentElement.parentElement && en.parentElement.parentElement.appendChild(note);
      } else {
        pushIsOn().then(on=>{ if(on) setOn(); });
      }
      en.onclick=async()=>{
        const label=en.textContent; en.innerHTML='<span class="spinner"></span>'; en.disabled=true;
        const ok=await enablePush();
        if(ok) setOn(); else { en.textContent=label; en.disabled=false; }
      };
    } }
  { const pe=$("#pexpEdit"); if(pe&&_primary) pe.querySelectorAll('.chip').forEach(c=>c.onclick=async()=>{
      const v=c.dataset.e; pe.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
      const { error }=await sb.from('athlete_sports').update({ parent_experience:v||null }).eq('athlete_id',a.id).eq('sport_key',_primary.sport_key);
      if(error){ console.error(error); toast('Could not save'); return; }
      state.coach = v ? { sportKey:_primary.sport_key, level:v } : null;
      toast(v?'Coach\'s Corner on 🧠':'Coach\'s Corner off');
    }); }
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{ navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
}
function inviteLink(token){ return `${location.origin}${location.pathname}?invite=${token}`; }
function trainerStatusLabel(s){ return ({draft:'In progress — tap to finish',submitted:'Submitted — under review',in_review:'Under review',needs_info:'Needs your attention',approved:'Approved ✓',suspended:'Paused',rejected:'Not approved'})[s]||'Submitted'; }

