const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

// Synthetic fixtures. These prove contract behaviour, rejection paths and ordering arithmetic only.
// No real person, provider, model or DEXA study is represented, and no accuracy claim follows from them.
const ORG='11111111-1111-4111-8111-111111111111',ACTOR='33333333-3333-4333-8333-333333333333';
const manifest=()=>({schema:'PP_BODY_COMPOSITION_MODEL_MANIFEST_V1',provider:{id:'synthetic-provider',version:'0.0.1-test',model:'synthetic-composition-model'},
  intendedUse:'informational_longitudinal',diagnosticUse:false,
  outputs:[{key:'lean_mass_kg',unit:'kg',definition:'Synthetic fixture definition.'},{key:'body_fat_percent',unit:'percent',definition:'Synthetic fixture definition.'}],
  trainingReference:{method:'DXA',datasetId:'synthetic-training',participantCount:10,ageRange:{min:18,max:60},completedAt:'2026-01-01T00:00:00Z'},
  validationReference:{method:'DXA',studyId:'synthetic-validation',independentFromTraining:true,participantCount:8,ageRange:{min:18,max:60},completedAt:'2026-02-01T00:00:00Z'},
  rights:{status:'buyer_supplied',expiresAt:null}});
const estimate=(overrides={})=>({schema:'PP_BODY_COMPOSITION_ESTIMATE_V1',status:'estimated',diagnosticUse:false,
  assessmentId:'synthetic-assessment-001',subjectId:'synthetic-subject-001',organizationId:ORG,createdAt:'2026-09-10T04:00:00Z',
  provider:{id:'synthetic-provider',version:'0.0.1-test',model:'synthetic-composition-model'},
  outputs:[{key:'lean_mass_kg',value:60,unit:'kg',uncertainty:{status:'provided',lower:57,upper:63,method:'synthetic interval'}},
    {key:'body_fat_percent',value:18,unit:'percent',uncertainty:{status:'not_provided'}}],...overrides});
const options=(overrides={})=>({resultId:'synthetic-result-001',subjectId:'synthetic-subject-001',subjectScope:'adult_reference',
  actorId:ACTOR,organizationId:ORG,consentReference:'synthetic-permission-001',savedAt:'2026-09-10T04:05:00Z',retentionUntil:'2026-10-10T04:00:00Z',...overrides});

function memoryAdapter({records=[],organizationId=ORG,subjectScope='adult_reference',subjectId='synthetic-subject-001'}={}){
  const rows=new Map(records.map(record=>[record.resultId,record]));
  const state={authenticated:true,actorId:ACTOR,organizationId,sessionId:'session-1'},calls={authorize:0,put:0,get:0,list:0,remove:0};
  let allow=true,swapAfterAuthorize=false;
  const inScope=request=>request?.organizationId===organizationId&&request?.subjectId===subjectId&&request?.subjectScope===subjectScope;
  return {rows,calls,session:state,setAllow:value=>{allow=value;},swapSessionAfterAuthorize:()=>{swapAfterAuthorize=true;},
    async getSession(){return {...state};},
    async authorize(request){calls.authorize++;if(swapAfterAuthorize){state.sessionId='session-2';swapAfterAuthorize=false;}return allow&&inScope(request);},
    async put(record){calls.put++;rows.set(record.resultId,record);},
    async get(request){calls.get++;const found=rows.get(request.resultId);return found?JSON.parse(JSON.stringify(found)):null;},
    async list(){calls.list++;return [...rows.values()].map(record=>JSON.parse(JSON.stringify(record)));},
    async remove(request){calls.remove++;return rows.delete(request.resultId);}};
}

