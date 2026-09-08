// ===================================================================
//  GROWTH — the active goal, and the number that proves it's working
// ===================================================================
// Design handoff, app screens §5. The goal leads, paired with the one measurement
// that evidences it; measurements become trend bars; goals sit underneath. A parent
// opens this screen for a number, not for a list of intentions.

// Which metric best evidences which goal. Deliberately small — an unmapped goal falls
// back to the label on its own rather than showing an unrelated number, which would be
// worse than showing none.
const GOAL_METRIC = {
  speed:'dash_40', agility:'shuttle', strength:'broad_jump', endurance:'plank_hold',
  catching:'catch_pct', footwork:'shuttle',
  // confidence and iq have no honest number. They stay unmapped on purpose.
};

// The empty state suggests things worth measuring for THIS age, not the whole metrics
// table. Weight is deliberately absent under 13 — see the note in ARCHITECTURE.md.
// It stays available under "+ Record"; it is simply never suggested.
const SUGGEST_METRICS = {
  littles: ['height','broad_jump'],
  youth:   ['dash_40','height','broad_jump','shuttle'],
  preteen: ['dash_40','height','broad_jump','shuttle'],
  teen:    ['dash_40','height','broad_jump','shuttle','vertical'],
  older:   ['dash_40','height','broad_jump','shuttle','vertical'],
};
const METRIC_HINT = {
  dash_40:'Same stretch of grass, every time', height:'Once a month is plenty',
  broad_jump:'Power, without a gym', shuttle:'Change of direction, 5-10-5',
  vertical:'Standing reach to peak', plank_hold:'Core, held not counted',
  catch_pct:'Out of 20 throws', weight:'Ask your pediatrician first',
};
const METRIC_GLYPH = { dash_40:'40', height:'Ht', broad_jump:'▮', shuttle:'↕',
  vertical:'▲', plank_hold:'⏱', catch_pct:'%', weight:'lb' };

function metricMeta(key){ return (state.ref&&state.ref.metrics||[]).find(m=>m.key===key)||null; }
function metricName(key){ return (metricMeta(key)||{}).name || key; }

// Height in inches reads as a number nobody uses out loud. 54 -> 4′ 6″.
function fmtMeasure(key, value, unit){
  const v=Number(value);
  if(key==='height' && unit==='in' && v>=24) return Math.floor(v/12)+'′ '+Math.round(v%12)+'″';
  const n=Math.round(v*100)/100;
  return n+(unit?' '+unit:'');
}

// Last five readings for one metric, oldest→newest, scaled to that metric's OWN
// min/max. Scaling to zero would make a 7.9s and an 8.1s dash look identical; scaling
// to the range is what makes a 0.2s improvement visible at all.
//
// Taller ALWAYS means better. On a lower-is-better metric the scale is inverted —
// without that, a kid whose 40 went 8.6 → 7.9 sees his best time drawn as the
// shortest bar, which reads as getting worse. That is the whole screen backwards.
function trendBars(list, lowerIsBetter){
  const pts=list.slice(0,5).reverse().map(m=>Number(m.value)).filter(n=>Number.isFinite(n));
  if(pts.length<2) return '';                     // one reading is not a trend
  const min=Math.min(...pts), max=Math.max(...pts), span=(max-min)||1;
  return `<div class="bars">${pts.map((v,i)=>{
    const norm = lowerIsBetter ? (max-v)/span : (v-min)/span;
    const h=18+Math.round(norm*82);               // floor so the worst reading is still a bar
    const last=i===pts.length-1;
    return `<i style="height:${h}%" class="${last?'on':''}"></i>`;
  }).join('')}</div>`;
}

