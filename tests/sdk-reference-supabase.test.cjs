const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ids={team:'11111111-1111-4111-8111-111111111111',actor:'33333333-3333-4333-8333-333333333333'};
const fixture=()=>({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.13.0',createdAt:'2026-09-10T04:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference-model'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:74,processingMs:14400,measurements:[{key:'wingspan',value:76.4,unit:'in',definition:'Estimated wingspan.'}]});
function client(){
  const rows=new Map();let token='adult-token',failure=null;
  const key=row=>[row.team_id,row.subject_reference,row.assessment_id].join('|');
  return {rows,setToken:value=>token=value,setFailure:value=>failure=value,auth:{async getSession(){return token?{data:{session:{access_token:token,user:{id:ids.actor}}},error:null}:{data:{session:null},error:null};}},from(table){
    assert.equal(table,'company_reference_assessments');let operation=null,row=null,filters={};
    const q={upsert(value,options){operation='upsert';row=structuredClone(value);assert.equal(options.onConflict,'team_id,subject_reference,assessment_id');return q;},delete(){operation='delete';return q;},select(){if(operation==='delete'){if(failure)return Promise.resolve({data:null,error:{message:failure}});const removed=rows.delete([filters.team_id,filters.subject_reference,filters.assessment_id].join('|'));return Promise.resolve({data:removed?[{assessment_id:filters.assessment_id}]:[],error:null});}operation=operation||'select';return q;},eq(column,value){filters[column]=value;return q;},async single(){if(failure)return {data:null,error:{message:failure}};rows.set(key(row),structuredClone(row));return {data:{record:structuredClone(row.record)},error:null};},async maybeSingle(){if(failure)return {data:null,error:{message:failure}};const found=rows.get([filters.team_id,filters.subject_reference,filters.assessment_id].join('|'));return {data:found?{record:structuredClone(found.record)}:null,error:null};}};return q;
  }};
}
test('adult-reference adapter persists a company record without an athlete row',async()=>{
  const [{createSupabaseCompanyReferenceAdapter},{createCompanyAssessmentStore}]=await Promise.all([import('../js/body-sdk-reference-supabase.mjs'),import('../js/body-sdk-record.mjs')]),db=client();
  const adapter=createSupabaseCompanyReferenceAdapter(db,{teamId:ids.team,subjectReference:'synthetic-adult-subject-001',adultAttestedAt:'2026-09-10T03:59:00Z'}),store=createCompanyAssessmentStore(adapter),pointer={assessmentId:'synthetic-assessment-001',subjectId:'synthetic-adult-subject-001'};
  const record=await store.save(fixture(),{...pointer,consentReference:'adult-reference-permission-2026-09-10',savedAt:'2026-09-10T04:01:00Z',retentionUntil:'2026-10-10T04:00:00Z'});
  const row=[...db.rows.values()][0];assert.equal(row.athlete_id,undefined);assert.equal(row.subject_reference,pointer.subjectId);assert.equal(row.adult_attested_at,'2026-09-10T03:59:00.000Z');assert.equal(row.record.photos,undefined);
  assert.equal((await store.reopen(pointer)).assessmentId,pointer.assessmentId);assert.equal(JSON.parse((await store.exportRecord(pointer)).content).subjectId,pointer.subjectId);assert.equal((await store.delete(pointer)).deleted,true);
});
test('adult-reference adapter rejects missing auth, invalid identifiers, retention gaps and database failures',async()=>{
  const [{createSupabaseCompanyReferenceAdapter},{createCompanyAssessmentStore}]=await Promise.all([import('../js/body-sdk-reference-supabase.mjs'),import('../js/body-sdk-record.mjs')]),db=client();
  assert.throws(()=>createSupabaseCompanyReferenceAdapter(db,{teamId:'team',subjectReference:'adult'}),{code:'INVALID_REFERENCE_SCOPE'});
  const store=createCompanyAssessmentStore(createSupabaseCompanyReferenceAdapter(db,{teamId:ids.team,subjectReference:'adult'})),options={assessmentId:'a',subjectId:'adult',consentReference:'permission'};
  await assert.rejects(store.save(fixture(),options),{code:'INVALID_REFERENCE_SCOPE'});db.setToken(null);await assert.rejects(store.save(fixture(),{...options,retentionUntil:'2026-10-10T04:00:00Z'}),{code:'AUTH_REQUIRED'});
  db.setToken('restored');db.setFailure('row-level security denied');await assert.rejects(store.save(fixture(),{...options,retentionUntil:'2026-10-10T04:00:00Z'}),{code:'REFERENCE_WRITE'});
});
test('adult-reference migration separates adult demos and enforces tenant, payload, audit and retention boundaries',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910033000_company_adult_reference_assessments.sql'),'utf8');
  for(const value of ['company_reference_assessments','subject_reference text','athlete_id,action','company_reference_payload_is_allowed','company_body_payload_has_forbidden_key','enable row level security','adult_attested_at','company_reference_assessment_audit','sweep_company_reference_assessment_retention','cron.schedule'])assert.match(sql,new RegExp(value.replaceAll('.','\\.')));
  assert.match(sql,/private\.is_admin_of_team\(team_id\)/);assert.doesNotMatch(sql,/subject_reference[^\n]+references public\.athletes/i);assert.match(sql,/values \(\(select auth\.uid\(\)\),null/);
});