test('a validated estimate becomes an allowlisted composition record with bounded retention', async()=>{
  const {prepareCompanyCompositionRecord,COMPANY_COMPOSITION_RECORD_SCHEMA}=await import('../js/body-composition-record.mjs');
  const record=prepareCompanyCompositionRecord(estimate(),manifest(),options());
  assert.equal(record.schema,COMPANY_COMPOSITION_RECORD_SCHEMA);
  assert.deepEqual(Object.keys(record).sort(),['assessmentId','capturedAt','consentReference','createdAt','createdBy','dataScope','limitations','modelManifest','organizationId','outputs','provider','resultId','retentionUntil','savedAt','schema','subjectId','subjectScope'].sort());
  assert.equal(record.provider.model,'synthetic-composition-model');
  assert.equal(record.modelManifest.trainingMethod,'DXA');
  assert.equal(record.outputs.length,2);
  assert.equal(record.outputs[0].uncertainty.status,'provided');
  assert.equal(record.outputs[1].uncertainty.status,'not_provided');
  assert.match(record.limitations,/Not a DEXA measurement/);
  assert.match(record.dataScope,/No photos, landmarks/);
  // Nothing from the capture or validation pipeline survives as a field of the stored payload.
  // The disclosure prose names those things on purpose, so this walks keys rather than text.
  const keys=new Set();
  (function walk(value){if(Array.isArray(value)){value.forEach(walk);return;}if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){keys.add(key);walk(item);}})(record);
  for(const forbidden of ['photos','photo','landmarks','mask','contours','mesh','geometry','vertices','participantCode','scanId','referenceValue','estimatedValue'])assert.ok(!keys.has(forbidden),forbidden);
});

test('composition records reject nested capture, validation and unknown fields', async()=>{
  const {prepareCompanyCompositionRecord,normalizeCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  const base=prepareCompanyCompositionRecord(estimate(),manifest(),options()),json=()=>JSON.parse(JSON.stringify(base));
  // Recursive rejection, not just top-level.
  for(const mutate of [
    record=>{record.provider.landmarks=[[1,2]];},
    record=>{record.outputs[0].mesh={vertices:[]};},
    record=>{record.modelManifest.photoDigest='abc';},
    record=>{record.outputs[0].uncertainty.participantCode='P001';},
    record=>{record.provider.scanId='S001';},
    record=>{record.outputs[0].referenceValue=60;},
    record=>{record.modelManifest.estimatedValue=60;},
  ]){const payload=json();mutate(payload);assert.throws(()=>normalizeCompanyCompositionRecord(payload),{code:'CAPTURE_DATA_FORBIDDEN'});}
  for(const mutate of [
    record=>{record.notes='extra';},
    record=>{record.provider.endpoint='https://example.invalid';},
    record=>{record.outputs[0].confidence=0.9;},
    record=>{record.modelManifest.datasetId='synthetic-training';},
  ]){const payload=json();mutate(payload);assert.throws(()=>normalizeCompanyCompositionRecord(payload),{code:'UNKNOWN_COMPOSITION_FIELD'});}
});

test('records that omit a required block are refused, matching the database allowlist', async()=>{
  const {prepareCompanyCompositionRecord,normalizeCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  const base=prepareCompanyCompositionRecord(estimate(),manifest(),options());
  // Executing the migration against a real PostgreSQL cluster showed the SQL allowlist could
  // accept a payload that simply omitted outputs or provider, because jsonb_typeof() of a
  // missing key is NULL. The contract already refused those; these cases keep both layers honest.
  for(const field of ['schema','resultId','assessmentId','subjectId','subjectScope','organizationId',
    'createdBy','consentReference','capturedAt','createdAt','savedAt','retentionUntil','provider',
    'modelManifest','outputs','dataScope','limitations']){
    const payload=JSON.parse(JSON.stringify(base));delete payload[field];
    assert.throws(()=>normalizeCompanyCompositionRecord(payload),error=>error.name==='CompanyCompositionRecordError','omitted '+field);
  }
  for(const path of [['provider','id'],['provider','version'],['provider','model'],
    ['modelManifest','schema'],['modelManifest','studyId'],['modelManifest','rightsStatus']]){
    const payload=JSON.parse(JSON.stringify(base));delete payload[path[0]][path[1]];
    assert.throws(()=>normalizeCompanyCompositionRecord(payload),error=>error.name==='CompanyCompositionRecordError',path.join('.'));
  }
  for(const key of ['key','label','value','unit','uncertainty']){
    const payload=JSON.parse(JSON.stringify(base));delete payload.outputs[0][key];
    assert.throws(()=>normalizeCompanyCompositionRecord(payload),error=>error.name==='CompanyCompositionRecordError','outputs[0].'+key);
  }
  // A not_provided disclosure must not smuggle interval fields, and duplicates are refused.
  const smuggled=JSON.parse(JSON.stringify(base));smuggled.outputs[1].uncertainty.lower=1;
  assert.throws(()=>normalizeCompanyCompositionRecord(smuggled),{code:'UNKNOWN_COMPOSITION_FIELD'});
  const duplicated=JSON.parse(JSON.stringify(base));duplicated.outputs[1]={...duplicated.outputs[0]};
  assert.throws(()=>normalizeCompanyCompositionRecord(duplicated),{code:'INVALID_COMPOSITION_RECORD'});
});
test('invalid units, uncertainty, disclosure text and retention windows are refused', async()=>{
  const {prepareCompanyCompositionRecord,normalizeCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  const base=prepareCompanyCompositionRecord(estimate(),manifest(),options()),json=()=>JSON.parse(JSON.stringify(base));
  const cases=[
    [record=>{record.outputs[0].unit='lb';},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.outputs[0].key='vo2max';},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.outputs[0].value=9999;},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.outputs[0].uncertainty.lower=70;},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.outputs[1].uncertainty.status='unknown';},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.outputs.push({...record.outputs[0]});},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.limitations='Clinically validated body composition.';},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.subjectScope='coach';},'INVALID_COMPOSITION_SCOPE'],
    [record=>{record.savedAt='2026-09-10T03:00:00Z';},'INVALID_COMPOSITION_RECORD'],
    [record=>{record.retentionUntil='2029-10-10T04:00:00Z';},'RETENTION_UNBOUNDED'],
    [record=>{record.retentionUntil=record.capturedAt;},'RETENTION_UNBOUNDED'],
  ];
  for(const [mutate,code] of cases){const payload=json();mutate(payload);assert.throws(()=>normalizeCompanyCompositionRecord(payload),{code},code+' case');}
  // A provider that does not match the approved manifest never reaches a record at all.
  assert.throws(()=>prepareCompanyCompositionRecord(estimate({provider:{id:'other-provider',version:'0.0.1-test',model:'synthetic-composition-model'}}),manifest(),options()),{code:'COMPOSITION_PROVIDER_MISMATCH'});
  assert.throws(()=>prepareCompanyCompositionRecord(estimate(),null,options()),{code:'INVALID_COMPOSITION_MANIFEST'});
  assert.throws(()=>prepareCompanyCompositionRecord(estimate(),manifest(),options({subjectId:'someone-else'})),{code:'COMPOSITION_SCOPE_MISMATCH'});
});

