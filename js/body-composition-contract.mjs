const MANIFEST='PP_BODY_COMPOSITION_MODEL_MANIFEST_V1',ESTIMATE='PP_BODY_COMPOSITION_ESTIMATE_V1';
const METRICS=Object.freeze({
  lean_mass_kg:{unit:'kg',min:5,max:220,label:'Lean mass'},
  fat_mass_kg:{unit:'kg',min:0,max:180,label:'Fat mass'},
  body_fat_percent:{unit:'percent',min:1,max:75,label:'Body fat'},
  skeletal_muscle_mass_kg:{unit:'kg',min:2,max:140,label:'Skeletal muscle mass'},
  bone_mineral_content_kg:{unit:'kg',min:.2,max:10,label:'Bone mineral content'},
});
const FORBIDDEN=/(^|_)(photo|photos|image|images|landmark|landmarks|mask|masks|contour|contours|mesh|meshes|geometry|geometries|vertex|vertices|face|faces)($|_)/i;
const fail=(code,message)=>{throw Object.assign(new Error(message),{name:'BodyCompositionContractError',code});};
const clean=(value,label,max=300)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_COMPOSITION_CONTRACT',label+' is invalid.');return value;};
const instant=(value,label)=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('INVALID_COMPOSITION_CONTRACT',label+' must be an ISO date.');return new Date(value).toISOString();};
function rejectCaptureFields(value){if(Array.isArray(value)){value.forEach(rejectCaptureFields);return;}if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){const normalized=key.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();if(FORBIDDEN.test(normalized))fail('CAPTURE_DATA_FORBIDDEN','Composition contracts cannot contain capture or geometry fields.');rejectCaptureFields(item);}}
const freeze=value=>Object.freeze(value);
export const BODY_COMPOSITION_METRICS=METRICS;

export function validateCompositionModelManifest(input){
  rejectCaptureFields(input);
  if(input?.schema!==MANIFEST||input.intendedUse!=='informational_longitudinal'||input.diagnosticUse!==false||!Array.isArray(input.outputs)||!input.outputs.length||input.outputs.length>Object.keys(METRICS).length)fail('INVALID_COMPOSITION_MANIFEST','Choose a supported informational, non-diagnostic model manifest.');
  const provider={id:clean(input.provider?.id,'provider.id',100),version:clean(input.provider?.version,'provider.version',100),model:clean(input.provider?.model,'provider.model',300)};
  const training=input.trainingReference,validation=input.validationReference,rights=input.rights;
  if(training?.method!=='DXA'||!Number.isInteger(training.participantCount)||training.participantCount<1||!Number.isInteger(training.ageRange?.min)||!Number.isInteger(training.ageRange?.max)||training.ageRange.min<3||training.ageRange.max>100||training.ageRange.min>=training.ageRange.max)fail('INVALID_COMPOSITION_MANIFEST','DEXA training-reference population details are required.');
  if(validation?.method!=='DXA'||validation.independentFromTraining!==true||!Number.isInteger(validation.participantCount)||validation.participantCount<1||!Number.isInteger(validation.ageRange?.min)||!Number.isInteger(validation.ageRange?.max)||validation.ageRange.min<3||validation.ageRange.max>100||validation.ageRange.min>=validation.ageRange.max)fail('INVALID_COMPOSITION_MANIFEST','Independent DEXA validation-reference details are required.');
  if(!['owned','licensed','buyer_supplied'].includes(rights?.status))fail('INVALID_COMPOSITION_MANIFEST','Model deployment rights must be documented.');
  const seen=new Set(),outputs=input.outputs.map(item=>{const key=clean(item?.key,'output key',100),definition=METRICS[key];if(!definition||seen.has(key)||item.unit!==definition.unit)fail('INVALID_COMPOSITION_MANIFEST','Composition outputs must use the supported metric dictionary.');seen.add(key);return freeze({key,unit:definition.unit,label:definition.label,definition:clean(item.definition,'output definition',1000)});});
  return freeze({schema:MANIFEST,provider:freeze(provider),intendedUse:'informational_longitudinal',diagnosticUse:false,outputs:freeze(outputs),trainingReference:freeze({method:'DXA',datasetId:clean(training.datasetId,'trainingReference.datasetId',180),participantCount:training.participantCount,ageRange:freeze({min:training.ageRange.min,max:training.ageRange.max}),completedAt:instant(training.completedAt,'trainingReference.completedAt')}),validationReference:freeze({method:'DXA',studyId:clean(validation.studyId,'validationReference.studyId',180),independentFromTraining:true,participantCount:validation.participantCount,ageRange:freeze({min:validation.ageRange.min,max:validation.ageRange.max}),completedAt:instant(validation.completedAt,'validationReference.completedAt')}),rights:freeze({status:rights.status,expiresAt:rights.expiresAt==null?null:instant(rights.expiresAt,'rights.expiresAt')}),limitations:'Provider-declared model provenance. Manifest validation does not independently verify training data, accuracy, rights or regulatory status.'});
}

