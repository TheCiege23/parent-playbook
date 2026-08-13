// Totals, current streak, and an 8-week sparkline from the completion log.
// A "streak" counts consecutive weeks with at least one session, ending with the current
// week or the one before it — so a week still in progress doesn't break it.
function sessionStats(rows){
  const weekKey=iso=>{ const p=iso.slice(0,10).split('-'); const d=new Date(+p[0],+p[1]-1,+p[2]);
    d.setDate(d.getDate()-((d.getDay()+6)%7)); return isoDay(d); };
  const counts={};
  rows.forEach(r=>{ const k=weekKey(r.done_on); counts[k]=(counts[k]||0)+1; });
  const thisMon=mondayOfThisWeek();
  const keyFor=back=>{ const d=new Date(thisMon); d.setDate(d.getDate()-back*7); return isoDay(d); };
  const last8=[]; for(let i=7;i>=0;i--) last8.push({ week:keyFor(i), count:counts[keyFor(i)]||0 });
  let streak=0;
  const start=(counts[keyFor(0)]||0)>0?0:1;   // don't punish a week that's only just begun
  for(let i=start;i<520;i++){ if((counts[keyFor(i)]||0)>0) streak++; else break; }
  return { total:rows.length, thisWeek:counts[keyFor(0)]||0, streak, last8 };
}