test('the store saves, reopens, exports and deletes under repeated fresh authorization', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const adapter=memoryAdapter(),store=createCompanyCompositionStore(adapter),pointer={resultId:'synthetic-result-001',subjectId:'synthetic-subject-001',subjectScope:'adult_reference'};
  const saved=await store.save(estimate(),manifest(),options());
  assert.equal(saved.createdBy,ACTOR);
  assert.equal(adapter.calls.put,1);
  const reopened=await store.reopen(pointer,{asOf:'2026-09-11T00:00:00Z'});
  assert.equal(reopened.resultId,'synthetic-result-001');
  const exported=await store.exportRecord(pointer,{asOf:'2026-09-11T00:00:00Z'});
  assert.equal(exported.filename,'body-composition-synthetic-result-001.json');
  assert.equal(exported.mediaType,'application/json');
  const parsed=JSON.parse(exported.content);
  // Export carries exactly the stored allowlist, no session, adapter or row metadata.
  assert.deepEqual(Object.keys(parsed).sort(),Object.keys(reopened).sort());
  assert.equal(parsed.consentReference,'synthetic-permission-001');
  // A read authorizes twice — once before the adapter answers and once after — so a single stale
  // allow can never be enough: save(1) + reopen(2) + export(2).
  assert.equal(adapter.calls.authorize,5);
  assert.deepEqual(await store.delete(pointer),{schema:'PP_COMPANY_COMPOSITION_DELETE_V1',resultId:'synthetic-result-001',subjectId:'synthetic-subject-001',subjectScope:'adult_reference',organizationId:ORG,deleted:true});
  await assert.rejects(store.delete(pointer),{code:'NOT_FOUND'});
});

