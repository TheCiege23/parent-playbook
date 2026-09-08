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
  if(!state.athletes.length){ toast('Add a child first'); return; }
  const athletes=state.athletes;
  const bg=sheet(H`<h3>Join a team or organization</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Enter the code you were given. This adds
      your child to that roster — stats and measurements only, the same as Team Connect. Never games,
      journey, or photos.</p>
    ${athletes.length>1?H`<div class="field"><label>Which child?</label>
      <select id="jtAthlete">${athletes.map(a=>`<option value="${esc(a.id)}">${esc(a.first_name)}</option>`).join('')}</select></div>`:''}
    <div class="field"><label>Team code</label><input id="jtCode" placeholder="e.g. BEARS26" autocapitalize="characters"/></div>
    <div class="err" id="jtErr"></div>
    <button class="btn amber" id="jtGo">Join</button>`);
  bg.querySelector('#jtGo').onclick=async e=>{
    const athleteId=athletes.length>1?bg.querySelector('#jtAthlete').value:athletes[0].id;
    const code=(bg.querySelector('#jtCode').value||'').trim();
    const err=bg.querySelector('#jtErr'); err.textContent='';
    if(!code){ err.textContent='Enter the code you were given.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const reset=()=>{ e.target.innerHTML='Join'; e.target.disabled=false; };
    let data,error;
    try{ ({data,error}=await sb.rpc('team_by_code',{ p_code:code })); }
    catch(ex){ console.error(ex); err.textContent='Could not check that code — try again.'; reset(); return; }
    if(error){ console.error(error); err.textContent='Could not check that code — try again.'; reset(); return; }
    const t=(data||[])[0];
    if(!t){ err.textContent="We don't recognise that code. Check it with whoever gave it to you."; reset(); return; }
    // Guard against a double-join: season is nullable, so the DB's unique constraint
    // (athlete_id, team_id, season) doesn't catch two null-season rows on its own.
    const { data:existing }=await sb.from('team_memberships').select('id').eq('athlete_id',athleteId).eq('team_id',t.id).limit(1);
    if(existing && existing.length){ err.textContent='Already on that roster.'; reset(); return; }
    const { error:ie }=await sb.from('team_memberships').insert({ athlete_id:athleteId, team_id:t.id });
    if(ie){ console.error(ie); err.textContent='Could not join — try again.'; reset(); return; }
    try{ await sb.rpc('team_code_used',{ p_code:code }); }catch(ex){ console.error(ex); }
    logUsageEvent('team_joined');
    bg.remove(); toast('Joined '+(t.name||'the roster'));
  };
}

// ---- entry point from Account: your own roster(s), or start one ----
async function openMyOrg(){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  let teams=[];
  try{
    const { data, error }=await sb.from('teams').select('id,name,sport_key,join_code,is_active')
      .eq('created_by',state.user.id).order('created_at',{ascending:true});
    if(error) throw error; teams=data||[];
  }catch(err){ console.error(err); return orgError(openMyOrg); }
  if(teams.length===1) return openOrgRoster(teams[0].id);
  if(!teams.length) return openOrgCreate();
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
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
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
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
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h1 style="font-size:22px">Start a roster</h1><button class="pill" id="orgCancel">Cancel</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px">For a team, league, or club — one roster you
      can see all at once, and the coaches connected to it. Stats and measurements only, same ceiling as
      Team Connect: never games, journey, or photos. Families join with a code you share; nobody is added
      without one.</p>
    <div class="field"><label>Name</label><input id="ocName" placeholder="e.g. Eastside Youth Soccer"/></div>
    <div class="field"><label>Sport</label><select id="ocSport"><option value="">Select…</option>
      ${sports.map(s=>`<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Level — optional</label><input id="ocLevel" placeholder="e.g. U12, Varsity"/></div>
    <div class="field"><label>Practice days — optional</label>${schedChips([],'ocDays')}</div>
    <div class="field"><label>Game day — optional</label>
      <select id="ocGameDay"><option value="">—</option>
        ${DAY_LABELS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></div>
    <div class="err" id="ocErr"></div>
    <button class="btn amber" id="ocGo" style="margin-top:6px">Create roster</button>
  </div>`;
  $("#orgCancel").onclick=()=>renderApp('account');
  let days=[];
  root.querySelectorAll('#ocDays .chip').forEach(c=>c.onclick=()=>{
    const i=Number(c.dataset.d); days=days.includes(i)?days.filter(x=>x!==i):[...days,i];
    c.classList.toggle('on', days.includes(i));
  });
  $("#ocGo").onclick=async e=>{
    const name=($("#ocName").value||'').trim();
    const sport=$("#ocSport").value;
    const level=($("#ocLevel").value||'').trim();
    const gd=$("#ocGameDay").value;
    const err=$("#ocErr"); err.textContent='';
    if(!name){ err.textContent='Give the roster a name.'; return; }
    if(!sport){ err.textContent='Pick a sport.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const row={ name, sport_key:sport, created_by:state.user.id, is_active:true };
    if(level) row.level=level;
    if(days.length) row.practice_days=days.sort((a,b)=>a-b);
    if(gd!=='') row.game_day=parseInt(gd,10);
    let created=null;
    for(let attempt=0; attempt<5 && !created; attempt++){
      const { data, error }=await sb.from('teams').insert({ ...row, join_code:orgCode() }).select('id').maybeSingle();
      if(!error){ created=data; break; }
      if(error.code!=='23505'){ console.error(error); err.textContent='Could not create that — try again.'; e.target.innerHTML='Create roster'; e.target.disabled=false; return; }
      // 23505 = join_code collision, vanishingly rare — just try a fresh code.
    }
    if(!created){ err.textContent='Could not generate a unique code — try again.'; e.target.innerHTML='Create roster'; e.target.disabled=false; return; }
    logUsageEvent('org_roster_created');
    toast('Roster created 🎉');
    openOrgRoster(created.id);
  };
}

// ---- the roster-wide table + coach-connection oversight ----
async function openOrgRoster(teamId){
  logUsageEvent('org_roster_viewed');
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
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
        sb.from('measurements').select('athlete_id,metric_key,value,unit,measured_on').in('athlete_id',ids).order('measured_on',{ascending:false}),
        sb.from('athlete_access').select('athlete_id,guardian_id').in('athlete_id',ids).eq('role','coach').is('revoked_at',null),
      ]);
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

  root.innerHTML = H`<div class="app-pad" style="padding-top:22px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <button class="pill" id="orgBack">‹ Rosters</button><button class="pill" id="orgDone2">Done</button>
    </div>
    <h1 style="font-size:22px;margin:0 0 2px">${esc(team.name)}</h1>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px">${esc(sportName(team.sport_key))}${team.level?' · '+esc(team.level):''} · ${rows.length} on roster</p>

    <div class="card app-pad" style="margin-bottom:16px">
      <div class="mrow"><span>Join code</span><b style="letter-spacing:.06em;font-family:ui-monospace,monospace">${esc(team.join_code||'—')}</b></div>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 2px 0">Share this with families — entering it adds
        their child to this roster. Nobody is added without it.</p>
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
