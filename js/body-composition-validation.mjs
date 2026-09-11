import {BODY_COMPOSITION_METRICS,validateCompositionModelManifest} from './body-composition-contract.mjs';
const fail=message=>{throw Object.assign(new Error(message),{name:'BodyCompositionValidationError',code:'INVALID_COMPOSITION_VALIDATION'});};
const code=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(value);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const round=value=>Math.round(value*10000)/10000;
export function evaluateCompositionValidationStudy(observations,{manifest:manifestInput,maxReferenceLagDays=7}={}){
  const manifest=validateCompositionModelManifest(manifestInput),declared=new Set(manifest.outputs.map(item=>item.key));
  if(!Array.isArray(observations)||!observations.length||observations.length>100000||!Number.isInteger(maxReferenceLagDays)||maxReferenceLagDays<0||maxReferenceLagDays>30)fail('A bounded validation observation set is required.');
  const rows=[],unique=new Set();
  for(const item of observations){const bounds=BODY_COMPOSITION_METRICS[item?.metricKey],unit=bounds?.unit,key=[item?.participantCode,item?.scanId,item?.metricKey].join('|');
    if(!code(item?.participantCode)||!code(item?.scanId)||!declared.has(item?.metricKey)||item.referenceMethod!=='DXA'||item.independentFromTraining!==true||item.unit!==unit||!Number.isFinite(item.referenceValue)||!Number.isFinite(item.estimatedValue)||item.referenceValue<bounds.min||item.referenceValue>bounds.max||item.estimatedValue<bounds.min||item.estimatedValue>bounds.max||!instant(item.referenceAt)||!instant(item.estimateAt)||Math.abs(Date.parse(item.referenceAt)-Date.parse(item.estimateAt))>maxReferenceLagDays*86400000||unique.has(key))fail('Every validation row must be unique, independently referenced to DXA and within the allowed time window.');
    unique.add(key);rows.push({participantCode:item.participantCode,metricKey:item.metricKey,error:item.estimatedValue-item.referenceValue,unit});
  }
  const metrics=[];
  for(const metricKey of declared){const group=rows.filter(row=>row.metricKey===metricKey);if(!group.length)continue;const errors=group.map(row=>row.error),n=errors.length;metrics.push(Object.freeze({key:metricKey,label:BODY_COMPOSITION_METRICS[metricKey].label,unit:BODY_COMPOSITION_METRICS[metricKey].unit,observationCount:n,participantCount:new Set(group.map(row=>row.participantCode)).size,bias:round(errors.reduce((a,b)=>a+b,0)/n),mae:round(errors.reduce((a,b)=>a+Math.abs(b),0)/n),rmse:round(Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/n)),maximumAbsoluteError:round(Math.max(...errors.map(Math.abs)))}));}
  if(!metrics.length)fail('No declared composition outputs were evaluated.');
  return Object.freeze({schema:'PP_BODY_COMPOSITION_VALIDATION_REPORT_V1',status:'descriptive_not_qualified',provider:manifest.provider,studyId:manifest.validationReference.studyId,referenceMethod:'DXA',maxReferenceLagDays,participantCount:new Set(rows.map(row=>row.participantCode)).size,observationCount:rows.length,metrics:Object.freeze(metrics),limitations:'Descriptive error statistics only. This report does not establish clinical validity, population generalizability, regulatory clearance or a release threshold.'});
}
