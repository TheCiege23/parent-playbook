async function screenProfile(){
  const a=state.active; const age=ageFrom(a.birthdate);
  const [{data:sports},{data:access},{data:invites}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('athlete_access').select('*').eq('athlete_id',a.id).is('revoked_at',null),
    sb.from('athlete_invites').select('*').eq('athlete_id',a.id).is('accepted_at',null).is('revoked_at',null),
  ]);
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
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{ navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
}
function inviteLink(token){ return `${location.origin}${location.pathname}?invite=${token}`; }