test('authentication changes, denied scopes and cross-tenant rows are refused', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const pointer={resultId:'synthetic-result-001',subjectId:'synthetic-subject-001',subjectScope:'adult_reference'};
  const signedOut=memoryAdapter();signedOut.session.authenticated=false;
  await assert.rejects(createCompanyCompositionStore(signedOut).save(estimate(),manifest(),options()),{code:'AUTH_REQUIRED'});
  const denied=memoryAdapter();denied.setAllow(false);
  await assert.rejects(createCompanyCompositionStore(denied).history(pointer),{code:'ACCESS_DENIED'});
  // The session is re-read after the adapter answers; a swapped session cancels the operation.
  const swapped=memoryAdapter();swapped.swapSessionAfterAuthorize();
  await assert.rejects(createCompanyCompositionStore(swapped).save(estimate(),manifest(),options()),{code:'SESSION_CHANGED'});
  // A row belonging to another organization or another subject scope never renders.
  const {prepareCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  const foreign=prepareCompanyCompositionRecord(estimate({organizationId:'22222222-2222-4222-8222-222222222222'}),manifest(),options({organizationId:'22222222-2222-4222-8222-222222222222'}));
  const leaky=memoryAdapter({records:[foreign]});
  await assert.rejects(createCompanyCompositionStore(leaky).reopen(pointer),{code:'ACCESS_DENIED'});
  await assert.rejects(createCompanyCompositionStore(leaky).history(pointer),{code:'ACCESS_DENIED'});
  // A child-athlete pointer cannot open an adult-reference row.
  const adult=prepareCompanyCompositionRecord(estimate(),manifest(),options());
  const mixed=memoryAdapter({records:[adult],subjectScope:'child_athlete'});
  await assert.rejects(createCompanyCompositionStore(mixed).reopen({...pointer,subjectScope:'child_athlete'}),{code:'ACCESS_DENIED'});
  await assert.rejects(createCompanyCompositionStore(memoryAdapter()).reopen({...pointer,subjectScope:'coach'}),{code:'INVALID_COMPOSITION_SCOPE'});
});

test('history is empty by default, orders newest first and drops rows past retention', async()=>{
  const {createCompanyCompositionStore,prepareCompanyCompositionRecord,COMPANY_COMPOSITION_HISTORY_SCHEMA}=await import('../js/body-composition-record.mjs');
  const pointer={subjectId:'synthetic-subject-001',subjectScope:'adult_reference'};
  const empty=await createCompanyCompositionStore(memoryAdapter()).history(pointer);
  assert.equal(empty.schema,COMPANY_COMPOSITION_HISTORY_SCHEMA);
  assert.equal(empty.count,0);
  assert.equal(empty.expiredCount,0);
  assert.deepEqual(empty.results,[]);
  const build=(resultId,capturedAt,retentionUntil)=>prepareCompanyCompositionRecord(estimate({createdAt:capturedAt}),manifest(),
    options({resultId,savedAt:capturedAt,retentionUntil}));
  const records=[build('r-old','2026-06-01T00:00:00Z','2026-07-01T00:00:00Z'),
    build('r-new','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z'),
    build('r-mid','2026-08-01T00:00:00Z','2026-09-20T00:00:00Z')];
  const history=await createCompanyCompositionStore(memoryAdapter({records})).history(pointer,{asOf:'2026-09-10T00:00:00Z'});
  assert.deepEqual(history.results.map(record=>record.resultId),['r-new','r-mid']);
  assert.equal(history.count,2);
  assert.equal(history.expiredCount,1);
  assert.match(history.limitations,/no trend, significance, causation or accuracy/);
  // Retention is enforced on individual reads too, not only in the list.
  const expired=createCompanyCompositionStore(memoryAdapter({records}));
  await assert.rejects(expired.reopen({...pointer,resultId:'r-old'},{asOf:'2026-09-10T00:00:00Z'}),{code:'RETENTION_EXPIRED'});
  await assert.rejects(expired.exportRecord({...pointer,resultId:'r-old'},{asOf:'2026-09-10T00:00:00Z'}),{code:'RETENTION_EXPIRED'});
  assert.equal((await expired.reopen({...pointer,resultId:'r-old'},{asOf:'2026-06-15T00:00:00Z'})).resultId,'r-old');
  // A duplicated identifier is a corrupt listing, not a silently deduplicated one.
  await assert.rejects(createCompanyCompositionStore({...memoryAdapter(),async list(){return [JSON.parse(JSON.stringify(records[1])),JSON.parse(JSON.stringify(records[1]))];}}).history(pointer),{code:'INVALID_COMPOSITION_RECORD'});
});

