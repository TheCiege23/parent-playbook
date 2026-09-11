const test=require('node:test'),assert=require('node:assert/strict');
function record({assessmentId='scan-2',subjectId='adult-1',organizationId='org-1',capturedAt='2026-09-10T12:00:00Z',sdkVersion='0.13.0',engineVersion='1.3.0',measurements}={}){
  const items=measurements||[{key:'wingspan',label:'Wingspan',value:76.8,unit:'in',definition:'Provisional wingspan estimate.'},{key:'leg_length',label:'Leg length',value:39.1,unit:'in',definition:'Provisional leg length estimate.'}];
  return {schema:'PP_COMPANY_BODY_ASSESSMENT_V1',assessmentId,subjectId,organizationId,capturedAt,assessment:{schema:'PP_BODY_SDK_SUMMARY_V1',sdkVersion,status:'provisional',unit:'in',engine:{id:'ondevice-pose',version:engineVersion,model:'pose-model'},outputCount:items.length,measurements:items}};
}
test('company history compares same-subject compatible scalar records in capture order',async()=>{
  const {compareCompanyAssessmentRecords}=await import('../js/body-sdk-reference-history.mjs');
  const older=record({assessmentId:'scan-1',capturedAt:'2026-08-10T12:00:00Z',measurements:[{key:'wingspan',label:'Wingspan',value:76.4,unit:'in',definition:'Provisional wingspan estimate.'},{key:'shoulder_width',label:'Shoulder width',value:14.6,unit:'in',definition:'Provisional shoulder estimate.'}]}),newer=record();
  const result=compareCompanyAssessmentRecords(newer,older);assert.equal(result.baseline.assessmentId,'scan-1');assert.equal(result.current.assessmentId,'scan-2');assert.equal(result.comparableOutputCount,1);
  assert.ok(Math.abs(result.measurements[0].change-.4)<1e-10);assert.equal(result.measurements[0].key,'wingspan');assert.equal(result.status,'descriptive_only');
  for(const forbidden of ['photos','landmarks','geometry','mesh','contours'])assert.equal(result[forbidden],undefined);
});
test('company history rejects identity, engine, duplicate, timestamp and scalar conflicts',async()=>{
  const {compareCompanyAssessmentRecords}=await import('../js/body-sdk-reference-history.mjs'),base=record({assessmentId:'scan-1',capturedAt:'2026-08-10T12:00:00Z'});
  for(const other of [record({subjectId:'adult-2'}),record({organizationId:'org-2'}),record({engineVersion:'2'}),record({assessmentId:'scan-1'}),record({capturedAt:'2026-08-10T12:00:00Z'}),record({measurements:[{key:'other',label:'Other',value:1,unit:'in',definition:'Different output.'}]})])assert.throws(()=>compareCompanyAssessmentRecords(base,other),/assessment|organization|adult|engine|capture|comparable/i);
  const invalid=record();invalid.assessment.measurements[0].value=NaN;assert.throws(()=>compareCompanyAssessmentRecords(base,invalid),/measurement/i);
});
test('comparison CSV preserves signed change, escapes formulas and excludes capture data',async()=>{
  const {compareCompanyAssessmentRecords,companyAssessmentComparisonCSV}=await import('../js/body-sdk-reference-history.mjs'),base=record({assessmentId:'scan-1',subjectId:'=adult',capturedAt:'2026-08-10T12:00:00Z'}),result=compareCompanyAssessmentRecords(base,record({subjectId:'=adult'})),csv=companyAssessmentComparisonCSV(result);
  assert.match(csv,/"'=adult"/);assert.match(csv,/descriptive provisional difference only/);assert.match(csv,/wingspan/);for(const forbidden of ['photo','landmark','geometry','mesh'])assert.ok(!csv.includes(forbidden));
});
