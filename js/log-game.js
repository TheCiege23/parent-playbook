// ===================================================================
//  LOG A GAME — fifteen seconds in a parking lot
// ===================================================================
// Design handoff, platform §2. This was one long sheet: date, season, opponent,
// home/away, two scores, arbitrary key/value stat rows, notes, and a file picker. A
// tired parent standing in a car park will not fill that in.
//
// Four rules this file is built on:
//   1. The score is the only required input. Everything else is a second screen that
//      can be skipped WITHOUT losing the game — so the row commits at the end of step 1.
//   2. Never make them type what we already know. Date, opponent, venue and season all
//      come from the week's plan.
//   3. Plenty of leagues don't keep score. Requiring two numbers quietly excludes every
//      under-8 league in the country, Mighty Mites included.
//   4. Media must never block the save. The row commits first; files follow, and a
//      failed upload is a queued retry rather than a lost game.

// Stat keys worth offering, by sport then position. Written to the same free-form
// `stats` JSON the app already stores — no schema change. "＋ Other" keeps the old
// key/value row for anything not listed, so nothing is lost.
const STAT_PRESETS = {
  football:  { _:['Tackles','Catches','Carries'], RB:['Rush yds','TD','Carries'],
               WR:['Rec yds','TD','Catches'], QB:['Pass yds','TD','Completions'],
               LB:['Tackles','Sacks','TFL'], DB:['Tackles','Pass def','INT'] },
  basketball:{ _:['Points','Rebounds','Assists','Steals'] },
  soccer:    { _:['Goals','Assists','Shots','Saves'] },
  baseball:  { _:['Hits','RBI','Runs','Strikeouts'] },
  softball:  { _:['Hits','RBI','Runs','Strikeouts'] },
  volleyball:{ _:['Kills','Digs','Aces','Blocks'] },
  hockey:    { _:['Goals','Assists','Shots','Saves'] },
  lacrosse:  { _:['Goals','Assists','Ground balls'] },
  wrestling: { _:['Takedowns','Escapes','Pins'] },
  track:     { _:['Place','Time','Distance'] },
  cheer:     { _:['Routine score','Stunts hit'] },
  gymnastics:{ _:['All-around','Vault','Beam','Floor'] },
  tennis:    { _:['Aces','Winners','Games won'] },
  swimming:  { _:['Time','Place','Split'] },
};
function statPresetsFor(sportKey, positions){
  const bySport = STAT_PRESETS[sportKey]; if(!bySport) return [];
  for(const p of (positions||[])) if(bySport[p]) return bySport[p];
  return bySport._ || [];
}

// Everything the plan already knows about a game on/around this date. The four fields
// a parent should never have to type.
function lgPrefill(){
  const sports = state.athleteSports || [];
  const primary = sports.find(s=>s.is_primary) || sports[0] || null;
  const today = new Date();
  const out = { date:isoDay(today), opponent:'', where:'', season:(typeof jrnLastSeason==='function'?jrnLastSeason():'')||'',
                fromPlan:false, dayLabel:'' };
  if(!primary || primary.game_day==null) return out;
  // A game day within ±1 day of today is almost certainly the fixture being logged.
  for(const delta of [0,-1,1]){
    const d = new Date(today.getFullYear(),today.getMonth(),today.getDate()+delta);
    if(((d.getDay()+6)%7) === Number(primary.game_day)){
      out.date = isoDay(d);
      out.fromPlan = true;
      out.dayLabel = d.toLocaleDateString(undefined,{weekday:'long'});
      break;
    }
  }
  return out;
}

// ---- state for one run through the flow ----
const LG = { id:null, step:1, sport:null, positions:[], row:null, saved:null };

function openLogGame(existing){
  const sports = state.athleteSports || [];
  const primary = sports.find(s=>s.is_primary) || sports[0] || null;
  LG.sport = primary?.sport_key || 'general';
  LG.positions = primary?.positions || [];
  const pre = lgPrefill();
  LG.id = existing ? existing.id : uuid();   // one id across both steps and every retry
  LG.step = 1;
  LG.saved = null;
  LG.row = existing ? { ...existing } : {
    id: LG.id, athlete_id: state.active.id, sport_key: LG.sport,
    game_date: pre.date, opponent: '', home_away: '', season: pre.season,
    our_score: null, their_score: null, result: 'na',
    notes: null, note_improve: null, stats: {}, created_by: state.user.id,
  };
  LG.prefill = pre;
  LG.editing = !!existing;
  lgRender();
}

