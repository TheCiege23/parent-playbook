import {BODY_COMPOSITION_METRICS,validateCompositionEstimate} from './body-composition-contract.mjs';

export const COMPANY_COMPOSITION_RECORD_SCHEMA='PP_COMPANY_COMPOSITION_RESULT_V1';
export const COMPANY_COMPOSITION_HISTORY_SCHEMA='PP_COMPANY_COMPOSITION_HISTORY_V1';
export const COMPOSITION_SUBJECT_SCOPES=Object.freeze(['adult_reference','child_athlete']);
export const COMPOSITION_MAX_RETENTION_DAYS=400;
const MANIFEST='PP_BODY_COMPOSITION_MODEL_MANIFEST_V1',ACTIONS=new Set(['save','read','export','delete','history']),MAX_HISTORY=500;
const DATA_SCOPE='Scalar composition outputs, units, uncertainty disclosure and provider identity only. No photos, landmarks, masks, contours, meshes, geometry, raw validation observations or participant/scan codes.';
const LIMITATIONS='Estimated body composition from an external model. Not a DEXA measurement, diagnosis, screening result, treatment recommendation or athletic-potential score.';
const HISTORY_LIMITATIONS='Stored provider estimates listed in reverse capture order. Ordering is descriptive; no trend, significance, causation or accuracy is implied.';
// consentReference and subjectReference stay legal, so a bare "reference" token is not forbidden.
// A raw validation row is: its participant/scan codes and its reference/estimated value pair never become a stored record.
const FORBIDDEN=/(^|_)(photo|photos|image|images|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces|digest|digests|fingerprint|fingerprints|participant|participants|scan|scans|observation|observations|reference_value|estimated_value|reference_method|reference_at|estimate_at)($|_)/i;
const RECORD_KEYS=Object.freeze(['schema','resultId','assessmentId','subjectId','subjectScope','organizationId','createdBy','consentReference','capturedAt','createdAt','savedAt','retentionUntil','provider','modelManifest','outputs','dataScope','limitations']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{name:'CompanyCompositionRecordError',code});};
const clone=value=>JSON.parse(JSON.stringify(value));
const text=(value,label,max=180)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_COMPOSITION_RECORD',label+' is required.');return value;};
const instant=(value,label)=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('INVALID_COMPOSITION_RECORD',label+' must be an ISO date.');return new Date(value).toISOString();};
const scope=(value,label)=>{if(!COMPOSITION_SUBJECT_SCOPES.includes(value))fail('INVALID_COMPOSITION_SCOPE',label+' must be adult_reference or child_athlete.');return value;};

function rejectForbiddenFields(value,depth=0){
  if(depth>12)fail('INVALID_COMPOSITION_RECORD','The composition payload is nested too deeply.');
  if(Array.isArray(value)){for(const item of value)rejectForbiddenFields(item,depth+1);return;}
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(FORBIDDEN.test(key.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase()))fail('CAPTURE_DATA_FORBIDDEN','Composition records cannot contain capture, geometry or raw validation fields.');
    rejectForbiddenFields(item,depth+1);
  }
}
function onlyKeys(value,label,allowed){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_COMPOSITION_RECORD',label+' must be an object.');
  for(const key of Object.keys(value))if(!allowed.includes(key))fail('UNKNOWN_COMPOSITION_FIELD','Unsupported field '+label+'.'+key+' in the composition record.');
  return value;
}
function normalizeOutputs(input){
  if(!Array.isArray(input)||!input.length||input.length>Object.keys(BODY_COMPOSITION_METRICS).length)fail('INVALID_COMPOSITION_RECORD','Stored composition outputs are invalid.');
  const seen=new Set();
  return Object.freeze(input.map(item=>{
    onlyKeys(item,'outputs[]',['key','label','value','unit','uncertainty']);
    const key=text(item.key,'output key',100),bounds=BODY_COMPOSITION_METRICS[key];
    if(!bounds||seen.has(key)||item.unit!==bounds.unit||item.label!==bounds.label||!Number.isFinite(item.value)||item.value<bounds.min||item.value>bounds.max)fail('INVALID_COMPOSITION_RECORD','A stored composition output is invalid or undeclared.');
    seen.add(key);
    const uncertainty=item.uncertainty;
    if(uncertainty?.status==='provided'){
      onlyKeys(uncertainty,'outputs[].uncertainty',['status','lower','upper','method']);
      if(!Number.isFinite(uncertainty.lower)||!Number.isFinite(uncertainty.upper)||uncertainty.lower>item.value||uncertainty.upper<item.value||uncertainty.lower<bounds.min||uncertainty.upper>bounds.max)fail('INVALID_COMPOSITION_RECORD','Stored composition uncertainty bounds are invalid.');
      return Object.freeze({key,label:bounds.label,value:item.value,unit:bounds.unit,uncertainty:Object.freeze({status:'provided',lower:uncertainty.lower,upper:uncertainty.upper,method:text(uncertainty.method,'uncertainty.method',180)})});
    }
    onlyKeys(uncertainty==null?{}:uncertainty,'outputs[].uncertainty',['status']);
    if(uncertainty?.status!=='not_provided')fail('INVALID_COMPOSITION_RECORD','Each stored output must disclose uncertainty availability.');
    return Object.freeze({key,label:bounds.label,value:item.value,unit:bounds.unit,uncertainty:Object.freeze({status:'not_provided'})});
  }));
}

