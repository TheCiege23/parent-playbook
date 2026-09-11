const test=require('node:test'),assert=require('node:assert/strict');
const fixture=()=>({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.10.0',createdAt:'2026-09-09T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference-model'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:74,processingMs:1400,
  measurements:[{key:'wingspan',value:76.4,unit:'in',definition:'Estimated wingspan.'},{key:'left_forearm_length',value:11.2,unit:'in',definition:'Estimated left segment.'}],photos:['PRIVATE'],landmarks:['PRIVATE'],surface:{mesh:'PRIVATE'}});
const options=()=>({assessmentId:'assessment-001',subjectId:'athlete-001',consentReference:'consent-001',actorId:'operator-001',organizationId:'company-001',savedAt:'2026-09-09T12:01:00Z',retentionUntil:'2027-09-09T12:01:00Z',surfaceStatus:'rejected'});

test('portable company record is detached, allowlisted and keeps missing outputs missing',async()=>{
  const {prepareCompanyAssessment}=await import('../js/body-sdk-record.mjs'),source=fixture(),record=prepareCompanyAssessment(source,options());
  assert.equal(record.schema,'PP_COMPANY_BODY_ASSESSMENT_V1');assert.equal(record.assessment.surfaceStatus,'rejected');assert.equal(record.assessment.outputCount,2);assert.equal(record.assessment.missingOutputs.length,23);
  assert.equal(record.surfaceProcessing,null);
  assert.ok(!JSON.stringify(record).includes('PRIVATE'));source.measurements[0].value=1;assert.equal(record.assessment.measurements[0].value,76.4);
  for(const bad of [o=>o.assessmentId='',o=>o.subjectId=' x\n',o=>o.actorId=null,o=>o.savedAt='bad']){const x=options();bad(x);assert.throws(()=>prepareCompanyAssessment(fixture(),x),{code:'INVALID_RECORD'});}
});

test('generated surface processing provenance is allowlisted and outcome-bound',async()=>{
  const {prepareCompanyAssessment}=await import('../js/body-sdk-record.mjs'),adjustment={protocol:'surface-lower-artifact-removal-v1',componentCountBefore:2,
    originalOccupiedVoxels:4784,removedVoxels:14,removedFraction:14/4784,affectedFromFloorFraction:.015625,affectedToFloorFraction:.046875};
  const processing={schema:'PP_COMPANY_SURFACE_PROCESSING_V1',status:'generated',adjustment:{...adjustment,privateMask:'PRIVATE'}};
  const record=prepareCompanyAssessment(fixture(),{...options(),surfaceStatus:'generated',surfaceProcessing:processing});
  assert.equal(record.surfaceProcessing.adjustment.removedVoxels,14);assert.equal(record.surfaceProcessing.adjustment.privateMask,undefined);assert.ok(!JSON.stringify(record).includes('PRIVATE'));
  processing.adjustment.removedVoxels=1;assert.equal(record.surfaceProcessing.adjustment.removedVoxels,14);
  for(const bad of [
    {...processing,status:'rejected',adjustment},
    {...processing,adjustment:{...adjustment,removedVoxels:257,removedFraction:257/4784}},
    {...processing,adjustment:{...adjustment,removedFraction:.9}},
    {...processing,adjustment:{...adjustment,affectedToFloorFraction:.2}},
  ])assert.throws(()=>prepareCompanyAssessment(fixture(),{...options(),surfaceStatus:'generated',surfaceProcessing:bad}),{code:'INVALID_RECORD'});
});

function memoryAdapter(){
  const records=new Map(),calls=[];let current={authenticated:true,actorId:'operator-001',organizationId:'company-001',sessionId:'session-001'},authorizeResult=true;
  const key=scope=>[scope.organizationId,scope.subjectId,scope.assessmentId].join('|');
  return {records,calls,setSession:value=>current=value,setAuthorize:value=>authorizeResult=value,
    async getSession(){calls.push('session');return {...current};},
    async authorize(scope){calls.push('authorize:'+scope.action);return authorizeResult;},
    async put(record,scope,session){calls.push('put');assert.equal(session.organizationId,scope.organizationId);records.set(key(scope),JSON.parse(JSON.stringify(record)));},
    async get(scope){calls.push('get');return records.has(key(scope))?JSON.parse(JSON.stringify(records.get(key(scope)))):null;},
    async remove(scope){calls.push('remove');return records.delete(key(scope));}};
}