function lgRender(){
  if(LG.step===1) return lgStepScore();
  if(LG.step===2) return lgStepExtras();
  return lgStepSaved();
}

// ===================================================================
//  1 · The score
// ===================================================================
function lgStepScore(){
  const r=LG.row, nm=esc(state.active.first_name);
  const opp = r.opponent ? esc(r.opponent) : 'Their team';
  const seasons = [r.season, (typeof jrnLastSeason==='function'?jrnLastSeason():'')].filter(Boolean);
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="lgClose" aria-label="Close">✕</button>
      <h3>How'd it go?</h3>
      <span class="lg-step">${LG.editing?'Edit':'1 of 2'}</span>
    </div>

    ${LG.prefill.fromPlan&&!LG.editing?H`<div class="lg-plan">
      <i>✓</i>
      <div><b>${esc(LG.prefill.dayLabel)}${r.opponent?' · vs. '+esc(r.opponent):''}</b>
        <span>From this week's plan${r.home_away?' · '+esc(r.home_away):''}${r.season?' · '+esc(r.season):''}</span></div>
      <button class="btn sm ghost" id="lgEdit">Edit</button>
    </div>`:''}

    <div id="lgDetails" ${LG.prefill.fromPlan&&!LG.editing?'hidden':''}>
      <div class="row2">
        <div class="field"><label for="lgDate">Date</label>
          <input id="lgDate" type="date" value="${esc(r.game_date)}" max="${isoDay(new Date())}"/></div>
        <div class="field"><label for="lgSeason">Season</label>
          <input id="lgSeason" value="${esc(r.season||'')}" placeholder="e.g. Fall 2026"/></div>
      </div>
      <div class="field"><label for="lgOpp">Opponent</label>
        <input id="lgOpp" value="${esc(r.opponent||'')}" placeholder="e.g. Northside Hawks"/></div>
    </div>

    <div class="lg-scores">
      <div class="lg-side">
        <span class="who">${nm}</span>
        <div class="stepper" data-side="our">
          <button data-d="-1" aria-label="Fewer">−</button>
          <b id="lgOur">${r.our_score==null?'–':r.our_score}</b>
          <button data-d="1" aria-label="More">＋</button>
        </div>
      </div>
      <span class="lg-vs">–</span>
      <div class="lg-side">
        <span class="who">${opp}</span>
        <div class="stepper" data-side="their">
          <button data-d="-1" aria-label="Fewer">−</button>
          <b id="lgTheir">${r.their_score==null?'–':r.their_score}</b>
          <button data-d="1" aria-label="More">＋</button>
        </div>
      </div>
    </div>
    <p class="lg-result" id="lgResultLine">${lgResultLabel(r)}</p>

    <div class="field" style="margin-top:6px">
      <label>Didn't keep score?</label>
      <div class="chipgrid" id="lgRes" style="grid-template-columns:repeat(4,1fr)">
        ${[['win','Won'],['loss','Lost'],['tie','Tied'],['na','Skip']].map(o=>
          `<div class="chip ${r.our_score==null&&r.result===o[0]?'on':''}" role="button" tabindex="0" data-r="${o[0]}">${o[1]}</div>`).join('')}
      </div>
    </div>

    <div class="field"><label>Where</label>
      <div class="chipgrid" id="lgWhere">
        ${['home','away','neutral'].map(w=>
          `<div class="chip ${r.home_away===w?'on':''}" role="button" tabindex="0" data-w="${w}">${w[0].toUpperCase()+w.slice(1)}</div>`).join('')}
      </div></div>

    ${LG.prefill.fromPlan&&!LG.editing?`<p class="muted-note" style="text-align:left;margin:2px 2px 12px">Pulled from ${esc(LG.prefill.dayLabel)}'s plan. Change any of it before you save.</p>`:''}
    <div class="err" id="lgErr"></div>
    <button class="btn amber" id="lgSave">${LG.editing?'Save changes':'Save the game'}</button>
    ${LG.editing?'':'<p class="muted-note" style="margin-top:9px">Stats and photos next — or skip them</p>'}`);

  bg.querySelector('#lgClose').onclick=()=>bg.remove();
  { const e=bg.querySelector('#lgEdit');
    if(e) e.onclick=()=>{ const d=bg.querySelector('#lgDetails'); d.hidden=!d.hidden; }; }

  // Steppers, not number inputs. A number keypad in a car park with cold hands is the
  // wrong control; two taps is right.
  bg.querySelectorAll('.stepper').forEach(st=>{
    const side=st.dataset.side;
    st.querySelectorAll('button').forEach(b=>b.onclick=()=>{
      const key = side==='our' ? 'our_score' : 'their_score';
      const cur = LG.row[key]==null ? 0 : LG.row[key];
      LG.row[key] = Math.max(0, cur + (+b.dataset.d));
      // Entering a score means they DID keep score — clear any Won/Lost/Tied pick.
      bg.querySelectorAll('#lgRes .chip').forEach(c=>c.classList.remove('on'));
      bg.querySelector('#lgOur').textContent = LG.row.our_score==null?'–':LG.row.our_score;
      bg.querySelector('#lgTheir').textContent = LG.row.their_score==null?'–':LG.row.their_score;
      LG.row.result = lgDerivedResult(LG.row);
      bg.querySelector('#lgResultLine').textContent = lgResultLabel(LG.row);
    });
  });

  // Result without a score — writes `result` directly with null scores. gameResult()
  // already falls back to the stored value, so the journey handles it unchanged.
  bg.querySelectorAll('#lgRes .chip').forEach(c=>c.onclick=()=>{
    const v=c.dataset.r;
    const already=c.classList.contains('on');
    bg.querySelectorAll('#lgRes .chip').forEach(x=>x.classList.remove('on'));
    // Deselecting has to actually clear the result. lgDerivedResult() returns the CURRENT
    // result unchanged when there are no scores — and selecting a chip nulls the scores —
    // so reassigning it here left the row recorded as a win with no chip selected and the
    // summary line still reading "Win". Tapping Won and tapping it again to undo saved a win.
    if(already){ LG.row.result='na'; }
    else{
      c.classList.add('on');
      LG.row.our_score=null; LG.row.their_score=null; LG.row.result=v;
      bg.querySelector('#lgOur').textContent='–';
      bg.querySelector('#lgTheir').textContent='–';
    }
    bg.querySelector('#lgResultLine').textContent = lgResultLabel(LG.row);
  });

  bg.querySelectorAll('#lgWhere .chip').forEach(c=>c.onclick=()=>{
    LG.row.home_away = (LG.row.home_away===c.dataset.w) ? '' : c.dataset.w;
    bg.querySelectorAll('#lgWhere .chip').forEach(x=>x.classList.toggle('on',x.dataset.w===LG.row.home_away));
  });

  bg.querySelector('#lgSave').onclick=async e=>{
    const errEl=bg.querySelector('#lgErr'); errEl.textContent='';
    const d=bg.querySelector('#lgDate'); if(d) LG.row.game_date=d.value;
    const se=bg.querySelector('#lgSeason'); if(se) LG.row.season=se.value.trim()||null;
    const op=bg.querySelector('#lgOpp'); if(op) LG.row.opponent=op.value.trim()||null;
    if(!LG.row.game_date){ errEl.textContent='Pick the game date.'; return; }
    e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled=true;
    const ok = await lgCommit(errEl);
    if(!ok){ e.target.innerHTML=LG.editing?'Save changes':'Save the game'; e.target.disabled=false; return; }
    bg.remove();
    if(LG.editing){ toast('Game updated'); return renderApp('journey'); }
    LG.step=2; lgRender();
  };
}

function lgDerivedResult(r){
  if(r.our_score==null||r.their_score==null) return r.result==='na'?'na':r.result;
  return r.our_score>r.their_score?'win':r.our_score<r.their_score?'loss':'tie';
}
function lgResultLabel(r){
  const m={win:'Win',loss:'Loss',tie:'Tie',na:''};
  return m[lgDerivedResult(r)]||'';
}

// The commit. Same client id every time, so step 2 is a second upsert on the same row
// and a retry can never create a second game.
async function lgCommit(errEl){
  LG.row.result = lgDerivedResult(LG.row);
  LG.row.sport_key = LG.row.sport_key || LG.sport;
  LG.row.home_away = LG.row.home_away || null;
  if(!navigator.onLine && typeof owQueue==='function'){
    await owQueue({ kind_op:'game_log', row:{ ...LG.row } });
    LG.saved={ offline:true };
    return true;
  }
  const { error } = await sb.from('games').upsert({ ...LG.row },{ onConflict:'id' });
  if(error){
    console.error(error); reportError(error,'logGame:commit');
    if(errEl) errEl.textContent='Could not save. '+(error.message||'');
    return false;
  }
  return true;
}

// ===================================================================
//  2 · The rest, optional — the game is already saved by this point
// ===================================================================
function lgStepExtras(){
  const nm=esc(state.active.first_name);
  const presets=statPresetsFor(LG.sport, LG.positions);
  const posLabel=(LG.positions||[]).length
    ? (state.ref?.positions||[]).find(p=>p.code===LG.positions[0]&&p.sport_key===LG.sport)?.name || LG.positions[0]
    : (state.ref?.sports||[]).find(s=>s.key===LG.sport)?.name || '';

  const bg=sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="lgBack" aria-label="Back">←</button>
      <h3>Anything worth noting?</h3>
      <span class="lg-step">2 of 2</span>
    </div>

    ${presets.length?H`<div class="field">
      <label>${esc(posLabel)}${posLabel?' · ':''}tap to add</label>
      <div class="lg-stats" id="lgStats">
        ${presets.map(k=>H`<div class="lg-stat" data-k="${esc(k)}">
          <span>${esc(k)}</span><input inputmode="numeric" placeholder="–" aria-label="${esc(k)}"/></div>`).join('')}
      </div>
      <button class="btn sm ghost" id="lgOther" style="margin-top:9px">＋ Other</button>
      <div id="lgOtherRows"></div>
    </div>`:H`<div class="field"><label>Stats</label><div id="lgOtherRows"></div>
      <button class="btn sm ghost" id="lgOther">＋ Add a stat</button></div>`}

    <div class="field">
      <label for="lgNote">One thing ${nm} did well</label>
      <textarea id="lgNote" rows="2" placeholder="Broke two tackles on the counter."></textarea>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">${nm} will read this in ten years. Skip it if you're not up to it.</p>
    </div>

    <div class="field">
      <label for="lgImprove">One thing to work on</label>
      <textarea id="lgImprove" rows="2" placeholder="Ball security in traffic."></textarea>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Just for you — it shapes next week's plan.</p>
    </div>

    <div class="field"><label>Photos &amp; video</label>
      <input id="lgFiles" type="file" accept="image/*,video/*" multiple/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Photos stay private to your household and anyone you invite.</p></div>

    <div class="err" id="lgErr2"></div>
    <div class="row2">
      <button class="btn ghost" id="lgSkip">Skip</button>
      <button class="btn amber" id="lgDone">Done</button>
    </div>`);

  bg.querySelector('#lgBack').onclick=()=>{ bg.remove(); LG.step=1; lgRender(); };
  const otherRows=bg.querySelector('#lgOtherRows');
  const addOther=()=>{ const d=document.createElement('div'); d.className='row2'; d.style.marginTop='8px';
    d.innerHTML='<input class="ok" placeholder="Stat" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/>'+
                '<input class="ov" placeholder="Value" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/>';
    otherRows.appendChild(d); };
  bg.querySelector('#lgOther').onclick=addOther;

  const collect=()=>{
    const stats={};
    bg.querySelectorAll('.lg-stat').forEach(s=>{
      const v=s.querySelector('input').value.trim();
      if(v) stats[s.dataset.k]=v;
    });
    otherRows.querySelectorAll('.row2').forEach(r=>{
      const k=r.querySelector('.ok').value.trim(), v=r.querySelector('.ov').value.trim();
      if(k&&v) stats[k]=v;
    });
    LG.row.stats=stats;
    LG.row.notes=bg.querySelector('#lgNote').value.trim()||null;
    LG.row.note_improve=bg.querySelector('#lgImprove').value.trim()||null;
  };

  const finish=async(e,withExtras)=>{
    const errEl=bg.querySelector('#lgErr2'); errEl.textContent='';
    if(withExtras) collect();
    e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled=true;
    if(withExtras){
      const ok=await lgCommit(errEl);
      if(!ok){ e.target.innerHTML='Done'; e.target.disabled=false; return; }
    }
    // Media never blocks the save — the row is already committed. Failures become a
    // queued retry, which is what owQueueMedia is for.
    const files=bg.querySelector('#lgFiles').files;
    let queued=0;
    if(files.length){
      const big=oversize(files);
      if(big){ errEl.textContent='"'+big.name+'" is over 100 MB — the game is saved, but that file is too big.'; }
      else{
        try{ await uploadMedia(files,{gameId:LG.id,takenOn:LG.row.game_date}); }
        catch(err){
          console.error(err);
          if(typeof owQueueMedia==='function'){
            const r=await owQueueMedia(files,{gameId:LG.id,takenOn:LG.row.game_date,force:true});
            queued=r.queued||0;
          }
        }
      }
    }
    bg.remove();
    LG.saved={ queued };
    LG.step=3; lgRender();
  };
  bg.querySelector('#lgSkip').onclick=e=>finish(e,false);
  bg.querySelector('#lgDone').onclick=e=>finish(e,true);
}

