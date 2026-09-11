const test=require('node:test'),assert=require('node:assert/strict');

// Asynchronous authorization races for the composition store.
// Synthetic fixtures only. These prove the contract's fail-closed behaviour when the session,
// membership, organization or subject scope changes while an operation is in flight. They prove
// nothing about anatomical accuracy, and no real record is used.
const ORG_A='11111111-1111-4111-8111-111111111111',ORG_B='22222222-2222-4222-8222-222222222222';
const ACTOR_A='33333333-3333-4333-8333-333333333333',ACTOR_B='44444444-4444-4444-8444-444444444444';

const manifest=()=>({schema:'PP_BODY_COMPOSITION_MODEL_MANIFEST_V1',provider:{id:'synthetic-provider',version:'0.0.1-test',model:'synthetic-composition-model'},
  intendedUse:'informational_longitudinal',diagnosticUse:false,
  outputs:[{key:'lean_mass_kg',unit:'kg',definition:'Synthetic fixture definition.'}],
  trainingReference:{method:'DXA',datasetId:'synthetic-training',participantCount:10,ageRange:{min:18,max:60},completedAt:'2026-01-01T00:00:00Z'},
  validationReference:{method:'DXA',studyId:'synthetic-validation',independentFromTraining:true,participantCount:8,ageRange:{min:18,max:60},completedAt:'2026-02-01T00:00:00Z'},
  rights:{status:'buyer_supplied',expiresAt:null}});
const estimate=(overrides={})=>({schema:'PP_BODY_COMPOSITION_ESTIMATE_V1',status:'estimated',diagnosticUse:false,
  assessmentId:'synthetic-assessment-001',subjectId:'synthetic-subject-001',organizationId:ORG_A,createdAt:'2026-09-10T04:00:00Z',
  provider:{id:'synthetic-provider',version:'0.0.1-test',model:'synthetic-composition-model'},
  outputs:[{key:'lean_mass_kg',value:60,unit:'kg',uncertainty:{status:'not_provided'}}],...overrides});
const options=(overrides={})=>({resultId:'synthetic-result-001',subjectId:'synthetic-subject-001',subjectScope:'adult_reference',
  actorId:ACTOR_A,organizationId:ORG_A,consentReference:'synthetic-permission-001',savedAt:'2026-09-10T04:05:00Z',retentionUntil:'2026-10-10T04:00:00Z',...overrides});
const POINTER={subjectId:'synthetic-subject-001',subjectScope:'adult_reference'};
const RESULT_POINTER={...POINTER,resultId:'synthetic-result-001'};

/** An adapter whose session and authorization decision can be changed at a chosen step. */
function racingAdapter({rows=[],script={}}={}){
  const state={authenticated:true,actorId:ACTOR_A,organizationId:ORG_A,sessionId:'session-1'};
  const step={getSession:0,authorize:0,get:0,list:0};
  const fire=(name)=>{const hook=script[name+':'+(++step[name])];if(hook)hook(state);};
  return {state,step,
    async getSession(){fire('getSession');return {...state};},
    async authorize(){fire('authorize');return script.deny? false:true;},
    async put(){},
    async get(){fire('get');return rows[0]?JSON.parse(JSON.stringify(rows[0])):null;},
    async list(){fire('list');return rows.map(r=>JSON.parse(JSON.stringify(r)));},
    async remove(){return true;}};
}

async function record(overrides={},opts={}){
  const {prepareCompanyCompositionRecord}=await import('../js/body-composition-record.mjs');
  return prepareCompanyCompositionRecord(estimate(overrides),manifest(),options(opts));
}

test('signing out while a history read is in flight discards the answer', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const row=await record();
  // The session disappears after the adapter has already returned the rows.
  const adapter=racingAdapter({rows:[row],script:{'getSession:3':state=>{state.authenticated=false;}}});
  await assert.rejects(createCompanyCompositionStore(adapter).history(POINTER),{code:'AUTH_REQUIRED'});
});

test('a different user signing in mid-read cancels the operation instead of rendering', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const row=await record();
  const adapter=racingAdapter({rows:[row],script:{'getSession:3':state=>{state.actorId=ACTOR_B;state.sessionId='session-2';}}});
  await assert.rejects(createCompanyCompositionStore(adapter).history(POINTER),{code:'SESSION_CHANGED'});
});