async function screenGrowth(){
  const a=state.active; const age=ageFrom(a.birthdate); const band=ageBand(age);
  const [{data:goals},{data:meas},{data:sess},{data:sports},{data:grow},{data:coachUp}] = await Promise.all([
    sb.from('goals').select('*').eq('athlete_id',a.id).order('created_at'),
    sb.from('measurements').select('*').eq('athlete_id',a.id).order('measured_on',{ascending:false}).limit(60),
    sb.from('sessions').select('done_on,title').eq('athlete_id',a.id).order('done_on',{ascending:false}).limit(60),
    sb.from('athlete_sports').select('sport_key,is_primary,age_cutoff_md,pw_ball_carrier_lb').eq('athlete_id',a.id),
    // sex + parent heights drive the maturity card. Read fresh rather than from
    // state.active, which is cached from a login that predates these columns.
    sb.from('athletes').select('sex_at_birth,mother_height_in,father_height_in,birthdate')
      .eq('id',a.id).maybeSingle(),
    sb.from('coach_updates').select('kind,body,created_at').eq('athlete_id',a.id)
      .order('created_at',{ascending:false}).limit(1),
  ]);
  const latestCoachUp = (coachUp||[])[0] || null;
  const primary=(sports||[]).find(s=>s.is_primary)||(sports||[])[0];
  state.activeSportKey=primary?.sport_key||state.activeSportKey||'general'; setAppBg();

  // Growth & maturation. Arithmetic on self-reported numbers only — see js/maturity.js
  // for why there is no body scan here, and no early/late maturity band.
  const mat = maturityReport({ ...(grow||{}), birthdate:(grow&&grow.birthdate)||a.birthdate },
                             meas||[], primary||null);

  const byMetric={}; (meas||[]).forEach(m=>{ (byMetric[m.metric_key]=byMetric[m.metric_key]||[]).push(m); });
  const metricKeys=Object.keys(byMetric);

  // Pop Warner division/position guidance — football only, and only as far as the
  // national matrix can honestly go. See js/pop-warner.js for why there's no single
  // ball-carrier cutoff baked in here.
  const pwWeight = byMetric.weight && byMetric.weight[0] ? Number(byMetric.weight[0].value) : null;
  const pwDivisions = primary?.sport_key==='football' ? pwEligibleDivisions(age, pwWeight) : [];
  const pwLimit = primary?.pw_ball_carrier_lb!=null ? Number(primary.pw_ball_carrier_lb) : null;
  const pwNote = primary?.sport_key==='football' ? pwPositionNote(pwWeight, pwLimit, a.first_name) : '';
  const active=(goals||[]).filter(g=>g.status==='active');
  const lead=active[0]||null;
  const leadKey=lead?GOAL_METRIC[lead.key]:null;
  const leadList=leadKey?byMetric[leadKey]:null;

  // "since March" — when the record actually starts, not when the account was made
  const firstOn=(meas||[]).length?(meas[meas.length-1].measured_on):null;
  const sinceLabel=firstOn
    ? new Date(firstOn+'T00:00:00').toLocaleDateString(undefined,{month:'long'})
    : null;

  // ---- the hero: the goal, and the number that evidences it ----
  let heroBody;
  if(!lead){
    heroBody = H`<p class="gh-empty">No active goal yet. Pick one and the week starts building around it — and this screen starts tracking whether it's working.</p>
      <button class="btn sm amber" id="heroGoal">Choose a goal</button>`;
  } else if(leadList && leadList.length){
    const latest=leadList[0], prev=leadList[1];
    const mm=metricMeta(leadKey)||{};
    let delta='';
    if(prev){
      const cur=Number(latest.value), prv=Number(prev.value);
      const better = mm.lower_is_better ? cur<prv : cur>prv;
      const diff=Math.round(Math.abs(cur-prv)*100)/100;
      // "0.4s faster" reads right for a time; "2in more" reads right for a distance.
      const word = mm.lower_is_better ? (better?'faster':'slower') : (better?'more':'less');
      delta = `<span class="gh-delta ${better?'up':'down'}">${diff}${esc(mm.unit||'')} ${word}</span>`;
    }
    heroBody = H`<div class="gh-num"><b>${esc(String(Math.round(Number(latest.value)*100)/100))}</b><span>${esc(mm.unit||'')}</span></div>
      <div class="gh-meta">${esc(metricName(leadKey))}${delta?' · '+delta:''}</div>`;
  } else {
    const suggest=leadKey?metricName(leadKey):null;
    heroBody = H`<p class="gh-empty">${suggest
      ? H`Time one <b>${esc(suggest.toLowerCase())}</b> today and you've got a starting line. Everything after that is progress you can see.`
      : H`This one isn't a number — you'll see it on the field before you see it here. Keep the week going.`}</p>
      ${suggest?H`<button class="btn sm amber" id="heroRecord">Record ${esc(a.first_name)}'s first ${esc(suggest.toLowerCase())}</button>`:''}`;
  }

  const suggestions=(SUGGEST_METRICS[band]||SUGGEST_METRICS.youth).filter(k=>!metricKeys.includes(k));

  $("#screen").innerHTML = H`
    ${topBar(`Progress${sinceLabel?` · since ${sinceLabel}`:''}`)}
    <div class="app-pad" style="padding-top:6px">

      <div class="ghero">
        <div class="k">Working toward</div>
        <h2>${lead?esc(lead.label):'Nothing set yet'}</h2>
        ${heroBody}
      </div>

      ${metricKeys.length?H`
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Measurements</div>
        <button class="btn sm ghost" id="addMeas">＋ Record</button>
      </div>
      <div class="card app-pad">
        ${metricKeys.map(k=>{
          const list=byMetric[k], latest=list[0], prev=list[1], mm=metricMeta(k)||{};
          let chip='';
          if(prev){
            const cur=Number(latest.value), prv=Number(prev.value);
            const better = mm.lower_is_better ? cur<prv : cur>prv;
            const diff=Math.round(Math.abs(cur-prv)*100)/100;
            chip=`<span class="pill ${better?'good':'flat'}">${better?'▲ better':'▼'} ${diff}${mm.unit?' '+esc(mm.unit):''}</span>`;
          }
          const bars=trendBars(list, !!mm.lower_is_better);
          const oldest=list[Math.min(list.length,5)-1];
          return H`<div class="mtrend">
            <div class="mt-h"><b>${esc(metricName(k))}</b>${chip}
              <span class="mt-v">${esc(fmtMeasure(k,latest.value,latest.unit||mm.unit))}</span></div>
            ${bars?H`${bars}<div class="mt-x"><span>${esc(new Date(oldest.measured_on+'T00:00:00').toLocaleDateString(undefined,{month:'short'}))}</span><span>${esc(new Date(latest.measured_on+'T00:00:00').toLocaleDateString(undefined,{month:'short'}))}</span></div>`
                 :`<div class="mt-x"><span>One reading — measure again in a few weeks to see a trend</span></div>`}
          </div>`;
        }).join('')}
      </div>
      <div class="teach" style="margin-top:14px"><div class="ic">📐</div><div>
        <h4>Same test, same conditions</h4>
        <p>Every few weeks is plenty. The trend is the point — one number means nothing.</p></div></div>
      ${growthCard(mat, a)}`
      :H`
      <div class="sec-title">Worth tracking for ${age!=null?'a '+age+'-year-old':'this age'}</div>
      <div class="card app-pad">
        ${suggestions.map(k=>H`<div class="grow"><div class="gi mglyph">${esc(METRIC_GLYPH[k]||'•')}</div>
          <div class="gt"><b>${esc(metricName(k))}</b><span>${esc(METRIC_HINT[k]||'')}</span></div>
          <button class="btn sm ghost" data-rec="${esc(k)}" aria-label="Record ${esc(metricName(k))}">＋</button></div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn sm ghost" id="addMeas" style="flex:1">Something else ›</button>
        </div>
      </div>
      ${age!=null&&age<13?`<p class="muted-note" style="margin-top:10px">No weigh-ins suggested for under-13s. Ask your pediatrician before tracking weight.</p>`:''}`}

      <div style="display:flex;justify-content:space-between;align-items:center">
        ${growthPrompt(mat)}

      <div class="sec-title">Goals</div>
        <button class="btn sm ghost" id="addGoal">＋ Goal</button>
      </div>
      <div class="card app-pad">
        ${(goals&&goals.length)?goals.map(g=>H`
          <div class="grow"><div class="gi">${g.status==='achieved'?'🏆':(g.type==='physical'?'💪':'🎯')}</div>
            <div class="gt"><b style="${g.status==='achieved'?'opacity:.6':''}">${esc(g.label)}</b><span>${esc(g.type)} · ${esc(g.status)}</span></div>
            <div style="display:flex;gap:6px">
              ${g.status==='active'?`<button class="btn sm ghost" data-achieve="${esc(g.id)}" title="Mark achieved">✓</button>`:''}
              <button class="btn sm ghost" data-delgoal="${esc(g.id)}" title="Remove">✕</button>
            </div></div>`).join('')
          :`<p class="empty">No goals yet — add one to shape the week.</p>`}
      </div>

      <!-- The trigger itself now lives on its own tab (Scan) so it isn't crammed onto
           Growth alongside everything else — but the POINTER stays here, because these
           numbers still land right back in this screen's trend bars the moment they're
           saved. Editors only: a grandparent with family view cannot give a release for
           someone else's child. -->
      ${state.canEdit?H`<div class="card app-pad" style="margin-top:10px">
        <div class="navrow" id="growToScan" role="button" tabindex="0">
          <div class="gi"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
          <div class="gt"><b>Body scan & vertical jump</b>
            <span>Four photos or a short video, measured on this phone — never uploaded, never saved.</span>
            </div><i>›</i></div>
      </div>`:''}

      ${state.canEdit?H`<div class="card app-pad" style="margin-top:10px">
        <div class="navrow" id="growToCoach" role="button" tabindex="0">
          <div class="gi">🎓</div>
          <div class="gt"><b>Team Connect</b>
            <span>${latestCoachUp
              ? esc(latestCoachUp.body.length>72 ? latestCoachUp.body.slice(0,72)+'…' : latestCoachUp.body)
              : 'Invite a coach or trainer you already work with — stats only, plus updates from them.'}</span>
            </div><i>›</i></div>
      </div>`:''}

      ${primary?.sport_key==='football'?H`<div class="sec-title" style="margin-top:18px">Pop Warner divisions</div>
      <div class="card app-pad">
        ${pwWeight==null
          ?H`<p class="empty">Record a weight above and this shows which division${age!=null?' fits a '+age+'-year-old':''} at that weight.</p>`
          : pwDivisions.length
            ?pwDivisions.map(d=>H`<div class="mrow"><span>${esc(d.label)}${d.via==='older-lighter'?' (older/lighter)':''}</span>
                <b>${esc(pwDivisionRange(d,d.via))}</b></div>`).join('')
            :H`<p class="empty">${esc(String(pwWeight))} lb at age ${age} doesn't land in a standard division band —
                check the current matrix with your league; birth-date cutoffs shift each season.</p>`}
        <p style="font-size:12.5px;line-height:1.55;color:var(--muted);margin:${pwWeight==null?0:12}px 2px 0">${esc(pwNote)}</p>
      </div>`:''}

      ${MARKETPLACE_ENABLED?H`<div class="card app-pad" id="mpBanner" style="cursor:pointer;margin-top:14px">
        <div class="grow" style="border:none;padding:0"><div class="gi">🔎</div>
          <div class="gt"><b>Find a Pro Trainer</b><span>Book a verified coach for ${esc(a.first_name)}.</span></div>
          <span class="pill">Browse ›</span></div>
      </div>`:''}

      ${(sess||[]).length?`<p class="muted-note" style="margin-top:16px">${sess.length} session${sess.length===1?'':'s'} logged, most recently ${esc(fmtDate(sess[0].done_on))}.</p>`:''}
    </div>`;
  bindTop();
  { const b=$("#addGoal"); if(b) b.onclick=()=>openAddGoal(goals||[]); }
  { const b=$("#heroGoal"); if(b) b.onclick=()=>openAddGoal(goals||[]); }
  { const b=$("#growAsk"); if(b) b.onclick=()=>openGrowthInputs(grow||{}, primary||null); }
  // `a` is the athlete this screen is rendering — the subject of the scan, and the row
  // measurements will be written against.
  { const s=$("#growToScan");
    if(s){ const open=()=>renderApp('scan');
      s.onclick=open; s.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } }; } }
  { const s=$("#growToCoach");
    if(s){ const open=()=>openTeamConnect(a);
      s.onclick=open; s.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } }; } }
  // Predicted height stays folded until asked for — same idiom as the other collapsers.
  { const t=$("#phToggle"), l=$("#phBody");
    if(t&&l){ const go=()=>{ const open=l.hidden; l.hidden=!open;
        t.setAttribute('aria-expanded',String(open)); t.classList.toggle('open',open); };
      t.onclick=go; t.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } }; } }
  { const b=$("#addMeas"); if(b) b.onclick=()=>openAddMeasure(); }
  { const b=$("#heroRecord"); if(b&&leadKey) b.onclick=()=>openAddMeasure(leadKey); }
  { const b=$("#mpBanner"); if(b) b.onclick=openMarketplace; }
  $("#screen").querySelectorAll('[data-rec]').forEach(b=>b.onclick=()=>openAddMeasure(b.dataset.rec));
  // Achieving keeps the goal in the record; removing takes it out of the plan entirely.
  $("#screen").querySelectorAll('[data-achieve]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const { error }=await sb.from('goals').update({status:'achieved'}).eq('id',b.dataset.achieve);
    if(error){ console.error(error); reportError(error,'growth:achieve'); toast('Could not update'); b.disabled=false; return; }
    toast('Goal achieved 🏆'); renderApp('growth');
  });
  $("#screen").querySelectorAll('[data-delgoal]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const { error }=await sb.from('goals').delete().eq('id',b.dataset.delgoal);
    if(error){ console.error(error); reportError(error,'growth:delgoal'); toast('Could not remove'); b.disabled=false; return; }
    toast('Goal removed'); renderApp('growth');
  });
}

// ---- PROFILE ----
