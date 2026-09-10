const test=require('node:test'),assert=require('node:assert/strict');
const fixture=()=>({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.10.0',createdAt:'2026-09-09T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference-model'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:74,processingMs:1400,measurements:[{key:'wingspan',value:76.4,unit:'in',definition:'Estimated wingspan.'},{key:'left_forearm_length',value:11.2,unit:'in',definition:'Estimated left segment.'},{key:'right_forearm_length',value:11.4,unit:'in',definition:'Estimated right segment.'}],photos:['PRIVATE'],landmarks:['PRIVATE'],missingOutputs:[]});
test('summary converts units, computes same-assessment differences and preserves missing readings',async()=>{
  const {summarizeMeasurementResult}=await import('../js/body-sdk-report.mjs'),r=fixture(),s=summarizeMeasurementResult(r,{unit:'cm',surfaceStatus:'rejected'});
  assert.equal(s.outputCount,3);assert.equal(s.missingOutputs.length,22);assert.equal(s.height,187.96);assert.equal(s.measurements[0].value,76.4*2.54);
  assert.ok(Math.abs(s.pairs[1].difference-.2*2.54)<1e-10);assert.equal(s.pairs[0].difference,null);assert.ok(!JSON.stringify(s).includes('PRIVATE'));
  r.measurements[0].value=1;assert.equal(s.measurements[0].value,76.4*2.54);
});
test('invalid values, duplicate keys, unknown outputs and unsupported contracts are rejected',async()=>{
  const {summarizeMeasurementResult}=await import('../js/body-sdk-report.mjs');
  for(const mutate of [r=>r.measurements.push({...r.measurements[0]}),r=>r.measurements[0].value=NaN,r=>r.measurements[0].key='body_fat',r=>r.measurements[0].unit='cm',r=>r.status='validated',r=>r.outputDictionary='unknown',r=>r.engine=null]){const r=fixture();mutate(r);assert.throws(()=>summarizeMeasurementResult(r),{code:'INVALID_ASSESSMENT_REPORT'});}
  assert.throws(()=>summarizeMeasurementResult(fixture(),{unit:'kg'}));
});
test('printable report escapes metadata, preserves rejected reconstruction and includes no remote assets',async()=>{
  const {measurementReportHTML}=await import('../js/body-sdk-report.mjs'),r=fixture();r.engine.model='<script>alert(1)</script>';r.measurements[0].definition='<img src="https://bad.test">';
  const html=measurementReportHTML(r,{surfaceStatus:'rejected'});
  assert.match(html,/Reconstruction rejected/);assert.match(html,/3 of 25/);assert.match(html,/Not available/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.ok(!html.includes('PRIVATE'));assert.match(html,/default-src/);assert.match(html,/<details open>/);
});
test('a missing side stays absent instead of comparing against a different reading',async()=>{
  const {summarizeMeasurementResult}=await import('../js/body-sdk-report.mjs'),r=fixture();r.measurements.pop();const s=summarizeMeasurementResult(r);
  assert.equal(s.pairs[1].left,11.2);assert.equal(s.pairs[1].right,null);assert.equal(s.pairs[1].difference,null);
});
