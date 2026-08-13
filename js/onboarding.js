// ===================================================================
//  ONBOARDING — teaching while collecting
// ===================================================================
const OB_BLANK = { i:0, mode:'create', familyId:null, familyName:'', athlete:{first:'',bd:'',hand:'',height:'',weight:''}, sport:'', positions:[], level:'', parentExp:'', practiceDays:[], gameDay:null, seasonStart:null, goals:[], consents:{}, teamCode:'', teamName:'' };
const ob = { ...OB_BLANK };
function obReset(patch){ Object.assign(ob, JSON.parse(JSON.stringify(OB_BLANK)), patch||{}); }
const PARENT_EXP=[['','No'],['kid','As a kid'],['jr_high','Jr high'],['hs','High school'],['college','College'],['pro','Pro/elite']];

// Look up a team code and fill in everything it knows. Shared by the coach's link and by
// typing the code in by hand. Returns '' on success or a message to show.
async function obApplyTeamCode(code){
  code=(code||'').trim();
  if(!code) return 'Enter the code your coach gave you.';
  let data,error;
  try{ ({data,error}=await sb.rpc('team_by_code',{ p_code:code })); }
  catch(e){ console.error(e); return 'Could not check that code — try again.'; }
  if(error){ console.error(error); return 'Could not check that code — try again.'; }
  const t=(data||[])[0];
  if(!t) return "We don't recognise that code. Check it with your coach.";
  ob.teamCode=code; ob.teamName=t.name;
  if(t.sport_key){ ob.sport=t.sport_key; ob.positions=[]; }
  if(t.level) ob.level=t.level;
  if(Array.isArray(t.practice_days)) ob.practiceDays=t.practice_days.map(Number);
  if(t.game_day!=null) ob.gameDay=Number(t.game_day);
  if(t.season_start) ob.seasonStart=t.season_start;
  return '';
}

