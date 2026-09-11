const test=require('node:test'),assert=require('node:assert/strict');
function manifest(){return {schema:'PP_BODY_COMPOSITION_MODEL_MANIFEST_V1',provider:{id:'licensed-provider',version:'1.0.0',model:'dexa-model-v1'},intendedUse:'informational_longitudinal',diagnosticUse:false,outputs:[{key:'lean_mass_kg',unit:'kg',definition:'Estimated whole-body lean mass.'},{key:'body_fat_percent',unit:'percent',definition:'Estimated whole-body fat percentage.'},{key:'bone_mineral_content_kg',unit:'kg',definition:'Estimated bone mineral content.'}],trainingReference:{method:'DXA',datasetId:'training-cohort-v1',participantCount:800,ageRange:{min:8,max:22},completedAt:'2026-01-01T00:00:00Z'},validationReference:{method:'DXA',studyId:'independent-study-v1',independentFromTraining:true,participantCount:200,ageRange:{min:8,max:22},completedAt:'2026-06-01T00:00:00Z'},rights:{status:'licensed',expiresAt:'2028-01-01T00:00:00Z'}};}
function estimate(){return {schema:'PP_BODY_COMPOSITION_ESTIMATE_V1',status:'estimated',diagnosticUse:false,assessmentId:'scan-001',subjectId:'adult-001',organizationId:'org-001',createdAt:'2026-09-10T12:00:00Z',provider:{id:'licensed-provider',version:'1.0.0',model:'dexa-model-v1'},outputs:[{key:'lean_mass_kg',value:61.2,unit:'kg',uncertainty:{status:'provided',lower:58,upper:64.4,method:'model-interval-v1'}},{key:'body_fat_percent',value:18.5,unit:'percent',uncertainty:{status:'not_provided'}}]};}
test('composition manifest requires DEXA provenance, independent validation and deployment rights',async()=>{
  const {validateCompositionModelManifest}=await import('../js/body-composition-contract.mjs'),result=validateCompositionModelManifest(manifest());
  assert.equal(result.trainingReference.method,'DXA');assert.equal(result.validationReference.independentFromTraining,true);assert.equal(result.rights.status,'licensed');assert.equal(result.outputs.length,3);assert.match(result.limitations,/does not independently verify/i);
  for(const change of [m=>m.trainingReference.method='BIA',m=>m.validationReference.independentFromTraining=false,m=>m.rights.status='unknown',m=>m.outputs.push({...m.outputs[0]}),m=>m.outputs[0].unit='lb']){const bad=manifest();change(bad);assert.throws(()=>validateCompositionModelManifest(bad));}
});
test('composition estimate is bound to the declared provider and exposes only supported scalars',async()=>{
  const {validateCompositionEstimate}=await import('../js/body-composition-contract.mjs'),result=validateCompositionEstimate(estimate(),manifest());
  assert.equal(result.outputs.length,2);assert.equal(result.outputs[0].label,'Lean mass');assert.equal(result.modelManifest.trainingMethod,'DXA');assert.match(result.limitations,/Not a DEXA measurement/i);
  for(const forbidden of ['photos','landmarks','geometry','mesh','images'])assert.equal(result[forbidden],undefined);
  const mismatch=estimate();mismatch.provider.model='other';assert.throws(()=>validateCompositionEstimate(mismatch,manifest()),/approved model/);
  const range=estimate();range.outputs[0].value=999;assert.throws(()=>validateCompositionEstimate(range,manifest()),/invalid/);
  const bounds=estimate();bounds.outputs[0].uncertainty.lower=70;assert.throws(()=>validateCompositionEstimate(bounds,manifest()),/uncertainty/);
});
test('composition contracts reject capture fields at any nesting depth and never fabricate readiness',async()=>{
  const {validateCompositionModelManifest,validateCompositionEstimate,compositionUnavailableReason}=await import('../js/body-composition-contract.mjs');
  const badManifest=manifest();badManifest.provider.photoModel='hidden';assert.throws(()=>validateCompositionModelManifest(badManifest),/capture or geometry/);
  const badEstimate=estimate();badEstimate.extra={mesh:{value:'x'}};assert.throws(()=>validateCompositionEstimate(badEstimate,manifest()),/capture or geometry/);
  assert.equal(compositionUnavailableReason(null).code,'MODEL_NOT_CONFIGURED');assert.equal(compositionUnavailableReason(manifest()).status,'ready_for_provider_estimates');
});
test('independent DEXA study reports descriptive participant-aware errors without a pass claim',async()=>{
  const {evaluateCompositionValidationStudy}=await import('../js/body-composition-validation.mjs'),rows=[
    {participantCode:'person_001',scanId:'scan_001',metricKey:'lean_mass_kg',referenceMethod:'DXA',independentFromTraining:true,unit:'kg',referenceValue:60,estimatedValue:62,referenceAt:'2026-09-09T12:00:00Z',estimateAt:'2026-09-10T12:00:00Z'},
    {participantCode:'person_001',scanId:'scan_002',metricKey:'lean_mass_kg',referenceMethod:'DXA',independentFromTraining:true,unit:'kg',referenceValue:61,estimatedValue:60,referenceAt:'2026-09-09T12:00:00Z',estimateAt:'2026-09-10T12:00:00Z'},
    {participantCode:'person_002',scanId:'scan_003',metricKey:'body_fat_percent',referenceMethod:'DXA',independentFromTraining:true,unit:'percent',referenceValue:20,estimatedValue:23,referenceAt:'2026-09-10T12:00:00Z',estimateAt:'2026-09-10T12:00:00Z'},
  ],report=evaluateCompositionValidationStudy(rows,{manifest:manifest()});
  assert.equal(report.participantCount,2);assert.equal(report.observationCount,3);const lean=report.metrics.find(x=>x.key==='lean_mass_kg');assert.equal(lean.observationCount,2);assert.equal(lean.participantCount,1);assert.equal(lean.bias,.5);assert.equal(lean.mae,1.5);assert.equal(lean.rmse,Math.round(Math.sqrt(2.5)*10000)/10000);assert.equal(report.status,'descriptive_not_qualified');assert.match(report.limitations,/does not establish/i);
});
test('DEXA study rejects duplicates, PII-like codes, wrong methods and stale references',async()=>{
  const {evaluateCompositionValidationStudy}=await import('../js/body-composition-validation.mjs'),base={participantCode:'person_001',scanId:'scan_001',metricKey:'lean_mass_kg',referenceMethod:'DXA',independentFromTraining:true,unit:'kg',referenceValue:60,estimatedValue:62,referenceAt:'2026-09-09T12:00:00Z',estimateAt:'2026-09-10T12:00:00Z'};
  for(const rows of [[base,base],[{...base,participantCode:'person@example.com'}],[{...base,referenceMethod:'BIA'}],[{...base,independentFromTraining:false}],[{...base,estimateAt:'2026-10-10T12:00:00Z'}]])assert.throws(()=>evaluateCompositionValidationStudy(rows,{manifest:manifest()}),/unique|DXA|time window/i);
});
