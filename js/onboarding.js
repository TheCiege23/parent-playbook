// ===================================================================
//  ONBOARDING — teaching while collecting
// ===================================================================
const ob = { i:0, mode:'create', familyId:null, familyName:'', athlete:{first:'',bd:'',hand:''}, sport:'', positions:[], level:'', goals:[], consents:{} };
function obReset(patch){ Object.assign(ob,{ i:0, mode:'create', familyId:null, familyName:'', athlete:{first:'',bd:'',hand:''}, sport:'', positions:[], level:'', goals:[], consents:{} }, patch||{}); }

async function renderOnboarding(){
  document.body.classList.remove('auth'); setAppBg();
  await loadRef();
  obReset();
  obStep();
}
// full first-run flow vs. adding a sibling into an existing household
const OB_FLOW = {
  create:   ['welcome','family','child','sport','goals','consent'],
  addChild: ['child','sport','goals','consent'],
};
function obSteps(){ return OB_FLOW[ob.mode]; }
function obStep(){
  const steps = obSteps();
  const name = steps[ob.i];
  const dots = steps.map((_,k)=>`<i class="${k<=ob.i?'on':''}"></i>`).join('');
  const inner = ({welcome:obWelcome,family:obFamily,child:obChild,sport:obSport,goals:obGoals,consent:obConsent})[name]();
  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div class="steps">${dots}</div>
    ${inner}
  </div>`;
  ({welcome:obWelcomeBind,family:obFamilyBind,child:obChildBind,sport:obSportBind,goals:obGoalsBind,consent:obConsentBind})[name]();
}
function obNext(){ if(ob.i < obSteps().length-1){ ob.i++; obStep(); } }
function obBack(){ if(ob.i>0){ ob.i--; obStep(); } else if(ob.mode==='addChild'){ renderApp('profile'); } }

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
  <div style="margin-top:20px"><button class="btn" id="n">Get started</button></div>`; }
function obWelcomeBind(){ $("#n").onclick=obNext; }

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
  $("#hand").querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
    ob.athlete.hand = ob.athlete.hand===c.dataset.h?'':c.dataset.h;
    $("#hand").querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x.dataset.h===ob.athlete.hand));
  });
  $("#n").onclick=()=>{
    const f=$("#cf").value.trim(), b=$("#cb").value;
    if(!f){$("#oberr").textContent="What's your athlete's first name?";return;}
    if(!b){$("#oberr").textContent="Add a birthdate so plans fit their age.";return;}
    const a=ageFrom(b); if(a===null||a<3||a>19){$("#oberr").textContent="Enter a realistic birthdate (ages 3–19).";return;}
    ob.athlete.first=f; ob.athlete.bd=b; obNext();
  };
}

// step: sport + position + level
function obSport(){
  const sports = state.ref.sports;
  const chosen = ob.sport;
  const positions = chosen ? state.ref.positions.filter(p=>p.sport_key===chosen) : [];
  const levels = chosen ? (sports.find(s=>s.key===chosen)?.level_vocab||[]) : [];
  return H`
  <div class="ob-head"><div class="k">The sport</div><h2>What is ${esc(ob.athlete.first)} playing?</h2>
  <p>Pick a sport, then a position and level. You can add more sports later.</p></div>
  <div class="teach"><div class="ic">🎓</div><div><h4>Explore before you specialize</h4>
    <p>Multi-sport kids get hurt less and often go further. Picking one now just sets today's focus — it's not a lifetime commitment.</p></div></div>
  <div class="field"><label>Sport</label>
    <div class="chipgrid" id="sports">
      ${sports.map(s=>`<div class="chip ${chosen===s.key?'on':''}" data-s="${s.key}">${esc(s.name)}</div>`).join('')}
    </div></div>
  ${chosen?H`
    <div class="field"><label>Position(s)</label>
      <div class="chipgrid" id="pos">
        ${positions.map(p=>`<div class="chip ${ob.positions.includes(p.code)?'on':''}" data-p="${p.code}">${esc(p.code)}</div>`).join('')}
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Tap all that apply — many young athletes play a few.</p>
    </div>
    <div class="field"><label>Level</label>
      <select id="lvl"><option value="">Select level…</option>
        ${levels.map(l=>`<option ${ob.level===l?'selected':''}>${esc(l)}</option>`).join('')}
      </select></div>`:''}
  <div class="err" id="oberr"></div>
  <div class="row2" style="margin-top:8px">
    <button class="btn ghost" id="b">Back</button><button class="btn" id="n">Continue</button>
  </div>`;
}
function obSportBind(){
  $("#b").onclick=obBack;
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
  $("#n").onclick=()=>{
    if(!ob.sport){$("#oberr").textContent="Pick a sport to continue.";return;}
    if(ob.positions.length===0){$("#oberr").textContent="Choose at least one position.";return;}
    if(!ob.level){$("#oberr").textContent="Select a level.";return;}
    obNext();
  };
}

// step: goals
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
  const grp = (type)=>GOAL_LIB[type].map(g=>`<div class="chip ${on(g.key)?'on':''}" data-k="${g.key}" data-t="${type}" data-l="${esc(g.label)}">${esc(g.label)}</div>`).join('');
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
  <p class="muted-note">By finishing you provide verifiable parental consent under COPPA for the data you've entered.</p>`;
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
      p_family_name: ob.familyName || 'My Family',
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
    await loadAthletes();
    state.active = state.athletes.find(a=>a.id===athleteId) || state.athletes[0];
    toast('Profile created 🎉');
    renderApp('week');
  }catch(err){
    console.error(err);
    errEl.textContent = "Something went wrong saving. "+(err.message||''); btn.innerHTML=label; btn.disabled=false;
  }
}

