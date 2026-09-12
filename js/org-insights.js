// Organization-only body assessment view. Reads use the signed-in Supabase client
// and existing measurement RLS. Never enters the editable parent application shell.
const OI_KEYS=Object.keys(BODY_OUTPUTS);
const OI_FETCH_KEYS=[...OI_KEYS,'height','sitting_height','weight'];
async function oiPages(factory,isCurrent){
  const rows=[];
  for(let start=0;;start+=500){
    const {data,error}=await factory().range(start,start+499);
    if(!isCurrent())throw Error('View closed.');
    if(error)throw error;
    rows.push(...data||[]);if(!data||data.length<500)return rows;
  }
}
async function loadOrgInsights(teamId,actorId,isCurrent,athleteId=null){
  if(!actorId||!isCurrent())throw Error('Sign in to view this roster.');
  const {data:team,error}=await sb.from('teams').select('id,name,created_by').eq('id',teamId).eq('created_by',actorId).maybeSingle();
  if(!isCurrent())throw Error('View closed.');if(error)throw error;
  if(!team||team.created_by!==actorId)throw Error('This roster is not available to your account.');
  const memberships=await oiPages(()=>{
    let q=sb.from('team_memberships').select('id,athlete_id').eq('team_id',teamId).order('id');
    return athleteId?q.eq('athlete_id',athleteId):q;
  },isCurrent);
  const referenceRows=athleteId?[]:await oiPages(()=>sb.from('company_reference_assessments')
    .select('id,assessment_id,subject_reference,captured_at,saved_at,retention_until,consent_reference,adult_attested_at')
    .eq('team_id',teamId).order('saved_at'),isCurrent);
  const referenceAssessments=referenceRows.map(row=>({id:row.id,assessment_id:row.assessment_id,subject_reference:row.subject_reference,captured_at:row.captured_at,saved_at:row.saved_at,
    retention_until:row.retention_until,consent_reference:row.consent_reference,adult_attested_at:row.adult_attested_at}));
  const ids=[...new Set(memberships.map(m=>m.athlete_id))],athletes=[],measurements=[],companyAssessments=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);
    const visible=await oiPages(()=>sb.from('athletes').select('id,first_name,birthdate,sex_at_birth').in('id',batch).order('id'),isCurrent);
    athletes.push(...visible.filter(a=>batch.includes(a.id)));
    const visibleIds=visible.filter(a=>batch.includes(a.id)).map(a=>a.id);
    if(visibleIds.length){
      const [rows,companyRows]=await Promise.all([
        oiPages(()=>sb.from('measurements').select('id,athlete_id,metric_key,value,unit,source,measured_on,created_at,note').in('athlete_id',visibleIds).in('metric_key',OI_FETCH_KEYS).order('id'),isCurrent),
        oiPages(()=>sb.from('company_body_assessments').select('id,assessment_id,athlete_id,captured_at,saved_at,retention_until').eq('team_id',teamId).in('athlete_id',visibleIds).order('id'),isCurrent),
      ]);
      measurements.push(...rows.filter(r=>visibleIds.includes(r.athlete_id)));
      companyAssessments.push(...companyRows.filter(r=>visibleIds.includes(r.athlete_id)).map(r=>({id:r.id,assessment_id:r.assessment_id,athlete_id:r.athlete_id,captured_at:r.captured_at,saved_at:r.saved_at,retention_until:r.retention_until})));
    }
  }
  return {team,athletes,measurements,companyAssessments,referenceAssessments,membershipCount:ids.length};
}
function oiSummaries(data,date){
  const byAthlete=new Map();
  for(const row of biValidRows(data.measurements)){
    if(row.measured_on>date||row.source!=='photo'||!OI_KEYS.includes(row.metric_key)||Number(row.value)<=0||typeof row.unit!=='string'||!row.unit.trim())continue;
    if(!byAthlete.has(row.athlete_id))byAthlete.set(row.athlete_id,[]);byAthlete.get(row.athlete_id).push(row);
  }
  return data.athletes.slice().sort((a,b)=>(a.first_name||'').localeCompare(b.first_name||'')||a.id.localeCompare(b.id)).map(athlete=>{
    const rows=byAthlete.get(athlete.id)||[];
    const scans=new Map();let legacy=0;
    for(const row of rows){
      const raw=readScanRecord(row);if(!raw){legacy++;continue;}
      // captured_at stays a UTC instant because the sort below compares instants. The DAY is a
      // separate question, and the as-of filter and the table both mean a calendar day in the
      // viewer’s own time — `today` and the date picker on this screen are built from local
      // getters. Slicing the UTC ISO mixed the two: a scan captured at 8pm west of UTC has a UTC
      // day of tomorrow, so it was filtered out of its own day and the athlete read "No recorded
      // photo assessment" while their scan sat in the database.
      const meta={...raw,captured_at:new Date(raw.captured_at).toISOString(),captured_day:localDay(new Date(raw.captured_at)),engine:{id:raw.engine.id,version:raw.engine.version,model:raw.engine.model}};
      if(meta.captured_day>date)continue;
      if(!scans.has(meta.id))scans.set(meta.id,{meta,metrics:new Map(),conflict:false});
      const group=scans.get(meta.id);
      if(group.meta.captured_at!==meta.captured_at||JSON.stringify(group.meta.engine)!==JSON.stringify(meta.engine))group.conflict=true;
      const existing=group.metrics.get(row.metric_key);if(existing&&(Number(existing.value)!==Number(row.value)||existing.unit!==row.unit))group.conflict=true;
      if(!group.metrics.has(row.metric_key))group.metrics.set(row.metric_key,row);
    }
    const latest=[...scans.values()].sort((a,b)=>b.meta.captured_at.localeCompare(a.meta.captured_at)||b.meta.id.localeCompare(a.meta.id))[0];
    const status=latest?.conflict?'Conflicting assessment metadata':latest?'Assessment recorded':legacy?'Unversioned photo readings':'No recorded photo assessment';
    const company=(data.companyAssessments||[]).filter(r=>r.athlete_id===athlete.id&&typeof r.assessment_id==='string'&&Number.isFinite(Date.parse(r.saved_at||'')))
      .sort((a,b)=>b.saved_at.localeCompare(a.saved_at)||b.assessment_id.localeCompare(a.assessment_id));
    return {athlete,status,latest:latest&&!latest.conflict?latest:null,assessmentCount:scans.size,legacyCount:legacy,companyCount:company.length,companyLatest:company[0]||null};
  });
}
function oiFilter(summaries,search,status){
  return summaries.filter(s=>(s.athlete.first_name||'').toLowerCase().includes(search.trim().toLowerCase())&&(!status||(status==='recorded'?!!s.latest:!s.latest)));
}
function oiCSV(team,summaries,date){
  const cell=v=>{let text=String(v??'');if(typeof v!=='number'&&/^[\s]*[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
  const header=['roster_id','roster','as_of','athlete_id','athlete','status','assessment_id','captured_at','engine','engine_version','model','recorded_outputs',...OI_KEYS.flatMap(k=>[k,k+'_unit'])];
  const rows=summaries.map(s=>{const scan=s.latest,m=scan?.meta;return [team.id,team.name,date,s.athlete.id,s.athlete.first_name,s.status,m?.id,m?.captured_at,m?.engine.id,m?.engine.version,m?.engine.model,scan?.metrics.size??0,...OI_KEYS.flatMap(k=>{const r=scan?.metrics.get(k);return r?[Number(r.value),r.unit]:['',''];})];});
  return [header,...rows].map(r=>r.map(cell).join(',')).join('\r\n');
}
function oiTable(summaries){
  return '<div class="bi-table-wrap"><table class="bi-table"><caption class="sr-only">Latest recorded body assessments for the filtered roster</caption><thead><tr><th>Athlete</th><th>Status</th><th>Assessment date</th><th>Outputs</th><th>Company copy</th><th>Results</th></tr></thead><tbody>'+summaries.map((s,i)=>'<tr><td>'+esc(s.athlete.first_name||'Athlete')+'</td><td>'+esc(s.status)+'</td><td>'+esc(s.latest?.meta.captured_day||'—')+'</td><td>'+(s.latest?s.latest.metrics.size:'—')+'</td><td>'+esc(s.companyLatest?'Saved '+localDay(new Date(s.companyLatest.saved_at)):'Not saved')+'</td><td><button class="pill" data-oi-athlete="'+i+'">View results</button></td></tr>').join('')+(summaries.length?'':'<tr><td colspan="6">No athletes match this view.</td></tr>')+'</tbody></table></div>';
}

function oiReferenceRows(rows=[]){
  return rows.filter(row=>row&&typeof row.assessment_id==='string'&&typeof row.subject_reference==='string'&&Number.isFinite(Date.parse(row.saved_at||'')))
    .sort((a,b)=>b.saved_at.localeCompare(a.saved_at)||b.assessment_id.localeCompare(a.assessment_id));
}
function oiReferenceTable(rows){
  return '<div class="bi-table-wrap"><table class="bi-table"><caption class="sr-only">Company-owned adult reference assessments</caption><thead><tr><th>Adult reference</th><th>Assessment</th><th>Captured</th><th>Saved</th><th>Retention</th><th>Record</th></tr></thead><tbody>'+rows.map((row,index)=>'<tr><td>'+esc(row.subject_reference)+'</td><td>'+esc(row.assessment_id)+'</td><td>'+esc(row.captured_at?localDay(new Date(row.captured_at)):'—')+'</td><td>'+esc(localDay(new Date(row.saved_at)))+'</td><td>'+esc(row.retention_until?.slice(0,10)||'No automatic date')+'</td><td><button class="pill" data-oi-reference="'+index+'">Open</button></td></tr>').join('')+(rows.length?'':'<tr><td colspan="6">No adult reference records are stored for this organization.</td></tr>')+'</tbody></table></div>';
}
function oiCompositionReadiness(){
  return '<section class="bi-reference"><div class="bi-section-head"><div><span class="bi-eyebrow">BODY COMPOSITION</span><h2>Provider integration ready</h2></div><span class="bi-unavailable">Model not configured</span></div><p class="bi-muted">Parent Playbook will accept lean mass, fat mass, body-fat percentage, skeletal muscle mass and bone mineral content only from an approved model with deployment rights, DEXA training provenance and independent DEXA validation. No composition value is generated today.</p><div class="bi-footer"><a class="btn ghost" href="/company-composition-demo">Open composition validation room</a><span>Manifest → provider estimate → independent DEXA comparison</span></div></section>';
}
function oiReferenceComparisonTable(result){
  const signed=value=>(value>0?'+':'')+Number(value).toFixed(1);
  return '<div class="bi-table-wrap"><table class="bi-table"><caption>Descriptive changes across '+result.comparableOutputCount+' shared outputs</caption><thead><tr><th>Measurement</th><th>Baseline</th><th>Current</th><th>Change</th></tr></thead><tbody>'+result.measurements.map(item=>'<tr><td>'+esc(item.label)+'</td><td>'+esc(Number(item.baseline).toFixed(1))+' '+esc(item.unit)+'</td><td>'+esc(Number(item.current).toFixed(1))+' '+esc(item.unit)+'</td><td>'+esc(signed(item.change))+' '+esc(item.unit)+'</td></tr>').join('')+'</tbody></table></div><p class="bi-muted">Baseline '+esc(localDay(new Date(result.baseline.capturedAt)))+' · Current '+esc(localDay(new Date(result.current.capturedAt)))+'. Differences are descriptive provisional estimates. They do not establish growth, accuracy, significance or cause.</p>';
}

function oiPortableCompanyResult(scan){
  const meta=scan?.meta,processing=meta?.processing?.duration_ms,height=meta?.input_height?.value;
  if(!meta||meta.output_dictionary!=='body-outputs-v2'||!Number.isFinite(height)||!Number.isFinite(processing)||!scan.metrics?.size)throw Error('This assessment cannot be imported into the company SDK record.');
  const measurements=[];
  for(const key of OI_KEYS){const row=scan.metrics.get(key);if(row)measurements.push({key,value:Number(row.value),unit:row.unit,definition:BODY_OUTPUTS[key].definition});}
  return {schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.13.0-parent-import-v1',createdAt:meta.captured_at,status:'provisional',
    engine:{id:meta.engine.id,version:meta.engine.version,model:meta.engine.model},outputDictionary:'body-outputs-v2',heightIn:Number(height),processingMs:Number(processing),measurements};
}
async function oiCompanyStore(teamId,athleteId){
  const [{createCompanyAssessmentStore},{createSupabaseCompanyAssessmentAdapter}]=await Promise.all([
    import('./body-sdk-record.mjs'),import('./body-sdk-supabase.mjs')]);
  return createCompanyAssessmentStore(createSupabaseCompanyAssessmentAdapter(sb,{teamId,athleteId}));
}
async function oiReferenceStore(teamId,subjectReference,adultAttestedAt){
  const [{createCompanyAssessmentStore},{createSupabaseCompanyReferenceAdapter}]=await Promise.all([
    import('./body-sdk-record.mjs'),import('./body-sdk-reference-supabase.mjs')]);
  return createCompanyAssessmentStore(createSupabaseCompanyReferenceAdapter(sb,{teamId,subjectReference,adultAttestedAt}));
}
async function oiSaveCompanyAssessment(teamId,summary){
  const scan=summary?.latest,athleteId=summary?.athlete?.id;
  if(!scan||!athleteId)throw Error('No versioned parent assessment is available.');
  const {data,error}=await sb.rpc('company_body_active_consent',{requested_team:teamId,requested_athlete:athleteId,requested_engine:scan.meta.engine.id});
  if(error)throw error;const consent=data?.[0];
  if(!consent?.consent_id||!/^[0-9a-f-]{36}$/i.test(consent.consent_id)||!/^\d{4}-\d{2}-\d{2}$/.test(consent.retention_until||''))throw Error('The parent must grant an active body-scan consent before this organization can store a copy.');
  const store=await oiCompanyStore(teamId,athleteId);
  return store.save(oiPortableCompanyResult(scan),{assessmentId:scan.meta.id,subjectId:athleteId,consentReference:consent.consent_id,
    retentionUntil:consent.retention_until+'T23:59:59.000Z',surfaceStatus:'unavailable'});
}
function oiMaturity(data,athlete,date){
  if(typeof maturityInputBatch!=='function'||typeof maturityOffsetEstimate!=='function')return null;
  const batch=maturityInputBatch(data.measurements.filter(r=>r.athlete_id===athlete.id&&r.measured_on<=date));
  return batch?maturityOffsetEstimate({sex:athlete.sex_at_birth,birthdate:athlete.birthdate,measuredOn:batch.measuredOn,heightIn:batch.height.value,sittingHeightIn:batch.sitting_height.value,weightLb:batch.weight.value}):null;
}
function oiMount(){const host=document.createElement('div');host.className='bi-page';root.replaceChildren(host);return host;}
async function openOrgBodyInsights(teamId){
  const actorId=state.user?.id,host=oiMount();
  const isCurrent=()=>state.user?.id===actorId&&root.contains(host);
  host.innerHTML='<p role="status">Loading roster assessments…</p>';
  let data;
  const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  let date=today,search='',status='';
  function draw(){
    if(!isCurrent())return;
    const all=oiSummaries(data,date),shown=oiFilter(all,search,status),recorded=all.filter(s=>s.latest).length,references=oiReferenceRows(data.referenceAssessments);
    host.innerHTML='<header class="bi-hero"><div><span class="bi-eyebrow">ORGANIZATION / BODY ASSESSMENTS</span><h1>'+esc(data.team.name)+'</h1><p>Recorded photo assessments across your roster and company-owned adult references.</p><button class="btn ghost" id="oiBack">Back to roster</button></div><div class="bi-summary"><strong>'+recorded+' / '+all.length+'</strong><span>visible athletes with an assessment</span><strong>'+references.length+'</strong><span>adult reference records</span></div></header><div class="bi-controls"><label>Readings through<input id="oiDate" type="date" value="'+esc(date)+'" max="'+today+'"></label><label>Find athlete<input id="oiSearch" type="search" value="'+esc(search)+'" placeholder="Name"></label><label>Assessment status<select id="oiStatus"><option value="">All athletes</option><option value="recorded" '+(status==='recorded'?'selected':'')+'>Assessment recorded</option><option value="missing" '+(status==='missing'?'selected':'')+'>No usable versioned assessment</option></select></label></div><p class="bi-muted">'+all.length+' visible athletes from '+data.membershipCount+' unique roster memberships. Each row uses one latest assessment through the selected date; missing outputs are not filled from older scans. Output counts do not indicate accuracy.</p><div id="oiRows">'+oiTable(shown)+'</div><section class="bi-scope"><h2>Export this roster view</h2><p>The CSV contains the filtered roster’s latest assessment values, units and engine details. Records are reloaded before export. No photo, video, maturity estimate or family-height data is included.</p><button class="btn ghost" id="oiExport" '+(shown.length?'':'disabled')+'>Export filtered CSV</button><button class="btn ghost" id="oiRefresh">Refresh records</button><p id="oiMessage" role="status"></p></section><section class="bi-reference"><div class="bi-section-head"><div><span class="bi-eyebrow">COMPANY DATA</span><h2>Adult reference assessments</h2></div><span>Separate from every child and roster profile</span></div><p class="bi-muted">These derived scalar records belong to this organization. Opening or exporting a record rechecks the signed-in administrator and tenant boundary. Source photos and geometry are never stored here.</p>'+oiReferenceTable(references)+'<div class="bi-footer"><a class="btn ghost" href="/company-persistence-demo">Import or manage an adult reference</a></div></section>'+'<div id="oiShared"></div>'+oiCompositionReadiness()+'<p class="bi-muted">Photo lengths and optional manual maturity-offset context are provisional. The maturity estimate appears only in an individual read-only view when a complete versioned input session exists. Comparisons and athlete rankings are not implied.</p>';
    host.querySelector('#oiBack').onclick=()=>{if(isCurrent())openOrgRoster(teamId);};
    host.querySelector('#oiDate').onchange=e=>{if(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)&&e.target.value<=today){date=e.target.value;draw();}else e.target.value=date;};
    host.querySelector('#oiSearch').onchange=e=>{search=e.target.value;draw();};
    host.querySelector('#oiStatus').onchange=e=>{status=e.target.value;draw();};
    host.querySelectorAll('[data-oi-athlete]').forEach(button=>button.onclick=()=>{if(isCurrent())openOrgBodyAthlete(teamId,shown[Number(button.dataset.oiAthlete)].athlete.id,date);});
    host.querySelectorAll('[data-oi-reference]').forEach(button=>button.onclick=()=>{const row=references[Number(button.dataset.oiReference)];if(isCurrent()&&row)openOrgReferenceAssessment(teamId,row);});
    host.querySelector('#oiRefresh').onclick=()=>reload(false);
    host.querySelector('#oiExport').onclick=()=>reload(true);
    // Loaded after the roster paints rather than with it: a family sharing nothing is the common
    // case, and a section nobody has contributed to must not hold up the screen that has content.
    // A failure here leaves the section absent rather than breaking the roster above it.
    // Guarded like the other optional helpers on this screen: if org-composition.js did not load,
    // the shared section is simply absent. It must never be able to take the roster down with it.
    if(typeof loadOrgComposition==='function'&&typeof ocMarkup==='function') loadOrgComposition(teamId,isCurrent).then(shared=>{
      const slot=isCurrent()&&host.querySelector('#oiShared');
      if(slot&&shared) slot.innerHTML=ocMarkup(ocRows(shared.rows,shared.athletesById),data.team.name);
    }).catch(error=>{
      const slot=isCurrent()&&host.querySelector('#oiShared');
      if(slot) slot.innerHTML='<section class="bi-reference"><div class="bi-section-head"><h2>Imported clinical measurements</h2></div><p class="bi-muted">Could not load what families have shared. '+esc(error.message||'Please retry.')+'</p></section>';
    });
  }
  let loading=false;
  async function reload(exportCSV){
    if(loading||!isCurrent())return;loading=true;
    const exportDate=date,exportSearch=search,exportStatus=status;
    const message=host.querySelector('#oiMessage');if(message)message.textContent='Reloading authorized records…';
    try{
      data=await loadOrgInsights(teamId,actorId,isCurrent);if(!isCurrent())return;
      if(exportCSV){const filtered=oiFilter(oiSummaries(data,exportDate),exportSearch,exportStatus);if(filtered.length)assessmentDownload(oiCSV(data.team,filtered,exportDate),'text/csv;charset=utf-8','roster-body-assessments-'+exportDate+'.csv');}
      draw();
    }catch(error){if(isCurrent()){host.innerHTML='<div class="bi-empty">Could not load authorized roster records. '+esc(error.message||'Please retry.')+'</div><button class="btn ghost" id="oiRetry">Retry</button><button class="btn ghost" id="oiExit">Back to roster</button>';host.querySelector('#oiRetry').onclick=()=>reload(false);host.querySelector('#oiExit').onclick=()=>openOrgRoster(teamId);}}
    finally{loading=false;}
  }
  await reload(false);
}

async function openOrgReferenceAssessment(teamId,pointer){
  const actorId=state.user?.id,host=oiMount(),isCurrent=()=>state.user?.id===actorId&&root.contains(host);
  host.innerHTML='<p role="status">Rechecking company access and opening the adult reference…</p>';
  try{
    const {data:team,error}=await sb.from('teams').select('id,name,created_by').eq('id',teamId).eq('created_by',actorId).maybeSingle();
    if(error)throw error;if(!isCurrent())return;if(!team||team.created_by!==actorId)throw Error('This organization is not available to your account.');
    const subjectId=String(pointer?.subject_reference||''),assessmentId=String(pointer?.assessment_id||'');
    const historyRaw=await oiPages(()=>sb.from('company_reference_assessments').select('id,assessment_id,subject_reference,captured_at,saved_at,retention_until,adult_attested_at').eq('team_id',teamId).eq('subject_reference',subjectId).order('saved_at'),isCurrent);
    const history=oiReferenceRows(historyRaw.map(row=>({id:row.id,assessment_id:row.assessment_id,subject_reference:row.subject_reference,captured_at:row.captured_at,saved_at:row.saved_at,retention_until:row.retention_until,adult_attested_at:row.adult_attested_at}))),
      comparisonChoices=history.filter(row=>row.assessment_id!==assessmentId);
    const store=await oiReferenceStore(teamId,subjectId,pointer?.adult_attested_at),record=await store.reopen({assessmentId,subjectId});
    if(!isCurrent())return;
    const summary=record.assessment,retention=record.retentionUntil?.slice(0,10)||'No automatic date';
    const comparison=comparisonChoices.length?'<section class="bi-reference"><div class="bi-section-head"><div><span class="bi-eyebrow">REPEAT ASSESSMENT</span><h2>Compare two authorized records</h2></div><span>Same adult reference only</span></div><p class="bi-muted">Choose another saved assessment. Both records are reauthorized and must use the same SDK and engine versions. The table reports simple second-minus-first differences without interpreting cause or significance.</p><div class="bi-controls oi-reference-controls"><label>Other assessment<select id="oiReferenceCompareSelect">'+comparisonChoices.map((row,index)=>'<option value="'+index+'">'+esc(row.captured_at?localDay(new Date(row.captured_at)):localDay(new Date(row.saved_at)))+' · '+esc(row.assessment_id)+'</option>').join('')+'</select></label></div><button class="btn amber" id="oiReferenceCompare">Compare authorized records</button><button class="btn ghost" id="oiReferenceCompareExport">Export comparison CSV</button><p id="oiReferenceCompareMessage" role="status"></p><div id="oiReferenceCompareResult"></div></section>':'<section class="bi-reference"><div class="bi-section-head"><div><span class="bi-eyebrow">REPEAT ASSESSMENT</span><h2>No second record yet</h2></div></div><p class="bi-muted">This history is ready to compare compatible records after another independent assessment is saved for the same adult reference.</p></section>';
    host.innerHTML='<button class="btn ghost" id="oiReferenceBack">Back to body assessments</button><header class="bi-reference-title"><span class="bi-eyebrow">COMPANY-OWNED ADULT REFERENCE</span><h1>'+esc(subjectId)+'</h1><p>'+esc(team.name)+' · saved '+esc(localDay(new Date(record.savedAt)))+' · retained through '+esc(retention)+'</p></header><div class="bi-grid"><article class="bi-metric"><div class="bi-eyebrow">Validated outputs</div><strong>'+esc(summary.outputCount)+'</strong><p class="bi-muted">Derived scalar measurements in the stored SDK summary.</p></article><article class="bi-metric"><div class="bi-eyebrow">Scaling height</div><strong>'+esc(summary.height)+' in</strong><p class="bi-muted">Reference height supplied for this assessment.</p></article><article class="bi-metric"><div class="bi-eyebrow">Processing</div><strong>'+esc((summary.processingMs/1000).toFixed(1))+' s</strong><p class="bi-muted">Recorded SDK processing duration.</p></article></div><div class="bi-section-head"><h2>Derived measurements</h2><span>Provisional · '+esc(summary.engine.id)+' · '+esc(summary.engine.version)+'</span></div><div class="bi-grid">'+summary.measurements.map(item=>'<article class="bi-metric"><div class="bi-eyebrow">'+esc(item.label||item.key)+'</div><strong>'+esc(Number(item.value).toFixed(1))+' '+esc(item.unit)+'</strong><p class="bi-muted">'+esc(item.definition)+'</p></article>').join('')+'</div>'+comparison+oiCompositionReadiness()+'<section class="bi-scope"><h2>Company controls</h2><p>This record is separate from child athletes. Export rechecks the current company session and produces scalar JSON only.</p><button class="btn amber" id="oiReferenceExport">Export authorized JSON</button><a class="btn ghost" href="/company-persistence-demo">Manage retention or deletion</a><p id="oiReferenceMessage" role="status"></p></section><p class="bi-muted">Provisional photo estimates. Accuracy is unvalidated; no anatomical girths, body composition, diagnosis, maturity prediction or athletic-potential claim.</p>';
    host.querySelector('#oiReferenceBack').onclick=()=>openOrgBodyInsights(teamId);
    host.querySelector('#oiReferenceExport').onclick=async event=>{const button=event.currentTarget,message=host.querySelector('#oiReferenceMessage');button.disabled=true;message.textContent='Rechecking current company access…';try{const currentStore=await oiReferenceStore(teamId,subjectId,pointer?.adult_attested_at),file=await currentStore.exportRecord({assessmentId,subjectId});if(isCurrent()){assessmentDownload(file.content,file.mediaType,file.filename);message.textContent='Authorized scalar JSON downloaded.';}}catch(error){if(isCurrent())message.textContent=error.message||'The export could not be authorized.';}finally{if(isCurrent())button.disabled=false;}};
    if(comparisonChoices.length){
      const runComparison=async download=>{const select=host.querySelector('#oiReferenceCompareSelect'),candidate=comparisonChoices[Number(select.value)],message=host.querySelector('#oiReferenceCompareMessage'),resultHost=host.querySelector('#oiReferenceCompareResult'),buttons=[host.querySelector('#oiReferenceCompare'),host.querySelector('#oiReferenceCompareExport')];buttons.forEach(button=>button.disabled=true);message.textContent='Rechecking both company records…';
        try{const currentStore=await oiReferenceStore(teamId,subjectId,pointer?.adult_attested_at),[current,other,module]=await Promise.all([currentStore.reopen({assessmentId,subjectId}),currentStore.reopen({assessmentId:candidate.assessment_id,subjectId}),import('./body-sdk-reference-history.mjs')]);if(!isCurrent())return;const result=module.compareCompanyAssessmentRecords(current,other);resultHost.innerHTML=oiReferenceComparisonTable(result);message.textContent='Compared after fresh tenant checks.';if(download){const csv=module.companyAssessmentComparisonCSV(result);assessmentDownload(csv,'text/csv;charset=utf-8','adult-reference-comparison-'+localDay(new Date(result.current.capturedAt))+'.csv');message.textContent='Compared and downloaded scalar-only CSV after fresh tenant checks.';}}
        catch(error){if(isCurrent()){resultHost.innerHTML='';message.textContent=error.message||'The assessments could not be compared.';}}finally{if(isCurrent())buttons.forEach(button=>button.disabled=false);}};
      host.querySelector('#oiReferenceCompare').onclick=()=>runComparison(false);host.querySelector('#oiReferenceCompareExport').onclick=()=>runComparison(true);
    }
  }catch(error){if(isCurrent()){host.innerHTML='<p class="bi-empty">'+esc(error.message||'Could not open this adult reference.')+'</p><button class="btn ghost" id="oiReferenceBack">Back to body assessments</button>';host.querySelector('#oiReferenceBack').onclick=()=>openOrgBodyInsights(teamId);}}
}
async function openOrgBodyAthlete(teamId,athleteId,date){
  const actorId=state.user?.id,host=oiMount(),isCurrent=()=>state.user?.id===actorId&&root.contains(host);
  host.innerHTML='<p role="status">Loading authorized athlete results…</p>';
  try{
    const data=await loadOrgInsights(teamId,actorId,isCurrent,athleteId);if(!isCurrent())return;
    const summary=oiSummaries(data,date).find(s=>s.athlete.id===athleteId);
    if(!summary)throw Error('This athlete is no longer available on this roster.');
    const scan=summary.latest,maturity=oiMaturity(data,summary.athlete,date),company=summary.companyLatest;
    const maturityCard=maturity?'<section><div class="bi-section-head"><h2>Growth timing context</h2><span>Manual measurements · '+esc(maturity.measuredOn)+'</span></div><article class="bi-metric"><div class="bi-eyebrow">Estimated maturity offset</div><strong>'+esc((maturity.offsetYears>0?'+':'')+maturity.offsetYears.toFixed(1)+' yr')+'</strong><p class="bi-muted">Estimated age at peak height velocity '+esc(maturity.ageAtPhvYears.toFixed(1))+' years; ±1 year minimum uncertainty. Do not use this to rank, select, diagnose puberty or prescribe training.</p></article></section>':'';
    host.innerHTML='<button class="btn ghost" id="oiReturn">Back to body assessments</button><h1>'+esc(summary.athlete.first_name||'Athlete')+'</h1><p>'+esc(summary.status)+' · readings through '+esc(date)+'</p>'+(scan?'<p class="bi-muted">'+esc(scan.meta.captured_at)+' · '+esc(scan.meta.engine.id)+' · '+esc(scan.meta.engine.version)+'</p><div class="bi-grid">'+OI_KEYS.map(k=>{const row=scan.metrics.get(k);return '<article class="bi-metric"><div class="bi-eyebrow">'+esc(biName(k))+'</div><strong>'+esc(biValue(row))+'</strong><p class="bi-muted">'+esc(BODY_OUTPUTS[k].definition)+'</p></article>';}).join('')+'</div>'+biAssessments([...scan.metrics.values()]):'<div class="bi-empty">No usable versioned photo assessment on or before this date.</div>')+maturityCard+
      '<section class="bi-scope"><h2>Company SDK record</h2><p>'+(company?'Authorized scalar copy saved '+esc(localDay(new Date(company.saved_at)))+'. Retained through '+esc(company.retention_until.slice(0,10))+'.':'No company-owned SDK record has been saved for this athlete.')+' Photos, landmarks, contours and mesh geometry are excluded.</p>'+
      (scan?'<button class="btn amber" id="oiCompanySave">'+(company?.assessment_id===scan.meta.id?'Refresh authorized copy':'Save latest authorized copy')+'</button>':'')+
      (company?'<button class="btn ghost" id="oiCompanyExport">Export company JSON</button><button class="btn ghost" id="oiCompanyDelete">Delete company copy</button>':'')+'<p id="oiCompanyMessage" role="status"></p></section><p class="bi-muted">Read-only roster results. Measurements are provisional; no anatomical accuracy or athletic-potential claim.</p>';
  }catch(error){if(isCurrent())host.innerHTML='<p class="bi-empty">'+esc(error.message||'Could not load results.')+'</p><button class="btn ghost" id="oiReturn">Back to body assessments</button>';}
  if(!isCurrent())return;host.querySelector('#oiReturn').onclick=()=>openOrgBodyInsights(teamId);
  const busy=async(button,work)=>{const message=host.querySelector('#oiCompanyMessage');button.disabled=true;message.textContent='Checking current access…';try{await work();if(isCurrent())await openOrgBodyAthlete(teamId,athleteId,date);}catch(error){if(isCurrent()){message.textContent=error.message||'The company record operation failed.';button.disabled=false;}}};
  const save=host.querySelector('#oiCompanySave');if(save)save.onclick=()=>busy(save,()=>oiSaveCompanyAssessment(teamId,summary));
  const exported=host.querySelector('#oiCompanyExport');if(exported)exported.onclick=()=>busy(exported,async()=>{const store=await oiCompanyStore(teamId,athleteId),file=await store.exportRecord({assessmentId:company.assessment_id,subjectId:athleteId});assessmentDownload(file.content,file.mediaType,file.filename);});
  const remove=host.querySelector('#oiCompanyDelete');if(remove)remove.onclick=()=>busy(remove,async()=>{const store=await oiCompanyStore(teamId,athleteId);await store.delete({assessmentId:company.assessment_id,subjectId:athleteId});});
}