test('the Supabase adapter keeps adult-reference and child-athlete scopes apart', async()=>{
  const {createSupabaseCompanyCompositionAdapter}=await import('../js/body-composition-supabase.mjs');
  const athlete='44444444-4444-4444-8444-444444444444';
  const captured={filters:{},order:null,limit:null,row:null,operation:null};
  const client=()=>({auth:{async getSession(){return {data:{session:{access_token:'composition-token',user:{id:ACTOR}}},error:null};}},
    from(table){assert.equal(table,'company_composition_results');
      const q={upsert(value,opts){captured.operation='upsert';captured.row=value;assert.equal(opts.onConflict,'team_id,subject_reference,result_id');return q;},
        delete(){captured.operation='delete';return q;},select(){return q;},
        eq(column,value){captured.filters[column]=value;return q;},is(column,value){captured.filters[column]=value;return q;},
        order(column,opts){captured.order=[column,opts];return q;},limit(value){captured.limit=value;return q;},
        async single(){return {data:{record:{resultId:'synthetic-result-001'}},error:null};},
        async maybeSingle(){return {data:null,error:null};},
        then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
      return q;}});
  // Adult reference: no athlete row is named, and the query pins athlete_id to null.
  const adult=createSupabaseCompanyCompositionAdapter(client(),{teamId:ORG,subjectReference:'synthetic-subject-001',subjectScope:'adult_reference'});
  const session=await adult.getSession();
  assert.equal(session.authenticated,true);
  assert.match(session.sessionId,/^supabase-composition:/);
  const {prepareCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  const record=prepareCompanyCompositionRecord(estimate(),manifest(),options({actorId:session.actorId}));
  await adult.put(record,{action:'save',organizationId:ORG,subjectId:'synthetic-subject-001',subjectScope:'adult_reference',resultId:'synthetic-result-001'},session);
  assert.equal(captured.row.athlete_id,null);
  assert.equal(captured.row.subject_scope,'adult_reference');
  assert.equal(captured.row.provider_id,'synthetic-provider');
  assert.equal(captured.row.model_version,'0.0.1-test');
  assert.equal(captured.row.record.subjectScope,'adult_reference');
  assert.equal(captured.row.record.photos,undefined);
  assert.deepEqual(await adult.list({action:'history',organizationId:ORG,subjectId:'synthetic-subject-001',subjectScope:'adult_reference'},session),[]);
  assert.deepEqual(captured.order,['captured_at',{ascending:false}]);
  assert.equal(captured.filters.athlete_id,null);
  // Configuration errors, not silent coercions.
  assert.throws(()=>createSupabaseCompanyCompositionAdapter(client(),{teamId:ORG,subjectReference:'synthetic-subject-001',subjectScope:'adult_reference',athleteId:athlete}),{code:'INVALID_COMPOSITION_SCOPE'});
  assert.throws(()=>createSupabaseCompanyCompositionAdapter(client(),{teamId:ORG,subjectReference:'synthetic-adult-subject-001',subjectScope:'child_athlete',athleteId:athlete}),{code:'INVALID_COMPOSITION_SCOPE'});
  assert.throws(()=>createSupabaseCompanyCompositionAdapter(client(),{teamId:ORG,subjectReference:athlete,subjectScope:'child_athlete'}),{code:'INVALID_COMPOSITION_SCOPE'});
  assert.throws(()=>createSupabaseCompanyCompositionAdapter(client(),{teamId:ORG,subjectReference:athlete,subjectScope:'roster'}),{code:'INVALID_COMPOSITION_SCOPE'});
  // Child athlete: the athlete id is both the roster row and the opaque subject reference.
  const child=createSupabaseCompanyCompositionAdapter(client(),{teamId:ORG,subjectReference:athlete,subjectScope:'child_athlete',athleteId:athlete});
  await child.remove({action:'delete',organizationId:ORG,subjectId:athlete,subjectScope:'child_athlete',resultId:'synthetic-result-001'},session);
  assert.equal(captured.filters.athlete_id,athlete);
  assert.equal(captured.filters.subject_scope,'child_athlete');
  // A request outside the configured scope never reaches the database.
  await assert.rejects(child.get({action:'read',organizationId:ORG,subjectId:'synthetic-subject-001',subjectScope:'adult_reference',resultId:'x'},session),{code:'COMPOSITION_SCOPE_MISMATCH'});
});

test('the Supabase adapter surfaces database failures instead of returning empty history', async()=>{
  const {createSupabaseCompanyCompositionAdapter}=await import('../js/body-composition-supabase.mjs');
  const failing={auth:{async getSession(){return {data:{session:{access_token:'composition-token',user:{id:ACTOR}}},error:null};}},
    from(){const q={select(){return q;},eq(){return q;},is(){return q;},order(){return q;},limit(){return q;},
      then(resolve){return Promise.resolve({data:null,error:{message:'row-level security denied'}}).then(resolve);}};return q;}};
  const adapter=createSupabaseCompanyCompositionAdapter(failing,{teamId:ORG,subjectReference:'synthetic-subject-001',subjectScope:'adult_reference'});
  const session=await adapter.getSession();
  await assert.rejects(adapter.list({action:'history',organizationId:ORG,subjectId:'synthetic-subject-001',subjectScope:'adult_reference'},session),{code:'COMPOSITION_LIST',message:'row-level security denied'});
  assert.throws(()=>createSupabaseCompanyCompositionAdapter({},{teamId:ORG,subjectReference:'a',subjectScope:'adult_reference'}),{code:'INVALID_SUPABASE_CLIENT'});
});

test('the composition migration isolates tenants, allowlists the payload, audits and bounds retention',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910190000_company_composition_results.sql'),'utf8');
  for(const value of ['company_composition_results','company_composition_payload_is_allowed','company_body_payload_has_forbidden_key',
    'enable row level security','can_manage_company_composition','company_composition_result_audit','sweep_company_composition_retention','cron.schedule',
    'PP_COMPANY_COMPOSITION_RESULT_V1','lean_mass_kg','bone_mineral_content_kg'])assert.match(sql,new RegExp(value.replaceAll('.','\\.')),value);
  // Adult-reference rows can never carry a child athlete, and child rows must name one.
  assert.match(sql,/check \(\(subject_scope='child_athlete'\) = \(athlete_id is not null\)\)/);
  assert.match(sql,/subject_scope<>'child_athlete' or subject_reference=athlete_id::text/);
  // Retention is bounded on both ends rather than open-ended.
  assert.match(sql,/retention_until>captured_at and retention_until<=captured_at\+interval '400 days'/);
  // NULL-safety: jsonb_typeof() of a missing key is NULL, so the allowlist must count keys and
  // compare with IS DISTINCT FROM rather than <>. Verified by execution, asserted here too.
  assert.match(sql,/select \(select count\(\*\) from jsonb_object_keys\(payload\)\) = 17/);
  assert.match(sql,/jsonb_typeof\(payload->'outputs'\) is distinct from 'array'/);
  assert.match(sql,/jsonb_typeof\(payload->'provider'\) is distinct from 'object'/);
  assert.match(sql,/count\(distinct element\.item->>'key'\)/);
  assert.match(sql,/'assessment_id',coalesce\(new\.assessment_id,old\.assessment_id\)/);
  assert.doesNotMatch(sql,/jsonb_typeof\(payload->'outputs'\) <> 'array'/);
  assert.match(sql,/private\.is_admin_of_team\(requested_team\)/);
  assert.match(sql,/private\.can_manage_company_body_assessment\(requested_team,requested_athlete\)/);
  for(const policy of ['select','insert','update','delete'])assert.match(sql,new RegExp('create policy company_composition_'+policy));
  assert.match(sql,/created_by=\(select auth\.uid\(\)\) and private\.can_manage_company_composition/);
  // No demonstration row is ever created by the migration.
  // Provider eligibility is enforced in the database, not only in the browser.
  assert.match(sql,/create table if not exists public\.company_composition_providers/);
  assert.match(sql,/references public\.company_composition_providers\(team_id,provider_id,model_id,model_version\)/);
  assert.match(sql,/on update cascade on delete restrict/);
  assert.match(sql,/enforce_company_composition_provider/);
  assert.match(sql,/before insert or update on public\.company_composition_results/);
  // The registry must stay out of tenant reach: SELECT only, and no write policy at all.
  // Supabase grants ALL on a new public table to anon and authenticated, including TRUNCATE,
  // which row-level security does not cover. Both tables reset to zero and grant back only
  // what the application needs. Verified against the live project on 2026-09-10.
  assert.match(sql,/revoke all on public\.company_composition_providers from anon, authenticated;/);
  assert.match(sql,/revoke all on public\.company_composition_results from anon, authenticated;/);
  assert.doesNotMatch(sql,/grant [a-z, ]*on public\.company_composition_(results|providers) to [a-z, ]*anon/);
  assert.doesNotMatch(sql,/create policy company_composition_provider_(insert|update|delete)/);
  // Empty-array NULL trap, found by executing the registry.
  assert.match(sql,/coalesce\(array_length\(keys,1\),0\) between 1 and 5/);
  assert.doesNotMatch(sql,/insert into public\.company_composition_results/);
});

test('the composition room lists real stored history and states the empty result honestly',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../company-composition-demo.html'),'utf8');
  const source=fs.readFileSync(path.join(__dirname,'../tools/company-composition-demo.mjs'),'utf8');
  assert.match(html,/No stored composition results\./);
  for(const id of ['historyConnect','historyTeam','historyScope','historySubject','historyLoad','historyStatus','historyResult'])assert.ok(html.includes(id),id);
  assert.match(html,/adult_reference/);assert.match(html,/child_athlete/);
  assert.match(html,/no composition result exists to store today/);
  // The panel reads the real store; it never fabricates a row to fill the screen.
  for(const token of ['createCompanyCompositionStore','createSupabaseCompanyCompositionAdapter','historyStore()','state.historyRequest'])assert.ok(source.includes(token),token);
  assert.ok(!/prepareCompanyCompositionRecord/.test(source),'the room must not build composition records');
  assert.ok(!source.includes('localStorage'));
  // A late answer for a scope the operator already changed is dropped rather than rendered.
  assert.match(source,/if\(ticket!==state\.historyRequest\)return;/);
  // Browser replay showed the rows cleared on a scope change but the status line kept describing
  // the previous scope. resetHistory() must clear the message with the rows.
  assert.match(source,/function resetHistory\(\)\{[^}]*historyMessage\('No stored composition results\.'\)/);
  assert.match(source,/expiredCount===1\?' expired past retention and is not shown\.'/);
  // The tables are provisioned by a migration applied separately from the site deploy, so an
  // unprovisioned environment must read as empty rather than as a raw database error.
  assert.match(source,/does not exist\|schema cache\|PGRST205\|42P01/);
  assert.match(source,/Composition storage is not provisioned in this environment yet/);
});