/** Re-validate a stored composition row without trusting the database or a stale browser cache. */
export function normalizeCompanyCompositionRecord(input){
  rejectForbiddenFields(input);
  onlyKeys(input,'record',RECORD_KEYS);
  if(input.schema!==COMPANY_COMPOSITION_RECORD_SCHEMA)fail('INVALID_COMPOSITION_RECORD','The company composition record is unsupported.');
  const provider=onlyKeys(input.provider,'provider',['id','version','model']),manifest=onlyKeys(input.modelManifest,'modelManifest',['schema','studyId','trainingMethod','validationMethod','rightsStatus']);
  if(manifest.schema!==MANIFEST||manifest.trainingMethod!=='DXA'||manifest.validationMethod!=='DXA'||!['owned','licensed','buyer_supplied'].includes(manifest.rightsStatus))fail('INVALID_COMPOSITION_RECORD','The stored model-manifest reference is invalid.');
  const capturedAt=instant(input.capturedAt,'capturedAt'),createdAt=instant(input.createdAt,'createdAt'),savedAt=instant(input.savedAt,'savedAt'),retentionUntil=instant(input.retentionUntil,'retentionUntil');
  if(!(capturedAt<=createdAt&&createdAt<=savedAt))fail('INVALID_COMPOSITION_RECORD','Composition timestamps must run capture, estimate, then save.');
  const window=Date.parse(retentionUntil)-Date.parse(capturedAt);
  if(window<=0||window>COMPOSITION_MAX_RETENTION_DAYS*86400000)fail('RETENTION_UNBOUNDED','Composition retention must end after capture and within '+COMPOSITION_MAX_RETENTION_DAYS+' days.');
  if(input.dataScope!==DATA_SCOPE||input.limitations!==LIMITATIONS)fail('INVALID_COMPOSITION_RECORD','The stored composition disclosure text was modified.');
  return Object.freeze({schema:COMPANY_COMPOSITION_RECORD_SCHEMA,resultId:text(input.resultId,'resultId'),assessmentId:text(input.assessmentId,'assessmentId'),
    subjectId:text(input.subjectId,'subjectId'),subjectScope:scope(input.subjectScope,'subjectScope'),organizationId:text(input.organizationId,'organizationId'),
    createdBy:text(input.createdBy,'createdBy'),consentReference:text(input.consentReference,'consentReference'),capturedAt,createdAt,savedAt,retentionUntil,
    provider:Object.freeze({id:text(provider.id,'provider.id',100),version:text(provider.version,'provider.version',100),model:text(provider.model,'provider.model',300)}),
    modelManifest:Object.freeze({schema:MANIFEST,studyId:text(manifest.studyId,'modelManifest.studyId'),trainingMethod:'DXA',validationMethod:'DXA',rightsStatus:manifest.rightsStatus}),
    outputs:normalizeOutputs(input.outputs),dataScope:DATA_SCOPE,limitations:LIMITATIONS});
}

