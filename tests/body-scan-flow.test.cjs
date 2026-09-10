const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
  let id=0;const observed={};
  const c=vm.createContext({console:{...console,error:error=>{observed.loggedError=error}},uuid:()=>`uuid-${++id}`,state:{user:{id:'parent'},active:{id:'a'}},ageFrom:()=>12,H:(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),''),sheet:()=>({querySelector:()=>({}),remove(){}}),URL:{revokeObjectURL(){}}});
  for(const file of ['scan-record','body-scan'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8'),c);
  c.observed=observed;
  vm.runInContext(`
    bsMarkActive=()=>{};
    loadScanConsent=async()=>({id:'consent'});
    bsResult=(result,subject,record)=>{observed.record=record;observed.subject=subject;observed.result=result};
    bsFailed=error=>{observed.error=error};
    bsRefuse=reason=>{observed.refused=reason};
    BS.subject={id:'a',first_name:'First',birthdate:'2014-01-01'};
    BS.frames={front:{test:true},back:{test:true}};BS.consent=true;
    BS.heightIn=60;BS.heightReference={value:60,measured_on:'2026-09-01',source:'manual'};
    registerBodyProvider({id:'ondevice-pose',version:'1',model:'full',defaultUnit:'in',async measure(args){observed.input=args;return {metrics:{wingspan:61},confidence:.7,detail:{framesUsed:['front','back']}}}});
  `,c);
  return {c,observed};
}
test('actual scan orchestration produces a provenance record and discards frame state',async()=>{
  const {c,observed}=setup();let tick=0;c.performance={now:()=>{tick+=275;return tick;}};await c.bsRun();assert.equal(observed.record.rows[0].athlete_id,'a');assert.equal(observed.input.heightIn,60);
  assert.equal(observed.record.meta.processing.duration_ms,275);assert.equal(observed.record.meta.processing.protocol,'provider-wall-time-v1');
  assert.equal(observed.record.meta.consent_id,'consent');assert.equal(vm.runInContext('Object.keys(BS.frames).length',c),0);assert.equal(vm.runInContext('BS.consent',c),false);
});
test('changing active profile during inference does not redirect the result',async()=>{
  const {c,observed}=setup();vm.runInContext(`BODY_PROVIDER.measure=async args=>{state.active={id:'b'};BS.subject={id:'b'};return {metrics:{wingspan:61},detail:{}}}`,c);
  await c.bsRun();assert.equal(observed.record.rows[0].athlete_id,'a');assert.equal(observed.subject.id,'a');
});
test('account changes or replacement capture before inference prevent processing',async()=>{
  for(const change of ["state.user=null","BS.frames={front:{newCapture:true}}"]){
    const {c,observed}=setup();vm.runInContext(`loadScanConsent=async()=>{${change};return {id:'consent'}}`,c);await c.bsRun();assert.ok(observed.refused);assert.equal(observed.input,undefined);
  }
});
test('logout during inference hides completed private results',async()=>{
  const {c,observed}=setup();vm.runInContext(`BODY_PROVIDER.measure=async()=>{state.user=null;return {metrics:{wingspan:61}}}`,c);await c.bsRun();assert.equal(observed.record,undefined);
});
test('failed inference discards frames and cannot produce a save payload',async()=>{
  const {c,observed}=setup();vm.runInContext(`BODY_PROVIDER.measure=async()=>{throw new Error('no_pose')}`,c);await c.bsRun();assert.equal(observed.error.message,'no_pose');assert.equal(observed.record,undefined);assert.equal(vm.runInContext('Object.keys(BS.frames).length',c),0);
});

test('optional reconstruction uses the captured height and photos but cannot enter saved provenance',async()=>{
  const {c,observed}=setup();let beforeCleanup,permission;
  c.bsReviewSurface=async options=>{beforeCleanup=Object.keys(options.frames).length;assert.equal(options.heightM,60*.0254);permission=await options.authorize();return {mesh:{vertices:[[0,1,0]],faces:[[0,0,0]]},secret:'PRIVATE_GEOMETRY'};};
  vm.runInContext('BS.surfaceRequested=true',c);await c.bsRun();assert.equal(beforeCleanup,2);assert.equal(permission,true);
  assert.equal(observed.result.surface.secret,'PRIVATE_GEOMETRY');assert.ok(!JSON.stringify(observed.record).includes('PRIVATE_GEOMETRY'));assert.ok(!JSON.stringify(observed.record).includes('vertices'));
  assert.equal(Object.keys(observed.input.frames).length,0);assert.equal(vm.runInContext('BS.surfaceRequested',c),false);
});
test('optional reconstruction stays off by default and skipping or failure preserves measurements',async()=>{
  for(const mode of ['off','skip','failure']){
    const {c,observed}=setup();let calls=0;c.bsReviewSurface=async()=>{calls++;if(mode==='failure')throw Error('GPU');return null;};
    if(mode!=='off')vm.runInContext('BS.surfaceRequested=true',c);await c.bsRun();assert.equal(calls,mode==='off'?0:1);assert.equal(observed.record.rows[0].value,61);
    if(mode!=='off')assert.match(observed.result.surfaceNotice,/skipped|could not finish/);
  }
});
test('withdrawal during surface work or dismissal during measurement prevents a late result',async()=>{
  const s=setup();s.c.bsReviewSurface=async options=>{s.c.loadScanConsent=async()=>null;assert.equal(await options.authorize(),false);throw Object.assign(Error('Withdrawn'),{name:'AbortError'});};vm.runInContext('BS.surfaceRequested=true',s.c);await s.c.bsRun();assert.equal(s.observed.record,undefined);assert.equal(vm.runInContext('Object.keys(BS.frames).length',s.c),0);
  const t=setup();let loading;t.c.sheet=()=>loading={querySelector:()=>({}),remove(){}};vm.runInContext('BODY_PROVIDER.measure=async()=>{dismiss();return {metrics:{wingspan:61}}}',t.c);t.c.dismiss=()=>loading.remove();await t.c.bsRun();assert.equal(t.observed.record,undefined);assert.equal(vm.runInContext('Object.keys(BS.frames).length',t.c),0);
});
