// ===================================================================
//  ORGANIZATIONS — roster-wide access for whoever runs a team, league, or club
// ===================================================================
// Built on the existing teams/team_memberships scaffold (the join_code
// onboarding-prefill already shipped; this is what actually links a child to
// the roster and grants a real read). teams.created_by is the org admin —
// no separate admin account type, same as "coach" is a grant, not a signup.
// The read ceiling matches coach exactly: athletes, athlete_sports,
// measurements, plus which coaches are connected — never coach_updates
// content. Enforced server-side by add_org_roster_access's RLS, not by this
// file hiding a button. See TEAM-CONNECT-EXPANSION-PLAN.md Part D.

function orgCode(){
  // Avoids 0/O/1/I — a code that's read aloud or handwritten shouldn't hinge on font choice.
  const AL='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<7;i++) s+=AL[Math.floor(Math.random()*AL.length)];
  return s;
}

// ---- a parent joining an existing roster (their own child, any time — not just at signup) ----
async function openJoinTeam(){
  const athlete=state.active, guardianId=state.user?.id;
  if(!athlete){ toast('Add a child first'); return; }
  if(!guardianId||state.canEdit===false){ toast('Only a parent or co-parent can join a roster for this child'); return; }
  const bg=sheet(H`<h3>Join a team or organization</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Enter the code you were given. This adds
      <b>${esc(athlete.first_name)}</b> to that roster — stats and measurements only, the same as Team Connect. Never games,
      journey, or photos.</p>
    <div class="field"><label for="jtCode">Team code</label><input id="jtCode" placeholder="e.g. BEARS26" autocapitalize="characters"/></div>
    <div class="err" id="jtErr" role="alert"></div>
    <button class="btn amber" id="jtGo">Join</button>`);
  const current=()=>bg.isConnected&&state.active?.id===athlete.id&&state.user?.id===guardianId&&state.canEdit!==false;
  bg.querySelector('#jtGo').onclick=async e=>{
    if(!current()) return;
    const code=(bg.querySelector('#jtCode').value||'').trim();
    const err=bg.querySelector('#jtErr'); err.textContent='';
    if(!code){ err.textContent='Enter the code you were given.'; return; }
    const button=e.currentTarget;
    button.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; button.disabled=true;
    try{
      const {data,error}=await sb.rpc('team_by_code',{ p_code:code });
      if(error) throw error;
      if(!current()) return;
      const team=(data||[])[0];
      if(!team){ err.textContent="We don't recognise that code. Check it with whoever gave it to you."; return; }
      // Season is nullable, so the DB unique constraint permits duplicate null-season rows.
      const {data:existing,error:readError}=await sb.from('team_memberships').select('id')
        .eq('athlete_id',athlete.id).eq('team_id',team.id).limit(1);
      if(readError) throw readError;
      if(!current()) return;
      if(existing?.length){ err.textContent='Already on that roster.'; return; }
      const {error:insertError}=await sb.from('team_memberships').insert({athlete_id:athlete.id,team_id:team.id});
      if(insertError) throw insertError;
      if(!current()) return;
      try{ await sb.rpc('team_code_used',{p_code:code}); }catch(ex){ console.error(ex); }
      if(!current()) return;
      logUsageEvent('team_joined');
      bg.remove(); toast('Joined '+(team.name||'the roster'));
    }catch(error){
      console.error(error);
      if(current()) err.textContent='Could not join this roster. Check your connection and try again.';
    }finally{
      if(current()){ button.textContent='Join'; button.disabled=false; }
    }
  };
}

