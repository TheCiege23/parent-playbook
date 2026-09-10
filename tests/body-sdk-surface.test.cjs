const test=require('node:test'),assert=require('node:assert/strict'),Hull=require('../js/visual-hull.js');
const views=Hull.VIEWS,turn=()=>new Promise(r=>setImmediate(r));
function mask(){const width=80,height=120,data=new Float32Array(width*height);for(let y=10;y<110;y++)for(let x=25;x<55;x++)data[y*width+x]=1;return Hull.prepareMask({width,height,data,centerX:39.5});}
async function setup(t,{hold=false,check=()=>true,reconstructionFailure=false}={}){
  const sdk=await import('../js/body-sdk.mjs'),workers=[],jobs=[],elements={},bitmaps=[],masks=[];
  const ctx={drawImage(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},putImageData(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}}};
  const el=id=>elements[id]??={value:id.includes('Display')?'overlay':'',checked:false,disabled:true,width:1,height:1,getContext:()=>ctx};
  const bg={isConnected:true,querySelector:s=>el(s.slice(1)),remove(){this.isConnected=false;}};
  const old={};for(const key of ['Worker','document','createImageBitmap'])old[key]=globalThis[key];
  globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>ctx})};
  globalThis.createImageBitmap=async()=>{const b={width:80,height:120,closed:0,close(){this.closed++;}};bitmaps.push(b);return b;};
  globalThis.Worker=class{
    constructor(url){this.url=url;this.terminated=0;workers.push(this);}
    postMessage(data){this.sent=data;const reply=()=>{
      if(this.terminated)return;
      let output;
      if(this.url.pathname.endsWith('/body-sdk-worker.js'))output={type:'result',result:{schema:'PP_BODY_SDK_RESULT_V1',measurements:[{key:'wingspan',value:70}],heightIn:data.heightIn}};
      else if(this.url.pathname.endsWith('/photo-import-worker.js'))output={type:'result',result:{blob:data.frame}};
      else if(data.type==='segment'){const m=mask();masks.push(m);output={id:data.id,mask:m,levels:{protocol:'pose-silhouette-levels-v1',shoulderFraction:.78,hipFraction:.52},model:'synthetic',delegate:'TEST'};data.bitmap.close();}
      else if(reconstructionFailure){reconstructionFailure=false;output={id:data.id,error:'Disconnected',code:'DISCONNECTED_SURFACE',diagnostics:{protocol:'surface-connectivity-v1',resolution:64,occupiedVoxels:1000,componentCount:2,largestComponentFraction:.99,components:[{voxels:990,fromFloorFraction:0,toFloorFraction:1},{voxels:10,fromFloorFraction:.02,toFloorFraction:.05}],photos:'must be discarded'}};}
      else output={id:data.id,mesh:Hull.reconstruct(data.masks,data.options),durationMs:20};
      this.onmessage?.({data:output});
    };if(hold&&data.type==='segment')jobs.push(reply);else queueMicrotask(reply);}
    terminate(){this.terminated++;}
  };
  const scanner=sdk.createBodyScanner(),controller=new AbortController();
  const options={frames:Object.fromEntries(views.map(v=>[v,new Blob([v],{type:'image/png'})])),heightIn:70,permissionAcknowledged:true,surfacePermissionAcknowledged:true,signal:controller.signal,
    checkPermission:check,mountReview:html=>{bg.html=html;return bg;}};
  t.after(()=>{controller.abort();scanner.dispose();bg.remove();for(const key in old)if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];});
  return {sdk,scanner,controller,options,el,bg,workers,jobs,bitmaps,masks};
}
async function ready(s){for(let i=0;i<100&&s.el('surfaceCheck-left').disabled;i++)await turn();assert.equal(s.el('surfaceCheck-left').disabled,false);}
function confirm(s){for(const v of views){s.el('surfaceCheck-'+v).checked=true;s.el('surfaceCheck-'+v).onchange();}}
test('combined SDK requires separate geometry permission and valid host callbacks before model processing',async t=>{
  const s=await setup(t);
  for(const [change,code] of [[{surfacePermissionAcknowledged:false},'SURFACE_PERMISSION_REQUIRED'],[{mountReview:null},'INVALID_SURFACE_HOST'],[{checkPermission:null},'INVALID_SURFACE_HOST'],[{heightIn:30},'INVALID_HEIGHT']])await assert.rejects(s.scanner.scanWithSurface({...s.options,...change}),{code});
  assert.equal(s.workers.length,0);
});
test('combined SDK snapshots input, shares reconstruction, and returns geometry separately from assessment',async t=>{
  const s=await setup(t);const pending=s.scanner.scanWithSurface(s.options);s.options.heightIn=85;s.options.frames.front=null;
  await ready(s);assert.match(s.el('surfaceRetention').textContent,/host application still controls/);assert.equal(s.workers[0].sent.heightIn,70);assert.ok(s.workers[0].sent.frames.front instanceof Blob);
  await assert.rejects(s.scanner.scan(s.options),{code:'BUSY'});await assert.rejects(s.scanner.scanWithSurface(s.options),{code:'BUSY'});
  confirm(s);await s.el('surfaceBuild').onclick();const result=await pending;
  assert.equal(result.schema,'PP_BODY_SDK_SURFACE_RESULT_V1');assert.equal(result.sdkVersion,'0.13.0');assert.equal(result.surfaceStatus,'generated');assert.ok(result.surface.mesh.vertices.length);assert.equal(result.surface.mesh.heightM,70*.0254);
  assert.equal(result.surface.posePlanes.protocol,'four-view-pose-plane-markers-v1');assert.deepEqual(result.surface.posePlanes.markers.map(marker=>marker.key),['shoulder_midpoint','torso_midpoint','hip_midpoint']);assert.equal(result.surface.posePlanes.markers[0].planeCm,138.7);
  assert.ok(!JSON.stringify(result.assessment).includes('vertices'));assert.ok(!JSON.stringify(result).includes('bits'));assert.equal(result.surface.views.length,4);
  assert.ok(s.workers.every(w=>w.terminated===1));assert.ok(s.masks.every(m=>m.bits.every(x=>!x)));
  const mesh=result.surface.mesh;s.sdk.releaseSurfaceResult(result);s.sdk.releaseSurfaceResult(result);assert.equal(mesh.vertices.length,0);assert.equal(result.surface,null);
});
test('pose plane aggregation uses the middle two views and reports disagreement without exposing landmarks',async t=>{
  const s=await setup(t),levels=[{shoulderFraction:.8,hipFraction:.54},{shoulderFraction:.78,hipFraction:.52},{shoulderFraction:.79,hipFraction:.53},{shoulderFraction:.77,hipFraction:.51}];
  const markers=s.sdk.derivePosePlaneMarkers(levels.map((item,index)=>({view:views[index],levels:{protocol:'pose-silhouette-levels-v1',...item},landmarks:'PRIVATE'})),2);
  assert.equal(markers.markers[0].planeCm,157);assert.equal(markers.markers[0].maxViewSpreadCm,6);assert.equal(markers.markers[2].planeCm,105);assert.ok(!JSON.stringify(markers).includes('PRIVATE'));
  assert.throws(()=>s.sdk.derivePosePlaneMarkers(levels.slice(0,3).map(item=>({levels:{protocol:'pose-silhouette-levels-v1',...item}})),2));
});
test('skipping the review returns length assessment and releases the busy lock',async t=>{
  const s=await setup(t);const pending=s.scanner.scanWithSurface(s.options);await ready(s);s.el('surfaceSkip').onclick();const result=await pending;
  assert.equal(result.surfaceStatus,'skipped');assert.equal(result.surface,null);assert.equal(result.assessment.measurements.length,1);
  assert.equal((await s.scanner.scan(s.options)).schema,'PP_BODY_SDK_RESULT_V1');
});
test('abort during silhouette work terminates the model immediately and blocks stale output',async t=>{
  const s=await setup(t,{hold:true});const pending=s.scanner.scanWithSurface(s.options);const checked=assert.rejects(pending,{code:'ABORTED'});
  for(let i=0;i<100&&!s.jobs.length;i++)await turn();assert.equal(s.jobs.length,1);s.controller.abort();await checked;
  assert.equal(s.bg.isConnected,false);assert.ok(s.workers.every(w=>w.terminated===1));s.jobs.shift()();assert.equal(s.el('surfaceBuild').disabled,true);
});
test('host withdrawal before build prevents reconstruction and returns no assessment package',async t=>{
  let allowed=true;const s=await setup(t,{check:()=>allowed});const pending=s.scanner.scanWithSurface(s.options);const checked=assert.rejects(pending,{code:'PERMISSION_CHANGED'});
  await ready(s);confirm(s);allowed=false;await s.el('surfaceBuild').onclick();await checked;assert.ok(s.workers.every(w=>w.sent?.type!=='reconstruct'));
});
test('dispose cancels a hung host permission lookup and permanently closes the scanner',async t=>{
  let called=false;const s=await setup(t,{check:()=>{called=true;return new Promise(()=>{});}});const pending=s.scanner.scanWithSurface(s.options);const checked=assert.rejects(pending,{code:'ABORTED'});
  for(let i=0;i<100&&!called;i++)await turn();assert.equal(called,true);s.scanner.dispose();await checked;assert.equal(s.workers.length,0);await assert.rejects(s.scanner.scan(s.options),{code:'DISPOSED'});
});
test('permission denied before inference never decodes or returns measurements',async t=>{
  const s=await setup(t,{check:()=>false});await assert.rejects(s.scanner.scanWithSurface(s.options),{code:'PERMISSION_CHANGED'});assert.equal(s.workers.length,0);assert.equal(s.bitmaps.length,0);
});