async function renderOnboarding(){
  document.body.classList.remove('auth'); setAppBg();
  try{ await loadRef(); }catch(err){ console.error(err); return bootError(); }
  obReset();
  // A coach's link (?team=BEARS26) applies before the first screen renders, so the
  // parent never has to find a field or type anything they were sent.
  const linked=teamCodeFromUrl();
  if(linked) await obApplyTeamCode(linked);
  obStep();
}
// full first-run flow vs. adding a sibling into an existing household
// Three steps, not seven. Only four things genuinely have to exist before the app can
// build a safe, useful week: the child's name, their birthdate (which decides what is
// age-appropriate — the single most important input), their sport, and consent.
//
// Everything else moved to where the app ALREADY asks for it, so nothing is lost:
//   household name  -> defaults, renameable in Profile
//   practice days   -> the Week screen already prompts, and a team code pre-fills it
//   goals           -> the Week screen now prompts; Growth has "+ Goal"
//   height/weight   -> Growth has "+ Height" / "+ Weight"
//   position/level  -> optional here, editable in Profile → Edit athlete
// Seven screens is a lot to ask of a parent on a phone who was mildly curious about a
// message in a team chat, and the ones lost to it are the ones who needed it most.
const OB_FLOW = {
  create:   ['child','sport','consent'],
  addChild: ['child','sport','consent'],
};
const OB_VIEW = {welcome:obWelcome,family:obFamily,child:obChild,sport:obSport,schedule:obSchedule,goals:obGoals,consent:obConsent};
const OB_BIND = {welcome:obWelcomeBind,family:obFamilyBind,child:obChildBind,sport:obSportBind,schedule:obScheduleBind,goals:obGoalsBind,consent:obConsentBind};
function obSteps(){ return OB_FLOW[ob.mode]; }
function obStep(){
  const steps = obSteps();
  const name = steps[ob.i];
  const dots = steps.map((_,k)=>`<i class="${k<=ob.i?'on':''}"></i>`).join('');
  // Onboarding has no bottom nav and no top bar, so a signed-in user with no athletes —
  // e.g. straight after deleting their last one — had NO way back to the sign-in screen.
  // Back stops at step 0, and there was nothing else on the page. That is a dead end you
  // can only escape by clearing site data. Always offer a way out.
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    ${state.user?`<div style="display:flex;justify-content:flex-end;margin-bottom:2px">
      <button class="pill" id="obLogout">Log out</button></div>`:''}
    <div class="steps">${dots}</div>
    ${OB_VIEW[name]()}
  </div>`;
  OB_BIND[name]();
  { const lo=$("#obLogout"); if(lo) lo.onclick=async()=>{
      await sb.auth.signOut();
      state.user=null; state.athletes=[]; state.active=null;
      renderAuth('login');
    }; }
  // Enter on a text field advances the step, same as tapping Continue.
  root.querySelectorAll('input[type=text],input:not([type]),input[type=date]').forEach(el=>{
    el.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const n=$("#n"); if(n) n.click(); } });
  });
}
function obNext(){ if(ob.i < obSteps().length-1){ ob.i++; obStep(); } }
// `addChild` is also how we re-enter after deleting the last athlete (keeps the
// household). There's no profile to go back to in that case — state.active is null
// and renderApp would throw — so Back stays put until they finish or log out.
function obBack(){ if(ob.i>0){ ob.i--; obStep(); } else if(ob.mode==='addChild' && state.active){ renderApp('profile'); } }

// step: welcome
function obWelcome(){ return H`
  <div class="ob-head"><div class="k">Let's begin</div><h2>A calmer way to develop your athlete</h2>
  <p>Parent Playbook turns "am I doing this right?" into a simple weekly plan — and teaches you the why as you go.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>You're the coach at home</h4>
    <p>The best youth development happens in short, playful reps — not marathon training. We'll build a balanced week that protects rest and keeps it fun.</p></div></div>
  <div class="card app-pad" style="margin-top:6px">
    <div class="grow"><div class="gi">📅</div><div class="gt"><b>A balanced weekly playbook</b><span>Skill, strength, recovery — age-appropriate.</span></div></div>
    <div class="grow"><div class="gi">📈</div><div class="gt"><b>Track real progress</b><span>Simple measurements, no radar guns required.</span></div></div>
    <div class="grow"><div class="gi">🔗</div><div class="gt"><b>Share with your circle</b><span>Invite a co-parent or grandparent to help.</span></div></div>
  </div>
  ${ob.teamName?H`<div class="card app-pad" style="margin-top:14px;border-color:#CFE3DC;background:#EAF3F0">
    <div class="grow" style="border:none;padding:0"><div class="gi" style="background:#fff">🏅</div>
      <div class="gt"><b>${esc(ob.teamName)}</b><span>Your coach's code is applied — sport, level and practice days are set.</span></div></div>
  </div>`:''}
  <div style="margin-top:20px"><button class="btn" id="n">Get started</button></div>
  ${ob.teamName?'':H`<p class="muted-note" style="margin-top:14px">
    Got a code from your coach? <a href="#" id="obWelcomeCode" style="color:var(--green-d)">Enter it now</a> and we'll fill in the team's schedule.</p>`}`; }
function obWelcomeBind(){ $("#n").onclick=obNext; obBindTeamCodeLink(); }

// The "enter a code" affordance now lives on the first real step (child). Shared so it
// keeps working wherever it is placed.
function obBindTeamCodeLink(){
  const link=$("#obWelcomeCode"); if(!link) return;
  link.onclick=e=>{
    e.preventDefault();
    const bg=sheet(H`<h3>Enter your team code</h3>
      <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Fills in the sport, level and practice schedule. Your coach never sees your child's profile.</p>
      <div class="field"><label>Code</label><input id="tcIn" autocapitalize="characters" placeholder="e.g. BEARS26"/></div>
      <div class="err" id="tcErr"></div>
      <button class="btn" id="tcGo">Apply code</button>
      <button class="btn ghost" id="tcNo" style="margin-top:8px">Skip for now</button>`);
    bg.querySelector('#tcNo').onclick=()=>bg.remove();
    const go=async()=>{
      const b=bg.querySelector('#tcGo'); b.innerHTML='<span class="spinner"></span>'; b.disabled=true;
      const msg=await obApplyTeamCode(bg.querySelector('#tcIn').value);
      b.innerHTML='Apply code'; b.disabled=false;
      if(msg){ bg.querySelector('#tcErr').textContent=msg; return; }
      bg.remove(); obStep();
    };
    bg.querySelector('#tcGo').onclick=go;
    bg.querySelector('#tcIn').addEventListener('keydown',ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); go(); } });
  };
}

// step: family
function obFamily(){ return H`
  <div class="ob-head"><div class="k">Your household</div><h2>Name your family space</h2>
  <p>Everything lives inside one private household you own.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Why a household, not just a kid?</h4>
    <p>Siblings, co-parents, and multiple sports all fit under one roof. It keeps every child's data separate but easy for you to manage in one place.</p></div></div>
  <div class="field"><label>Household name</label><input id="fam" placeholder="e.g. The Henson Family" value="${esc(ob.familyName)}"/></div>
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`; }
function obFamilyBind(){
  $("#b").onclick=obBack;
  $("#n").onclick=()=>{ const v=$("#fam").value.trim(); if(!v){$("#oberr").textContent="Give your household a name.";return;} ob.familyName=v; obNext(); };
}

// step: child
function obChild(){ return H`
  <div class="ob-head"><div class="k">Add your athlete</div><h2>Tell us about your child</h2>
  <p>This creates a profile <b>you</b> own and control — your child never logs in.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Age shapes everything</h4>
    <p>We use your child's age to pick the right drills, durations, and rest. Under-13s develop coordination and love-of-the-game first; specialization can wait.</p></div></div>
  ${ob.teamName?H`<div class="card app-pad" style="margin-bottom:14px;border-color:#CFE3DC;background:#EAF3F0">
    <div class="grow" style="border:none;padding:0"><div class="gi" style="background:#fff">🏅</div>
      <div class="gt"><b>${esc(ob.teamName)}</b><span>Your coach's code is applied — sport, level and practice days are set.</span></div></div>
  </div>`:H`<p class="muted-note" style="text-align:left;margin:0 2px 14px">
    Got a code from your coach? <a href="#" id="obWelcomeCode" style="color:var(--green-d)">Enter it</a> and we'll fill in the team's schedule.</p>`}
  <div class="field"><label>First name</label><input id="cf" placeholder="Marcus" value="${esc(ob.athlete.first)}"/></div>
  <div class="field"><label>Birthdate</label><input id="cb" type="date" value="${esc(ob.athlete.bd)}" max="${new Date().toISOString().slice(0,10)}"/></div>
  <div class="field"><label>Dominant hand (optional)</label>
    <div class="chipgrid" id="hand">
      ${['left','right','both'].map(h=>`<div class="chip ${ob.athlete.hand===h?'on':''}" data-h="${h}">${h[0].toUpperCase()+h.slice(1)}</div>`).join('')}
    </div></div>
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`; }
function obChildBind(){
  $("#b").onclick=obBack;
  obBindTeamCodeLink();
  $("#hand").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    ob.athlete.hand = ob.athlete.hand===c.dataset.h?'':c.dataset.h;
    $("#hand").querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x.dataset.h===ob.athlete.hand));
  });
  $("#n").onclick=()=>{
    const f=$("#cf").value.trim(), b=$("#cb").value;
    if(!f){$("#oberr").textContent="What's your athlete's first name?";return;}
    if(!b){$("#oberr").textContent="Add a birthdate so plans fit their age.";return;}
    const a=ageFrom(b); if(a===null||a<3||a>19){$("#oberr").textContent="Enter a realistic birthdate (ages 3–19).";return;}
    // NOTE: height/weight validation used to live here and referenced `h`/`w` after the
    // inputs themselves had been moved to Growth. That threw a ReferenceError on every
    // Continue tap — signup was dead and the parent saw no error at all, because the
    // throw happened before anything could be written to #oberr. Never validate a field
    // you haven't read in this scope.
    ob.athlete.first=f; ob.athlete.bd=b; obNext();
  };
}

// Position chips. The `positions` table carries a full name ("Running Back") next to the
// code — showing the bare code left first-time parents guessing at ATH, DL, UTIL, DS.
function posChips(sportKey, selected, id){
  const list=(state.ref?.positions||[]).filter(p=>p.sport_key===sportKey);
  return `<div class="chipgrid two" id="${id}">${list.map(p=>
    `<div class="chip ${selected.includes(p.code)?'on':''}" data-p="${esc(p.code)}">${esc(p.code)}${
      p.name?`<span class="sub">${esc(p.name)}</span>`:''}</div>`).join('')}</div>`;
}

// step: sport + position + level
function obSport(){
  const sports = state.ref.sports;
  const chosen = ob.sport;
  const positions = chosen ? state.ref.positions.filter(p=>p.sport_key===chosen) : [];
  const levels = chosen ? (sports.find(s=>s.key===chosen)?.level_vocab||[]) : [];
  return H`
  <div class="ob-head"><div class="k">The sport</div><h2>What is ${esc(ob.athlete.first)} playing?</h2>
  <p>Just the sport is enough to start — position and level are optional and easy to add later.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Explore before you specialize</h4>
    <p>Multi-sport kids get hurt less and often go further. Picking one now just sets today's focus — it's not a lifetime commitment.</p></div></div>
  ${ob.teamName?H`<div class="card app-pad" style="margin-bottom:14px;border-color:#CFE3DC;background:#EAF3F0">
    <div class="grow" style="border:none;padding:0"><div class="gi" style="background:#fff">🏈</div>
      <div class="gt"><b>${esc(ob.teamName)}</b><span>Sport, level and practice days filled in from your coach's code.</span></div>
      <button class="btn sm ghost" id="obTeamClear">Clear</button></div>
  </div>`
  :H`<div class="field"><label>Have a code from your coach? (optional)</label>
    <div style="display:flex;gap:8px">
      <input id="obTeamCode" placeholder="e.g. HAWKS26" autocapitalize="characters" style="flex:1;min-width:0"/>
      <button class="btn sm" id="obTeamGo" style="flex:0 0 auto">Apply</button>
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Fills in the sport, level and the team's practice schedule. Your coach never sees your child's profile.</p>
    <div class="err" id="obTeamErr"></div>
  </div>`}
  <div class="field"><label>Sport</label>
    <div class="chipgrid" id="sports">
      ${sports.map(s=>`<div class="chip ${chosen===s.key?'on':''}" data-s="${s.key}">${esc(s.name)}</div>`).join('')}
    </div></div>
  ${chosen?H`
    <div class="field"><label>Position(s) — optional</label>
      ${posChips(chosen, ob.positions, 'pos')}
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Tap all that apply — many young athletes play a few.</p>
    </div>
    <div class="field"><label>Level — optional</label>
      <select id="lvl"><option value="">Select level…</option>
        ${levels.map(l=>`<option ${ob.level===l?'selected':''}>${esc(l)}</option>`).join('')}
      </select></div>
    <div class="field"><label>Did you play ${esc(sports.find(s=>s.key===chosen)?.name||'this sport')}? (optional)</label>
      <div class="chipgrid" id="pexp" style="grid-template-columns:repeat(3,1fr)">
        ${PARENT_EXP.map(([v,l])=>`<div class="chip ${ob.parentExp===v?'on':''}" data-e="${v}">${esc(l)}</div>`).join('')}
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">We'll add a "Coach's Corner" note for you on drills you already know.</p>
    </div>`:''}
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`;
}
function obSportBind(){
  $("#b").onclick=obBack;
  // Team code: fills the sport, level and the team's schedule. Nothing is written that
  // links this child to the team — see the team_by_code comment in the migration.
  { const go=$("#obTeamGo"), inp=$("#obTeamCode"), err=$("#obTeamErr");
    const apply=async()=>{
      err.textContent=''; go.innerHTML='<span class="spinner"></span>'; go.disabled=true;
      const msg=await obApplyTeamCode(inp.value);
      go.innerHTML='Apply'; go.disabled=false;
      if(msg){ err.textContent=msg; return; }
      obStep();
    };
    if(go) go.onclick=apply;
    if(inp) inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); apply(); } });
  }
  { const cl=$("#obTeamClear"); if(cl) cl.onclick=()=>{
      ob.teamCode=''; ob.teamName=''; ob.practiceDays=[]; ob.gameDay=null; ob.seasonStart=null; obStep(); }; }
  $("#sports").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    ob.sport = c.dataset.s; ob.positions=[]; ob.level=''; obStep();
  });
  const posEl=$("#pos");
  if(posEl) posEl.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    const code=c.dataset.p;
    ob.positions = ob.positions.includes(code)?ob.positions.filter(x=>x!==code):[...ob.positions,code];
    c.classList.toggle('on');
  });
  const lvl=$("#lvl"); if(lvl) lvl.onchange=()=>ob.level=lvl.value;
  const pexp=$("#pexp"); if(pexp) pexp.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    ob.parentExp=c.dataset.e; pexp.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
  });
  $("#n").onclick=()=>{
    if(!ob.sport){$("#oberr").textContent="Pick a sport to continue.";return;}
    // Position and level are optional now — the engine handles both being unset, and
    // both are editable later in Profile → Edit athlete. Asking for them here cost more
    // parents than it gained plans.
    obNext();
  };
}

// step: practice schedule — the single input that decides whether the plan helps or harms
function obSchedule(){
  const nm=esc(ob.athlete.first);
  return H`
  <div class="ob-head"><div class="k">The team's week</div><h2>When does ${nm} practice?</h2>
  <p>We build the home plan <b>around</b> practice — never on top of it.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>This is the safety setting</h4>
    <p>Adding home training on practice days is the most common way young athletes get overused and burn out. The more the team trains, the less we add — and if the week is already full, we add nothing at all.</p></div></div>
  <div class="field"><label>Practice days</label>${schedChips(ob.practiceDays,'pd')}
    <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Tap all that apply. Not sure yet? Skip it — you can set this any time.</p></div>
  <div class="field"><label>Usual game day (optional)</label>
    <select id="gd"><option value="">— No regular game day —</option>
      ${DAY_LABELS.map((d,i)=>`<option value="${i}" ${ob.gameDay===i?'selected':''}>${d}</option>`).join('')}
    </select></div>
  <div class="field"><label>First game (approx., optional)</label>
    <input id="ss" type="date" value="${esc(ob.seasonStart||'')}"/>
    <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Season not started? Put a rough date — until then we treat it as camp and leave game days off the plan.</p></div>
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`;
}
function obScheduleBind(){
  $("#b").onclick=obBack;
  $("#pd").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    const i=+c.dataset.d;
    ob.practiceDays = ob.practiceDays.includes(i) ? ob.practiceDays.filter(x=>x!==i) : [...ob.practiceDays,i];
    c.classList.toggle('on');
  });
  $("#gd").onchange=()=>{ const v=$("#gd").value; ob.gameDay = v===''?null:parseInt(v,10); };
  $("#ss").onchange=()=>{ ob.seasonStart = $("#ss").value||null; };
  $("#n").onclick=()=>{
    ob.seasonStart = $("#ss").value||null;
    if(ob.gameDay!=null && ob.practiceDays.includes(ob.gameDay)){
      $("#oberr").textContent="That day is already a practice day — pick a different game day."; return;
    }
    if(ob.seasonStart && ob.gameDay==null){
      $("#oberr").textContent="Pick a game day too, or clear the first-game date."; return;
    }
    if(ob.practiceDays.length>=6){
      $("#oberr").textContent="Six or more practice days doesn't leave room to recover. Double-check that with the coach."; return;
    }
    ob.practiceDays.sort((a,b)=>a-b); obNext();
  };
}

// step: goals
// The goal KEYS drive the engine (GOAL_SESSIONS, skillsFor) and must never change per
// sport. The LABELS are what a parent reads, and the defaults below are written in ball-
// sport language: "Read the game better" is meaningless to a cheerleader, "Play with
// confidence" is wrong for a child who performs rather than plays, and "More reliable
// hands" means nothing to a swimmer. A parent who sees another sport's vocabulary
// concludes, correctly, that the app was not built for their child.
//
// So: same keys, sport-appropriate wording, and goals that genuinely do not apply are
// hidden rather than reworded into nonsense.
const GOAL_LABELS = {
  cheer:      { catching:'Safer catches & cradles', footwork:'Sharper motions & footwork',
                confidence:'Perform with confidence', iq:'Know the routine cold',
                endurance:'Last the whole routine' },
  gymnastics: { footwork:'Cleaner landings & footwork', confidence:'Perform with confidence',
                iq:'Know the routine cold', endurance:'Last the whole routine' },
  dance:      { footwork:'Sharper footwork & lines', confidence:'Perform with confidence',
                iq:'Pick up choreography faster', endurance:'Last the whole routine' },
  swimming:   { footwork:'Stronger kick & turns', confidence:'Race with confidence',
                iq:'Smarter race plan', endurance:'Last the whole race' },
  track:      { catching:'Cleaner relay handoffs', footwork:'Sharper running form',
                confidence:'Race with confidence', iq:'Smarter race plan',
                endurance:'Last the whole race' },
  wrestling:  { catching:'Stronger grip & hand fighting', confidence:'Compete with confidence',
                iq:'Read your opponent', endurance:'Last the whole match' },
  tennis:     { catching:'Softer hands at the net', iq:'Read the point better',
                endurance:'Last the whole match' },
  soccer:     { catching:'Better first touch' },
  basketball: { catching:'Safer hands & ball handling' },
};
// Goals with no sensible meaning in a sport. Better absent than reworded into filler.
const GOAL_HIDE = {
  gymnastics:['catching'], dance:['catching'], swimming:['catching'],
};
function goalLibFor(sportKey){
  const over=GOAL_LABELS[sportKey]||{}, hide=GOAL_HIDE[sportKey]||[];
  const map=t=>GOAL_LIB[t].filter(g=>!hide.includes(g.key))
                          .map(g=>({...g, label:over[g.key]||g.label}));
  return { skill:map('skill'), physical:map('physical') };
}
const GOAL_LIB = {
  skill:[
    {key:'catching',label:'More reliable hands'},
    {key:'footwork',label:'Sharper footwork'},
    {key:'confidence',label:'Play with confidence'},
    {key:'iq',label:'Read the game better'},
  ],
  physical:[
    {key:'speed',label:'Get faster'},
    {key:'strength',label:'Build age-safe strength'},
    {key:'agility',label:'Improve agility'},
    {key:'endurance',label:'Last the whole game'},
  ],
};
function obGoals(){
  const on = k => ob.goals.some(g=>g.key===k);
  const lib = goalLibFor(ob.sport);
  const grp = (type)=>lib[type].map(g=>`<div class="chip ${on(g.key)?'on':''}" data-k="${g.key}" data-t="${type}" data-l="${esc(g.label)}">${esc(g.label)}</div>`).join('');
  return H`
  <div class="ob-head"><div class="k">Goals</div><h2>What should we work toward?</h2>
  <p>Pick 1–3 to start. These shape ${esc(ob.athlete.first)}'s weekly playbook.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Process beats outcome</h4>
    <p>"Get faster" is a direction; the week turns it into small daily reps. Kids stay motivated when they can feel steady progress, not chase a scoreboard.</p></div></div>
  <div class="sec-title" style="margin-top:8px">Skill</div>
  <div class="chipgrid" id="gskill">${grp('skill')}</div>
  <div class="sec-title">Physical</div>
  <div class="chipgrid" id="gphys">${grp('physical')}</div>
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:16px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`;
}
function obGoalsBind(){
  $("#b").onclick=obBack;
  document.querySelectorAll('#gskill .chip, #gphys .chip').forEach(c=>c.onclick=()=>{
    const k=c.dataset.k;
    if(ob.goals.some(g=>g.key===k)) ob.goals=ob.goals.filter(g=>g.key!==k);
    else{ if(ob.goals.length>=3){toast('Start with up to 3 goals');return;} ob.goals.push({key:k,type:c.dataset.t,label:c.dataset.l}); }
    c.classList.toggle('on');
  });
  $("#n").onclick=()=>{ if(ob.goals.length===0){$("#oberr").textContent="Pick at least one goal.";return;} obNext(); };
}

// step: consent (COPPA) + finish
const CONSENTS = [
  {key:'child_data', req:true,  label:"I'm the parent/legal guardian and I consent to creating and storing my child's development data."},
  {key:'account',    req:true,  label:"I agree to the Terms and understand I can delete this profile and its data at any time."},
  {key:'media',      req:false, label:"I may add photos to help track progress. Photos stay private to my household and people I invite. (optional)"},
];
function obConsent(){
  return H`
  <div class="ob-head"><div class="k">Consent & safety</div><h2>You're in control of the data</h2>
  <p>A quick, required step to keep ${esc(ob.athlete.first)} safe.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Built child-safe by design</h4>
    <p>Your child never logs in and is never public. Only you — and adults you explicitly invite — can ever see this profile. You can revoke access or delete everything anytime.</p></div></div>
  <div class="card app-pad">
    ${CONSENTS.map(c=>H`
      <label style="display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" data-c="${c.key}" style="width:20px;height:20px;margin-top:1px;flex:0 0 auto" />
        <span style="font-size:13.5px;line-height:1.45">${esc(c.label)} ${c.req?'<b style="color:var(--danger)">*</b>':''}</span>
      </label>`).join('')}
  </div>
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:16px">
    <button class="btn ghost" id="b">Back</button><button class="btn amber" id="n">Create profile</button>
  </div>
  <p class="muted-note">By finishing you provide verifiable parental consent under COPPA for the data you've entered.<br>
    Read the <a href="/privacy" target="_blank" rel="noopener" style="color:var(--green-d)">Privacy Policy</a> and
    <a href="/terms" target="_blank" rel="noopener" style="color:var(--green-d)">Terms</a> — the consent above refers to them.</p>`;
}
function obConsentBind(){
  $("#b").onclick=obBack;
  document.querySelectorAll('input[data-c]').forEach(x=>x.onchange=()=>ob.consents[x.dataset.c]=x.checked);
  $("#n").onclick=finishOnboarding;
}

async function finishOnboarding(){
  const errEl=$("#oberr"); errEl.textContent="";
  const missing = CONSENTS.filter(c=>c.req && !ob.consents[c.key]);
  if(missing.length){ errEl.textContent="Please check the required consent boxes."; return; }
  const btn=$("#n"); const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
  try{
    // One transactional RPC: family + athlete + sport + goals + consent are saved
    // together or not at all. Guarantees the COPPA consent record is never dropped.
    const newFamily = (ob.mode!=='addChild' || !ob.familyId);
    const { data:athleteId, error } = await sb.rpc('create_athlete_onboarding', {
      p_new_family: newFamily,
      p_family_id: newFamily ? null : ob.familyId,
      // No longer asked during setup. Renameable in Profile → Household name.
      p_family_name: (ob.familyName||'').trim() || 'My Family',
      p_first: ob.athlete.first,
      p_birthdate: ob.athlete.bd,
      p_hand: ob.athlete.hand || null,
      p_sport: ob.sport,
      p_positions: ob.positions,
      p_level: ob.level,
      p_goals: ob.goals.map(g=>({ type:g.type, key:g.key, label:g.label })),
      p_consents: Object.entries(ob.consents).filter(([,v])=>v).map(([k])=>({
        consent_type: (k==='account'?'account':k==='media'?'media':'child_data')
      })),
    });
    if(error) throw error;
    // Non-consent extras, written after the transactional RPC (which doesn't take them).
    // Best-effort: both are editable later from Profile, so a hiccup here isn't fatal.
    const extra={};
    if(ob.parentExp) extra.parent_experience=ob.parentExp;
    if(ob.practiceDays.length) extra.practice_days=ob.practiceDays;
    if(ob.gameDay!=null) extra.game_day=ob.gameDay;
    if(ob.seasonStart) extra.season_start=ob.seasonStart;
    if(Object.keys(extra).length){
      // Same trap as the measurement seed below: supabase-js returns {error}, it does not
      // throw, so a bare try/catch here would hide a failure that loses the practice
      // schedule — the thing the whole week is built around.
      const { error:xe }=await sb.from('athlete_sports').update(extra).eq('athlete_id',athleteId);
      if(xe){ console.error('athlete_sports extras failed',xe); reportError(xe,'onboarding:sport-extras'); }
    }
    // Seed the growth chart with whatever they gave us. Best-effort — a failure here
    // must never cost them the profile they just created.
    const today=new Date().toISOString().slice(0,10);
    const seed=[];
    // source MUST be a value of the measure_source enum: manual | guided | photo | import.
    // This used to say 'onboarding', which is not one of them, so every single height and
    // weight entered at intake was rejected by the database and silently thrown away.
    if(ob.athlete.height) seed.push({athlete_id:athleteId,metric_key:'height',value:parseFloat(ob.athlete.height),unit:'in',measured_on:today,source:'manual',created_by:state.user.id});
    if(ob.athlete.weight) seed.push({athlete_id:athleteId,metric_key:'weight',value:parseFloat(ob.athlete.weight),unit:'lb',measured_on:today,source:'manual',created_by:state.user.id});
    if(seed.length){
      // supabase-js RETURNS {error} rather than throwing, so a try/catch around this
      // catches nothing. That is how the bug above survived: the insert failed on every
      // signup and nobody, including the console, ever heard about it.
      const { error:me }=await sb.from('measurements').insert(seed);
      if(me){ console.error('measurement seed failed',me); reportError(me,'onboarding:measurement-seed'); }
    }
    // Aggregate only — tells a coach how many families used the code, nobody who.
    if(ob.teamCode){
      try{ await sb.rpc('team_code_used',{ p_code:ob.teamCode }); }catch(e){ console.error(e); }
      // Stop the stashed code re-applying to a sibling added later — that child may well
      // be on a different team, and a silently pre-filled wrong schedule is worse than none.
      clearTeamCode();
    }
    await loadAthletes();
    state.active = state.athletes.find(a=>a.id===athleteId) || state.athletes[0];
    toast('Profile created 🎉');
    renderApp('week');
  }catch(err){
    console.error(err);
    errEl.textContent = "Something went wrong saving. "+(err.message||''); btn.innerHTML=label; btn.disabled=false;
  }
}

