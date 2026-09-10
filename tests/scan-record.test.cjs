const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(extra={}){let id=0;const c=vm.createContext({uuid:()=>`id-${++id}`,console,...extra});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/scan-record.js'),'utf8'),c);return c;}
const input=()=>({metrics:{wingspan:60,leg_length:28},confidence:.72,detail:{framesUsed:['front','back'],framesMissed:['left'],rejected:['torso_length'],frames:['PRIVATE'],meshUrl:'PRIVATE'},frames:'PRIVATE',meshUrl:'PRIVATE'});
const ctx=()=>({athleteId:'athlete-a',actorId:'parent-a',consentId:'consent-a',capturedAt:'2026-09-09T15:00:00Z',engine:{id:'pose',version:'1',model:'full-v1'},height:{value:59,measured_on:'2026-09-01',source:'manual'},defaultUnit:'in'});
test('record snapshots athlete, height, result and allowed provenance without retaining captures',()=>{
  const c=setup(),r=input(),x=ctx(),record=c.buildScanRecord(r,x);x.athleteId='other';x.height.value=100;r.metrics.wingspan=99;
  assert.equal(record.rows[0].athlete_id,'athlete-a');assert.equal(record.rows[0].value,60);assert.equal(record.meta.input_height.value,59);
  assert.ok(!JSON.stringify(record).includes('PRIVATE'));assert.equal(c.readScanRecord(record.rows[0]).quality.score,.72);
  assert.equal(record.rows[0].note,record.rows[1].note);assert.notEqual(record.rows[0].id,record.rows[1].id);
});
test('capture check provenance keeps only bounded status codes and no landmark data',()=>{
  const c=setup(),r=input();r.detail.captureChecks=[{view:'front',protocol:'photo-quality-v1',accepted:true,reasons:[],warnings:['headroom'],landmarks:'PRIVATE'},{view:'unrecognized',accepted:true}];
  const record=c.buildScanRecord(r,ctx());assert.equal(record.meta.quality.capture_checks.length,1);assert.equal(record.meta.quality.capture_checks[0].warnings[0],'headroom');assert.ok(!JSON.stringify(record).includes('PRIVATE'));
});
test('processing duration and exact-file-check provenance are bounded and exclude digests',()=>{
 const c=setup(),r=input(),context=ctx();context.processingMs=1245.7;r.detail.photoIdentity={protocol:'exact-photo-bytes-v1',checked_views:4,distinct_files:true,digests:['PRIVATE']};
 const record=c.buildScanRecord(r,context);assert.equal(record.meta.processing.duration_ms,1246);assert.equal(record.meta.photo_reuse_check.checked_views,4);assert.ok(!JSON.stringify(record).includes('PRIVATE'));assert.match(c.scanProcessingLabel(record.meta),/1.2 s/);
 for(const duration of [-1,Infinity,NaN,3600001,'100']){context.processingMs=duration;assert.equal(c.buildScanRecord(r,context).meta.processing,null);}
 assert.equal(c.scanProcessingLabel({processing:{duration_ms:100,protocol:'unknown'}}),'');
});
test('typed outputs reject invalid data and do not silently invent units',()=>{
  const c=setup();for(const value of [null,'60',NaN,Infinity,0,-2]) assert.throws(()=>c.buildScanRecord({metrics:{wingspan:value}},ctx()),/Invalid/);
  assert.throws(()=>c.buildScanRecord({metrics:{}},ctx()),/No measurements/);
  const x=ctx();delete x.defaultUnit;assert.throws(()=>c.buildScanRecord(input(),x),/unit/);
  assert.equal(c.buildScanRecord({metrics:{length:100},units:{length:'cm'}},x).rows[0].unit,'cm');
});
test('reader handles old notes, malformed metadata and cross-athlete notes',()=>{
  const c=setup(),record=c.buildScanRecord(input(),ctx());
  for(const note of ['On-device scan','PP_SCAN_V1:{broken','PP_SCAN_V1:'+JSON.stringify({schema:99})]) assert.equal(c.readScanRecord({note}),null);
  assert.equal(c.readScanRecord({...record.rows[0],athlete_id:'other'}),null);
});
test('comparison excludes changed engine version, changed model and legacy/new mixing',()=>{
  const c=setup(),a=c.buildScanRecord(input(),ctx()).rows[0],x=ctx();
  assert.equal(c.scanCompatibility(a,c.buildScanRecord(input(),x).rows[0]),true);
  x.engine.version='2';assert.equal(c.scanCompatibility(a,c.buildScanRecord(input(),x).rows[0]),false);
  x.engine.version='1';x.engine.model='lite';assert.equal(c.scanCompatibility(a,c.buildScanRecord(input(),x).rows[0]),false);
  assert.equal(c.scanCompatibility(a,{...a,note:'legacy'}),false);
});
test('retries preserve row IDs and use conflict-ignore; another active athlete cannot redirect save',async()=>{
  const sent=[];const c=setup({state:{user:{id:'parent-a'},active:{id:'athlete-b'}},loadScanConsent:async()=>({id:'consent-a'}),sb:{from:()=>({async upsert(rows,options){sent.push({rows,options});return {error:null}}})}});
  const record=c.buildScanRecord(input(),ctx());await c.saveScanRecord(record);await c.saveScanRecord(record);
  assert.equal(sent[0].rows[0].id,sent[1].rows[0].id);assert.equal(sent[0].rows[0].athlete_id,'athlete-a');assert.equal(sent[0].options.ignoreDuplicates,true);
});
test('revoked/replaced consent and account changes refuse a save; database failures remain retryable',async()=>{
  let writes=0;const c=setup({state:{user:{id:'parent-a'}},loadScanConsent:async()=>null,sb:{from:()=>({async upsert(){writes++;return {error:Error('offline')}}})}});
  const record=c.buildScanRecord(input(),ctx());await assert.rejects(c.saveScanRecord(record),/Permission changed/);assert.equal(writes,0);
  c.loadScanConsent=async()=>({id:'consent-a'});await assert.rejects(c.saveScanRecord(record),/offline/);assert.equal(writes,1);
  c.state.user={id:'other'};await assert.rejects(c.saveScanRecord(record),/Sign in/);assert.equal(writes,1);
});
