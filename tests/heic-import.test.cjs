const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function decoder({count=1,width=2316,height=3088,displayFailure=false}={}){
  const seen={loads:0,freed:0,contexts:0,displayed:0};
  const c=vm.createContext({Blob,Uint8Array,Uint8ClampedArray,ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}},OffscreenCanvas:class{constructor(w,h){this.width=w;this.height=h;seen.canvas=this;}getContext(){return {putImageData(){}};}async convertToBlob(){return new Blob(['converted'],{type:'image/png'});}},loadCodec:async()=>{seen.loads++;return {default:()=>({HeifDecoder:class{constructor(){this.decoder=1;}decode(bytes){seen.bytes=bytes;return Array.from({length:count},()=>({get_width:()=>width,get_height:()=>height,free(){seen.freed++;},display(data,fn){seen.displayed++;fn(displayFailure?null:data);}}));}},heif_context_free(){seen.contexts++;}})};}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/heic-decode.js'),'utf8').replace('await import(URL)','await loadCodec()'),c);
  return {api:c.HeicImport,seen};
}
test('HEIC detector checks MIME, filename and bounded file-brand bytes without loading codec for JPEG',async()=>{
  const s=decoder(),jpeg=new Blob(['jpeg'],{type:'image/jpeg'});const r=await s.api.normalize(jpeg);assert.equal(r.blob,jpeg);assert.equal(r.conversion,null);assert.equal(s.seen.loads,0);
  assert.equal(await s.api.isHEIC(new File(['x'],'photo.HEIF')),true);
  assert.equal(await s.api.isHEIC(new Blob(['0000ftypheic0000'],{type:'application/octet-stream'})),true);
  assert.equal(await s.api.isHEIC(new Blob(['0000not-heic'])),false);
});
test('HEIC conversion preserves dimensions and releases native image, context, bytes and canvas',async()=>{
  const s=decoder(),r=await s.api.normalize(new Blob(['private file bytes'],{type:'image/heic'}));assert.equal(r.blob.type,'image/png');assert.equal(r.conversion.width,2316);assert.equal(r.conversion.height,3088);assert.equal(r.conversion.protocol,'heic-png-v1');
  assert.equal(s.seen.freed,1);assert.equal(s.seen.contexts,1);assert.ok(s.seen.bytes.every(b=>b===0));assert.equal(s.seen.canvas.width,1);
});
test('multi-image and oversized HEIC files are rejected before raster output; native resources still release',async()=>{
  for(const config of [{count:2},{width:5000,height:5000}]){const s=decoder(config);await assert.rejects(s.api.normalize(new Blob(['x'],{type:'image/heic'})),/heic_multiple_images|photo_dimensions/);assert.equal(s.seen.displayed,0);assert.equal(s.seen.contexts,1);assert.equal(s.seen.freed,config.count||1);}
  const failed=decoder({displayFailure:true});await assert.rejects(failed.api.normalize(new Blob(['x'],{type:'image/heic'})),/heic_decode_failed/);assert.equal(failed.seen.freed,1);
});
test('local import cancellation terminates decoding and ignores late results',async t=>{
  const original=global.Worker,workers=[];global.Worker=class{constructor(){this.closed=0;workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.closed++;}};t.after(()=>global.Worker=original);
  const {importScanPhoto}=await import('../js/photo-import.mjs'),signal=new AbortController();
  await assert.rejects(importScanPhoto(new Blob(['x'])),/Permission/);assert.equal(workers.length,0);
  const pending=importScanPhoto(new Blob(['x']),{permissionAcknowledged:true,signal:signal.signal});const late=workers[0].onmessage;signal.abort();await assert.rejects(pending,{name:'AbortError'});late({data:{type:'result',result:'stale'}});assert.equal(workers[0].closed,1);
  const next=importScanPhoto(new Blob(['x']),{permissionAcknowledged:true});workers[1].onmessage({data:{type:'result',result:{blob:'ready'}}});assert.equal((await next).blob,'ready');assert.equal(workers[1].closed,1);
});
test('local import timeout releases a hung decoder',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const original=global.Worker;let closed=0;global.Worker=class{postMessage(){}terminate(){closed++;}};t.after(()=>global.Worker=original);
  const {importScanPhoto}=await import('../js/photo-import.mjs');const check=assert.rejects(importScanPhoto(new Blob(['x']),{permissionAcknowledged:true}),/timed out/);t.mock.timers.tick(90000);await check;assert.equal(closed,1);
});
