// ===================================================================
//  COACH VIEW — Team Connect's restricted screen, not a cut-down app shell
// ===================================================================
// A coach never sees renderApp()'s normal 7-tab shell. Not because a tab is hidden —
// because retrofitting Week/Journey/Activity to each notice "I'm being viewed by a
// coach, render nothing" is how a permission boundary quietly grows a hole in it over
// time. This screen shows exactly what a coach-role athlete_access row can actually
// reach: the athlete's core profile, their measurements, and the coach_updates thread
// (RLS enforces the same boundary server-side — see TEAM-CONNECT-EXPANSION-PLAN.md).
//
// Reuses topBar()/bindTop() from shell.js as-is: athlete switcher (for a coach
// connected to more than one athlete) and Log out already work exactly as they do
// everywhere else in the app, with no coach-specific branching needed in either.

const COACH_KIND = {
  general:      { label:'General',      pill:'' },
  workout:      { label:'Workout',      pill:'' },
  nutrition:    { label:'Nutrition',    pill:'' },
  announcement: { label:'Announcement', pill:'ann' },
};

async function renderCoachView(){
  const a = state.active;
  if(!a){ return screenError('week'); }   // no athlete resolved — same fallback every other screen uses

  root.innerHTML = H`
    <div id="screen"></div>
    <nav class="nav" id="nav">
      <div class="sb-brand" aria-hidden="true"><span class="mk">P</span><b>Parent Playbook</b></div>
      <div class="sb-foot" aria-hidden="true">
        <img src="/assets/brownpig-logo-ondark.png" alt="" width="112" height="112"/>
        <span>A Brown Pig company</span>
      </div>
    </nav>`;
  await screenCoach();
}

