// ===================================================================
//  PROFILE — the athlete, and who can see them
// ===================================================================
// Design handoff, app screens §5. screenProfile was doing eight jobs; it is now two
// routes. Profile keeps the athlete, Coach's Corner and access. Everything else —
// household, password, notifications, export, legal, deletion, log out — moved one
// level down into Account & settings, reachable but never in the way.
async function screenProfile(){
  logUsageEvent('view_profile');
  const a=state.active; const age=ageFrom(a.birthdate);
  const householdIds=(state.athletes||[]).filter(x=>x.family_id===a.family_id).map(x=>x.id);
  const [{data:sports},{data:access},{data:invites},{data:doneRows}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('athlete_access').select('*').eq('athlete_id',a.id).is('revoked_at',null),
    sb.from('athlete_invites').select('*').in('athlete_id',householdIds.length?householdIds:[a.id]).is('accepted_at',null).is('revoked_at',null),
    sb.from('sessions').select('done_on,title').eq('athlete_id',a.id)
      .gte('done_on',isoDay(mondayOfThisWeek())).lte('done_on',dateForDayIndex(6)),
  ]);
  const _primary=(sports||[]).find(s=>s.is_primary)||(sports||[])[0];
  state.activeSportKey=_primary?.sport_key||state.activeSportKey||'general'; setAppBg();
  const myAccess=(access||[]).find(x=>x.guardian_id===state.user.id);
  const myRole=state.role||(myAccess?myAccess.role:'owner');
  const isOwner=(myRole==='owner');
  const canEdit=state.canEdit!==false;
  const sportName=state.ref?.sports.find(x=>x.key===_primary?.sport_key)?.name||'';
  const seasonLabel=(typeof seasonMeta==='function'&&_primary?.season_state)
    ? (seasonMeta(_primary.season_state)||{}).label : null;
  const visibleInvites=(invites||[]).filter(i=>i.scope==='family'||i.athlete_id===a.id);
  const sub=[sportName,(_primary?.positions||[]).join('/'),_primary?.level].filter(Boolean).join(' · ');

  $("#screen").innerHTML = H`
    ${topBar(sub||'Athlete')}
    <div class="app-pad" style="padding-top:6px">
      ${playbookPath('profile')}

      <div class="card app-pad">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0">
            <h3 style="font-size:19px">${esc(a.first_name)}${age!=null?', '+age:''}</h3>
            <p style="font-size:13px;color:var(--muted);margin:3px 0 0">${esc(sub||'No sport set')}</p>
          </div>
          ${canEdit?'<button class="btn sm ghost" id="editAthlete">Edit</button>':''}
        </div>
        ${seasonLabel||canEdit?H`<div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
          ${seasonLabel?`<span class="pill good">${esc(seasonLabel)}</span>`:''}
          ${canEdit?'<button class="btn sm ghost" id="editSeason">'+(seasonLabel?'Change season':'Set the season')+'</button>':''}
          ${canEdit?'<button class="btn sm ghost" id="addSport">＋ Add a sport</button>':''}
        </div>`:''}
      </div>

      ${(sports||[]).length>1?H`
      <div class="sec-title">Sports</div>
      <div class="card app-pad">
        ${(sports||[]).map(s=>{const nm=state.ref?.sports.find(x=>x.key===s.sport_key)?.name||s.sport_key;
          return H`<div class="grow"><div class="gi">${s.is_primary?'⭐':'🏅'}</div>
            <div class="gt"><b>${esc(nm)}${s.is_primary?' · primary':''}</b>
              <span>${esc((s.positions||[]).join('/')||'no position')} · ${esc(s.level||'no level')}</span></div>
            <div style="display:flex;gap:5px">
              ${canEdit?`<button class="btn sm ghost" data-editsport="${esc(s.id)}" title="Positions & level">✎</button>`:''}
              ${canEdit?`<button class="btn sm ghost" data-schedsport="${esc(s.id)}" title="Practice schedule">📅</button>`:''}
              ${canEdit&&!s.is_primary?`<button class="btn sm ghost" data-primary="${esc(s.id)}" title="Make primary">⭐</button>`:''}
              ${canEdit&&(sports||[]).length>1?`<button class="btn sm ghost" data-rmsport="${esc(s.id)}" title="Remove">✕</button>`:''}
            </div></div>`;}).join('')}
        <p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">Practices and games from every sport share one weekly load budget — adding a sport never doubles the training.</p>
      </div>`:''}

      ${_primary?H`<div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">${esc(sportName||'Primary')} schedule</div>
        ${canEdit?'<button class="btn sm ghost" id="editSched">Edit</button>':''}
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
        <div class="grow" style="border:none;padding:0"><div class="gi">✦</div>
          <div class="gt"><b>Did you play ${esc(sportName||'this sport')}?</b><span>We'll add notes written for someone who already knows the drill.</span></div></div>
        <div class="chipgrid" id="pexpEdit" style="grid-template-columns:repeat(3,1fr);margin-top:12px" ${canEdit?'':'aria-disabled="true"'}>
          ${PARENT_EXP.map(([v,l])=>`<div class="chip ${(_primary.parent_experience||'')===v?'on':''}" ${canEdit?'role="button" tabindex="0"':''} data-e="${v}">${esc(l)}</div>`).join('')}
        </div>
        ${_primary.sport_key==='football'&&canEdit?H`<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
          <div class="gt" style="margin-bottom:8px"><b>Your league's ball-carrier weight limit</b>
            <span>Pop Warner's "X-Man" rule is real but set locally — enter your league's number and it shows up on Growth. Leave it blank and Growth just explains the rule instead.</span></div>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="pwLimit" type="number" inputmode="numeric" min="1" max="400" placeholder="e.g. 130"
              value="${_primary.pw_ball_carrier_lb!=null?esc(String(_primary.pw_ball_carrier_lb)):''}"
              style="width:90px"/>
            <span style="font-size:13px;color:var(--muted)">lb</span>
            <button class="btn sm ghost" id="pwSave">Save</button>
          </div>
        </div>`:''}
      </div>`:''}

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Who can see ${esc(a.first_name)}</div>
        ${canEdit?'<button class="btn sm ghost" id="invite">＋ Invite</button>':''}
      </div>
      <div class="card app-pad">
        <div class="grow"><div class="gi">👤</div><div class="gt"><b>You</b><span>${isOwner?'Owner · full control':esc(myRole)+' access'}</span></div></div>
        ${(access||[]).filter(x=>x.guardian_id!==state.user.id).map(x=>H`
          <div class="grow"><div class="gi">🤝</div><div class="gt"><b>Shared guardian</b><span>${esc(x.role)} · can ${x.role==='co_parent'||x.role==='owner'?'edit':'view'}</span></div></div>`).join('')}
        ${visibleInvites.map(i=>H`
          <div class="grow"><div class="gi">✉️</div><div class="gt"><b>${i.scope==='family'?'Family invite pending':'Invite pending'}</b><span>${esc(i.role)} · expires ${new Date(i.expires_at).toLocaleDateString()}</span></div>
            <button class="btn sm ghost" data-copy="${esc(inviteLink(i.token))}">Copy</button></div>`).join('')}
      </div>

      <div class="card app-pad" style="margin-top:14px">
        ${canEdit?H`<div class="navrow" id="addChild"><div class="gi">👧</div>
          <div class="gt"><b>Add another athlete</b><span>Different sport, different age, separate plan</span></div><i>›</i></div>`:''}
        <div class="navrow" id="toAccount"><div class="gi">⚙️</div>
          <div class="gt"><b>Account &amp; settings</b><span>Household, notifications, your data</span></div><i>›</i></div>
      </div>

      ${(doneRows||[]).length?H`<div class="sec-title">Lately</div>
      <div class="card app-pad">
        <div class="mrow"><span>Done this week</span><b>${doneRows.length}</b></div>
        <div class="mrow"><span>Most recent</span><b style="max-width:60%;text-align:right;font-weight:500">${esc(doneRows[doneRows.length-1].title)}</b></div>
      </div>`:''}
    </div>`;
  bindTop();
  bindPlaybookPath();
  state.athleteSports = sports||[];   // openSportEditor needs to know what's already added
  { const ea=$("#editAthlete"); if(ea) ea.onclick=openEditAthlete; }
  { const as=$("#addSport"); if(as) as.onclick=()=>openSportEditor(null,()=>renderApp('profile')); }
  { const es=$("#editSeason"); if(es&&_primary) es.onclick=()=>openSeasonState(_primary,()=>renderApp('profile')); }
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
  { const ta=$("#toAccount"); if(ta) ta.onclick=()=>renderApp('account'); }
  { const pe=$("#pexpEdit"); if(pe&&_primary&&canEdit) pe.querySelectorAll('.chip').forEach(c=>c.onclick=async()=>{
      const v=c.dataset.e; pe.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
      const { error }=await sb.from('athlete_sports').update({ parent_experience:v||null }).eq('athlete_id',a.id).eq('sport_key',_primary.sport_key);
      if(error){ console.error(error); reportError(error,'profile:parentExp'); toast('Could not save'); return; }
      state.coach = v ? { sportKey:_primary.sport_key, level:v } : null;
      toast(v?'Coach\'s Corner on ✦':'Coach\'s Corner off');
    }); }
  { const ps=$("#pwSave"); if(ps&&_primary) ps.onclick=async()=>{
      const raw=$("#pwLimit").value;
      const n = raw==='' ? null : Number(raw);
      if(raw!=='' && (!isFinite(n)||n<=0)){ toast('Enter a number in pounds'); return; }
      ps.disabled=true;
      const { error }=await sb.from('athlete_sports').update({ pw_ball_carrier_lb:n }).eq('athlete_id',a.id).eq('sport_key',_primary.sport_key);
      if(error){ console.error(error); reportError(error,'profile:pwLimit'); toast('Could not save'); ps.disabled=false; return; }
      toast(n!=null?'Saved':'Cleared'); renderApp('profile');
    }; }
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{ navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
}

function inviteLink(token){ return `${location.origin}${location.pathname}?invite=${token}`; }
function trainerStatusLabel(s){ return ({draft:'In progress — tap to finish',submitted:'Submitted — under review',in_review:'Under review',needs_info:'Needs your attention',approved:'Approved ✓',suspended:'Paused',rejected:'Not approved'})[s]||'Submitted'; }