/**
 * Build a detached composition record from an accepted provider estimate.
 * The estimate must already pass validateCompositionEstimate() against the exact approved manifest,
 * so nothing reaches storage while the gate is closed. resultId is caller-supplied so a retry is idempotent.
 */
export function prepareCompanyCompositionRecord(estimateInput,manifestInput,{resultId,subjectId,subjectScope,actorId,organizationId,consentReference,capturedAt=null,savedAt=new Date().toISOString(),retentionUntil}={}){
  const estimate=validateCompositionEstimate(estimateInput,manifestInput);
  const record=normalizeCompanyCompositionRecord({schema:COMPANY_COMPOSITION_RECORD_SCHEMA,resultId,assessmentId:estimate.assessmentId,subjectId,subjectScope,
    organizationId,createdBy:actorId,consentReference,capturedAt:capturedAt==null?estimate.createdAt:capturedAt,createdAt:estimate.createdAt,savedAt,retentionUntil,
    provider:{...estimate.provider},modelManifest:{...estimate.modelManifest},
    outputs:estimate.outputs.map(item=>({key:item.key,label:item.label,value:item.value,unit:item.unit,uncertainty:{...item.uncertainty}})),
    dataScope:DATA_SCOPE,limitations:LIMITATIONS});
  if(record.subjectId!==estimate.subjectId||record.organizationId!==estimate.organizationId)fail('COMPOSITION_SCOPE_MISMATCH','The estimate does not belong to the requested organization and subject.');
  return record;
}

function liveSession(value){
  if(!value||value.authenticated!==true)fail('AUTH_REQUIRED','An authenticated company session is required.');
  return {actorId:text(value.actorId,'actorId'),organizationId:text(value.organizationId,'organizationId'),sessionId:text(value.sessionId,'sessionId',500)};
}
const sameSession=(a,b)=>a.actorId===b.actorId&&a.organizationId===b.organizationId&&a.sessionId===b.sessionId;

/**
 * Organization-scoped composition storage. Every action re-reads the session, asks the adapter to
 * authorize the exact scope, then confirms the session did not change; a late adapter answer belonging
 * to a replaced session is discarded rather than displayed. Server-side RLS remains the real boundary.
 */