// ===================================================================
//  3 · Saved — a toast wastes the best moment in the app
// ===================================================================
async function lgStepSaved(){
  const nm=esc(state.active.first_name);
  const r=LG.row;
  let seasonCount=null, total=null;
  try{
    const { data } = await sb.from('games').select('id,season').eq('athlete_id',state.active.id);
    total=(data||[]).length;
    if(r.season) seasonCount=(data||[]).filter(g=>g.season===r.season).length;
  }catch(e){}
  const n = seasonCount ?? total;
  const ordinal = x => { if(x==null) return ''; const s=['th','st','nd','rd'], v=x%100; return x+(s[(v-20)%10]||s[v]||s[0]); };
  const scoreStr=(r.our_score!=null&&r.their_score!=null)?`${r.our_score}–${r.their_score}`:'';
  const rl={win:'Win',loss:'Loss',tie:'Tie',na:'Logged'}[lgDerivedResult(r)];
  const statEntries=Object.entries(r.stats||{});

  const bg=sheet(H`
    <div class="lg-saved">
      <div class="tick">✓</div>
      <h3>${n!=null?`Game ${n}, in the book.`:'In the book.'}</h3>
      <p>${n!=null&&r.season
        ? H`That's ${nm}'s ${esc(ordinal(n))} game logged in ${esc(r.season)}.`
        : H`${nm}'s game is saved.`}${LG.saved&&LG.saved.offline?' It will sync when you\'re back online.':''}</p>
    </div>

    <div class="gcard" style="margin-top:16px">
      <div class="gh"><div style="min-width:0">
        <div class="score">${scoreStr||'Game'}</div>
        <div class="meta">${esc(fmtDate(r.game_date))}${r.opponent?' · vs '+esc(r.opponent):''}${r.home_away?' · '+esc(r.home_away):''}</div>
      </div><span class="result-badge r-${lgDerivedResult(r)}">${rl}</span></div>
      ${statEntries.length?`<div class="statchips">${statEntries.map(s=>`<span class="statchip">${esc(s[0])} <b>${esc(s[1])}</b></span>`).join('')}</div>`:''}
      ${r.notes?`<p style="font-size:13px;margin:10px 0 0;line-height:1.5">${esc(r.notes)}</p>`:''}
    </div>

    ${LG.saved&&LG.saved.queued?H`<div class="teach" style="margin-top:14px"><div class="ic">📶</div><div>
      <h4>${LG.saved.queued} file${LG.saved.queued===1?'':'s'} still uploading</h4>
      <p>The signal dropped — nothing is lost. They're on your phone and we'll finish next time you open the app on Wi-Fi. You don't have to stand here.</p></div></div>`:''}

    <div class="card app-pad" style="margin-top:14px">
      <div class="grow" style="border:none;padding:0"><div class="gi">★</div>
        <div class="gt"><b>Was this a first?</b><span>Mark it as a milestone so it doesn't get lost among the games.</span></div></div>
      <button class="btn sm amber" id="lgMile" style="margin-top:12px">Add milestone</button>
    </div>

    <button class="btn ghost" id="lgJourney" style="margin-top:14px">See the journey</button>`);

  bg.querySelector('#lgMile').onclick=()=>{ bg.remove(); openAddMilestone(r.game_date); };
  bg.querySelector('#lgJourney').onclick=()=>{ bg.remove(); renderApp('journey'); };
}