async function screenGrowth(){
  const a=state.active;
  const [{data:goals},{data:meas},{data:sess},{data:cancels}] = await Promise.all([
    sb.from('goals').select('*').eq('athlete_id',a.id).order('created_at'),
    sb.from('measurements').select('*').eq('athlete_id',a.id).order('measured_on',{ascending:false}).limit(40),
    sb.from('sessions').select('done_on,title,kind').eq('athlete_id',a.id).order('done_on',{ascending:false}).limit(120),
    sb.from('schedule_exceptions').select('on_date,kind').eq('athlete_id',a.id).order('on_date',{ascending:false}).limit(40),
  ]);
  const done=sess||[];
  const stats=sessionStats(done);
  const byMetric={};(meas||[]).forEach(m=>{(byMetric[m.metric_key]=byMetric[m.metric_key]||[]).push(m);});
  $("#screen").innerHTML = H`
    ${topBar('Progress & goals')}
    <div class="app-pad" style="padding-top:6px">
      <div class="sec-title" style="margin:6px 2px 10px">Training done</div>
      <div class="card app-pad">
        ${done.length?H`
          <div style="display:flex;gap:10px;text-align:center">
            <div style="flex:1"><div style="font-size:24px;font-weight:700;color:var(--green-d)">${stats.total}</div>
              <div style="font-size:11.5px;color:var(--muted)">sessions</div></div>
            <div style="flex:1"><div style="font-size:24px;font-weight:700;color:var(--green-d)">${stats.thisWeek}</div>
              <div style="font-size:11.5px;color:var(--muted)">this week</div></div>
            <div style="flex:1"><div style="font-size:24px;font-weight:700;color:${stats.streak?'var(--green-d)':'var(--muted)'}">${stats.streak}</div>
              <div style="font-size:11.5px;color:var(--muted)">week streak</div></div>
          </div>
          <div style="display:flex;gap:3px;margin-top:14px;align-items:flex-end;height:38px">
            ${stats.last8.map(w=>`<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
              <div title="${w.count} session${w.count===1?'':'s'}" style="background:${w.count?'var(--green)':'var(--line)'};height:${Math.max(4,Math.min(100,w.count*22))}%;border-radius:3px"></div></div>`).join('')}
          </div>
          <p style="font-size:11px;color:var(--muted);margin:6px 2px 0;text-align:center">last 8 weeks</p>
          <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px">
            ${done.slice(0,5).map(s=>H`<div class="mrow"><span>${esc(fmtDate(s.done_on))}</span><b style="max-width:62%;text-align:right;font-weight:500">${esc(s.title)}</b></div>`).join('')}
          </div>
          ${(cancels||[]).length?`<p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0">${cancels.length} team session${cancels.length===1?'':'s'} cancelled — most recently ${esc(fmtDate(cancels[0].on_date))}.</p>`:''}`
        :`<p style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">Nothing logged yet — tap a day on the Week screen and mark it done.</p>`}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title" style="margin:6px 2px 10px">Goals</div>
        <button class="btn sm ghost" id="addGoal">+ Goal</button>
      </div>
      <div class="card app-pad">
        ${(goals&&goals.length)?goals.map(g=>H`
          <div class="grow"><div class="gi">${g.status==='achieved'?'🏆':(g.type==='physical'?'💪':'🎯')}</div>
            <div class="gt"><b style="${g.status==='achieved'?'opacity:.6':''}">${esc(g.label)}</b><span>${esc(g.type)} · ${esc(g.status)}</span></div>
            <div style="display:flex;gap:6px">
              ${g.status==='active'?`<button class="btn sm ghost" data-achieve="${esc(g.id)}" title="Mark achieved">✓</button>`:''}
              <button class="btn sm ghost" data-delgoal="${esc(g.id)}" title="Remove">✕</button>
            </div></div>`).join('')
          :`<p style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">No goals yet — add one to shape the week.</p>`}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Measurements</div>
        <button class="btn sm ghost" id="addMeas">+ Record</button>
      </div>
      <div class="card app-pad">
        ${Object.keys(byMetric).length?Object.entries(byMetric).map(([k,list])=>{
          const latest=list[0]; const name=state.ref?.metrics.find(m=>m.key===k)?.name||k;
          const prev=list[1];
          let trend=''; if(prev){ const lower=state.ref?.metrics.find(m=>m.key===k)?.lower_is_better;
            const cur=Number(latest.value), prv=Number(prev.value);        // numeric comes back as string — coerce
            const better = lower ? cur<prv : cur>prv;
            const diff = Math.round(Math.abs(cur-prv)*100)/100;
            trend = `<span class="pill" style="background:${better?'#E9F1EF':'#FBE9DC'};color:${better?'var(--good)':'#9a4a12'}">${better?'▲ better':'▼'} ${diff}</span>`; }
          return H`<div class="mrow"><span>${esc(name)}</span><span style="display:flex;gap:8px;align-items:center">${trend}<b>${(+latest.value)}${latest.unit?' '+esc(latest.unit):''}</b></span></div>`;
        }).join(''):`<p style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">No measurements yet — start with height and weight below.</p>`}
        <!-- One tap straight to the two measurements that matter, instead of "+ Record"
             then hunting a 14-item dropdown. Height and weight are the ones a parent
             actually logs, and height is the only one that changes the training plan. -->
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn sm" id="addHeight" style="flex:1">+ Height</button>
          <button class="btn sm" id="addWeight" style="flex:1">+ Weight</button>
        </div>
        <p style="font-size:11.5px;color:var(--muted);margin:10px 2px 0;line-height:1.45">
          Add height every couple of months and we'll spot a growth spurt — that's when we ease the week off instead of adding to it. Use <b>+ Record</b> above for anything else.</p>
      </div>
      <div class="teach" style="margin-top:16px"><div class="ic">🎓</div><div>
        <h4>Measure a few things, consistently</h4>
        <p>Same test, same conditions, every few weeks. Trends matter far more than any single number — and they keep kids motivated.</p></div></div>
    </div>`;
  bindTop();
  $("#addGoal").onclick=()=>openAddGoal(goals||[]);
  $("#addMeas").onclick=()=>openAddMeasure();
  { const h=$("#addHeight"); if(h) h.onclick=()=>openAddMeasure('height'); }
  { const w=$("#addWeight"); if(w) w.onclick=()=>openAddMeasure('weight'); }
  // Achieving keeps the goal in the record; removing takes it out of the plan entirely.
  $("#screen").querySelectorAll('[data-achieve]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const { error }=await sb.from('goals').update({status:'achieved'}).eq('id',b.dataset.achieve);
    if(error){ console.error(error); toast('Could not update'); b.disabled=false; return; }
    toast('Goal achieved 🏆'); renderApp('growth');
  });
  $("#screen").querySelectorAll('[data-delgoal]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const { error }=await sb.from('goals').delete().eq('id',b.dataset.delgoal);
    if(error){ console.error(error); toast('Could not remove'); b.disabled=false; return; }
    toast('Goal removed'); renderApp('growth');
  });
}

// ---- PROFILE ----
