const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(extra={}){const c=vm.createContext({Date,Number,Math,isFinite,Map,JSON,...extra});for(const f of ['dates.js','maturity.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+f),'utf8'),c);return c;}
const male={sex:'male',birthdate:'2012-09-09',measuredOn:'2026-09-09',heightIn:68,sittingHeightIn:35,weightLb:140};

test('combined-sample Mirwald equations use documented metric inputs and return bounded provenance',()=>{
  const c=setup(),m=c.maturityOffsetEstimate(male),f=c.maturityOffsetEstimate({sex:'female',birthdate:'2013-09-09',measuredOn:'2026-09-09',heightIn:64,sittingHeightIn:33,weightLb:115});
  assert.deepEqual(JSON.parse(JSON.stringify(m)),{protocol:'mirwald-maturity-offset-v1',method:'mirwald-combined-2002',measuredOn:'2026-09-09',sex:'male',ageYears:14,offsetYears:.65,ageAtPhvYears:13.35,uncertaintyYears:1,category:'estimated_near_phv',inputs:{heightIn:68,sittingHeightIn:35,weightLb:140}});
  assert.equal(f.offsetYears,1.15);assert.equal(f.ageAtPhvYears,11.85);assert.equal(f.category,'estimated_post_phv');
});

test('maturity offset refuses missing sex, bad dates, ages outside the study range and implausible dimensions',()=>{
  const c=setup();
  for(const change of [{sex:null},{birthdate:'2012-02-30'},{measuredOn:'2026-02-30'},{birthdate:'2020-09-09'},{heightIn:0},{heightIn:50,sittingHeightIn:51},{sittingHeightIn:10},{weightLb:5}])assert.equal(c.maturityOffsetEstimate({...male,...change}),null);
});

test('same-session input batches cannot silently mix dates, duplicate metrics or unversioned rows',()=>{
  const c=setup(),note=JSON.stringify({schema:'PP_MATURITY_INPUT_V1',batchId:'batch-12345678',method:'parent_manual_same_session'}),row=(metric_key,value,extra={})=>({metric_key,value,unit:metric_key==='weight'?'lb':'in',source:'manual',measured_on:'2026-09-09',created_at:'2026-09-09T12:00:00Z',note,...extra});
  const rows=[row('height',68),row('sitting_height',35),row('weight',140)],batch=c.maturityInputBatch(rows);
  assert.equal(batch.batchId,'batch-12345678');assert.equal(batch.height.value,68);assert.equal(batch.weight.value,140);
  assert.equal(c.maturityInputBatch([...rows,row('height',69)]),null);
  assert.equal(c.maturityInputBatch(rows.map((r,i)=>i===2?{...r,measured_on:'2026-09-08'}:r)),null);
  assert.equal(c.maturityInputBatch(rows.map(r=>({...r,note:''}))),null);
});

test('maturity report derives the estimate only from a complete versioned batch',()=>{
  const c=setup(),note=JSON.stringify({schema:'PP_MATURITY_INPUT_V1',batchId:'batch-abcdefgh'}),rows=[['height',68],['sitting_height',35],['weight',140]].map(([metric_key,value])=>({metric_key,value,unit:metric_key==='weight'?'lb':'in',source:'manual',measured_on:'2026-09-09',created_at:'2026-09-09T12:00:00Z',note}));
  assert.equal(c.maturityReport({sex_at_birth:'male',birthdate:'2012-09-09'},rows,null).maturityOffset.offsetYears,.65);
  assert.equal(c.maturityReport({sex_at_birth:'male',birthdate:'2012-09-09'},rows.slice(0,2),null).maturityOffset,null);
});

test('parent input sheet saves one coherent three-measurement batch and refreshes Growth',async()=>{
  const elements={},saved=[],renders=[];let removed=false,seq=0;
  const el=id=>elements[id]??={value:'',textContent:'',disabled:false,innerHTML:''};
  const bg={querySelector:el,remove(){removed=true;}};
  const c=setup({H:(strings,...values)=>strings.reduce((s,x,i)=>s+x+(values[i]??''),''),esc:String,fmtDate:String,ageFrom:()=>14,
    state:{canEdit:true,active:{id:'athlete-1',first_name:'Alex'},user:{id:'parent-1'}},sheet:()=>bg,uuid:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,
    sb:{from:()=>({insert:async rows=>{saved.push(...rows);return {error:null};}})},renderApp:x=>renders.push(x)});
  c.openMaturityInputs({sex_at_birth:'male',birthdate:'2012-09-09'},[]);
  el('#moHeight').value='68';el('#moSitting').value='35';el('#moWeight').value='140';await el('#moSave').onclick({target:el('#moSave')});
  assert.equal(saved.length,3);assert.deepEqual(saved.map(x=>x.metric_key),['height','sitting_height','weight']);assert.equal(new Set(saved.map(x=>x.note)).size,1);
  const note=JSON.parse(saved[0].note);assert.equal(note.schema,'PP_MATURITY_INPUT_V1');assert.match(note.batchId,/^[a-f0-9-]{36}$/);assert.equal(removed,true);assert.deepEqual(renders,['growth']);
});