test('store saves, reopens, exports and deletes through fresh scoped authorization',async()=>{
  const {createCompanyAssessmentStore}=await import('../js/body-sdk-record.mjs'),adapter=memoryAdapter(),store=createCompanyAssessmentStore(adapter),pointer={assessmentId:'assessment-001',subjectId:'athlete-001'};
  await store.save(fixture(),{...pointer,consentReference:'consent-001',savedAt:'2026-09-09T12:01:00Z',surfaceStatus:'not_requested'});
  const reopened=await store.reopen(pointer);assert.equal(reopened.organizationId,'company-001');assert.equal(reopened.createdBy,'operator-001');
  const exported=await store.exportRecord(pointer),payload=JSON.parse(exported.content);assert.equal(exported.filename,'body-assessment-assessment-001.json');assert.equal(payload.assessmentId,'assessment-001');assert.ok(!exported.content.includes('PRIVATE'));
  const receipt=await store.delete(pointer);assert.equal(receipt.deleted,true);await assert.rejects(store.reopen(pointer),{code:'NOT_FOUND'});
  assert.ok(adapter.calls.includes('authorize:save'));assert.ok(adapter.calls.includes('authorize:read'));assert.ok(adapter.calls.includes('authorize:export'));assert.ok(adapter.calls.includes('authorize:delete'));
});

test('missing auth, denied access, session changes and cross-scope reads release no record',async()=>{
  const {createCompanyAssessmentStore}=await import('../js/body-sdk-record.mjs'),adapter=memoryAdapter(),store=createCompanyAssessmentStore(adapter),pointer={assessmentId:'assessment-001',subjectId:'athlete-001'};
  adapter.setSession({authenticated:false});await assert.rejects(store.save(fixture(),{...pointer,consentReference:'consent-001'}),{code:'AUTH_REQUIRED'});assert.equal(adapter.records.size,0);
  adapter.setSession({authenticated:true,actorId:'operator-001',organizationId:'company-001',sessionId:'session-001'});adapter.setAuthorize(false);
  await assert.rejects(store.save(fixture(),{...pointer,consentReference:'consent-001'}),{code:'ACCESS_DENIED'});assert.equal(adapter.records.size,0);
  adapter.setAuthorize(true);await store.save(fixture(),{...pointer,consentReference:'consent-001'});
  const raw=[...adapter.records.values()][0];raw.organizationId='other-company';adapter.records.set('company-001|athlete-001|assessment-001',raw);
  await assert.rejects(store.reopen(pointer),{code:'ACCESS_DENIED'});
});

test('identity changed by an authorization callback blocks the operation before persistence',async()=>{
  const {createCompanyAssessmentStore}=await import('../js/body-sdk-record.mjs');let sessionId='session-001',writes=0;
  const store=createCompanyAssessmentStore({getSession:async()=>({authenticated:true,actorId:'operator-001',organizationId:'company-001',sessionId}),authorize:async()=>{sessionId='session-002';return true;},put:async()=>{writes++;},get:async()=>null,remove:async()=>false});
  await assert.rejects(store.save(fixture(),{assessmentId:'a',subjectId:'s',consentReference:'c'}),{code:'SESSION_CHANGED'});assert.equal(writes,0);
});

test('adapter and stored payload validation fail closed',async()=>{
  const {createCompanyAssessmentStore}=await import('../js/body-sdk-record.mjs');assert.throws(()=>createCompanyAssessmentStore({}),{code:'INVALID_ADAPTER'});
  const adapter=memoryAdapter(),store=createCompanyAssessmentStore(adapter),scope={organizationId:'company-001',subjectId:'athlete-001',assessmentId:'assessment-001'};
  adapter.records.set([scope.organizationId,scope.subjectId,scope.assessmentId].join('|'),{schema:'unknown'});
  await assert.rejects(store.reopen({assessmentId:scope.assessmentId,subjectId:scope.subjectId}),{code:'INVALID_RECORD'});
});
