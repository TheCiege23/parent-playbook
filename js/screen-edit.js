// ===================================================================
//  EDIT ATHLETE
//  Everything onboarding captures, changeable afterwards. Before this
//  existed the only way to fix a typo'd birthdate or a changed position
//  was deleting the athlete — losing every game, milestone, photo and
//  measurement along with them.
// ===================================================================
const ed = { first:'', nick:'', bd:'', hand:'', sport:'', origSport:'', positions:[], level:'', sportRowId:null };

async function openEditAthlete(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading…</div></div>`;
  try{ await loadRef(); }catch(err){ console.error(err); return bootError(); }
  const a=state.active;
  let rows=[];
  try{
    const { data, error }=await sb.from('athlete_sports').select('*').eq('athlete_id',a.id).order('created_at');
    if(error) throw error; rows=data||[];
  }catch(err){ console.error(err); return bootError(); }
  const primary=rows.find(s=>s.is_primary)||rows[0]||null;
  const sportKey=primary?(primary.sport_key||''):'';
  Object.assign(ed,{
    first:a.first_name||'',
    nick:a.nickname||'',
    bd:(a.birthdate||'').slice(0,10),
    hand:a.dominant_hand||'',
    sport:sportKey,
    origSport:sportKey,
    positions:primary?[...(primary.positions||[])]:[],
    level:primary?(primary.level||''):'',
    sportRowId:primary?primary.id:null,
  });
  edRender();
}

// live preview so a birthdate change doesn't silently move the training band
function edBandNote(bd){
  const age=ageFrom(bd);
  if(age==null) return '';
  const band=ageBand(age);
  const label={littles:'ages 3–6',youth:'ages 7–9',preteen:'ages 10–12',teen:'ages 13–15',older:'ages 16–19'}[band];
  const warn=(age<3||age>19);
  return `<p style="font-size:11.5px;color:${warn?'var(--danger)':'var(--muted)'};margin:6px 2px 0">
    ${warn?'That works out to '+age+' years old — check the date.'
          :'Age '+age+' → plans built for <b>'+label+'</b>.'}</p>`;
}

function edRender(){
  const a=state.active;
  const sports=(state.ref&&state.ref.sports)||[];
  const levels=ed.sport?(sports.find(s=>s.key===ed.sport)||{}).level_vocab||[]:[];
  const sportChanged=ed.sport&&ed.origSport&&ed.sport!==ed.origSport;
  root.innerHTML = H`<div class="app-pad" style="padding-top:22px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <button class="pill" id="edBack">‹ Profile</button>
      <span class="pill">Editing</span>
    </div>
    <h1 style="font-size:22px;margin:0 0 2px">Edit ${esc(a.first_name)}</h1>
    <p style="color:var(--muted);font-size:13px;margin:0 0 16px">Changes apply to the weekly plan right away. Games, milestones, photos and measurements are never affected.</p>

    <div class="sec-title">The athlete</div>
    <div class="field"><label>First name</label><input id="edFirst" value="${esc(ed.first)}" placeholder="Marcus"/></div>
    <div class="field"><label>Nickname (optional)</label><input id="edNick" value="${esc(ed.nick)}" placeholder="What you actually call them"/></div>
    <div class="field"><label>Birthdate</label>
      <input id="edBd" type="date" value="${esc(ed.bd)}" max="${new Date().toISOString().slice(0,10)}"/>
      <div id="edBand">${edBandNote(ed.bd)}</div></div>
    <div class="field"><label>Dominant hand (optional)</label>
      <div class="chipgrid" id="edHand">
        ${['left','right','both'].map(h=>`<div class="chip ${ed.hand===h?'on':''}" data-h="${h}">${h[0].toUpperCase()+h.slice(1)}</div>`).join('')}
      </div></div>

    <div class="sec-title">The sport</div>
    <div class="field"><label>Sport</label>
      <div class="chipgrid" id="edSport">
        ${sports.map(s=>`<div class="chip ${ed.sport===s.key?'on':''}" data-s="${esc(s.key)}">${esc(s.name)}</div>`).join('')}
      </div>
      ${sportChanged?`<p style="font-size:11.5px;color:#9a4a12;margin:6px 2px 0">Switching sport clears the positions below — pick new ones. Practice days and everything in the Journey stay put.</p>`:''}
    </div>
    ${ed.sport?H`
      <div class="field"><label>Position(s)</label>
        ${posChips(ed.sport, ed.positions, 'edPos')}
        <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Tap all that apply — the weekly drills follow these.</p>
      </div>
      <div class="field"><label>Level</label>
        <select id="edLevel"><option value="">Select level…</option>
          ${levels.map(l=>`<option ${ed.level===l?'selected':''}>${esc(l)}</option>`).join('')}
        </select></div>`:''}

    <div class="err" id="edErr"></div>
    <div class="row2" style="margin-top:8px">
      <button class="btn ghost" id="edCancel">Cancel</button><button class="btn" id="edSave">Save changes</button>
    </div>
    <p class="muted-note">Need to remove this athlete entirely? That's on the Profile screen.</p>
  </div>`;

  $("#edBack").onclick=()=>renderApp('profile');
  $("#edCancel").onclick=()=>renderApp('profile');
  $("#edFirst").oninput=e=>ed.first=e.target.value;
  $("#edNick").oninput=e=>ed.nick=e.target.value;
  $("#edBd").onchange=e=>{ ed.bd=e.target.value; const n=$("#edBand"); if(n) n.innerHTML=edBandNote(ed.bd); };
  $("#edHand").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    ed.hand = ed.hand===c.dataset.h?'':c.dataset.h;
    $("#edHand").querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x.dataset.h===ed.hand));
  });
  $("#edSport").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    if(ed.sport===c.dataset.s) return;
    ed.sport=c.dataset.s; ed.positions=[]; ed.level='';   // codes and levels are per-sport
    edRender();
  });
  { const p=$("#edPos"); if(p) p.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
      const code=c.dataset.p;
      ed.positions = ed.positions.includes(code)?ed.positions.filter(x=>x!==code):[...ed.positions,code];
      c.classList.toggle('on');
    }); }
  { const l=$("#edLevel"); if(l) l.onchange=()=>ed.level=l.value; }
  $("#edSave").onclick=edSave;
}

async function edSave(){
  const errEl=$("#edErr"); errEl.textContent='';
  const first=(ed.first||'').trim();
  if(!first){ errEl.textContent="First name can't be empty."; return; }
  if(!ed.bd){ errEl.textContent='Add a birthdate so plans fit their age.'; return; }
  const age=ageFrom(ed.bd);
  if(age===null||age<3||age>19){ errEl.textContent='Enter a realistic birthdate (ages 3–19).'; return; }
  if(ed.sport){
    if(!ed.positions.length){ errEl.textContent='Choose at least one position.'; return; }
    if(!ed.level){ errEl.textContent='Select a level.'; return; }
  }
  const btn=$("#edSave"); const label=btn.textContent;
  btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
  try{
    const { error:ae }=await sb.from('athletes').update({
      first_name:first, nickname:(ed.nick||'').trim()||null,
      birthdate:ed.bd, dominant_hand:ed.hand||null,
    }).eq('id',state.active.id);
    if(ae) throw ae;

    if(ed.sportRowId){
      const { error:se }=await sb.from('athlete_sports').update({
        sport_key:ed.sport, positions:ed.positions, level:ed.level||null,
      }).eq('id',ed.sportRowId);
      if(se) throw se;
    }

    // reload so every screen (and the plan) reflects the change immediately
    await loadAthletes();
    state.active = state.athletes.find(x=>x.id===state.active.id) || state.athletes[0];
    state.activeSportKey = ed.sport || state.activeSportKey;
    toast('Saved ✓');
    renderApp('profile');
  }catch(err){
    console.error(err);
    // athlete_sports has UNIQUE(athlete_id, sport_key) — switching to a sport the
    // athlete already has would surface as a raw Postgres 23505 otherwise.
    errEl.textContent = (err.code==='23505' || /duplicate key/i.test(err.message||''))
      ? `${esc(state.active.first_name)} already has that sport set up.`
      : 'Could not save. '+(err.message||'');
    btn.innerHTML=label; btn.disabled=false;
  }
}