// Parents need an exit from roster-wide sharing after joining with a code. The
// database's team_memberships delete policy limits this to athlete editors.
function openAthleteRosterMemberships(){
  const athlete=state.active, guardianId=state.user?.id;
  if(!athlete || !guardianId || state.canEdit===false) return;
  const bg=sheet(H`<h3>${esc(athlete.first_name)}'s roster sharing</h3>
    <p class="muted-note" style="text-align:left">Teams on this list can view ${esc(athlete.first_name)}'s stats and measurements.</p>
    <div id="rosterSharingList" role="status" aria-live="polite">Loading rosters…</div>
    <button class="btn ghost" id="rosterSharingClose" style="margin-top:14px">Close</button>`);
  const list=bg.querySelector('#rosterSharingList');
  const current=()=>bg.isConnected&&state.active?.id===athlete.id&&state.user?.id===guardianId&&state.canEdit!==false;
  bg.querySelector('#rosterSharingClose').onclick=()=>bg.remove();
  const load=async()=>{
    if(!current()) return;
    list.textContent='Loading rosters…';
    let rows;
    try{
      const {data,error}=await sb.from('team_memberships').select('id,team_id,teams(name)').eq('athlete_id',athlete.id);
      if(error) throw error;
      rows=[...new Map((data||[]).map(row=>[row.team_id,row])).values()];
    }catch(error){
      console.error(error);
      if(!current()) return;
      list.innerHTML='<p class="err">Could not load roster sharing. Check your connection and try again.</p><button class="btn ghost" id="rosterSharingRetry">Retry</button>';
      list.querySelector('#rosterSharingRetry').onclick=load;
      return;
    }
    if(!current()) return;
    if(!rows.length){ list.innerHTML='<p class="empty">This athlete is not on a team roster.</p>'; return; }
    list.innerHTML=rows.map((row,index)=>H`<div class="mrow" style="align-items:center;gap:12px">
      <div><b>${esc(row.teams?.name||'Team roster')}</b><div class="muted-note" style="text-align:left;margin-top:2px">Stats and measurements shared</div></div>
      <button class="btn sm ghost" data-leave-roster="${index}" aria-label="Leave ${esc(row.teams?.name||'team roster')}">Leave</button>
    </div>`).join('');
    list.querySelectorAll('[data-leave-roster]').forEach(button=>button.onclick=()=>{
      const row=rows[Number(button.dataset.leaveRoster)];
      if(!row||!current()) return;
      const name=row.teams?.name||'this roster';
      list.innerHTML=H`<p>Leave <b>${esc(name)}</b>?</p>
        <p class="muted-note" style="text-align:left">This stops the roster's access to ${esc(athlete.first_name)}'s stats and measurements. It cannot recall information someone already copied outside Parent Playbook.</p>
        <div class="err" id="rosterLeaveError" role="alert"></div>
        <button class="btn danger" id="rosterLeaveConfirm">Leave roster</button>
        <button class="btn ghost" id="rosterLeaveKeep" style="margin-top:10px">Keep sharing</button>`;
      list.querySelector('#rosterLeaveKeep').onclick=load;
      list.querySelector('#rosterLeaveConfirm').onclick=async event=>{
        if(!current()) return;
        const confirm=event.currentTarget;
        confirm.disabled=true; confirm.textContent='Leaving…';
        try{
          // Remove every duplicate membership for this athlete and team so a
          // legacy null-season duplicate cannot leave access in place.
          const {data:removed,error}=await sb.from('team_memberships').delete()
            .eq('athlete_id',athlete.id).eq('team_id',row.team_id).select('id');
          if(error) throw error;
          if(!removed?.length) throw new Error('No roster membership was removed');
          if(current()){ toast('Left '+name); await load(); }
        }catch(error){
          console.error(error);
          if(!current()) return;
          list.querySelector('#rosterLeaveError').textContent='Could not leave this roster. Try again.';
          confirm.disabled=false; confirm.textContent='Leave roster';
        }
      };
    });
  };
  load();
}

// ---- entry point from Account: your own roster(s), or start one ----
async function openMyOrg(){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let teams=[];
  try{
    const { data, error }=await sb.from('teams').select('id,name,sport_key,join_code,is_active')
      .eq('created_by',state.user.id).order('created_at',{ascending:true});
    if(error) throw error; teams=data||[];
  }catch(err){ console.error(err); return orgError(openMyOrg); }
  if(!teams.length) return openOrgCreate();
  root.innerHTML = H`<div class="app-pad org-page" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h1 style="font-size:22px">Your rosters</h1><button class="pill" id="orgDone">Done</button>
    </div>
    ${teams.map(t=>H`<button class="card app-pad" data-t="${esc(t.id)}" style="width:100%;text-align:left;display:block;margin-bottom:10px;border:none;cursor:pointer">
      <b style="font-size:15px">${esc(t.name)}</b>
      <div style="color:var(--muted);font-size:12.5px;margin-top:2px">${esc(sportName(t.sport_key)||'—')}${t.is_active?'':' · inactive'}</div>
    </button>`).join('')}
    <button class="btn ghost" id="orgNew" style="margin-top:6px">Start another roster</button>
  </div>`;
  $("#orgDone").onclick=()=>renderApp('account');
  $("#orgNew").onclick=openOrgCreate;
  root.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>openOrgRoster(b.dataset.t));
}