// ---------------------------------------------------------------------------
//  PARENT-SIDE VIEW — the read-only feed a guardian sees, opened from Growth.
//  Same table, same RLS, the other direction: a coach writes here, a guardian reads.
// ---------------------------------------------------------------------------
async function openTeamConnect(subject){
  logUsageEvent('team_connect_viewed');
  const a = subject || state.active;
  const bg = sheet(H`<div class="center-screen" style="min-height:24dvh">
    <span class="spinner"></span><div>Loading…</div></div>`);

  const [{ data: updates }, { data: access }] = await Promise.all([
    sb.from('coach_updates').select('id,sender_id,kind,body,created_at')
      .eq('athlete_id', a.id).order('created_at', { ascending:false }).limit(30),
    sb.from('athlete_access').select('guardian_id').eq('athlete_id', a.id)
      .eq('role','coach').is('revoked_at', null),
  ]);

  const senderName = new Map();
  const ids = Array.from(new Set((updates||[]).map(u=>u.sender_id)));
  if(ids.length){
    const { data: gs } = await sb.from('guardians').select('id,display_name').in('id', ids);
    (gs||[]).forEach(g => senderName.set(g.id, (g.display_name||'').trim() || 'A coach'));
  }

  bg.remove();
  const bg2 = sheet(H`<h3>Team Connect</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Stats and measurements are shared with any
      coach or trainer you've connected below — never games, journey, or photos. Updates they send show up here.</p>

    ${(updates||[]).length ? H`<div class="card app-pad">
        ${updates.map(u=>H`<div style="padding:10px 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
            <b style="font-size:13px">${esc(senderName.get(u.sender_id) || 'A coach')}</b>
            <span style="font-size:11.5px;color:var(--muted)">${esc(fmtDate(u.created_at.slice(0,10)))}</span>
          </div>
          ${u.kind==='announcement'?H`<span class="pill" style="background:var(--amber-pale,#FCEEDA);
            color:var(--amber-ink,#8A5A16);margin:4px 0;display:inline-block">Announcement</span>`
            : u.kind==='nutrition' ? H`<span class="pill" style="margin:4px 0;display:inline-block">Nutrition</span>` : ''}
          <p style="font-size:14px;margin:4px 0 0;white-space:pre-wrap">${esc(u.body)}</p>
        </div>`).join('')}
      </div>`
      : H`<p class="empty">No updates yet.</p>`}

    <div class="sec-title" style="margin-top:18px">Connected</div>
    ${(access||[]).length
      ? H`<div class="card app-pad"><div class="mrow"><span>Coach / trainer access</span>
          <b>${access.length} connected</b></div>
          <p style="font-size:11.5px;color:var(--muted);margin:8px 2px 0">Manage or revoke from Profile, under
            "Who can see ${esc(a.first_name)}".</p></div>`
      : H`<div class="card app-pad"><div class="navrow" id="tcInvite" role="button" tabindex="0">
          <div class="gi">＋</div><div class="gt"><b>Invite a coach or trainer</b>
            <span>Someone you already work with — access is stats-only and revocable anytime.</span></div><i>›</i></div>
        </div>`}

    <button class="btn ghost" id="tcClose" style="margin-top:16px">Close</button>`);
  bg2.querySelector('#tcClose').onclick = () => bg2.remove();
  const inv = bg2.querySelector('#tcInvite');
  if(inv) inv.onclick = () => { bg2.remove(); openInvite(); };
}

async function screenCoach(){
  const a = state.active;
  const [{ data: sports }, { data: measRows }, { data: updates }] = await Promise.all([
    sb.from('athlete_sports').select('sport_key,positions,level,is_primary').eq('athlete_id', a.id),
    sb.from('measurements').select('metric_key,value,unit,measured_on')
      .eq('athlete_id', a.id).order('measured_on', { ascending:false }).limit(100),
    sb.from('coach_updates').select('id,sender_id,kind,body,created_at')
      .eq('athlete_id', a.id).order('created_at', { ascending:false }).limit(30),
  ]);

  const primary = (sports||[]).find(s=>s.is_primary) || (sports||[])[0];
  const sportName = state.ref?.sports.find(x=>x.key===primary?.sport_key)?.name || '';
  const age = ageFrom(a.birthdate);
  const sub = [sportName, (primary?.positions||[]).join('/'), primary?.level].filter(Boolean).join(' · ');

  // Newest reading per metric — a coach needs "where things stand," not a full history.
  const latest = {};
  for(const r of (measRows||[])) if(!latest[r.metric_key]) latest[r.metric_key] = r;
  const statRows = Object.values(latest).sort((x,y)=> (x.metric_key<y.metric_key?-1:1));

  const senderName = new Map();
  for(const u of (updates||[])) if(!senderName.has(u.sender_id))
    senderName.set(u.sender_id, u.sender_id===state.user.id ? 'You' : null);
  const unresolved = Array.from(senderName.entries()).filter(([,v])=>v===null).map(([k])=>k);
  if(unresolved.length){
    const { data: gs } = await sb.from('guardians').select('id,display_name').in('id', unresolved);
    (gs||[]).forEach(g => senderName.set(g.id, (g.display_name||'').trim() || 'A parent'));
  }

  $("#screen").innerHTML = H`
    ${topBar(sub||'Team Connect', '<span class="pill" style="background:var(--green-pale);color:var(--green-d)">Coach view</span>')}
    <div class="app-pad" style="padding-top:6px">

      <div class="card app-pad">
        <h3 style="font-size:19px">${esc(a.first_name)}${age!=null?', '+age:''}</h3>
        <p style="font-size:13px;color:var(--muted);margin:3px 0 0">${esc(sub||'No sport set')}</p>
        <p style="font-size:12px;color:var(--muted-soft,var(--muted));margin:10px 0 0">You have Team Connect access —
          stats and measurements only. No games, journey, photos, or weekly plan.</p>
      </div>

      <div class="sec-title" style="margin-top:18px">Current stats</div>
      ${statRows.length ? H`<div class="card app-pad">
          ${statRows.map(r=>H`<div class="mrow">
            <span>${esc(metricName(r.metric_key))} · ${esc(fmtDate(r.measured_on))}</span>
            <b>${esc(fmtMeasure(r.metric_key, r.value, r.unit))}</b></div>`).join('')}
        </div>`
        : H`<p class="empty">No measurements recorded yet.</p>`}

      <div class="sec-title" style="margin-top:22px">Send an update</div>
      <div class="card app-pad">
        <div class="chipgrid" id="cuKind" style="grid-template-columns:repeat(2,1fr)">
          ${Object.entries(COACH_KIND).map(([k,v],i)=>H`<div class="chip ${i===0?'on':''}" data-k="${k}">${esc(v.label)}</div>`).join('')}
        </div>
        <div class="err" id="cuNote" style="display:none;margin-top:10px;color:var(--amber-ink,#8A5A16);
          background:var(--amber-pale,#FCEEDA);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.5">
          This is your personal recommendation, not medical advice — the family should check with a
          pediatrician or dietitian before changing what ${esc(a.first_name)} eats.
        </div>
        <textarea id="cuBody" rows="3" maxlength="4000" placeholder="What's next for ${esc(a.first_name)}…"
          style="width:100%;margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;
          font:inherit;resize:vertical"></textarea>
        <div class="err" id="cuErr"></div>
        <button class="btn amber" id="cuSend" style="margin-top:10px">Send to the family</button>
      </div>

      <div class="sec-title" style="margin-top:22px">Updates</div>
      ${(updates||[]).length ? H`<div class="card app-pad">
          ${updates.map(u=>H`<div style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
              <b style="font-size:13px">${esc(senderName.get(u.sender_id) || 'A parent')}</b>
              <span style="font-size:11.5px;color:var(--muted)">${esc(fmtDate(u.created_at.slice(0,10)))}</span>
            </div>
            ${u.kind==='announcement'?H`<span class="pill" style="background:var(--amber-pale,#FCEEDA);
              color:var(--amber-ink,#8A5A16);margin:4px 0;display:inline-block">Announcement</span>`
              : u.kind!=='general' ? H`<span class="pill" style="margin:4px 0;display:inline-block">${esc(COACH_KIND[u.kind]?.label||u.kind)}</span>` : ''}
            <p style="font-size:14px;margin:4px 0 0;white-space:pre-wrap">${esc(u.body)}</p>
          </div>`).join('')}
        </div>`
        : H`<p class="empty">No updates sent yet.</p>`}
    </div>`;
  bindTop();

  let kind = 'general';
  const kindBox = $("#cuKind"), note = $("#cuNote");
  kindBox.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    kind = c.dataset.k;
    kindBox.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on', x===c));
    note.style.display = (kind==='nutrition') ? 'block' : 'none';
  });

  $("#cuSend").onclick = async e => {
    const body = ($("#cuBody").value||'').trim();
    const err = $("#cuErr"); err.textContent = '';
    if(!body){ err.textContent = 'Write something before sending.'; return; }
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const { error } = await sb.from('coach_updates').insert({
      athlete_id: a.id, sender_id: state.user.id, kind, body,
    });
    if(error){
      console.error(error);
      err.textContent = 'Could not send that.';
      e.target.innerHTML = 'Send to the family'; e.target.disabled = false;
      return;
    }
    logUsageEvent('team_connect_update_sent');
    toast('Sent');
    screenCoach();
  };
}