export function validateCompositionEstimate(input,manifestInput){
  rejectCaptureFields(input);const manifest=validateCompositionModelManifest(manifestInput);
  if(input?.schema!==ESTIMATE||input.status!=='estimated'||input.diagnosticUse!==false||!Array.isArray(input.outputs)||!input.outputs.length||input.outputs.length>manifest.outputs.length)fail('INVALID_COMPOSITION_ESTIMATE','Choose a supported non-diagnostic composition estimate.');
  const provider={id:clean(input.provider?.id,'provider.id',100),version:clean(input.provider?.version,'provider.version',100),model:clean(input.provider?.model,'provider.model',300)};
  if(provider.id!==manifest.provider.id||provider.version!==manifest.provider.version||provider.model!==manifest.provider.model)fail('COMPOSITION_PROVIDER_MISMATCH','The estimate does not match the approved model manifest.');
  const declared=new Map(manifest.outputs.map(item=>[item.key,item])),seen=new Set(),outputs=input.outputs.map(item=>{const key=clean(item?.key,'output key',100),definition=declared.get(key),bounds=METRICS[key];if(!definition||seen.has(key)||item.unit!==definition.unit||!Number.isFinite(item.value)||item.value<bounds.min||item.value>bounds.max)fail('INVALID_COMPOSITION_ESTIMATE','A composition output is invalid or undeclared.');seen.add(key);const uncertainty=item.uncertainty;if(uncertainty?.status==='provided'){if(!Number.isFinite(uncertainty.lower)||!Number.isFinite(uncertainty.upper)||uncertainty.lower>item.value||uncertainty.upper<item.value||uncertainty.lower<bounds.min||uncertainty.upper>bounds.max)fail('INVALID_COMPOSITION_ESTIMATE','Composition uncertainty bounds are invalid.');return freeze({key,label:definition.label,value:item.value,unit:item.unit,uncertainty:freeze({status:'provided',lower:uncertainty.lower,upper:uncertainty.upper,method:clean(uncertainty.method,'uncertainty.method',180)})});}if(uncertainty?.status!=='not_provided')fail('INVALID_COMPOSITION_ESTIMATE','Each output must disclose uncertainty availability.');return freeze({key,label:definition.label,value:item.value,unit:item.unit,uncertainty:freeze({status:'not_provided'})});});
  return freeze({schema:ESTIMATE,status:'estimated',diagnosticUse:false,assessmentId:clean(input.assessmentId,'assessmentId',180),subjectId:clean(input.subjectId,'subjectId',180),organizationId:clean(input.organizationId,'organizationId',180),createdAt:instant(input.createdAt,'createdAt'),provider:freeze(provider),outputs:freeze(outputs),modelManifest:freeze({schema:manifest.schema,studyId:manifest.validationReference.studyId,trainingMethod:'DXA',validationMethod:'DXA',rightsStatus:manifest.rights.status}),limitations:'Estimated body composition from an external model. Not a DEXA measurement, diagnosis, screening result, treatment recommendation or athletic-potential score.'});
}

export function compositionUnavailableReason(manifestInput){
  if(manifestInput==null)return freeze({status:'unavailable',code:'MODEL_NOT_CONFIGURED',message:'Body composition requires a licensed model manifest with DEXA training and independent validation evidence.'});
  try{validateCompositionModelManifest(manifestInput);return freeze({status:'ready_for_provider_estimates',code:'MANIFEST_VALIDATED',message:'The manifest is structurally valid. Provider outputs still require runtime validation and independent buyer review.'});}
  catch(error){return freeze({status:'unavailable',code:error.code||'INVALID_COMPOSITION_MANIFEST',message:error.message});}
}