function sportName(k){ return state.ref?.sports.find(x=>x.key===k)?.name || k || ''; }

function orgError(retry){
  root.innerHTML = H`<div class="app-pad org-page" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h1 style="font-size:22px">Organization</h1><button class="pill" id="orgErrDone">Done</button>
    </div>
    <div class="card app-pad"><div class="empty">Couldn't load. Check your connection and retry.</div>
      <button class="btn ghost" id="orgErrRetry" style="margin-top:12px">Retry</button></div>
  </div>`;
  $("#orgErrDone").onclick=()=>renderApp('account');
  $("#orgErrRetry").onclick=retry;
}

// ---- create a roster: this account becomes its admin (teams.created_by), no separate signup ----
async function openOrgCreate(){
  const sports=state.ref?.sports||[];
  root.innerHTML = H`<div class="app-pad org-page org-create" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h1 style="font-size:22px">Start a roster</h1><button class="pill" id="orgCancel">Cancel</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px">For a team, league, or club — one roster you
      can see all at once, and the coaches connected to it. Stats and measurements only, same ceiling as
      Team Connect: never games, journey, or photos. Families join with a code you share; nobody is added
      without one.</p>
    <div class="field"><label for="ocName">Name</label><input id="ocName" maxlength="120" placeholder="e.g. Eastside Youth Soccer"/></div>
    <div class="field"><label for="ocSport">Sport</label><select id="ocSport"><option value="">Select…</option>
      ${sports.map(s=>`<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="ocLevel">Level — optional</label><input id="ocLevel" maxlength="60" placeholder="e.g. U12, Varsity"/></div>
    <div class="field"><label>Practice days — optional</label>${schedChips([],'ocDays')}</div>
    <div class="field"><label for="ocGameDay">Game day — optional</label>
      <select id="ocGameDay"><option value="">—</option>
        ${DAY_LABELS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></div>
    <div class="err" id="ocErr" role="alert"></div>
    <button class="btn amber" id="ocGo" style="margin-top:6px">Create roster</button>
  </div>`;
  $("#orgCancel").onclick=()=>renderApp('account');
  let days=[];
  root.querySelectorAll('#ocDays .chip').forEach(c=>c.onclick=()=>{
    const i=Number(c.dataset.d); days=days.includes(i)?days.filter(x=>x!==i):[...days,i];
    c.classList.toggle('on', days.includes(i));
    c.setAttribute('aria-pressed',String(days.includes(i)));
  });
  $("#ocGo").onclick=async e=>{
    const btn=$('#ocGo'); if(btn.disabled) return;
    const name=($("#ocName").value||'').trim();
    const sport=$("#ocSport").value;
    const level=($("#ocLevel").value||'').trim();
    const gd=$("#ocGameDay").value;
    const err=$("#ocErr"); err.textContent='';
    if(!name){ err.textContent='Give the roster a name.'; return; }
    if(!sport){ err.textContent='Pick a sport.'; return; }
    if(gd!==''&&days.includes(Number(gd))){err.textContent='That day is already a practice day — pick a different game day.';return;}
    if(days.length>=6){err.textContent='Six or more practice days doesn’t leave room to recover. Double-check the schedule.';return;}
    btn.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; btn.disabled=true;
    const row={ name, sport_key:sport, created_by:state.user.id, is_active:true };
    if(level) row.level=level;
    if(days.length) row.practice_days=days.sort((a,b)=>a-b);
    if(gd!=='') row.game_day=parseInt(gd,10);
    let created=null;
    try{
      for(let attempt=0; attempt<5 && !created; attempt++){
        const { data, error }=await sb.from('teams').insert({ ...row, join_code:orgCode() }).select('id').maybeSingle();
        if(!error){ created=data; break; }
        if(error.code!=='23505') throw error;
        // 23505 = join_code collision, vanishingly rare — just try a fresh code.
      }
      if(!created){err.textContent='Could not generate a unique code — try again.';return;}
      logUsageEvent('org_roster_created');
      toast('Roster created 🎉');
      await openOrgRoster(created.id);
      }catch(error){console.error(error);err.textContent='Could not create that — check your connection and try again.';}
    finally{btn.innerHTML='Create roster';btn.disabled=false;}
  };
}

// ---- the roster-wide table + coach-connection oversight ----
async function openOrgRoster(teamId){
  logUsageEvent('org_roster_viewed');
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let team, memberships=[], athletes=[], sports=[], meas=[], access=[];
  try{
    const { data:t, error:te }=await sb.from('teams').select('*').eq('id',teamId).maybeSingle();
    if(te) throw te; if(!t){ toast('Roster not found'); return renderApp('account'); }
    team=t;
    const { data:tm, error:tme }=await sb.from('team_memberships').select('athlete_id').eq('team_id',teamId);
    if(tme) throw tme; memberships=tm||[];
    const ids=memberships.map(m=>m.athlete_id);
    if(ids.length){
      const [a,s,m,ac]=await Promise.all([
        sb.from('athletes').select('id,first_name,birthdate').in('id',ids),
        sb.from('athlete_sports').select('athlete_id,sport_key,positions,level,is_primary').in('athlete_id',ids),
        // Order fully, not just by date. measured_on is a DATE and one body scan writes
        // twenty-five rows sharing it, so ordering by date alone leaves the winner of the
        // tie to Postgres — and the roster card showed a different one of the athlete’s
        // twenty-five metrics between page loads. Same fault the goals query fixed in
        // screen-week.js. created_at breaks the tie by what was actually recorded last,
        // and id makes it total.
        sb.from('measurements').select('id,athlete_id,metric_key,value,unit,measured_on,created_at').in('athlete_id',ids)
          .order('measured_on',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}),
        sb.from('athlete_access').select('athlete_id,guardian_id').in('athlete_id',ids).eq('role','coach').is('revoked_at',null),
      ]);
      const failed=[a,s,m,ac].find(result=>result.error);
      if(failed) throw failed.error;
      athletes=a.data||[]; sports=s.data||[]; meas=m.data||[]; access=ac.data||[];
    }
  }catch(err){ console.error(err); return orgError(()=>openOrgRoster(teamId)); }

  const coachIds=Array.from(new Set(access.map(r=>r.guardian_id)));
  const coachName=new Map();
  if(coachIds.length){
    const { data:gs }=await sb.from('guardians').select('id,display_name').in('id',coachIds);
    (gs||[]).forEach(g=>coachName.set(g.id,(g.display_name||'').trim()||'A coach'));
  }

  const latestByAthlete={};
  for(const r of meas) if(!latestByAthlete[r.athlete_id]) latestByAthlete[r.athlete_id]=r;
  const sportsByAthlete={};
  for(const s of sports){ const cur=sportsByAthlete[s.athlete_id]; if(!cur||s.is_primary) sportsByAthlete[s.athlete_id]=s; }
  const coachesByAthlete={};
  for(const r of access) (coachesByAthlete[r.athlete_id]=coachesByAthlete[r.athlete_id]||[]).push(coachName.get(r.guardian_id)||'A coach');

  const rows=athletes.slice().sort((x,y)=>(x.first_name||'').localeCompare(y.first_name||''));

  root.innerHTML = H`<div class="app-pad org-page" style="padding-top:22px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <button class="pill" id="orgBack">‹ Rosters</button><button class="pill" id="orgDone2">Done</button>
    </div>
    <h1 style="font-size:22px;margin:0 0 2px">${esc(team.name)}</h1>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px">${esc(sportName(team.sport_key))}${team.level?' · '+esc(team.level):''} · ${rows.length} on roster</p>
    <button class="btn ghost" id="orgBodyInsights" style="margin-bottom:16px">Body assessment dashboard</button>

    <div class="card app-pad" style="margin-bottom:16px">
      <div class="mrow"><span>Join code</span><b style="letter-spacing:.06em;font-family:ui-monospace,monospace">${esc(team.join_code||'—')}</b></div>
      <button class="btn sm ghost" id="orgCopyCode" ${team.join_code?'':'disabled'} style="margin-top:10px">Copy join code</button>
      <p style="font-size:12.5px;color:var(--muted);margin:8px 2px 0">Ask families to open Profile → Account &amp; settings → Join with a code.
        Joining shares their child's stats and measurements with this roster. Using the code during setup only prefills the schedule.</p>
    </div>

    <div class="sec-title">Roster</div>
    ${rows.length ? rows.map(a=>{
        const age=ageFrom(a.birthdate);
        const sp=sportsByAthlete[a.id];
        const spLabel=sp?[sportName(sp.sport_key),(sp.positions||[]).join('/'),sp.level].filter(Boolean).join(' · '):'—';
        const latest=latestByAthlete[a.id];
        const coaches=coachesByAthlete[a.id]||[];
        return H`<button class="card app-pad" data-a="${esc(a.id)}" style="width:100%;text-align:left;display:block;margin-bottom:10px;border:none;cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div style="min-width:0">
              <b style="font-size:15px">${esc(a.first_name)}${age!=null?', '+age:''}</b>
              <div style="color:var(--muted);font-size:12.5px;margin-top:2px">${esc(spLabel)}</div>
            </div>
            <div style="text-align:right;flex:none">
              ${latest?H`<b style="font-size:13px">${esc(fmtMeasure(latest.metric_key,latest.value,latest.unit))}</b>
                <div style="font-size:11px;color:var(--muted)">${esc(metricName(latest.metric_key))}</div>`
                :`<span style="font-size:12px;color:var(--muted)">No stats yet</span>`}
            </div>
          </div>
          ${coaches.length?H`<p style="font-size:11.5px;color:var(--muted);margin:8px 2px 0">Connected: ${esc(coaches.join(', '))}</p>`:''}
        </button>`;
      }).join('')
      : `<div class="card app-pad"><div class="empty">Nobody's joined yet — share the code above.</div></div>`}
  </div>`;
  $("#orgBack").onclick=openMyOrg;
  $("#orgDone2").onclick=()=>renderApp('account');
  $("#orgBodyInsights").onclick=()=>openOrgBodyInsights(teamId);
  $('#orgCopyCode').onclick=async()=>{
    try{await navigator.clipboard.writeText(team.join_code);toast('Join code copied');}
    catch(error){toast('Select the join code above to copy it');}
  };
  root.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>openOrgAthleteDetail(b.dataset.a, athletes, sports, meas, coachesByAthlete));
}

// One athlete's full stat list — connection-only oversight, so this never reaches
// coach_updates; RLS wouldn't return it even if it tried.
function openOrgAthleteDetail(athleteId, athletes, sports, meas, coachesByAthlete){
  const a=athletes.find(x=>x.id===athleteId); if(!a) return;
  const age=ageFrom(a.birthdate);
  const mine=meas.filter(m=>m.athlete_id===athleteId);
  const latest={};
  for(const r of mine) if(!latest[r.metric_key]) latest[r.metric_key]=r;
  const statRows=Object.values(latest).sort((x,y)=>(x.metric_key<y.metric_key?-1:1));
  const coaches=coachesByAthlete[athleteId]||[];
  const bg=sheet(H`<h3>${esc(a.first_name)}${age!=null?', '+age:''}</h3>
    <div class="sec-title" style="margin-top:10px">Current stats</div>
    ${statRows.length?H`<div class="card app-pad">
        ${statRows.map(r=>H`<div class="mrow">
          <span>${esc(metricName(r.metric_key))} · ${esc(fmtDate(r.measured_on))}</span>
          <b>${esc(fmtMeasure(r.metric_key,r.value,r.unit))}</b></div>`).join('')}
      </div>` : `<p class="empty">No measurements recorded yet.</p>`}
    <div class="sec-title" style="margin-top:16px">Connected coaches</div>
    ${coaches.length?H`<div class="card app-pad">${coaches.map(c=>H`<div class="mrow"><span>${esc(c)}</span></div>`).join('')}</div>`
      :`<p class="empty">No coach connected yet.</p>`}
    <button class="btn ghost" id="oadClose" style="margin-top:14px">Close</button>`);
  bg.querySelector('#oadClose').onclick=()=>bg.remove();
}
