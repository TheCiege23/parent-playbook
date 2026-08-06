async function screenGrowth(){
  const a=state.active;
  const [{data:goals},{data:meas}] = await Promise.all([
    sb.from('goals').select('*').eq('athlete_id',a.id).order('created_at'),
    sb.from('measurements').select('*').eq('athlete_id',a.id).order('measured_on',{ascending:false}).limit(40),
  ]);
  const byMetric={};(meas||[]).forEach(m=>{(byMetric[m.metric_key]=byMetric[m.metric_key]||[]).push(m);});
  $("#screen").innerHTML = H`
    ${topBar('Progress & goals')}
    <div class="app-pad" style="padding-top:6px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title" style="margin:6px 2px 10px">Goals</div>
        <button class="btn sm ghost" id="addGoal">+ Goal</button>
      </div>
      <div class="card app-pad">
        ${(goals&&goals.length)?goals.map(g=>H`
          <div class="grow"><div class="gi">${g.type==='physical'?'💪':'🎯'}</div>
            <div class="gt"><b>${esc(g.label)}</b><span>${g.type} · ${g.status}</span></div></div>`).join('')
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
            const better = lower ? latest.value<prev.value : latest.value>prev.value;
            trend = `<span class="pill" style="background:${better?'#E9F1EF':'#FBE9DC'};color:${better?'var(--good)':'#9a4a12'}">${better?'▲ better':'▼'} ${Math.abs(latest.value-prev.value)}</span>`; }
          return H`<div class="mrow"><span>${esc(name)}</span><span style="display:flex;gap:8px;align-items:center">${trend}<b>${latest.value}${latest.unit?' '+esc(latest.unit):''}</b></span></div>`;
        }).join(''):`<p style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">No measurements yet. Record a height, weight, or a 40 time to start a trend line.</p>`}
      </div>
      <div class="teach" style="margin-top:16px"><div class="ic">🎓</div><div>
        <h4>Measure a few things, consistently</h4>
        <p>Same test, same conditions, every few weeks. Trends matter far more than any single number — and they keep kids motivated.</p></div></div>
    </div>`;
  bindTop();
  $("#addGoal").onclick=openAddGoal;
  $("#addMeas").onclick=openAddMeasure;
}

// ---- PROFILE ----
