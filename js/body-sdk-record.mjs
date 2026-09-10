import {summarizeMeasurementResult} from './body-sdk-report.mjs';

export const COMPANY_ASSESSMENT_SCHEMA='PP_COMPANY_BODY_ASSESSMENT_V1';
const actions=new Set(['save','read','export','delete']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{name:'CompanyAssessmentError',code});};
const clone=value=>JSON.parse(JSON.stringify(value));
function id(value,label,max=180){
  if(typeof value!=='string'||value.length<1||value.length>max||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_RECORD',label+' is required.');
  return value;
}
function instant(value,label){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('INVALID_RECORD',label+' must be an ISO date.');return new Date(value).toISOString();}
function normalizeSurfaceProcessing(input,surfaceStatus){
  if(input==null)return null;
  if(input?.schema!=='PP_COMPANY_SURFACE_PROCESSING_V1'||input.status!==surfaceStatus)fail('INVALID_RECORD','The surface-processing record does not match the assessment outcome.');
  const adjustment=input.adjustment;
  if(adjustment==null)return {schema:'PP_COMPANY_SURFACE_PROCESSING_V1',status:surfaceStatus,adjustment:null};
  const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max,fraction=v=>Number.isFinite(v)&&v>=0&&v<=1;
  if(surfaceStatus!=='generated'||adjustment.protocol!=='surface-lower-artifact-removal-v1'||!integer(adjustment.componentCountBefore,2,4)||
    !integer(adjustment.originalOccupiedVoxels,100,2e6)||!integer(adjustment.removedVoxels,1,256)||adjustment.removedVoxels>=adjustment.originalOccupiedVoxels||
    !fraction(adjustment.removedFraction)||Math.abs(adjustment.removedFraction-adjustment.removedVoxels/adjustment.originalOccupiedVoxels)>1e-12||
    !fraction(adjustment.affectedFromFloorFraction)||!fraction(adjustment.affectedToFloorFraction)||adjustment.affectedFromFloorFraction>=adjustment.affectedToFloorFraction||adjustment.affectedToFloorFraction>.1)
    fail('INVALID_RECORD','The surface adjustment is invalid.');
  return {schema:'PP_COMPANY_SURFACE_PROCESSING_V1',status:surfaceStatus,adjustment:{protocol:adjustment.protocol,componentCountBefore:adjustment.componentCountBefore,
    originalOccupiedVoxels:adjustment.originalOccupiedVoxels,removedVoxels:adjustment.removedVoxels,removedFraction:adjustment.removedFraction,
    affectedFromFloorFraction:adjustment.affectedFromFloorFraction,affectedToFloorFraction:adjustment.affectedToFloorFraction}};
}
function normalizeSummary(input){
  if(input?.schema!=='PP_BODY_SDK_SUMMARY_V1'||input.unit!=='in'||!Array.isArray(input.measurements))fail('INVALID_RECORD','The stored assessment summary is unsupported.');
  try{
    const summary=summarizeMeasurementResult({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:input.sdkVersion,createdAt:input.createdAt,status:'provisional',
      outputDictionary:'body-outputs-v2',heightIn:input.height,processingMs:input.processingMs,engine:input.engine,
      measurements:input.measurements.map(m=>({key:m.key,value:m.value,unit:'in',definition:m.definition}))},{unit:'in',surfaceStatus:input.surfaceStatus});
    summary.createdAt=instant(summary.createdAt,'assessment.createdAt');return summary;
  }catch{fail('INVALID_RECORD','The stored assessment summary is invalid.');}
}
function normalizeRecord(input){
  if(input?.schema!==COMPANY_ASSESSMENT_SCHEMA)fail('INVALID_RECORD','The company assessment record is unsupported.');
  const assessment=normalizeSummary(input.assessment),capturedAt=instant(input.capturedAt,'capturedAt'),savedAt=instant(input.savedAt,'savedAt');
  const surfaceProcessing=normalizeSurfaceProcessing(input.surfaceProcessing,assessment.surfaceStatus);
  if(capturedAt!==assessment.createdAt)fail('INVALID_RECORD','The record timestamp does not match its assessment.');
  const retentionUntil=input.retentionUntil===null?null:instant(input.retentionUntil,'retentionUntil');
  return {schema:COMPANY_ASSESSMENT_SCHEMA,assessmentId:id(input.assessmentId,'assessmentId'),subjectId:id(input.subjectId,'subjectId'),
    organizationId:id(input.organizationId,'organizationId'),createdBy:id(input.createdBy,'createdBy'),consentReference:id(input.consentReference,'consentReference'),
    capturedAt,savedAt,retentionUntil,assessment,surfaceProcessing,
    dataScope:'Derived scalar measurements and optional surface-processing diagnostics only. No photos, landmarks, file fingerprints, masks, contours or geometry.',
    limitations:'Provisional photo estimates. Accuracy is unvalidated; no anatomical girths, body composition, diagnosis or maturity prediction.'};
}

/** Create a detached, allowlisted company record. The caller supplies a stable assessmentId so a retry can be idempotent. */
export function prepareCompanyAssessment(result,{assessmentId,subjectId,actorId,organizationId,consentReference,savedAt=new Date().toISOString(),retentionUntil=null,surfaceStatus='not_requested',surfaceProcessing=null}={}){
  let assessment;
  try{assessment=summarizeMeasurementResult(result,{unit:'in',surfaceStatus});}catch{fail('INVALID_ASSESSMENT','A supported provisional SDK assessment is required.');}
  return normalizeRecord({schema:COMPANY_ASSESSMENT_SCHEMA,assessmentId,subjectId,organizationId,createdBy:actorId,consentReference,
    capturedAt:assessment.createdAt,savedAt,retentionUntil,assessment,surfaceProcessing});
}

function session(value){
  if(!value||value.authenticated!==true)fail('AUTH_REQUIRED','An authenticated company session is required.');
  return {actorId:id(value.actorId,'actorId'),organizationId:id(value.organizationId,'organizationId'),sessionId:id(value.sessionId,'sessionId',500)};
}
const sameSession=(a,b)=>a.actorId===b.actorId&&a.organizationId===b.organizationId&&a.sessionId===b.sessionId;

/**
 * Bind the portable record to a company's own identity and persistence system.
 * Adapter put/get/remove operations must enforce authorization at the server or database boundary;
 * the callback checks here also prevent stale browser state from displaying or mutating records.
 */
export function createCompanyAssessmentStore(adapter={}){
  for(const name of ['getSession','authorize','put','get','remove'])if(typeof adapter[name]!=='function')fail('INVALID_ADAPTER','Adapter '+name+'() is required.');
  async function authorize(action,pointer){
    if(!actions.has(action))fail('INVALID_ACTION','Unsupported company assessment action.');
    const before=session(await adapter.getSession()),scope={action,actorId:before.actorId,organizationId:before.organizationId,
      assessmentId:id(pointer.assessmentId,'assessmentId'),subjectId:id(pointer.subjectId,'subjectId')};
    if(await adapter.authorize(clone(scope),clone(before))!==true)fail('ACCESS_DENIED','The current company session is not authorized for this assessment.');
    const after=session(await adapter.getSession());
    if(!sameSession(before,after))fail('SESSION_CHANGED','The company session changed. Retry the operation.');
    return {session:before,scope};
  }
  async function stillCurrent(expected){const live=session(await adapter.getSession());if(!sameSession(expected,live))fail('SESSION_CHANGED','The company session changed. Retry the operation.');}
  async function load(pointer,action){
    const gate=await authorize(action,pointer),raw=await adapter.get(clone(gate.scope),clone(gate.session));
    await stillCurrent(gate.session);if(raw==null)fail('NOT_FOUND','The assessment was not found.');
    const record=normalizeRecord(raw);
    if(record.organizationId!==gate.session.organizationId||record.assessmentId!==gate.scope.assessmentId||record.subjectId!==gate.scope.subjectId)fail('ACCESS_DENIED','The returned assessment is outside the authorized scope.');
    const repeat=await authorize(action,pointer);if(!sameSession(gate.session,repeat.session))fail('SESSION_CHANGED','The company session changed. Retry the operation.');
    return record;
  }
  return Object.freeze({
    async save(result,options={}){
      const pointer={assessmentId:options.assessmentId,subjectId:options.subjectId},gate=await authorize('save',pointer);
      const record=prepareCompanyAssessment(result,{...options,actorId:gate.session.actorId,organizationId:gate.session.organizationId});
      await adapter.put(clone(record),clone(gate.scope),clone(gate.session));await stillCurrent(gate.session);return clone(record);
    },
    reopen:pointer=>load(pointer,'read'),
    async exportRecord(pointer){
      const record=await load(pointer,'export'),safe=record.assessmentId.replace(/[^a-z0-9._-]+/gi,'-').slice(0,80)||'assessment';
      return {filename:'body-assessment-'+safe+'.json',mediaType:'application/json',content:JSON.stringify(record,null,2)+'\n',record};
    },
    async delete(pointer){
      const gate=await authorize('delete',pointer),removed=await adapter.remove(clone(gate.scope),clone(gate.session));
      await stillCurrent(gate.session);if(removed!==true)fail('NOT_FOUND','The assessment was not found.');
      return {schema:'PP_COMPANY_BODY_ASSESSMENT_DELETE_V1',assessmentId:gate.scope.assessmentId,subjectId:gate.scope.subjectId,organizationId:gate.scope.organizationId,deleted:true};
    },
  });
}
