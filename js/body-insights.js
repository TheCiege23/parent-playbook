// Body Insights reads existing measurements. Dates are recording dates, not inferred scan sessions.
const BI_BODY = ['height',...Object.keys(BODY_OUTPUTS)];
const BI_LABELS = {height:'Height',wingspan:'Wingspan',standing_reach:'Standing reach',shoulder_width:'Shoulder width',torso_length:'Torso length',leg_length:'Leg length',vertical:'Vertical jump',reaction_time:'Reaction time',footwork_cadence:'Footwork cadence'};
function biName(key){ return BI_LABELS[key] || BODY_OUTPUTS[key]?.label || (typeof metricName==='function'?metricName(key):key.replace(/_/g,' ')); }
function biValue(row){ return row ? `${Number(Number(row.value).toFixed(2))}${row.unit?' '+row.unit:''}` : '—'; }
function biMethod(row){ return ({photo:'Photo estimate',video:'Video assessment',manual:'Manual entry',guided:'Guided assessment',import:'Imported'})[row.source] || 'Method not recorded'; }
function biValidRows(rows){
  return (rows||[]).filter(r=>r && r.value!==null && r.value!=='' && Number.isFinite(Number(r.value)) && /^\d{4}-\d{2}-\d{2}$/.test(r.measured_on||''))
    .slice().sort((a,b)=>b.measured_on.localeCompare(a.measured_on) || String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(b.id||'').localeCompare(String(a.id||'')));
}
function biSnapshot(rows, date){
  const snapshot = new Map();
  for(const r of biValidRows(rows)) if(r.measured_on<=date && !snapshot.has(r.metric_key)) snapshot.set(r.metric_key,r);
  return snapshot;
}
function biComparison(current, previous){
  if(!previous) return {label:'No earlier reading',delta:null};
  if(current.unit!==previous.unit) return {label:'Different units · not compared',delta:null};
  if(!current.source || current.source!==previous.source) return {label:'Different or unknown methods · not compared',delta:null};
  if(!scanCompatibility(current,previous)) return {label:'Engine details differ or are missing · not compared',delta:null};
  const delta=Number((Number(current.value)-Number(previous.value)).toFixed(2));
  return {label:delta===0?'No change':`${delta>0?'+':''}${delta}${current.unit?' '+current.unit:''}`,delta};
}
function biChart(rows, current){
  const pts=rows.filter(r=>r.metric_key===current.metric_key && scanCompatibility(r,current) && r.measured_on<=current.measured_on).slice(0,8).reverse();
  if(pts.length<2) return '<p class="bi-muted">Another reading will start a trend.</p>';
  const values=pts.map(r=>Number(r.value)), lo=Math.min(...values), hi=Math.max(...values), span=hi-lo||1;
  const points=values.map((v,i)=>`${8+i*224/(pts.length-1)},${hi===lo?25:42-(v-lo)/span*34}`).join(' ');
  return `<svg class="bi-chart" viewBox="0 0 240 50" role="img" aria-label="${esc(biName(current.metric_key)+': '+pts.map(r=>r.measured_on+' '+biValue(r)).join('; '))}"><path d="M8 44H232" stroke="currentColor" opacity=".15"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5"/></svg><div class="bi-axis"><span>${esc(pts[0].measured_on)}</span><span>${esc(pts[pts.length-1].measured_on)}</span></div>`;
}
function biMetricCard(row, before, rows){
  const change=biComparison(row,before);
  return `<article class="bi-metric"><div class="bi-eyebrow">${esc(biName(row.metric_key))}</div><strong>${esc(biValue(row))}</strong><span class="bi-delta">${esc(change.label)}</span>${biChart(rows,row)}<p class="bi-muted">${esc(biMethod(row))} · ${esc(row.measured_on)}</p></article>`;
}
function biSidePairs(input,date){
  const groups=new Map();
  for(const row of biValidRows(input)){
    if(row.measured_on>date||!BODY_SIDE_KEYS.includes(row.metric_key))continue;
    const meta=readScanRecord(row);if(!meta)continue;
    if(!groups.has(meta.id))groups.set(meta.id,{meta,rows:new Map()});
    const group=groups.get(meta.id);if(!group.rows.has(row.metric_key))group.rows.set(row.metric_key,row);
  }
  const latest=[...groups.values()].sort((a,b)=>b.meta.captured_at.localeCompare(a.meta.captured_at))[0];
  if(!latest)return '';
  return `<section><div class="bi-section-head"><h2>Left & right segment estimates</h2><span>One assessment · ${esc(latest.meta.captured_at.slice(0,10))}</span></div><p class="bi-muted">Provisional joint distances from the requested front photo. Pose error can create a difference; mirrored or incorrectly oriented captures can swap side labels. This is not a diagnosis of limb-length difference or injury risk.</p><div class="bi-table-wrap"><table class="bi-table"><caption class="sr-only">Left and right estimates from the same assessment</caption><thead><tr><th scope="col">Segment</th><th scope="col">Left</th><th scope="col">Right</th><th scope="col">Absolute difference</th></tr></thead><tbody>${BODY_SEGMENTS.map(s=>{
    const left=latest.rows.get('left_'+s.key+'_length'),right=latest.rows.get('right_'+s.key+'_length');
    return `<tr><td>${esc(s.label)}</td><td>${esc(biValue(left))}</td><td>${esc(biValue(right))}</td><td>${esc(compareBodySides(left,right).label)}</td></tr>`;
  }).join('')}</tbody></table></div></section>`;
}
function biOutputDefinitions(rows){
  const keys=[...new Set(rows.filter(r=>r.source==='photo'&&BODY_OUTPUTS[r.metric_key]).map(r=>r.metric_key))];
  if(!keys.length)return '';
  return `<details class="bi-assessment"><summary>Photo-output definitions</summary><div class="bi-assessment-body"><p>Current definitions (${esc(BODY_OUTPUT_VERSION)}). Each assessment retains its own engine version. No photo-derived output is a validated anatomical or clinical measurement.</p><dl>${keys.map(k=>`<dt><b>${esc(BODY_OUTPUTS[k].label)}</b></dt><dd>${esc(BODY_OUTPUTS[k].definition)}</dd>`).join('')}</dl></div></details>`;
}
function biAssessments(rows){
  const scans=new Map();
  for(const row of rows){const meta=readScanRecord(row);if(!meta) continue;
    if(!scans.has(meta.id)) scans.set(meta.id,{meta,rows:[]});scans.get(meta.id).rows.push(row);}
  if(!scans.size) return '';
  return `<section><div class="bi-section-head"><h2>Body assessment details</h2><span>${scans.size} saved assessments with engine records</span></div>${[...scans.values()].map(({meta,rows:items})=>{
    const checked=Array.isArray(meta.quality?.capture_checks)?meta.quality.capture_checks:[];
    const duration=scanProcessingLabel(meta);
    const reuse=meta.photo_reuse_check?.protocol==='exact-photo-bytes-v1'&&meta.photo_reuse_check.checked_views===4&&meta.photo_reuse_check.distinct_files===true;
    const photoStatus=(checked.length?'<p><b>Photo checks:</b> '+checked.filter(c=>c?.accepted===true).length+' of '+checked.length+' accepted. Checks are heuristic.</p>':'')+(reuse?'<p>Four different photo files checked. Edited copies, subject identity and facing direction are not verified.</p>':'')+(duration?'<p>'+esc(duration)+'</p>':'');
    const q=meta.quality||{},score=typeof q.score==='number'&&Number.isFinite(q.score)?Math.round(q.score*100):null;
    return `<details class="bi-assessment"><summary>${esc(new Date(meta.captured_at).toLocaleString())} · ${items.length} measurements</summary><div class="bi-assessment-body"><p><b>Engine:</b> ${esc(meta.engine.id)} · ${esc(meta.engine.version)}</p><p><b>Model:</b> ${esc(meta.engine.model)}</p><p><b>Height input:</b> ${esc(meta.input_height?.value??'Unknown')} in · ${esc(meta.input_height?.measured_on||'Date not recorded')}</p><p><b>Capture quality:</b> ${score===null?'Not recorded':score+'/100 (heuristic, not accuracy)'}</p><p><b>Views used:</b> ${esc(scanStrings(q.frames_used).join(', ')||'Not recorded')}</p><p><b>Views missed:</b> ${esc(scanStrings(q.frames_missed).join(', ')||'None recorded')}</p><p><b>Measurements rejected:</b> ${esc(scanStrings(q.rejected).join(', ')||'None recorded')}</p>${photoStatus}<p class="bi-muted">These details travel with the measurements in your export. Older recordings may not include engine details.</p></div></details>`;
  }).join('')}</section>`;
}
function biMarkup(athlete, input, date, baseline){
  const rows=biValidRows(input), dates=[...new Set(rows.map(r=>r.measured_on))];
  const now=biSnapshot(rows,date), before=biSnapshot(rows,baseline||'');
  const body=[...now.values()].filter(r=>BI_BODY.includes(r.metric_key)&&!BODY_SIDE_KEYS.includes(r.metric_key));
  const performance=[...now.values()].filter(r=>!BI_BODY.includes(r.metric_key));
  const card=r=>biMetricCard(r,before.get(r.metric_key),rows);
  const selectedRows=rows.filter(r=>r.measured_on<=date);
  const height=now.get('height');
  const heightRows=selectedRows.filter(r=>r.metric_key==='height' && r.unit==='in');
  const growth=typeof growthVelocity==='function'?growthVelocity(heightRows):null;
  const predicted=typeof midParentalHeight==='function'?midParentalHeight(athlete.mother_height_in,athlete.father_height_in,athlete.sex_at_birth):null;
  const maturityBatch=typeof maturityInputBatch==='function'?maturityInputBatch(selectedRows):null;
  const maturity=maturityBatch&&typeof maturityOffsetEstimate==='function'?maturityOffsetEstimate({sex:athlete.sex_at_birth,birthdate:athlete.birthdate,measuredOn:maturityBatch.measuredOn,heightIn:maturityBatch.height.value,sittingHeightIn:maturityBatch.sitting_height.value,weightLb:maturityBatch.weight.value}):null;
  // Population references for body lengths come from the loaded-cohort registry, which is
  // deliberately empty: no published cohort has established definitional equivalence with a
  // pose-derived estimate. Guarded the same way staturePercentile is, so the page still renders
  // if the registry script is absent.
  const refSummary=typeof referenceCohortSummary==='function'?referenceCohortSummary():null;
  const refNote=refSummary&&!refSummary.usableMetrics.length
    ?`<p class="bi-muted bi-no-reference">${esc(refSummary.reason)}</p>`:'';
  const reference=height && height.unit==='in' && typeof staturePercentile==='function' && typeof ageMonthsAt==='function'
    ? staturePercentile(Number(height.value),ageMonthsAt(athlete.birthdate,height.measured_on),athlete.sex_at_birth):null;
  const percentile=reference?.pct;
  return `<div class="bi-page">
    <header class="bi-hero"><div><span class="bi-eyebrow">PARENT PLAYBOOK / BODY INSIGHTS</span><h1>A clearer view of progress.</h1><p>${esc(athlete.first_name||'Your athlete')}'s measurements, movement and growth in one place.</p><div class="bi-actions"><button class="btn amber" id="biScan">New assessment</button><button class="btn ghost" id="biExport" ${rows.length?'':'disabled'}>Export records</button></div></div><div class="bi-summary"><strong>${now.size}</strong><span>recorded metrics</span><strong>${dates.length}</strong><span>recording dates</span></div></header>
    <div class="bi-controls"><label>View readings through<select id="biDate" ${dates.length?'':'disabled'}>${dates.map(d=>`<option ${d===date?'selected':''}>${d}</option>`).join('')}</select></label><label>Compare with<select id="biBaseline"><option value="">No comparison</option>${dates.filter(d=>d<date).map(d=>`<option ${d===baseline?'selected':''}>${d}</option>`).join('')}</select></label></div>
    <p class="bi-muted">Each card shows the latest reading on or before the selected date. Comparison uses the same units and recorded method; matching methods alone does not guarantee equivalent conditions.</p>
    <section><div class="bi-section-head"><h2>Body measurements</h2><span>Lengths & proportions</span></div>${body.length?`${refNote}<div class="bi-grid">${body.map(card).join('')}</div>`:'<div class="bi-empty">Start with a measured height, then take a four-photo assessment to estimate body lengths.</div>'}</section>
    ${biSidePairs(rows,date)}
    ${biOutputDefinitions([...now.values()])}
    <section><div class="bi-section-head"><h2>Growth context</h2><span>Based on recorded height and family inputs</span></div><div class="bi-grid">
      <article class="bi-metric"><div class="bi-eyebrow">Height reference</div><strong>${Number.isFinite(percentile)?ordinalPct(percentile):'—'}</strong><p class="bi-muted">${Number.isFinite(percentile)?'CDC stature percentile for age and sex.':'Needs height in inches, date of birth and supported reference inputs.'}</p></article>
      <article class="bi-metric"><div class="bi-eyebrow">Population reference</div><strong>${refSummary&&refSummary.usableMetrics.length?refSummary.usableMetrics.length:'—'}</strong><p class="bi-muted">${refSummary&&refSummary.usableMetrics.length?esc('Body measurements with a population comparison. Height uses '+refSummary.statureReference+'.'):esc(refSummary?refSummary.reason:'Population references are unavailable in this build.')}</p></article>
      <article class="bi-metric"><div class="bi-eyebrow">Recorded growth rate</div><strong>${growth?Number(growth.inPerYear.toFixed(1))+' in/yr':'—'}</strong><p class="bi-muted">${growth?'Annualized change between height readings; not predicted PHV.':'Needs height readings sufficiently far apart.'}</p></article>
      <article class="bi-metric"><div class="bi-eyebrow">Adult-height estimate</div><strong>${predicted?Math.round(predicted.lo)+'–'+Math.round(predicted.hi)+' in':'—'}</strong><p class="bi-muted">${predicted?'Mid-parental range; not a scan-derived prediction.':'Add parental heights and sex in Growth to calculate a range.'}</p></article>
      <article class="bi-metric"><div class="bi-eyebrow">Estimated maturity offset</div><strong>${maturity?(maturity.offsetYears>0?'+':'')+maturity.offsetYears.toFixed(1)+' yr':'—'}</strong><p class="bi-muted">${maturity?'Manual same-session measurements; ±1 year minimum uncertainty. Context only, not puberty diagnosis or training prescription.':'Ages 8–16: add a same-session standing height, sitting height and body mass in Growth.'}</p></article>
    </div></section>
    <section><div class="bi-section-head"><h2>Movement & other measurements</h2><span>Video, guided and recorded results</span></div>${performance.length?`<div class="bi-grid">${performance.map(card).join('')}</div>`:'<div class="bi-empty">Assess a jump, reaction, footwork or sprint to start a performance record.</div>'}</section>
    <section class="bi-scope"><h2>What this profile measures</h2><p>Photo assessments estimate joint-based lengths using a recorded height. Video assessments estimate movement results. Changes may include capture and measurement error.</p><div><span>3D body reconstruction · temporary experiment</span><span>Circumferences & composition · not validated</span><span>PHV estimate · separate manual Growth inputs</span></div></section>
    <section><div class="bi-section-head"><h2>Measurement record</h2><span>${selectedRows.length} entries through ${esc(date||'today')}</span></div><div class="bi-table-wrap"><table class="bi-table"><caption class="sr-only">Recorded measurements and methods</caption><thead><tr><th scope="col">Date</th><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Method</th></tr></thead><tbody>${selectedRows.slice(0,40).map(r=>`<tr><td>${esc(r.measured_on)}</td><td>${esc(biName(r.metric_key))}</td><td>${esc(biValue(r))}</td><td>${esc(biMethod(r))}</td></tr>`).join('')||'<tr><td colspan="4">No measurements recorded yet.</td></tr>'}</tbody></table></div>${selectedRows.length>40?'<p class="bi-muted">Showing the latest 40 entries. Export includes all loaded records.</p>':''}</section>
    ${biAssessments(selectedRows)}
    <section class="bi-scope"><h2>Take your results with you</h2><p>Download a printable report for the selected dates or a spreadsheet of all your measurement records.</p><div class="bi-actions"><button class="btn ghost" id="biReport" ${rows.length?'':'disabled'}>Download report</button><button class="btn ghost" id="biCSV" ${rows.length?'':'disabled'}>Export CSV</button></div></section>
    <footer class="bi-footer"><button class="btn ghost" id="biGrowth">Open Growth</button><span>Photos used for body measurement are processed on-device and discarded.</span></footer>
  </div>`;
}
async function screenBodyInsights(){
  const athlete={...state.active}, host=document.querySelector('#screen'), actorId=state.user?.id;
  const isCurrent=()=>state.active?.id===athlete.id && state.user?.id===actorId && document.querySelector('#screen')===host;
  host.innerHTML='<div class="app-pad" role="status">Loading body insights…</div>';
  const {data:profile,error:profileError}=await sb.from('athletes').select('sex_at_birth,mother_height_in,father_height_in,birthdate').eq('id',athlete.id).maybeSingle();
  if(!isCurrent()) return;
  if(profileError) throw profileError;
  Object.assign(athlete,profile||{});
  const rows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await sb.from('measurements').select('*').eq('athlete_id',athlete.id).order('measured_on',{ascending:false}).order('id').range(offset,offset+499);
    if(!isCurrent()) return;
    if(error) throw error;
    rows.push(...data||[]);
    if(!data || data.length<500) break;
  }
  // Switching athlete or navigating while the request runs must not paint old records.
  if(!isCurrent()) return;
  const dates=[...new Set(biValidRows(rows).map(r=>r.measured_on))];
  const draw=(date=dates[0]||'',baseline=dates[1]||'')=>{
    host.innerHTML=topBar('Body insights')+biMarkup(athlete,rows,date,baseline);
    bindTop();
    host.querySelector('#biDate').onchange=e=>draw(e.target.value,dates.find(d=>d<e.target.value)||'');
    host.querySelector('#biBaseline').onchange=e=>draw(date,e.target.value);
    host.querySelector('#biScan').onclick=()=>renderApp('scan');
    host.querySelector('#biGrowth').onclick=()=>renderApp('growth');
    host.querySelector('#biReport').onclick=()=>assessmentDownload(assessmentReport(athlete,rows,date,baseline),'text/html','body-insights-report-'+date+'.html');
    host.querySelector('#biCSV').onclick=()=>assessmentDownload(assessmentCSV(rows),'text/csv;charset=utf-8','body-insights-'+athlete.id+'.csv');
    host.querySelector('#biExport').onclick=()=>{
      const payload={schema_version:1,exported_at:new Date().toISOString(),athlete:{id:athlete.id,first_name:athlete.first_name},scope:'All recorded measurements for this athlete; not limited to the selected date.',body_output_dictionary:{version:BODY_OUTPUT_VERSION,definitions:BODY_OUTPUTS,scope:'Current app definitions; historical records retain their own recorded versions.'},measurements:rows};
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='body-insights-'+athlete.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  };
  draw();
}
