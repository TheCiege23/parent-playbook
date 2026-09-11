import {summarizeMeasurementResult} from './body-sdk-report.mjs';

const TOP=new Set(['schema','assessmentId','subjectId','organizationId','createdBy','consentReference','capturedAt','savedAt','retentionUntil','assessment','surfaceProcessing','dataScope','limitations']);
const FORBIDDEN=/(^|_)(photo|photos|image|images|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces|digest|digests|fingerprint|fingerprints)($|_)/i;
const fail=message=>{throw Object.assign(new Error(message),{name:'AdultReferenceImportError',code:'INVALID_REFERENCE_EXPORT'});};
function normalizedKey(key){return String(key).replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();}
function rejectForbidden(value){
  if(Array.isArray(value)){for(const item of value)rejectForbidden(item);return;}
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){if(FORBIDDEN.test(normalizedKey(key)))fail('The file contains a forbidden capture or geometry field.');rejectForbidden(item);}
}
export function importAdultReferenceRecord(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.schema!=='PP_COMPANY_BODY_ASSESSMENT_V1')fail('Choose a supported Parent Playbook company assessment JSON file.');
  for(const key of Object.keys(input))if(!TOP.has(key))fail('The company assessment contains an unsupported field.');
  rejectForbidden(input);
  const source=input.assessment;
  if(!source||source.schema!=='PP_BODY_SDK_SUMMARY_V1'||source.unit!=='in'||source.status!=='provisional'||!Array.isArray(source.measurements))fail('The company assessment summary is unsupported.');
  let summary;
  try{summary=summarizeMeasurementResult({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:source.sdkVersion,createdAt:source.createdAt,status:'provisional',
    engine:source.engine,outputDictionary:'body-outputs-v2',heightIn:source.height,processingMs:source.processingMs,
    measurements:source.measurements.map(item=>({key:item.key,value:item.value,unit:item.unit,definition:item.definition}))},{unit:'in',surfaceStatus:source.surfaceStatus});}
  catch{fail('The scalar assessment values or provenance are invalid.');}
  if(summary.measurements.length!==source.measurements.length||summary.outputCount!==source.outputCount)fail('The recorded output count does not match the validated scalar assessment.');
  const result={schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:source.sdkVersion,createdAt:summary.createdAt,status:'provisional',engine:{...source.engine},
    outputDictionary:'body-outputs-v2',heightIn:source.height,processingMs:source.processingMs,
    measurements:summary.measurements.map(item=>({key:item.key,value:item.value,unit:'in',definition:item.definition}))};
  return Object.freeze({sourceAssessmentId:String(input.assessmentId||''),sourceSubjectId:String(input.subjectId||''),result,summary});
}

export function parseAdultReferenceExport(text){
  if(typeof text!=='string'||!text.trim()||text.length>2_000_000)fail('The selected JSON file is empty or too large.');
  let value;try{value=JSON.parse(text);}catch{fail('The selected file is not valid JSON.');}
  return importAdultReferenceRecord(value);
}
