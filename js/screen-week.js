// ===================================================================
//  WEEK — one thing today, the week underneath
// ===================================================================
// Shape (design handoff, app screens §2): today's activity owns the top and the only
// primary button on the screen; the seven days follow; strength / speed / fuel collapse
// into a single reference row. Days can be checked off. A day that passes unchecked
// REBALANCES into the next open day instead of turning red, and the streak counts
// weeks, never days — a day-level streak makes a rest day read as a loss, which is the
// opposite of everything else this app says.
async function screenWeek(){
  const a=state.active; const age=ageFrom(a.birthdate);
  const weekStart=isoDay(mondayOfThisWeek()), weekEnd=dateForDayIndex(6);
  // far enough back for the streak counter; see weekStreak()
  const histFrom=isoDay(new Date(mondayOfThisWeek().getTime()-26*7*86400000));
  const [{data:sports},{data:goals},{data:histRows},{data:cancelRows},{data:heightRows}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    // order explicitly: goals[0] drives the big "This week's focus" headline, and
    // unordered Postgres rows made it change between page loads
    sb.from('goals').select('*').eq('athlete_id',a.id).eq('status','active').order('created_at'),
    // one query covers both this week's ticks and the streak history
    sb.from('sessions').select('done_on,title').eq('athlete_id',a.id)
      .gte('done_on',histFrom).lte('done_on',weekEnd),
    sb.from('schedule_exceptions').select('on_date,kind').eq('athlete_id',a.id)
      .gte('on_date',weekStart).lte('on_date',weekEnd),
    // Height history — the only measurement that changes the plan. See growthSignal().
    sb.from('measurements').select('metric_key,value,measured_on').eq('athlete_id',a.id)
      .eq('metric_key','height').order('measured_on',{ascending:false}).limit(12),
  ]);
  const thisWeekRows=(histRows||[]).filter(r=>r.done_on>=weekStart&&r.done_on<=weekEnd);
  const doneSet=new Set(thisWeekRows.map(r=>r.done_on+'|'+r.title));
  const cancelledDates=new Set((cancelRows||[]).map(r=>r.on_date));
  const cancelledIdx=[0,1,2,3,4,5,6].filter(i=>cancelledDates.has(dateForDayIndex(i)));
  const primary = sports?.find(s=>s.is_primary)||sports?.[0];
  state.activeSportKey = primary?.sport_key||'general'; setAppBg();
  state.coach = primary?.parent_experience ? { sportKey:primary.sport_key, level:primary.parent_experience } : null;
  const nameOf = k => state.ref?.sports.find(s=>s.key===k)?.name || k;
  const sportName = primary ? nameOf(primary.sport_key) : 'Athlete';

  // Every sport the athlete plays, each with its own schedule and season window.
  // buildProgram merges them into ONE weekly load budget.
  const roster=(sports||[]).map(s=>{
    const ss=s.season_start||null, se=s.season_end||null;
    const pre=!!(ss && weekEnd<ss), off=!!(se && weekStart>se);
    // `gamesOn` gates the GAME DAY only. A sport in preseason camp is still very much
    // active — practices are happening — so it must keep contributing skill work.
    return { sportKey:s.sport_key, sportName:nameOf(s.sport_key), positions:s.positions||[],
             level:s.level||null, practiceDays:s.practice_days||[], gameDay:s.game_day,
             gamesOn:!(pre||off), isPrimary:!!s.is_primary };
  });
  // Games don't exist before the season opens — a weekly game day would otherwise put
  // "Game day" on every Saturday of the preseason.
  const seasonStart = primary?.season_start || null;
  const seasonEnd   = primary?.season_end   || null;
  const preseason = !!(seasonStart && weekEnd < seasonStart);
  const offseason = !!(seasonEnd && weekStart > seasonEnd);
  const inSeason = !(preseason || offseason);
  const multiSport = roster.length>1;
  // "Active" = games running OR practices on the calendar. Camp counts.
  const activeNames = roster.filter(s=>s.gamesOn||s.practiceDays.length).map(s=>s.sportName);
  // Week counter: weeks into the SEASON once one is set, otherwise weeks since the
  // profile was created. "Week 8" on opening day read as nonsense.
  const seasonRef = primary?.season_start || null;
  const weeksIn = weeksSince(a.created_at);
  const seasonWeek = (seasonRef && weekStart>=seasonRef) ? weeksSince(seasonRef)+1 : null;

  const growth = growthSignal(heightRows||[]);
  const sched = { sports: roster, cancelled: cancelledIdx,
      practiceDays: primary?.practice_days||[], gameDay: primary?.game_day,
      inSeason, seasonStart, seasonEnd, seasonState: primary?.season_state||null,
      level: primary?.level||null, growth };
  const prog = buildProgram(age, goals||[], primary?.sport_key||'general', primary?.positions||[], weeksIn, sched);
  // The athlete row now carries the season, because it is the single thing that most
  // changes what a week should look like.
  const sub = (multiSport
    ? `${(activeNames.length?activeNames:roster.map(s=>s.sportName)).join(' + ')}${age!=null?` · Age ${age}`:''}`
    : `${sportName}${primary?.positions?.length? ' · '+primary.positions.join('/'):''}${age!=null?` · Age ${age}`:''}`)
    + (prog.seasonLabel?` · ${prog.seasonLabel}`:'');
  const hasSchedule = roster.some(s=>s.practiceDays.length>0 || s.gameDay!=null);
  const weekEmoji = sportEmojiFor(primary?.sport_key||'general');
  const weekGrad = sportGradient(primary?.sport_key||'general');
  const todayIdx = (new Date().getDay()+6)%7; // Mon=0
  const focusLabel = goals?.[0]?.label || 'Build the basics';
  const bandAges = {littles:'ages 3–6',youth:'ages 7–9',preteen:'ages 10–12',teen:'ages 13–15',older:'ages 16–19'}[prog.band];

  // ---- rebalance, then read the week ----
  const isDoneAt=i=>{ const d=prog.days[i]; return !!(d&&d.act&&doneSet.has(dateForDayIndex(i)+'|'+d.act.title)); };
  const days = rebalanceWeek(prog.days, { todayIdx, isDone:isDoneAt, gameDays:prog.gameDays||[] });
  // Rest and moved days are never "done" — there is nothing to complete. Without this
  // guard a rest day whose RECOVERY card shares a title with a logged session rendered
  // with a tick and a strikethrough, which is exactly the wrong message about rest.
  const done=i=>{ const d=days[i];
    if(!d||d.t==='rest'||d.t==='moved'||!d.act) return false;
    return doneSet.has(dateForDayIndex(i)+'|'+d.act.title); };
  // rest isn't a chore to tick off, and a moved day has already been counted where it landed
  const loggableIdx=days.map((w,i)=>({w,i})).filter(o=>o.w.t!=='rest'&&o.w.t!=='moved').map(o=>o.i);
  const loggable=loggableIdx.length;
  const doneCount=loggableIdx.filter(done).length;
  const movedIdx=days.map((w,i)=>({w,i})).filter(o=>o.w.t==='moved').map(o=>o.i);

  const streak = weekStreak(histRows||[], { age, goals:goals||[],
    sportKey:primary?.sport_key||'general', positions:primary?.positions||[],
    weekIndex:weeksIn, schedule:sched });

  // ---- today ----
  const todayW = days[todayIdx];
  const todayDate = dateForDayIndex(todayIdx);
  const todayDone = done(todayIdx);
  const dayName = i => new Date(dateForDayIndex(i)+'T00:00:00').toLocaleDateString(undefined,{weekday:'long'});
  const tomorrowIdx = todayIdx<6 ? todayIdx+1 : -1;
  const tomorrowW = tomorrowIdx>=0 ? days[tomorrowIdx] : null;

  // Where a missed day went, said once, in plain words. Never in red.
  const movedNote = movedIdx.length
    ? movedIdx.map(i=>days[i].movedTo!=null
        ? `${DAY_LABELS[i]}'s ${days[i].title.toLowerCase()} moved to ${DAY_LABELS[days[i].movedTo]}`
        : `${DAY_LABELS[i]}'s ${days[i].title.toLowerCase()} didn't happen — it comes back next week`).join('. ')+'.'
    : '';

  const tomorrowCard = !tomorrowW ? '' : H`
      <div class="card app-pad" id="tomorrowCard" style="cursor:pointer;margin-bottom:14px">
        <div class="sec-title" style="margin:0 0 8px">Tomorrow</div>
        <div class="grow" style="border:none;padding:0">
          <div class="gi">${tomorrowW.t==='game'?'🏆':tomorrowW.t==='rest'?'🌙':tomorrowW.t==='practice'?'🏅':'💪'}</div>
          <div class="gt"><b>${esc(tomorrowW.title)}</b><span>${esc(tomorrowW.sub||'')}</span></div>
          ${tomorrowW.act?'<span class="pill">Open ›</span>':''}
        </div>
      </div>
      ${railSkeleton()}
    </div>`;

  // Three states, one card. Rest takes the whole thing and offers nothing to complete —
  // that is the screen that proves the product means what it says about rest.
  let todayCard='';
  if(!todayW){ todayCard=''; }
  else if(todayW.t==='rest'){
    todayCard = H`
      <div class="today rest">
        <div class="k">Today · ${esc(dayName(todayIdx))}</div>
        <h3>Nothing today.</h3>
        <p>That's the plan, not a gap. ${doneCount>0
          ? H`${esc(a.first_name)} has trained <b>${doneCount}</b> ${doneCount===1?'day':'days'} this week`
          : H`Recovery is when the work from the last few days actually becomes strength`}${
          tomorrowW&&tomorrowW.t==='game'?' — tomorrow needs fresh legs':''}.</p>
        <p class="sub2">Bed early if you can. Sleep is where growing athletes build the speed you're after.</p>
      </div>`;
  } else if(todayDone){
    todayCard = H`
      <div class="today done">
        <div class="k">Today · ${esc(dayName(todayIdx))}</div>
        <h3>✓ That's ${esc(dayName(todayIdx))} done</h3>
        <p>${doneCount} ${doneCount===1?'day':'days'} this week.${movedNote?' '+esc(movedNote):''}</p>
        <div class="acts">
          <button class="ghostlink" id="todayOpen">Open it again ›</button>
          <button class="ghostlink" id="todayUndo">Undo</button>
        </div>
      </div>`;
  } else {
    todayCard = H`
      <div class="today">
        <div class="k">Today · ${esc(dayName(todayIdx))}</div>
        <h3>${esc(todayW.title)}</h3>
        <p>${esc(todayW.sub||'')}${state.canEdit?'':' · '+esc(ownerFirstName())+' marks these off'}</p>
        <div class="acts">
          ${!state.canEdit
            ? H`<button class="ghostlink" id="todayOpen">See how it's done ›</button>`
            : todayW.act
              ? H`<button class="btn sm amber" id="todayDone">Mark done</button>
                  <button class="ghostlink" id="todayOpen">How to do it ›</button>`
              : '<span class="doneflag">Nothing to complete today</span>'}
        </div>
      </div>`;
  }

  const cards={};
  const reg=list=>list.forEach(x=>{ if(x&&x.title) cards[x.title]=x; });
  reg(days.map(d=>d.act)); reg(prog.strength); reg(prog.speed); reg(prog.fuel);
  const cardRow=x=>`<div class="day" data-act="${esc(x.title)}" style="cursor:pointer">
      <div class="body"><h4>${esc(x.title)}</h4><p>${x.dur?esc(x.dur)+' · ':''}${esc((x.why||'').slice(0,52))}…</p></div>
      <span class="pill">Open ›</span></div>`;
  const refCount=(prog.strength||[]).length+(prog.speed||[]).length+(prog.fuel||[]).length;

  // The design's week screen is header -> today -> the week -> one collapsed reference
  // row. Six teach cards could stack between today and the list, pushing the week —
  // the entire point of the screen — below the fold on a phone. These explain WHY the
  // week is shaped the way it is, which is worth reading once and never again, so they
  // collapse. The two that change what a parent does today (a heavy team week, a growth
  // spurt) stay inline above.
  const wkNotes = [];
  if(!prog.overloaded) wkNotes.push({ ic:'🛡️', h: hasSchedule?'Built around practice':'Safe by design',
    p: !hasSchedule
      ? H`Built for ${esc(bandAges)} — age-appropriate and rest-first. Tap any item for how-to, what to say, and when to stop.`
      : prog.cancelled.length
        ? H`A team session came off the schedule, so there's room for ${prog.homeDays===0?'<b>rest</b> — the week was already full':'<b>'+prog.homeDays+(prog.homeDays===1?'</b> session':'</b> sessions')+' at home instead'}. Tap any item for how-to and when to stop.`
        : H`Practice days are left alone — ${esc(a.first_name)} does ${prog.homeDays===0?'<b>nothing extra</b> at home this week':'<b>'+prog.homeDays+(prog.homeDays===1?'</b> home session':'</b> home sessions')} on top of the team's schedule. Tap any item for how-to and when to stop.` });
  if(prog.seasonState==='offseason') wkNotes.push({ ic:'🌱', h:'Offseason — this is the part that matters',
    p:"No games competing for the week, so there's room for <b>one more session</b> than in season. Skill and age-safe strength now is what shows up in September. Change the season in Profile whenever it moves." });
  if(prog.seasonState==='between_sports') wkNotes.push({ ic:'🔄', h:'Between sports',
    p:"One's finished and the next hasn't started, so the week leads with general athleticism — strength, speed and movement — instead of sport-specific work. It's the best window of the year for it." });
  if(prog.assumeTeamLoad) wkNotes.push({ ic:'🏅', h:"We've assumed a busy team week",
    p: H`At ${esc(primary?.level||'this level')}, ${esc(a.first_name)} is probably training more with the team than a rec season — so we've added <b>one session fewer</b> at home rather than stack on top of a week we can't see. Tell us the actual practice days and we'll use those instead of guessing.` });
  if((preseason||offseason)&&primary?.game_day!=null) wkNotes.push({ ic:'📆', h: preseason?'Preseason — no games yet':"Season's over",
    p: preseason
      ? H`Games start around <b>${esc(fmtDate(seasonStart))}</b>, so Saturdays are open until then. Practices still count as training.`
      : H`The season ended <b>${esc(fmtDate(seasonEnd))}</b> — game days are off the plan. Update the dates in Profile when the next one starts.` });

  $("#screen").innerHTML = H`
    ${topBar(sub, streak>0?H`<span class="streak" title="${streak} full ${streak===1?'week':'weeks'} in a row"><b>${streak}</b><span>${streak===1?'Week':'Weeks'}</span></span>`:'')}
    <div class="app-pad two-col" style="padding-top:6px">
      <div class="col-main">
      <div class="card app-pad" style="position:relative;overflow:hidden;background:${weekGrad};color:#fff;border:none">
        <div class="sportwm" style="background-image:${sportPattern(weekEmoji)}"></div>
        <div style="position:relative">
          <div class="k-mono">${preseason?'Camp':(seasonWeek?'Season week '+seasonWeek:'Week '+(weeksIn+1))} · This week's focus</div>
          <h2 style="font-size:21px;margin:6px 0 4px">${esc(focusLabel)}</h2>
          <p style="font-size:13px;opacity:.9;margin:0">${esc(sportName)}${age!=null?' · '+age+' yrs':''} — ${esc(BAND_LINE[prog.band])}.</p>
        </div>
      </div>

      <div style="margin-top:14px">${todayCard}</div>
      ${todayW&&(todayW.t==='rest'||todayDone)?tomorrowCard:''}

      ${prog.overloaded?H`<div class="teach" style="background:#FBE9DC;border-color:#E6C9BC"><div class="ic">⚠️</div><div>
        <h4>That's a heavy team week</h4>
        <p>${esc(a.first_name)}'s team has them going <b>${prog.committed} days</b> this week${prog.budget?` — for ${esc(bandAges)} the guidance we follow is about ${prog.budget}`:''}. We've added <b>nothing</b> at home, and we won't while it stays this full. Worth a conversation with the coach.</p></div></div>`:''}

      ${prog.growth?H`<div class="teach" style="background:#EAF3F0;border-color:#CFE3DC"><div class="ic">📏</div><div>
        <h4>${esc(a.first_name)} is growing fast right now</h4>
        <p><b>${esc(prog.growth.gainIn)}"</b> in the last ${esc(Math.round(prog.growth.days/30))} months — about ${esc(prog.growth.inPerYear)}" a year. During a stretch like this bone grows faster than the tendons attached to it, so knees and heels get sore easily and coordination can go backwards for a while. Both are normal.<br><br>
        We've taken <b>one session off</b> this week rather than adding to it. Keep an eye out for pain just below the kneecap or at the back of the heel — if it lasts more than a couple of weeks, or they're limping or swollen, see a doctor.</p></div></div>`:''}

      ${!(goals&&goals.length)?H`<div class="card app-pad" id="goalBanner" style="cursor:pointer;margin-top:14px">
        <div class="grow"><div class="gi">🎯</div>
          <div class="gt"><b>What should ${esc(a.first_name)} work toward?</b><span>Pick 1–3 and the week starts building around them.</span></div>
          <span class="pill">Choose ›</span></div>
      </div>`:''}

      ${!hasSchedule?H`<div class="card app-pad" id="schedBanner" style="cursor:pointer;margin-top:14px">
        <div class="grow"><div class="gi">📅</div>
          <div class="gt"><b>When does ${esc(a.first_name)} have practice?</b><span>So we plan around it instead of on top of it.</span></div>
          <span class="pill">Set ›</span></div>
      </div>`:''}

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">This week</div>
        ${loggable>0?`<span class="pill" style="${doneCount>=loggable?'background:#E9F1EF;color:var(--good)':''}">${doneCount} of ${loggable} done</span>`:''}
      </div>
      ${days.map((w,idx)=>{
        const isDone=done(idx);
        const isMoved=w.t==='moved';
        const isToday=idx===todayIdx;
        // Family view gets a small dot, never a checkbox — a control that looks
        // tappable and then refuses is worse than no control at all.
        const tickable=w.t!=='rest'&&w.t!=='moved'&&!!w.act&&state.canEdit!==false;
        const cls=['day', isDone?'is-done':'', isMoved?'is-moved':'', isToday?'is-today':''].filter(Boolean).join(' ');
        return H`
        <div class="${cls}" data-day="${idx}">
          ${tickable
            ? H`<button class="chk ${isDone?'on':''}" data-tick="${idx}"
                  aria-pressed="${isDone?'true':'false'}"
                  aria-label="${isDone?'Mark not done':'Mark done'}: ${esc(w.title)}">${isDone?'✓':''}</button>`
            : H`<span class="chk static ${w.t==='rest'?'rest':''} ${isDone?'seen':''}" aria-hidden="true">${isDone?'✓':(w.t==='rest'?'z':(isMoved?'→':''))}</span>`}
          <div class="d"><b>${w.d}</b>${isToday?'<span>Today</span>':'<span>&nbsp;</span>'}</div>
          <div class="body"><h4>${esc(w.title)}</h4><p>${esc(w.t==='rest'?(w.sub||'')+' — counts as done':(w.sub||''))}</p></div>
          <span class="tag t-${w.t}">${esc(w.type)}</span>
        </div>`;}).join('')}

      ${wkNotes.length?H`<div class="refbar" id="whyToggle" role="button" tabindex="0" aria-expanded="false" aria-controls="whyList">
        <div class="gi">💡</div>
        <div class="gt"><b>Why this week looks like this</b><span>How we sized it — read once, then forget it</span></div>
        <span class="pill"><b>${wkNotes.length}</b> <i class="caret">›</i></span>
      </div>
      <div id="whyList" hidden>
        ${wkNotes.map(n=>H`<div class="teach" style="background:#EAF3F0;border-color:#CFE3DC"><div class="ic">${n.ic}</div><div>
          <h4>${n.h}</h4><p>${n.p}</p></div></div>`).join('')}
      </div>`:''}

      <div class="refbar" id="refToggle" role="button" tabindex="0" aria-expanded="false" aria-controls="refList">
        <div class="gi">📚</div>
        <div class="gt"><b>Strength, speed &amp; fuel</b><span>Reference — read any time, not part of the plan</span></div>
        <span class="pill"><b>${refCount}</b> <i class="caret">›</i></span>
      </div>
      <div id="refList" hidden>
        <div class="sec-title">Strength &amp; movement</div>
        ${prog.strength.map(cardRow).join('')}
        <div class="sec-title">Speed &amp; conditioning</div>
        ${prog.speed.map(cardRow).join('')}
        <div class="sec-title">Fuel &amp; recovery</div>
        ${prog.fuel.map(cardRow).join('')}
      </div>

      <p class="muted-note" style="margin-top:18px">Parent Playbook gives general, age-appropriate guidance — not medical or nutrition advice. Check with your pediatrician, a registered dietitian, or your child's coach before starting new training, and stop any activity that causes pain.</p>
    </div>`;
  // Snapshot for the offline screen. Small and non-sensitive: the plan, who it's for,
  // and which days are ticked. Never the journey.
  if(typeof owSaveWeek==='function') owSaveWeek({
    athlete_id:a.id, first_name:a.first_name, sub,
    days:days.map(w=>({d:w.d,t:w.t,type:w.type,title:w.title,sub:w.sub||''})),
    done:loggableIdx.filter(done),
  });
  // Publish which days are nudge-able so notify-daily never has to reimplement
  // buildProgram. Day indexes only — no titles, no names. Best-effort: a failure here
  // costs a nudge, never the week.
  if(state.canEdit!==false){
    const nudge=days.map((w,i)=>({w,i}))
      .filter(o=>o.w.t==='train'||o.w.t==='gym')
      .filter(o=>!done(o.i))
      .map(o=>o.i);
    sb.from('week_plan_days').upsert({ athlete_id:a.id, week_start:weekStart,
      nudge_days:nudge, updated_at:new Date().toISOString() },{ onConflict:'athlete_id,week_start' })
      .then(r=>{ if(r&&r.error) console.error('week_plan_days',r.error); });
  }
  // The rail is secondary by design: rendered empty with the week, filled after. A
  // failure in here can never delay or break the screen a parent actually came for.
  if(typeof fillWeekRail === 'function'){
    fillWeekRail(a, goals, days, todayIdx).catch(e => console.error('rail', e));
  }
  bindTop();
  { const gb=$("#goalBanner"); if(gb) gb.onclick=()=>openAddGoal(goals||[]); }
  { const sc=$("#schedBanner"); if(sc&&primary) sc.onclick=()=>openPracticeSchedule(primary.sport_key,
      { practiceDays:primary.practice_days||[], gameDay:primary.game_day,
        seasonStart:primary.season_start, seasonEnd:primary.season_end }); }

  // context for a day row — shared by the row, the tick, and today's card so the tally
  // can never disagree with whichever one the parent tapped
  const ctxFor=i=>{ const w=days[i]; if(!w||!w.act) return null;
    return { date:dateForDayIndex(i), kind:w.type, week:prog.week, title:w.act.title,
             loggable:w.t!=='rest'&&w.t!=='moved',
             teamSession:(w.t==='practice'||w.t==='game'),
             cancelled:cancelledDates.has(dateForDayIndex(i)), done:done(i) }; };

  { const tctx=ctxFor(todayIdx);
    const td=$("#todayDone"); if(td&&tctx) td.onclick=()=>markSessionDone(tctx,td);
    const tu=$("#todayUndo"); if(tu&&tctx) tu.onclick=()=>undoSessionDone(tctx,tu);
    const to=$("#todayOpen"); if(to&&todayW&&todayW.act) to.onclick=()=>openActivity(todayW.act,tctx); }

  { const tc=$("#tomorrowCard");
    if(tc&&tomorrowW&&tomorrowW.act) tc.onclick=()=>openActivity(tomorrowW.act,ctxFor(tomorrowIdx)); }

  // Ticking a day is the whole interaction — it must not also open the sheet.
  $("#screen").querySelectorAll('[data-tick]').forEach(btn=>{
    const i=+btn.getAttribute('data-tick'); const ctx=ctxFor(i); if(!ctx) return;
    btn.onclick=e=>{ e.stopPropagation(); ctx.done?undoSessionDone(ctx,btn):markSessionDone(ctx,btn); };
  });
  $("#screen").querySelectorAll('[data-day]').forEach(el=>{
    const i=+el.getAttribute('data-day'); const w=days[i]; if(!w||!w.act) return;
    el.onclick=()=>openActivity(w.act,ctxFor(i));
  });

  // Reference material stays collapsed: it is not the plan, and seven days plus three
  // more lists was the reason the actual plan got scrolled past.
  { const t=$("#whyToggle"), l=$("#whyList");
    if(t&&l){ const go=()=>{ const open=l.hidden; l.hidden=!open;
        t.setAttribute('aria-expanded',String(open)); t.classList.toggle('open',open); };
      t.onclick=go; t.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } }; } }
  { const t=$("#refToggle"), l=$("#refList");
    const flip=()=>{ const open=l.hidden; l.hidden=!open; t.setAttribute('aria-expanded',String(open)); t.classList.toggle('open',open); };
    if(t&&l){ t.onclick=flip; t.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); flip(); } }; } }

  $("#screen").querySelectorAll('[data-act]').forEach(el=>{ const k=el.getAttribute('data-act'); if(k&&cards[k]) el.onclick=()=>openActivity(cards[k]); });
}

// ---- GROWTH ----