export function createCompanyCompositionStore(adapter={}){
  for(const name of ['getSession','authorize','put','get','list','remove'])if(typeof adapter[name]!=='function')fail('INVALID_ADAPTER','Adapter '+name+'() is required.');
  async function authorize(action,pointer){
    if(!ACTIONS.has(action))fail('INVALID_ACTION','Unsupported company composition action.');
    const before=liveSession(await adapter.getSession()),request={action,actorId:before.actorId,organizationId:before.organizationId,
      subjectId:text(pointer?.subjectId,'subjectId'),subjectScope:scope(pointer?.subjectScope,'subjectScope')};
    if(action!=='history')request.resultId=text(pointer?.resultId,'resultId');
    if(await adapter.authorize(clone(request),clone(before))!==true)fail('ACCESS_DENIED','The current company session is not authorized for this composition scope.');
    const after=liveSession(await adapter.getSession());
    if(!sameSession(before,after))fail('SESSION_CHANGED','The company session changed. Retry the operation.');
    return {session:before,scope:request};
  }
  async function stillCurrent(expected){const live=liveSession(await adapter.getSession());if(!sameSession(expected,live))fail('SESSION_CHANGED','The company session changed. Retry the operation.');}
  function inScope(record,gate){
    if(record.organizationId!==gate.session.organizationId||record.subjectId!==gate.scope.subjectId||record.subjectScope!==gate.scope.subjectScope)fail('ACCESS_DENIED','The returned composition result is outside the authorized scope.');
    return record;
  }
  async function load(pointer,action,asOf){
    const gate=await authorize(action,pointer),raw=await adapter.get(clone(gate.scope),clone(gate.session));
    await stillCurrent(gate.session);
    if(raw==null)fail('NOT_FOUND','The composition result was not found.');
    const record=inScope(normalizeCompanyCompositionRecord(raw),gate);
    if(record.resultId!==gate.scope.resultId)fail('ACCESS_DENIED','The returned composition result is outside the authorized scope.');
    if(Date.parse(record.retentionUntil)<=Date.parse(instant(asOf,'asOf')))fail('RETENTION_EXPIRED','The composition result passed its retention date and is no longer available.');
    const repeat=await authorize(action,pointer);
    if(!sameSession(gate.session,repeat.session))fail('SESSION_CHANGED','The company session changed. Retry the operation.');
    return record;
  }
  return Object.freeze({
    async save(estimate,manifest,options={}){
      const gate=await authorize('save',options);
      const record=prepareCompanyCompositionRecord(estimate,manifest,{...options,actorId:gate.session.actorId,organizationId:gate.session.organizationId});
      inScope(record,gate);
      if(record.resultId!==gate.scope.resultId)fail('ACCESS_DENIED','The prepared composition result is outside the authorized scope.');
      await adapter.put(clone(record),clone(gate.scope),clone(gate.session));
      await stillCurrent(gate.session);
      return clone(record);
    },
    reopen:(pointer,{asOf=new Date().toISOString()}={})=>load(pointer,'read',asOf),
    async exportRecord(pointer,{asOf=new Date().toISOString()}={}){
      const record=await load(pointer,'export',asOf),safe=record.resultId.replace(/[^a-z0-9._-]+/gi,'-').slice(0,80)||'result';
      return {filename:'body-composition-'+safe+'.json',mediaType:'application/json',content:JSON.stringify(record,null,2)+'\n',record};
    },
    async delete(pointer){
      const gate=await authorize('delete',pointer),removed=await adapter.remove(clone(gate.scope),clone(gate.session));
      await stillCurrent(gate.session);
      if(removed!==true)fail('NOT_FOUND','The composition result was not found.');
      return {schema:'PP_COMPANY_COMPOSITION_DELETE_V1',resultId:gate.scope.resultId,subjectId:gate.scope.subjectId,subjectScope:gate.scope.subjectScope,organizationId:gate.scope.organizationId,deleted:true};
    },
    async history(pointer,{asOf=new Date().toISOString()}={}){
      const now=Date.parse(instant(asOf,'asOf')),gate=await authorize('history',pointer),rows=await adapter.list(clone(gate.scope),clone(gate.session));
      await stillCurrent(gate.session);
      if(!Array.isArray(rows)||rows.length>MAX_HISTORY)fail('INVALID_COMPOSITION_RECORD','The composition history response is invalid.');
      const seen=new Set(),results=[];let expiredCount=0;
      for(const raw of rows){
        const record=inScope(normalizeCompanyCompositionRecord(raw),gate);
        if(seen.has(record.resultId))fail('INVALID_COMPOSITION_RECORD','The composition history contains duplicate result identifiers.');
        seen.add(record.resultId);
        if(Date.parse(record.retentionUntil)<=now){expiredCount++;continue;}
        results.push(record);
      }
      results.sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)||b.savedAt.localeCompare(a.savedAt)||a.resultId.localeCompare(b.resultId));
      const repeat=await authorize('history',pointer);
      if(!sameSession(gate.session,repeat.session))fail('SESSION_CHANGED','The company session changed. Retry the operation.');
      return Object.freeze({schema:COMPANY_COMPOSITION_HISTORY_SCHEMA,organizationId:gate.session.organizationId,subjectId:gate.scope.subjectId,subjectScope:gate.scope.subjectScope,
        asOf:new Date(now).toISOString(),count:results.length,expiredCount,results:Object.freeze(results),limitations:HISTORY_LIMITATIONS});
    },
  });
}