test('production allowlist, worker and smoke checks cover the composition storage layer',()=>{
  const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
  const worker=read('sw.js'),smoke=read('tools/deployment-smoke.cjs'),sdkFiles=read('tools/sdk-files.cjs');
  for(const asset of ['/js/body-composition-record.mjs','/js/body-composition-supabase.mjs'])assert.ok(worker.includes(asset),asset);
  for(const route of ['/js/body-composition-record.mjs','/js/body-composition-supabase.mjs'])assert.ok(smoke.includes(route),route);
  for(const name of ['body-composition-record.mjs','body-composition-supabase.mjs'])assert.ok(sdkFiles.includes(name),name);
  assert.ok(sdkFiles.includes('20260910190000_company_composition_results.sql'));
});

test('the executable database harness is present, self-contained and cannot reach a real server',()=>{
  const dir=path.join(__dirname,'db'),read=name=>fs.readFileSync(path.join(dir,name),'utf8');
  for(const name of ['run.cjs','replay.cjs','security-tests.cjs','00-preamble.sql','05-post-identity-seed.sql','10-fixtures.sql','README.md','inventory.sql'])
    assert.ok(fs.existsSync(path.join(dir,name)),'missing tests/db/'+name);
  // The main glob is tests/*.test.cjs, so the harness must not be picked up by the default suite.
  for(const name of fs.readdirSync(dir))assert.ok(!name.endsWith('.test.cjs'),'tests/db/'+name+' would join the default suite');
  const run=read('run.cjs'),replay=read('replay.cjs'),security=read('security-tests.cjs');
  // No developer-machine paths may survive into the repository copies.
  for(const [name,source] of [['run.cjs',run],['replay.cjs',replay],['security-tests.cjs',security]]){
    assert.doesNotMatch(source,/[A-Za-z]:[\/]Users[\/]/,name+' carries an absolute developer path');
    assert.doesNotMatch(source,/scratchpad/,name+' still references the scratchpad');
  }
  // The harness builds its own cluster and refuses a supplied connection.
  assert.match(run,/initdb/);assert.match(run,/listen_addresses=127\.0\.0\.1/);
  for(const source of [replay,security])assert.match(source,/will not connect to a server it did not create/);
  assert.match(run,/Refusing to remove/);
  // Fixtures stay synthetic and never name the live adult-reference record.
  const fixtures=read('10-fixtures.sql');
  assert.match(fixtures,/SYNTHETIC/);
  // The fixture header names the live record only to say it is NOT used, so check the SQL itself.
  const statements=source=>source.split(String.fromCharCode(10)).filter(line=>!line.trim().startsWith('--')).join(String.fromCharCode(10));
  // The needles here are the LIVE record identifiers, deliberately. This asserts the
  // database fixtures never reference the real adult-reference record; renaming these
  // to the synthetic fixture names would make the assertion test nothing.
  for(const source of [fixtures,read('00-preamble.sql')])assert.doesNotMatch(statements(source),/friday-adult-reference-001|friday-reference-001/);
  // The README must keep stating what the harness does not prove.
  const readme=read('README.md');
  assert.match(readme,/Not that the nightly retention job runs/);
  assert.match(readme,/## Provider eligibility/);
  // The registry only helps if it stays out of tenant reach, so the README must keep saying so.
  assert.match(readme,/no INSERT, UPDATE or DELETE grant and no write policy/);
  assert.match(readme,/nothing verifies that the registered provider is a real/);
});

test('the migration pins exactly the disclosure text and metric bounds the contract uses', async()=>{
  const {BODY_COMPOSITION_METRICS}=await import('../js/body-composition-contract.mjs');
  const {prepareCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910190000_company_composition_results.sql'),'utf8');
  const record=prepareCompanyCompositionRecord(estimate(),manifest(),options());
  // The database pins both disclosure strings exactly. Editing either one on the JavaScript side
  // alone would not fail a unit test — it would silently make every real write fail the CHECK.
  assert.ok(sql.includes(record.dataScope),'the migration does not pin the current dataScope text');
  assert.ok(sql.includes(record.limitations),'the migration does not pin the current limitations text');
  // Same for the metric dictionary: label, unit and physiological bounds live in both layers.
  for(const [key,spec] of Object.entries(BODY_COMPOSITION_METRICS)){
    const row=new RegExp("\\('"+key+"','"+spec.label+"','"+spec.unit+"',"+spec.min+"::numeric,"+spec.max+"::numeric\\)");
    assert.match(sql,row,key+' bounds differ between the contract and the migration');
  }
  // And the five supported keys are the same set on both sides.
  for(const key of Object.keys(BODY_COMPOSITION_METRICS))assert.ok(sql.includes("'"+key+"'"),key+" missing from the migration");
});
