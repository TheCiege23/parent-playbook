const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ids={team:'11111111-1111-4111-8111-111111111111',athlete:'22222222-2222-4222-8222-222222222222',actor:'33333333-3333-4333-8333-333333333333',consent:'44444444-4444-4444-8444-444444444444'};
const fixture=()=>({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.13.0',createdAt:'2026-09-09T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference-model'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:74,processingMs:1400,measurements:[{key:'wingspan',value:76.4,unit:'in',definition:'Estimated wingspan.'}]});
function client(){
  const rows=new Map(),calls=[];let token='token-one',dbFailure=null;
  const key=row=>[row.team_id,row.athlete_id,row.assessment_id].join('|');
  const api={rows,calls,setToken:value=>token=value,setFailure:value=>dbFailure=value,auth:{async getSession(){calls.push('session');return token?{data:{session:{access_token:token,user:{id:ids.actor}}},error:null}:{data:{session:null},error:null};}},from(table){
    assert.equal(table,'company_body_assessments');let operation=null,row=null,filters={};
    const builder={upsert(value,options){operation='upsert';row=structuredClone(value);calls.push(['upsert',options]);return this;},delete(){operation='delete';calls.push('delete');return this;},select(columns){calls.push(['select',columns]);if(operation==='delete'){if(dbFailure)return Promise.resolve({data:null,error:{message:dbFailure}});const k=[filters.team_id,filters.athlete_id,filters.assessment_id].join('|'),removed=rows.delete(k);return Promise.resolve({data:removed?[{assessment_id:filters.assessment_id}]:[],error:null});}operation=operation||'select';return this;},eq(column,value){filters[column]=value;return this;},async single(){if(dbFailure)return {data:null,error:{message:dbFailure}};rows.set(key(row),structuredClone(row));return {data:{record:structuredClone(row.record)},error:null};},async maybeSingle(){if(dbFailure)return {data:null,error:{message:dbFailure}};const found=rows.get([filters.team_id,filters.athlete_id,filters.assessment_id].join('|'));return {data:found?{record:structuredClone(found.record)}:null,error:null};}};
    return builder;
  }};return api;
}
test('Supabase adapter completes the portable save, reopen, export and delete contract',async()=>{
  const [{createSupabaseCompanyAssessmentAdapter},{createCompanyAssessmentStore}]=await Promise.all([import('../js/body-sdk-supabase.mjs'),import('../js/body-sdk-record.mjs')]),db=client();
  const adapter=createSupabaseCompanyAssessmentAdapter(db,{teamId:ids.team,athleteId:ids.athlete}),store=createCompanyAssessmentStore(adapter),pointer={assessmentId:'friday-001',subjectId:ids.athlete};
  const record=await store.save(fixture(),{...pointer,consentReference:ids.consent,savedAt:'2026-09-09T12:01:00Z',retentionUntil:'2027-09-09T12:00:00Z'});
  assert.equal(record.organizationId,ids.team);assert.equal(record.createdBy,ids.actor);assert.equal(db.rows.size,1);const stored=[...db.rows.values()][0];assert.equal(stored.consent_id,ids.consent);assert.equal(stored.record.photos,undefined);
  assert.equal((await store.reopen(pointer)).assessmentId,'friday-001');assert.equal(JSON.parse((await store.exportRecord(pointer)).content).subjectId,ids.athlete);
  assert.equal((await store.delete(pointer)).deleted,true);await assert.rejects(store.reopen(pointer),{code:'NOT_FOUND'});
});
test('adapter rejects missing auth, invalid scope and production records without retention',async()=>{
  const [{createSupabaseCompanyAssessmentAdapter},{createCompanyAssessmentStore}]=await Promise.all([import('../js/body-sdk-supabase.mjs'),import('../js/body-sdk-record.mjs')]),db=client();
  assert.throws(()=>createSupabaseCompanyAssessmentAdapter({},{}),{code:'INVALID_SUPABASE_CLIENT'});assert.throws(()=>createSupabaseCompanyAssessmentAdapter(db,{teamId:'team',athleteId:ids.athlete}),{code:'INVALID_SUPABASE_SCOPE'});
  const store=createCompanyAssessmentStore(createSupabaseCompanyAssessmentAdapter(db,{teamId:ids.team,athleteId:ids.athlete})),options={assessmentId:'a',subjectId:ids.athlete,consentReference:ids.consent};
  await assert.rejects(store.save(fixture(),options),{code:'RETENTION_REQUIRED'});db.setToken(null);await assert.rejects(store.save(fixture(),{...options,retentionUntil:'2027-09-09T12:00:00Z'}),{code:'AUTH_REQUIRED'});
});
test('database failures remain explicit and token changes invalidate the browser session',async()=>{
  const [{createSupabaseCompanyAssessmentAdapter},{createCompanyAssessmentStore}]=await Promise.all([import('../js/body-sdk-supabase.mjs'),import('../js/body-sdk-record.mjs')]),db=client(),store=createCompanyAssessmentStore(createSupabaseCompanyAssessmentAdapter(db,{teamId:ids.team,athleteId:ids.athlete})),options={assessmentId:'a',subjectId:ids.athlete,consentReference:ids.consent,retentionUntil:'2027-09-09T12:00:00Z'};
  db.setFailure('row-level security denied');await assert.rejects(store.save(fixture(),options),{code:'SUPABASE_WRITE'});db.setFailure(null);await store.save(fixture(),options);db.setToken('token-two');assert.equal((await store.reopen({assessmentId:'a',subjectId:ids.athlete})).assessmentId,'a');
});
test('migration defines tenant RLS, consent, payload and retention enforcement',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910001500_company_body_assessments.sql'),'utf8');
  for(const required of ['enable row level security','company_body_insert','private.can_manage_company_body_assessment','private.can_use_company_body_consent','private.can_write_company_body_assessment','biometric_consents','company_body_payload_has_forbidden_key','company_body_payload_is_allowed','company_body_assessment_audit','sweep_company_body_assessment_retention','cron.schedule'])assert.match(sql,new RegExp(required.replaceAll('.','\\.')));
  assert.match(sql,/photo\|photos\|image\|images\|landmark/);assert.match(sql,/\(\^\|_\).*\(\$\|_\)/);assert.match(sql,/requested_retention::date<=c\.retention_until/);
  assert.match(sql,/can_write_company_body_assessment\(team_id,athlete_id,consent_id,retention_until\)/);
  assert.match(sql,/revoke all on function private\.can_use_company_body_consent\(uuid,uuid,timestamptz\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function private\.can_manage_company_body_assessment\(uuid,uuid\) to authenticated/);
  assert.match(sql,/grant execute on function private\.can_write_company_body_assessment\(uuid,uuid,uuid,timestamptz\) to authenticated/);
  const patch=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910010000_fix_company_body_policy_function_access.sql'),'utf8');
  assert.match(patch,/drop policy if exists company_body_insert/);assert.match(patch,/can_write_company_body_assessment/);
  const tokens=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910011500_fix_company_body_forbidden_key_tokens.sql'),'utf8');
  assert.match(tokens,/regexp_replace\(item\.key/);assert.match(tokens,/surfaceStatus and surfaceProcessing/);
});
