const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const sdk = import('../js/body-sdk.mjs');
const frame = () => new Blob(['image'], {type:'image/jpeg'});
const options = () => ({permissionAcknowledged:true, heightIn:70, frames:Object.fromEntries(['front','right','back','left'].map(v => [v,frame()]))});
function workers(t) {
  const original = global.Worker, created = [];
  global.Worker = class {
    constructor(url) { this.url = url; this.terminated = 0; created.push(this); }
    postMessage(data) {this.sent = data;}
    terminate() {this.terminated++;}
    emit(data) {this.onmessage?.({data});}
  };
  t.after(() => {global.Worker = original;}); return created;
}
test('SDK rejects invalid input and permission before starting a worker', async t => {
  const created = workers(t), {createBodyScanner} = await sdk, scanner = createBodyScanner();
  for (const [input,code] of [[{},'PERMISSION_REQUIRED'],[{...options(),heightIn:NaN},'INVALID_HEIGHT'],[{...options(),frames:{}},'INVALID_PHOTO']])
    await assert.rejects(scanner.scan(input), {code});
  await assert.rejects(scanner.reviewPhoto({permissionAcknowledged:true,view:'other',frame:frame()}),{code:'INVALID_VIEW'});
  await assert.rejects(scanner.reviewPhoto({permissionAcknowledged:true,view:'front',frame:new Blob(['x'],{type:'text/plain'})}),{code:'INVALID_PHOTO'});
  assert.equal(created.length,0);
});
test('HEIC originals are accepted for on-device worker import, including files without MIME types',async t=>{
  const created=workers(t),{createBodyScanner}=await sdk,scanner=createBodyScanner();
  for(const frame of [new Blob(['heic'],{type:'image/heic'}),new File(['heic'],'IMG.HEIC',{type:''})]){
    const pending=scanner.reviewPhoto({frame,view:'front',permissionAcknowledged:true});assert.equal(created.at(-1).sent.frame,frame);
    created.at(-1).emit({type:'result',result:{accepted:true}});assert.equal((await pending).accepted,true);
  }
  assert.equal(created.length,2);
});
test('capture failures expose only bounded view/reason diagnostics to the host',async t=>{
  const created=workers(t),{createBodyScanner}=await sdk,scanner=createBodyScanner(),pending=scanner.scan(options());
  created[0].emit({type:'error',code:'CAPTURE_QUALITY',message:'Photo checks failed.',captureChecks:[{view:'front',accepted:false,reasons:['frame_edge',{pixels:'secret'},'secret data'],photo:'secret'},{view:'unknown',reasons:['no_person']},{view:'back',accepted:true,reasons:[]}]});
  await assert.rejects(pending,error=>{assert.equal(error.code,'CAPTURE_QUALITY');assert.deepEqual(error.captureChecks,[{view:'front',accepted:false,reasons:['frame_edge']},{view:'back',accepted:true,reasons:[]}]);assert.ok(!JSON.stringify(error.captureChecks).includes('secret'));return true;});
});
test('SDK isolates payload, returns worker result and releases resources; progress callback errors do not strand it', async t => {
  const created = workers(t), {createBodyScanner} = await sdk, scanner = createBodyScanner();
  const promise = scanner.scan({...options(),athleteSecret:'do not send',onProgress(){throw Error('consumer error');}});
  const worker = created[0]; assert.ok(worker.url.pathname.endsWith('/js/body-sdk-worker.js')); assert.equal(worker.sent.athleteSecret,undefined);
  await assert.rejects(scanner.scan(options()),{code:'BUSY'});
  worker.emit({type:'progress',message:'Loading'}); worker.emit({type:'result',result:{schema:'test'}});
  assert.deepEqual(await promise,{schema:'test'}); assert.equal(worker.terminated,1); assert.equal(worker.onmessage,null);
  const next = scanner.reviewPhoto({permissionAcknowledged:true,view:'front',frame:frame()});
  created[1].emit({type:'error',code:'PROCESSING_FAILED',message:'failed'}); await assert.rejects(next,{code:'PROCESSING_FAILED'}); assert.equal(created[1].terminated,1);
});
test('SDK abort terminates in-flight computation, ignores stale output and permits a fresh request', async t => {
  const created = workers(t), {createBodyScanner} = await sdk, scanner = createBodyScanner(), abort = new AbortController();
  const promise = scanner.scan({...options(),signal:abort.signal}); const stale = created[0].onmessage;
  abort.abort(); await assert.rejects(promise,{name:'AbortError',code:'ABORTED'}); assert.equal(created[0].terminated,1);
  const next = scanner.scan(options()); stale({data:{type:'result',result:'stale'}});
  await assert.rejects(scanner.scan(options()),{code:'BUSY'});
  created[1].emit({type:'result',result:'fresh'}); assert.equal(await next,'fresh');
  await assert.rejects(scanner.scan({...options(),signal:abort.signal}),{code:'ABORTED'}); assert.equal(created.length,2);
});
test('SDK dispose and worker failures release the worker and prevent reuse after disposal', async t => {
  const created = workers(t), {createBodyScanner} = await sdk, scanner = createBodyScanner();
  const failed = scanner.scan(options()); created[0].onerror({preventDefault(){}}); await assert.rejects(failed,{code:'WORKER_FAILED'});
  const pending = scanner.scan(options()); scanner.dispose(); await assert.rejects(pending,{code:'ABORTED'});
  await assert.rejects(scanner.scan(options()),{code:'DISPOSED'}); assert.equal(created[1].terminated,1);
});
test('SDK timeout terminates hung inference and allows retry', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const created = workers(t), {createBodyScanner} = await sdk, scanner = createBodyScanner({timeoutMs:1000});
  const request = scanner.scan(options()); const check = assert.rejects(request,{code:'TIMEOUT'});
  t.mock.timers.tick(1000); await check; assert.equal(created[0].terminated,1);
  const retry = scanner.scan(options()); created[1].emit({type:'result',result:'ok'}); assert.equal(await retry,'ok');
});
function workerContext(extra = {}) {
  const messages = [], c = vm.createContext({Blob,crypto:require('node:crypto').webcrypto,performance,Date,
    self:{postMessage:message => messages.push(message)}, ...extra});
  c.importScripts = (...files) => {for(const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),c);};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/body-sdk-worker.js'),'utf8'),c);
  return {c,messages};
}
test('worker uses real provider registration and only exports documented length fields', () => {
  const {c} = workerContext();
  const output = c.sdkScanResult({heightIn:70,metrics:{wingspan:70,body_fat:15,leg_length:NaN},photos:'secret',landmarks:['secret'],
    detail:{captureChecks:[{view:'front',protocol:'q',accepted:true,reasons:[],warnings:[],landmarks:'secret'}]}},123);
  assert.equal(output.schema,'PP_BODY_SDK_RESULT_V1'); assert.equal(output.engine.version,'1.3.0');
  assert.equal(output.measurements.length,1); assert.equal(output.missingOutputs.length,24); assert.equal(output.status,'provisional');
  assert.ok(!JSON.stringify(output).includes('secret')); assert.ok(!JSON.stringify(output).includes('body_fat')); assert.equal(output.processingMs,123);
});
test('worker rejects duplicate files before decoding or model inference', async () => {
  let decoded = 0; const {c,messages} = workerContext({createImageBitmap(){decoded++;throw Error('should not decode');}});
  await c.self.onmessage({data:{operation:'scan',...options()}});
  assert.equal(decoded,0); assert.equal(messages.at(-1).code,'DUPLICATE_PHOTOS');
});
test('worker closes decoded oversized images and does not load the model', async () => {
  let closed = 0; const {c,messages} = workerContext({createImageBitmap:async()=>({width:5000,height:5000,close(){closed++;}})});
  await c.self.onmessage({data:{operation:'review',view:'front',frame:frame()}});
  assert.equal(closed,1); assert.equal(messages.at(-1).code,'PHOTO_DIMENSIONS');
});
test('worker preserves photo-quality reasons when the registered measurement engine rejects a view',async()=>{
  const {c,messages}=workerContext({createImageBitmap:async()=>({width:800,height:1200,close(){}})});
  vm.runInContext("sdkProvider.measure=async()=>{const error=Error('capture_quality');error.captureChecks=[{view:'front',accepted:false,reasons:['frame_edge'],landmarks:['secret']}];throw error;}",c);
  await c.self.onmessage({data:{operation:'scan',heightIn:70,frames:Object.fromEntries(['front','right','back','left'].map(v=>[v,new Blob([v],{type:'image/jpeg'})]))}});
  const e=messages.at(-1);assert.equal(e.code,'CAPTURE_QUALITY');assert.equal(e.captureChecks[0].reasons[0],'frame_edge');assert.equal(e.captureChecks[0].landmarks,undefined);
});
test('complete SDK worker scan invokes the real provider with synthetic landmarks and releases every bitmap', async () => {
  let closed = 0, detected = 0;
  const {c,messages} = workerContext({createImageBitmap:async()=>({width:800,height:1200,close(){closed++;}})});
  const n = Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:.9}));
  for(const [i,x,y] of [[0,.5,.1],[2,.48,.12],[5,.52,.12],[7,.46,.15],[8,.54,.15],[11,.39,.28],[12,.61,.28],[13,.38,.41],[14,.62,.41],[15,.37,.53],[16,.63,.53],[23,.43,.5],[24,.57,.5],[25,.43,.7],[26,.57,.7],[27,.43,.88],[28,.57,.88],[29,.43,.9],[30,.57,.9],[31,.42,.91],[32,.58,.91]]) Object.assign(n[i],{x,y});
  c.loadPoseLandmarker = async()=>({detect(){detected++;return {landmarks:[n],worldLandmarks:[n.map(p=>({x:p.x*1.8,y:p.y*1.8,z:0}))]};}});
  await c.self.onmessage({data:{operation:'scan',heightIn:70,frames:Object.fromEntries(['front','right','back','left'].map(v=>[v,new Blob([v],{type:'image/jpeg'})]))}});
  const output = messages.at(-1); assert.equal(output.type,'result'); assert.equal(output.result.measurements.length,25);
  assert.equal(output.result.captureChecks.length,4); assert.equal(output.result.missingOutputs.length,0);
  assert.equal(detected,4); assert.equal(closed,8); assert.equal(output.result.engine.version,'1.3.0');
  assert.ok(!JSON.stringify(output).includes('worldLandmarks'));
});
