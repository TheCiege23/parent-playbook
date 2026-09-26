const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function row(key='wingspan',options={}){
  const meta={schema:1,id:'scan-new',athlete_id:'a',captured_at:'2026-09-08T12:00:00Z',engine:{id:'photo-local',version:'1',model:'pose'}};
  Object.assign(meta,options.meta||{});
  return {id:'r-'+key,athlete_id:'a',metric_key:key,value:60,unit:'in',source:'photo',measured_on:'2026-09-08',note:'PP_SCAN_V1:'+JSON.stringify(meta),...options.row};
}
function data(){return {teams:[{id:'team',name:'Test roster',created_by:'owner'}],team_memberships:[{id:'membership',athlete_id:'a',team_id:'team'}],athletes:[{id:'a',first_name:'Alex'}],measurements:[row()],company_body_assessments:[],company_reference_assessments:[]};}
function setup(tables=data(),hook=()=>{}){
  const calls=[],downloads=[];let mounted;
  const root={replaceChildren:h=>mounted=h,contains:h=>mounted===h};
  const document={createElement(){const elements={};return {innerHTML:'',querySelector:id=>elements[id]??=( {} ),querySelectorAll:()=>[]};}};
  const sb={from(table){const filters=[],orders=[];let fields;
    const q={select:s=>(fields=s,q),eq:(k,v)=>(filters.push(r=>r[k]===v),q),in:(k,vs)=>(filters.push(r=>vs.includes(r[k])),q),order:k=>(orders.push(k),q),async range(a,b){return execute(a,b);},async maybeSingle(){const r=await execute(0,0);return {...r,data:r.data?.[0]||null};}};
    async function execute(a,b){calls.push({table,fields,start:a,end:b});const result=await hook(table,fields);if(result)return result;let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));for(const k of orders.reverse())rows=rows.slice().sort((x,y)=>String(x[k]).localeCompare(String(y[k])));return {data:rows.slice(a,b+1),error:null};}
    return q;
  }};
  const c=vm.createContext({console,Date,Map,Set,Number,JSON,document,root,sb,state:{user:{id:'owner'}},assessmentDownload:(...args)=>downloads.push(args),openOrgRoster(){}});
  vm.runInContext(`function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`,c);
  // org-composition is loaded here for the same reason index.html loads it first: org-insights
  // renders the shared-measurements section from it. It is optional at runtime and guarded, so
  // this also keeps the guard honest -- if it stopped being optional, these tests would say so.
  for(const f of ['dates','maturity','body-outputs','scan-record','body-insights','org-composition','org-insights'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+f+'.js'),'utf8'),c);
  return {c,calls,downloads,host:()=>mounted,tables};
}
test('latest assessment keeps missing outputs missing and distinguishes legacy/empty/future records',()=>{
  const {c}=setup(),input={athletes:[{id:'a',first_name:'Alex'},{id:'b',first_name:'Blair'},{id:'c',first_name:'Casey'}],measurements:[row(),row('leg_length',{meta:{id:'old',captured_at:'2026-08-01T12:00:00Z'},row:{measured_on:'2026-08-01'}}),row('torso_length',{meta:{id:'future',captured_at:'2027-01-01T00:00:00Z'},row:{measured_on:'2027-01-01'}}),row('wingspan',{row:{athlete_id:'b',note:null}})]};
  const summaries=c.oiSummaries(input,'2026-09-09');assert.equal(summaries[0].latest.metrics.size,1);assert.equal(summaries[0].latest.metrics.has('leg_length'),false);assert.equal(summaries[1].status,'Unversioned photo readings');assert.equal(summaries[2].status,'No recorded photo assessment');
  assert.equal(c.oiFilter(summaries,'aLex','recorded').length,1);assert.equal(c.oiFilter(summaries,'','missing').length,2);
});
test('conflicting metadata or values are not silently merged into an assessment',()=>{
  const {c}=setup();for(const bad of [row('leg_length',{meta:{engine:{id:'different',version:'1',model:'pose'}}}),row('wingspan',{row:{value:70,id:'other'}})]){
    const r=c.oiSummaries({athletes:[{id:'a'}],measurements:[row(),bad]},'2026-09-09')[0];assert.equal(r.latest,null);assert.equal(r.status,'Conflicting assessment metadata');
  }
});
test('roster CSV escapes formula text and includes values/units/engine without raw notes or family details',()=>{
  const {c}=setup(),input={athletes:[{id:'a',first_name:'=1+1'}],measurements:[row()]};
  const summaries=c.oiSummaries(input,'2026-09-09'),csv=c.oiCSV({id:'team',name:'<Team>, North'},summaries,'2026-09-09');
  assert.match(csv,/'=1\+1/);assert.match(csv,/photo-local/);assert.match(csv,/"60","in"/);assert.ok(!csv.includes('PP_SCAN_V1'));assert.ok(!csv.includes('consent_id'));
  assert.ok(c.oiTable([{...summaries[0],athlete:{id:'a',first_name:'<img onerror=x>'}}]).includes('&lt;img'));
});
test('organization athlete view derives maturity context only from a complete parent-entered batch and keeps it out of roster CSV',()=>{
  const {c}=setup(),athlete={id:'a',first_name:'Alex',sex_at_birth:'male',birthdate:'2012-09-09'},note=JSON.stringify({schema:'PP_MATURITY_INPUT_V1',batchId:'batch-12345678'});
  const manual=[['height',68,'in'],['sitting_height',35,'in'],['weight',140,'lb']].map(([metric_key,value,unit],i)=>({id:'manual-'+i,athlete_id:'a',metric_key,value,unit,source:'manual',measured_on:'2026-09-09',created_at:'2026-09-09T12:00:00Z',note}));
  const input={team:{id:'team',name:'Roster'},athletes:[athlete],measurements:[row(),...manual]},result=c.oiMaturity(input,athlete,'2026-09-09');
  assert.equal(result.offsetYears,.65);assert.equal(c.oiMaturity({...input,measurements:[row(),...manual.slice(0,2)]},athlete,'2026-09-09'),null);
  const csv=c.oiCSV(input.team,c.oiSummaries(input,'2026-09-09'),'2026-09-09');assert.ok(!csv.includes('sitting_height'));assert.ok(!csv.includes('maturity'));
});
test('loader paginates measurements and checks team ownership before reading roster data',async()=>{
  const tables=data();tables.measurements=Array.from({length:501},(_,i)=>row('wingspan',{row:{id:String(i).padStart(4,'0')}}));
  const {c,calls}=setup(tables);const loaded=await c.loadOrgInsights('team','owner',()=>true);assert.equal(loaded.measurements.length,501);assert.equal(calls.filter(x=>x.table==='measurements').length,2);
  await assert.rejects(c.loadOrgInsights('team','stranger',()=>true),/not available/);
  assert.equal(calls.at(-1).table,'teams');assert.ok(!calls.some(x=>/media|coach_updates|guardians/.test(x.table)));
});
test('loader deduplicates paginated memberships and only fetches measurements for visible athletes',async()=>{
  const tables=data();tables.team_memberships=Array.from({length:501},(_,i)=>({id:String(i).padStart(4,'0'),athlete_id:'a',team_id:'team'}));tables.measurements.push(row('leg_length',{row:{athlete_id:'outside'}}));
  const {c,calls}=setup(tables);const result=await c.loadOrgInsights('team','owner',()=>true);assert.equal(result.membershipCount,1);assert.equal(result.measurements.length,1);assert.equal(calls.filter(x=>x.table==='team_memberships').length,2);
});
test('query failures and stale sessions stop the loader rather than returning a partial roster',async()=>{
  const {c}=setup(data(),t=>t==='measurements'?{error:Error('Denied'),data:null}:null);await assert.rejects(c.loadOrgInsights('team','owner',()=>true),/Denied/);
  let current=true;const other=setup(data(),t=>{if(t==='athletes')current=false;});await assert.rejects(other.c.loadOrgInsights('team','owner',()=>current),/View closed/);
});
test('CSV export reloads access and cannot export an athlete removed from the roster',async()=>{
  const {c,host,tables,downloads}=setup();await c.openOrgBodyInsights('team');assert.match(host().innerHTML,/Alex/);
  tables.team_memberships=[];await host().querySelector('#oiExport').onclick();assert.equal(downloads.length,0);assert.match(host().innerHTML,/0 visible athletes/);
});
test('athlete drill-down remains read-only and lost access cannot render cached measurements',async()=>{
  const {c,host,tables}=setup();await c.openOrgBodyAthlete('team','a','2026-09-09');assert.match(host().innerHTML,/Wingspan/);assert.ok(!host().innerHTML.includes('biScan'));assert.match(host().innerHTML,/Read-only/);
  tables.team_memberships=[];await c.openOrgBodyAthlete('team','a','2026-09-09');assert.match(host().innerHTML,/no longer available/);assert.ok(!host().innerHTML.includes('60 in'));
});
test('an account/navigation change during export cannot download or overwrite the replacement screen',async()=>{
  let invalidate=false,c;const fixture=setup(data(),table=>{if(invalidate&&table==='measurements'){c.state.user.id='other-account';c.root.replaceChildren({innerHTML:'New account screen'});}});c=fixture.c;
  await c.openOrgBodyInsights('team');const old=fixture.host();invalidate=true;await old.querySelector('#oiExport').onclick();
  assert.equal(fixture.downloads.length,0);assert.equal(fixture.host().innerHTML,'New account screen');
});
test('company import rebuilds only the scalar SDK result from a versioned parent assessment',()=>{
  const {c}=setup(),scan=c.oiSummaries({athletes:[{id:'a'}],companyAssessments:[],measurements:[row('wingspan',{meta:{output_dictionary:'body-outputs-v2',processing:{protocol:'provider-wall-time-v1',duration_ms:1200},input_height:{value:74,unit:'in'}}})]},'2026-09-09')[0].latest;
  const result=c.oiPortableCompanyResult(scan);assert.equal(result.schema,'PP_BODY_SDK_RESULT_V1');assert.equal(result.heightIn,74);assert.equal(result.measurements.length,1);assert.equal(result.measurements[0].key,'wingspan');
  for(const key of ['photos','landmarks','contours','mesh','note'])assert.equal(result[key],undefined);
  assert.throws(()=>c.oiPortableCompanyResult(c.oiSummaries({athletes:[{id:'a'}],measurements:[row()]},'2026-09-09')[0].latest),/cannot be imported/);
});
test('loader and roster summary expose the authorized company copy state without record payloads',async()=>{
  const tables=data();tables.company_body_assessments=[{id:'copy',assessment_id:'scan-new',team_id:'team',athlete_id:'a',captured_at:'2026-09-08T12:00:00Z',saved_at:'2026-09-09T12:00:00Z',retention_until:'2027-09-09T23:59:59Z',record:{should_not_load:true}}];
  const {c,calls}=setup(tables),loaded=await c.loadOrgInsights('team','owner',()=>true),summary=c.oiSummaries(loaded,'2026-09-09')[0];
  assert.equal(summary.companyCount,1);assert.equal(summary.companyLatest.assessment_id,'scan-new');assert.equal(summary.companyLatest.record,undefined);
  assert.match(c.oiTable([summary]),/Saved 2026-09-09/);assert.ok(calls.some(x=>x.table==='company_body_assessments'&&!x.fields.includes('record')));
});
test('adult reference history loads metadata only and stays separate from athlete rows',async()=>{
  const tables=data();tables.company_reference_assessments=[{id:'reference-row',team_id:'team',assessment_id:'adult-001',subject_reference:'adult-reference-001',captured_at:'2026-09-08T12:00:00Z',saved_at:'2026-09-10T12:00:00Z',retention_until:'2026-10-10T23:59:59Z',consent_reference:'permission-001',adult_attested_at:'2026-09-10T11:59:00Z',record:{should_not_load:true}}];
  const {c,calls}=setup(tables),loaded=await c.loadOrgInsights('team','owner',()=>true),references=c.oiReferenceRows(loaded.referenceAssessments);
  assert.equal(references.length,1);assert.equal(references[0].subject_reference,'adult-reference-001');assert.equal(references[0].record,undefined);
  assert.equal(c.oiSummaries(loaded,'2026-09-10')[0].athlete.id,'a');
  assert.match(c.oiReferenceTable(references),/Separate|adult-reference-001|adult-001/i);
  assert.ok(calls.some(x=>x.table==='company_reference_assessments'&&!x.fields.includes('record')));
});
test('adult reference table escapes organization-controlled references',()=>{
  const {c}=setup(),html=c.oiReferenceTable(c.oiReferenceRows([{assessment_id:'<img onerror=x>',subject_reference:'=adult',saved_at:'2026-09-10T12:00:00Z'}]));
  assert.ok(!html.includes('<img onerror=x>'));assert.match(html,/&lt;img/);assert.match(html,/=adult/);
});
test('adult repeat comparison table preserves signed changes and escapes metric labels',()=>{
  const {c}=setup(),html=c.oiReferenceComparisonTable({comparableOutputCount:1,baseline:{capturedAt:'2026-08-10T12:00:00Z'},current:{capturedAt:'2026-09-10T12:00:00Z'},measurements:[{label:'<Wingspan>',baseline:76.4,current:76.8,change:.4,unit:'in'}]});
  assert.ok(!html.includes('<Wingspan>'));assert.match(html,/&lt;Wingspan&gt;/);assert.match(html,/\+0\.4 in/);assert.match(html,/do not establish growth/i);
});
test('organization composition readiness never presents an estimate without a configured provider',()=>{
  const {c}=setup(),html=c.oiCompositionReadiness();
  assert.match(html,/Body composition is unavailable/);assert.match(html,/No composition value is generated today/);assert.doesNotMatch(html,/company-composition-demo|validation room|Manifest/);
  for(const value of ['12%','60 kg','DEXA equivalent'])assert.equal(html.includes(value),false);
});
test('company consent RPC migration returns only the scoped reference and retention date',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910014500_company_body_active_consent_rpc.sql'),'utf8');
  assert.match(sql,/returns table\(consent_id uuid, retention_until date\)/);assert.match(sql,/can_manage_company_body_assessment\(requested_team,requested_athlete\)/);
  assert.match(sql,/revoke all on function public\.company_body_active_consent/);assert.match(sql,/grant execute .* to authenticated/);
  for(const forbidden of ['guardian_id','detail','policy_version'])assert.equal(new RegExp('select\\s+c\\.'+forbidden,'i').test(sql),false);
});
