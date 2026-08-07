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
      <div class="card app-pad">
        <div class="mrow"><span>First name</span><b>${esc(a.first_name)}</b></div>
        <div class="mrow"><span>Age</span><b>${age??'—'}</b></div>
        <div class="mrow"><span>Dominant hand</span><b>${esc(a.dominant_hand||'—')}</b></div>
        ${(sports||[]).map(s=>{const nm=state.ref?.sports.find(x=>x.key===s.sport_key)?.name||s.sport_key;
          return H`<div class="mrow"><span>${esc(nm)}${s.is_primary?' (primary)':''}</span><b>${esc((s.positions||[]).join('/'))} · ${esc(s.level||'')}</b></div>`;}).join('')}
      </div>

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
      </div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">🔔</div><div class="gt"><b>Notifications</b><span>Get alerts for bookings and messages.</span></div>
          <button class="btn sm ghost" id="enableNotif">Turn on</button></div>
      </div>

      ${isAdmin?H`<div class="sec-title">Admin</div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">🛡️</div><div class="gt"><b>Trainer review queue</b><span>Review and approve Pro Trainer applications.</span></div></div>
        <button class="btn sm" id="adminQueue" style="margin-top:10px">Open review queue</button>
      </div>`:''}

      ${isOwner?H`<div class="sec-title">Manage</div>
      <div class="card app-pad">
        <button class="btn ghost" id="addChild" style="margin-bottom:10px">+ Add another athlete</button>
        <button class="btn danger" id="del">Delete this athlete</button>
      </div>
      <p class="muted-note">Deleting removes this athlete and all their data for everyone. This can't be undone.</p>`:''}
    </div>`;
  bindTop();
  { const iv=$("#invite"); if(iv) iv.onclick=openInvite; }
  { const ac=$("#addChild"); if(ac) ac.onclick=startAddChild; }
  { const dl=$("#del"); if(dl) dl.onclick=confirmDelete; }
  { const bt=$("#beTrainer"); if(bt) bt.onclick=startTrainerOnboarding; }
  { const ts=$("#trainerStatus"); if(ts) ts.onclick=()=>trainerStatusScreen(); }
  { const aq=$("#adminQueue"); if(aq) aq.onclick=openAdminQueue; }
  { const ft=$("#findTrainer"); if(ft) ft.onclick=openMarketplace; }
  { const mb=$("#myBookings"); if(mb) mb.onclick=openMyBookings; }
  { const en=$("#enableNotif"); if(en) en.onclick=enablePush; }
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