test('a token refresh that replaces the session id cancels a read', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const row=await record();
  const adapter=racingAdapter({rows:[row],script:{'getSession:2':state=>{state.sessionId='session-rotated';}}});
  await assert.rejects(createCompanyCompositionStore(adapter).reopen(RESULT_POINTER,{asOf:'2026-09-11T00:00:00Z'}),{code:'SESSION_CHANGED'});
});

test('switching organization mid-read refuses rather than showing the previous tenant rows', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const row=await record();
  const adapter=racingAdapter({rows:[row],script:{'getSession:3':state=>{state.organizationId=ORG_B;}}});
  await assert.rejects(createCompanyCompositionStore(adapter).history(POINTER),{code:'SESSION_CHANGED'});
});

test('membership revoked between the two authorization checks fails closed', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const row=await record();
  let calls=0;
  const base=racingAdapter({rows:[row]});
  const adapter={...base,async authorize(){return ++calls===1;}};
  // The row was fetched under the first allow; the confirming check now denies, so nothing returns.
  await assert.rejects(createCompanyCompositionStore(adapter).reopen(RESULT_POINTER,{asOf:'2026-09-11T00:00:00Z'}),{code:'ACCESS_DENIED'});
  calls=0;
  await assert.rejects(createCompanyCompositionStore(adapter).history(POINTER),{code:'ACCESS_DENIED'});
});

test('a write is authorized against the session read at execution time, not a cached one', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  // The session changes after authorize() but before put() completes.
  const adapter=racingAdapter({script:{'getSession:2':state=>{state.sessionId='session-2';}}});
  await assert.rejects(createCompanyCompositionStore(adapter).save(estimate(),manifest(),options()),{code:'SESSION_CHANGED'});
  // And the stored record is always attributed to the live session actor, never a caller-supplied one.
  const clean=racingAdapter({});
  const saved=await createCompanyCompositionStore(clean).save(estimate(),manifest(),options({actorId:ACTOR_B,organizationId:ORG_B}));
  assert.equal(saved.createdBy,ACTOR_A);
  assert.equal(saved.organizationId,ORG_A);
});

test('a row from another subject scope cannot be rendered through a history read', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const childRow=await record({},{subjectScope:'child_athlete'});
  const adapter=racingAdapter({rows:[childRow]});
  await assert.rejects(createCompanyCompositionStore(adapter).history(POINTER),{code:'ACCESS_DENIED'});
});

test('one malformed row fails the whole listing rather than rendering the rest', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const good=await record();
  const tampered=JSON.parse(JSON.stringify(good));
  tampered.resultId='synthetic-result-002';
  tampered.outputs[0].landmarks=[[1,2]];
  const adapter=racingAdapter({rows:[good,tampered]});
  await assert.rejects(createCompanyCompositionStore(adapter).history(POINTER),{code:'CAPTURE_DATA_FORBIDDEN'});
});

test('an expired record reaches neither the history, the view nor an export', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const expired=await record({createdAt:'2026-06-01T00:00:00Z'},{savedAt:'2026-06-01T00:05:00Z',retentionUntil:'2026-07-01T00:00:00Z'});
  const asOf='2026-09-10T00:00:00Z';
  const store=createCompanyCompositionStore(racingAdapter({rows:[expired]}));
  const history=await store.history(POINTER,{asOf});
  assert.equal(history.count,0);
  assert.equal(history.expiredCount,1);
  assert.deepEqual(history.results,[]);
  await assert.rejects(store.reopen(RESULT_POINTER,{asOf}),{code:'RETENTION_EXPIRED'});
  await assert.rejects(store.exportRecord(RESULT_POINTER,{asOf}),{code:'RETENTION_EXPIRED'});
});

test('an export always re-reads and re-validates rather than trusting a fetched row', async()=>{
  const {createCompanyCompositionStore}=await import('../js/body-composition-record.mjs');
  const good=await record();
  const tampered=JSON.parse(JSON.stringify(good));
  tampered.limitations='Clinically validated body composition.';
  const store=createCompanyCompositionStore(racingAdapter({rows:[tampered]}));
  await assert.rejects(store.exportRecord(RESULT_POINTER,{asOf:'2026-09-11T00:00:00Z'}),{code:'INVALID_COMPOSITION_RECORD'});
});