test('failed reconstruction followed by lengths-only returns rejected with curated diagnostics',async t=>{
  const s=await setup(t,{reconstructionFailure:true});const pending=s.scanner.scanWithSurface(s.options);await ready(s);confirm(s);
  await s.el('surfaceBuild').onclick();assert.match(s.el('surfaceStatus').textContent,/near the feet or lower legs/);
  s.el('surfaceSkip').onclick();const result=await pending;
  assert.equal(result.surfaceStatus,'rejected');assert.equal(result.surface,null);assert.equal(result.assessment.measurements.length,1);
  assert.equal(result.surfaceFailure.code,'DISCONNECTED_SURFACE');assert.equal(result.surfaceFailure.diagnostics.componentCount,2);
  assert.equal(result.surfaceFailure.diagnostics.photos,undefined);assert.ok(!JSON.stringify(result.surfaceFailure).includes('bits'));
  assert.ok(s.masks.every(m=>m.bits.every(x=>!x)));
});

test('successful retry replaces prior failure and returns only the accepted surface outcome',async t=>{
  const s=await setup(t,{reconstructionFailure:true});const pending=s.scanner.scanWithSurface(s.options);await ready(s);confirm(s);
  await s.el('surfaceBuild').onclick();await s.el('surfaceBuild').onclick();const result=await pending;
  assert.equal(result.surfaceStatus,'generated');assert.equal(result.surfaceFailure,null);assert.ok(result.surface.mesh.vertices.length);
});
