async function screenWeek(){
  const a=state.active; const age=ageFrom(a.birthdate);
  const [{data:sports},{data:goals}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('goals').select('*').eq('athlete_id',a.id).eq('status','active'),
  ]);
  const primary = sports?.find(s=>s.is_primary)||sports?.[0];
  state.activeSportKey = primary?.sport_key||'general'; setAppBg();
  state.coach = primary?.parent_experience ? { sportKey:primary.sport_key, level:primary.parent_experience } : null;
  const sportName = primary ? (state.ref?.sports.find(s=>s.key===primary.sport_key)?.name || primary.sport_key) : 'Athlete';
  const sub = `${sportName}${primary?.positions?.length? ' · '+primary.positions.join('/'):''}${age!=null?` · Age ${age}`:''}`;
  const prog = buildProgram(age, goals||[], primary?.sport_key||'general', primary?.positions||[]);
  const weekEmoji = sportEmojiFor(primary?.sport_key||'general');
  const weekGrad = sportGradient(primary?.sport_key||'general');
  const todayIdx = (new Date().getDay()+6)%7; // Mon=0
  const focusLabel = goals?.[0]?.label || 'Build the basics';
  const bandAges = {littles:'ages 3–6',youth:'ages 7–9',preteen:'ages 10–12',teen:'ages 13–15',older:'ages 16–19'}[prog.band];

  const cards={};
  const reg=list=>list.forEach(x=>{ if(x&&x.title) cards[x.title]=x; });
  reg(prog.days.map(d=>d.act)); reg(prog.strength); reg(prog.speed); reg(prog.fuel);
  const cardRow=x=>`<div class="day" data-act="${esc(x.title)}" style="cursor:pointer">
      <div class="body"><h4>${esc(x.title)}</h4><p>${x.dur?esc(x.dur)+' · ':''}${esc((x.why||'').slice(0,52))}…</p></div>
      <span class="pill">Open ›</span></div>`;

  $("#screen").innerHTML = H`
    ${topBar(sub)}
    <div class="app-pad" style="padding-top:6px">
      <div class="card app-pad" style="position:relative;overflow:hidden;background:${weekGrad};color:#fff;border:none">
        <div class="sportwm" style="background-image:${sportPattern(weekEmoji)}"></div>
        <div style="position:relative">
          <div style="font-size:12px;opacity:.85;font-weight:600;text-transform:uppercase;letter-spacing:.05em">This week's focus</div>
          <h2 style="font-size:21px;margin:6px 0 4px">${esc(focusLabel)}</h2>
          <p style="font-size:13px;opacity:.9;margin:0">${esc(sportName)}${age!=null?' · '+age+' yrs':''} — ${esc(BAND_LINE[prog.band])}.</p>
        </div>
      </div>

      <div class="teach" style="margin-top:14px"><div class="ic">🛡️</div><div>
        <h4>Safe by design</h4>
        <p>Built for ${esc(bandAges)} — age-appropriate and rest-first. Tap any item for how-to, what to say, and when to stop.</p></div></div>

      <div class="card app-pad" id="mpBanner" style="cursor:pointer;margin-top:14px">
        <div class="grow"><div class="gi">🔎</div>
          <div class="gt"><b>Find a Pro Trainer</b><span>Book a verified coach for ${esc(a.first_name)}.</span></div>
          <span class="pill">Browse ›</span></div>
      </div>

      <div class="sec-title">The week</div>
      ${prog.days.map((w,idx)=>H`
        <div class="day" data-act="${esc(w.act?w.act.title:'')}" style="cursor:pointer;${idx===todayIdx?'border-color:var(--green);box-shadow:0 0 0 2px #E9F1EF':''}">
          <div class="d"><b>${w.d}</b>${idx===todayIdx?'<span style="color:var(--green)">Today</span>':'<span>&nbsp;</span>'}</div>
          <div class="body"><h4>${esc(w.title)}</h4><p>${esc(w.sub)}</p></div>
          <span class="tag t-${w.t}">${esc(w.type)}</span>
        </div>`).join('')}

      <div class="sec-title">Strength &amp; movement</div>
      ${prog.strength.map(cardRow).join('')}
      <div class="sec-title">Speed &amp; conditioning</div>
      ${prog.speed.map(cardRow).join('')}
      <div class="sec-title">Fuel &amp; recovery</div>
      ${prog.fuel.map(cardRow).join('')}

      <p class="muted-note" style="margin-top:18px">Parent Playbook gives general, age-appropriate guidance — not medical or nutrition advice. Check with your pediatrician, a registered dietitian, or your child's coach before starting new training, and stop any activity that causes pain.</p>
    </div>`;
  bindTop();
  { const mp=$("#mpBanner"); if(mp) mp.onclick=openMarketplace; }
  $("#screen").querySelectorAll('[data-act]').forEach(el=>{ const k=el.getAttribute('data-act'); if(k&&cards[k]) el.onclick=()=>openActivity(cards[k]); });
}

// ---- GROWTH ----
