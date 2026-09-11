const RECORD='PP_COMPANY_BODY_ASSESSMENT_V1',SUMMARY='PP_BODY_SDK_SUMMARY_V1';
const fail=message=>{throw Object.assign(new Error(message),{name:'CompanyAssessmentComparisonError',code:'INVALID_ASSESSMENT_COMPARISON'});};
const validText=(value,max=300)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function normalizedRecord(input){
  const summary=input?.assessment;
  if(input?.schema!==RECORD||!validText(input.assessmentId,180)||!validText(input.subjectId,180)||!validText(input.organizationId,180)||!instant(input.capturedAt)||
    summary?.schema!==SUMMARY||summary.status!=='provisional'||!['in','cm'].includes(summary.unit)||!validText(summary.sdkVersion,40)||!validText(summary.engine?.id,100)||
    !validText(summary.engine?.version,100)||!validText(summary.engine?.model,300)||!Array.isArray(summary.measurements)||summary.measurements.length>25||summary.outputCount!==summary.measurements.length)fail('Choose two supported company assessment records.');
  const measurements=new Map();
  for(const item of summary.measurements){
    if(!validText(item?.key,100)||measurements.has(item.key)||!validText(item.label||item.key,180)||item.unit!==summary.unit||!Number.isFinite(item.value)||item.value<=0||!validText(item.definition,2000))fail('A stored scalar measurement is invalid.');
    measurements.set(item.key,{key:item.key,label:item.label||item.key,value:item.value,unit:item.unit,definition:item.definition});
  }
  return {assessmentId:input.assessmentId,subjectId:input.subjectId,organizationId:input.organizationId,capturedAt:new Date(input.capturedAt).toISOString(),sdkVersion:summary.sdkVersion,engine:{...summary.engine},unit:summary.unit,measurements};
}

/** Compare two independently saved scalar records for one subject. No accuracy or causation is inferred. */
export function compareCompanyAssessmentRecords(left,right){
  let first=normalizedRecord(left),second=normalizedRecord(right);
  if(first.assessmentId===second.assessmentId)fail('Choose two different assessments.');
  if(first.subjectId!==second.subjectId||first.organizationId!==second.organizationId)fail('Assessments must belong to the same organization and adult reference.');
  if(first.capturedAt>second.capturedAt)[first,second]=[second,first];
  if(first.capturedAt===second.capturedAt)fail('Assessment capture times must be different.');
  if(first.sdkVersion!==second.sdkVersion||first.unit!==second.unit||first.engine.id!==second.engine.id||first.engine.version!==second.engine.version||first.engine.model!==second.engine.model)fail('Assessments use incompatible SDK or engine versions.');
  const measurements=[];
  for(const [key,current] of second.measurements){
    const baseline=first.measurements.get(key);if(!baseline)continue;
    const change=current.value-baseline.value;
    measurements.push({key,label:current.label,unit:current.unit,baseline:baseline.value,current:current.value,change,absoluteChange:Math.abs(change),definition:current.definition});
  }
  if(!measurements.length)fail('The assessments have no comparable scalar outputs.');
  return Object.freeze({schema:'PP_COMPANY_ASSESSMENT_COMPARISON_V1',status:'descriptive_only',organizationId:first.organizationId,subjectId:first.subjectId,unit:first.unit,
    sdkVersion:first.sdkVersion,engine:first.engine,baseline:{assessmentId:first.assessmentId,capturedAt:first.capturedAt,outputCount:first.measurements.size},
    current:{assessmentId:second.assessmentId,capturedAt:second.capturedAt,outputCount:second.measurements.size},comparableOutputCount:measurements.length,measurements,
    limitations:'Descriptive difference between two provisional photo estimates. No accuracy, significance, causation, growth, diagnosis or athletic-potential claim.'});
}

export function companyAssessmentComparisonCSV(comparison){
  if(comparison?.schema!=='PP_COMPANY_ASSESSMENT_COMPARISON_V1'||!Array.isArray(comparison.measurements)||!comparison.measurements.length)fail('Choose a validated company assessment comparison.');
  const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
  const header=['organization_id','subject_reference','baseline_assessment_id','baseline_captured_at','current_assessment_id','current_captured_at','sdk_version','engine','engine_version','metric_key','metric','baseline','current','change','absolute_change','unit','interpretation'];
  const rows=comparison.measurements.map(item=>[comparison.organizationId,comparison.subjectId,comparison.baseline.assessmentId,comparison.baseline.capturedAt,comparison.current.assessmentId,comparison.current.capturedAt,
    comparison.sdkVersion,comparison.engine.id,comparison.engine.version,item.key,item.label,item.baseline,item.current,item.change,item.absoluteChange,item.unit,'descriptive provisional difference only']);
  return [header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
