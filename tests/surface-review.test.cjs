const test=require('node:test'),assert=require('node:assert/strict');
const Hull=require('../js/visual-hull.js');
function mask(){const width=80,height=120,data=new Float32Array(width*height);for(let y=10;y<110;y++)for(let x=25;x<55;x++)data[y*width+x]=1;return Hull.prepareMask({width,height,data,centerX:39.5});}
async function setup({hold=false,allowed=()=>true,modelError=false}={}){
  const {reviewSurface,renderSurfacePreview}=await import('../js/surface-review.mjs');
  const elements={},canvases=[],jobs=[],messages=[],masks=[],stats={terminated:0,bitmapsClosed:0,draws:0};let timer,current=true;
  const ctx={drawImage(){stats.draws++;},fillRect(){stats.draws++;},beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){},fill(){},putImageData(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}}};
  function element(id){return elements[id]??={value:id.includes('Display')?'overlay':'',checked:false,disabled:true,width:1,height:1,getContext:()=>ctx};}
  const bg={isConnected:true,querySelector:s=>element(s.slice(1)),remove(){this.isConnected=false;}};
  const old={};for(const k of ['Worker','document','createImageBitmap','setInterval','clearInterval'])old[k]=globalThis[k];
  globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>ctx};canvases.push(c);return c;}};
  globalThis.createImageBitmap=async()=>({width:80,height:120,close(){stats.bitmapsClosed++;}});
  globalThis.setInterval=fn=>{timer=fn;return 1;};globalThis.clearInterval=()=>{};
  globalThis.Worker=class{
    postMessage(data){messages.push(data.type);jobs.push(()=>{
      if(modelError&&data.type==='segment'){this.onmessage({data:{id:data.id,error:'Synthetic model failure'}});return;}
      const output=data.type==='segment'?{mask:mask(),levels:{protocol:'pose-silhouette-levels-v1',shoulderFraction:.78,hipFraction:.52},model:'SYNTHETIC',delegate:'TEST'}:{mesh:Hull.reconstruct(data.masks,data.options),durationMs:20};
      if(output.mask)masks.push(output.mask);this.onmessage({data:{id:data.id,...output}});
    });if(!hold)queueMicrotask(()=>jobs.shift()());}
    terminate(){stats.terminated++;}
  };
  const frames=Object.fromEntries(Hull.VIEWS.map(v=>[v,new Blob([v])]));
  const pending=reviewSurface({frames,heightM:1.8,mount:html=>{stats.html=html;return bg;},isCurrent:()=>current,authorize:async()=>allowed()});
  // Observe expected rejections immediately, before an awaited UI event.
  pending.catch(()=>{});
  return {pending,bg,el:element,stats,jobs,masks,canvases,messages,renderSurfacePreview,
    invalidate(){current=false;timer();},restore(){bg.remove();for(const k in old)if(old[k]===undefined)delete globalThis[k];else globalThis[k]=old[k];}};
}
const turn=()=>new Promise(r=>setImmediate(r));
async function ready(s){for(let i=0;i<25&&s.el('surfaceCheck-left').disabled;i++)await turn();assert.equal(s.el('surfaceCheck-left').disabled,false);}
function confirm(s){for(const v of Hull.VIEWS){s.el('surfaceCheck-'+v).checked=true;s.el('surfaceCheck-'+v).onchange();}}

test('main review requires four manual checks and fresh alignment review; completion clears every photo and mask',async()=>{
  const s=await setup();try{
    await ready(s);assert.equal(s.el('surfaceBuild').disabled,true);confirm(s);assert.equal(s.el('surfaceBuild').disabled,false);
    assert.equal(s.el('surfacePair-front').width,240);assert.equal(s.el('surfaceFeet-right').width,480);
    assert.match(s.el('surfacePairNote-front').textContent,/overall overlap 100%/);assert.match(s.el('surfacePairNote-front').textContent,/not a measurement-accuracy score/);
    s.el('surfaceCenter-front').value='';s.el('surfaceCenter-front').oninput();assert.equal(s.el('surfaceBuild').disabled,true);assert.equal(s.el('surfaceCheck-front').checked,false);
    assert.equal(s.el('surfacePair-front').width,0);assert.equal(s.el('surfaceFeet-front').height,0);
    s.el('surfaceCenter-front').value='49.375';s.el('surfaceCenter-front').oninput();assert.equal(s.el('surfaceBuild').disabled,true);confirm(s);
    await s.el('surfaceBuild').onclick();const result=await s.pending;
    assert.ok(result.mesh.vertices.length>0);assert.equal(result.mesh.experimental,true);assert.equal(result.views.length,4);assert.equal(result.views[0].review,'manual-view-review-v1');assert.equal(result.posePlanes.markers.length,3);assert.ok(!JSON.stringify(result.views).includes('shoulderFraction'));
    assert.ok(s.masks.every(m=>m.bits.every(x=>x===0)));assert.ok(s.canvases.every(c=>c.width===0&&c.height===0));assert.equal(s.stats.terminated,1);
    assert.ok(!JSON.stringify(result).includes('bits'));assert.equal(s.bg.isConnected,false);
    for(const a of ['front','right'])for(const kind of ['Pair','Feet'])assert.equal(s.el('surface'+kind+'-'+a).width,0);
  }finally{s.restore();}
});
test('missing or withdrawn release prevents model or reconstruction execution',async()=>{
  let permit=false;const s=await setup({allowed:()=>permit});try{await assert.rejects(s.pending,{name:'AbortError'});assert.deepEqual(s.messages,[]);}finally{s.restore();}
  permit=true;const t=await setup({allowed:()=>permit});try{await ready(t);confirm(t);permit=false;await t.el('surfaceBuild').onclick();await assert.rejects(t.pending,{name:'AbortError'});assert.equal(t.messages.includes('reconstruct'),false);assert.ok(t.masks.every(m=>m.bits.every(x=>!x)));}finally{t.restore();}
});
test('skipping a pending model terminates it and rejects late images without losing the length flow',async()=>{
  const s=await setup({hold:true});try{for(let i=0;i<20&&!s.jobs.length;i++)await turn();assert.equal(s.jobs.length,1);
    s.el('surfaceSkip').onclick();assert.equal(await s.pending,null);assert.equal(s.stats.terminated,1);const draws=s.stats.draws;
    s.jobs.shift()();await turn();assert.equal(s.stats.draws,draws);assert.ok(s.canvases.every(c=>c.width===0));
  }finally{s.restore();}
});
test('account or capture replacement aborts a pending review and releases its model',async()=>{
  const s=await setup({hold:true});try{for(let i=0;i<20&&!s.jobs.length;i++)await turn();s.invalidate();await assert.rejects(s.pending,{name:'AbortError'});assert.equal(s.stats.terminated,1);assert.equal(s.bg.isConnected,false);}finally{s.restore();}
});
test('model failure leaves a clear path to lengths only and no build action',async()=>{
  const s=await setup({modelError:true});try{await turn();await turn();
    assert.match(s.el('surfaceStatus').textContent,/Synthetic model failure/);assert.equal(s.el('surfaceBuild').disabled,true);
    s.el('surfaceSkip').onclick();assert.equal(await s.pending,null);assert.ok(s.canvases.every(c=>c.width===0));
  }finally{s.restore();}
});
test('temporary preview rotates generated geometry and idempotent disposal erases it',async()=>{
  const s=await setup();try{await ready(s);s.el('surfaceSkip').onclick();await s.pending;
    const mesh=Hull.reconstruct(Object.fromEntries(Hull.VIEWS.map(v=>[v,mask()])),{heightM:1.8,resolution:24}),preview={mesh};
    mesh.topologyAdjustment={protocol:'surface-lower-artifact-removal-v1',removedVoxels:14,removedFraction:.0029};
    const host={querySelector:tag=>s.el(tag),replaceChildren(){this.empty=true;}};
    const release=s.renderSurfacePreview(host,preview);assert.match(host.innerHTML,/unvalidated/);assert.match(host.innerHTML,/removed 14 detached lower-region voxels/);const before=s.stats.draws;
    s.el('input').value='90';s.el('input').oninput();assert.ok(s.stats.draws>before);release();release();assert.equal(mesh.vertices.length,0);assert.equal(mesh.faces.length,0);assert.equal(preview.mesh,null);assert.equal(host.empty,true);
  }finally{s.restore();}
});

test('failure summary rejects malformed diagnostic fields and excludes arbitrary error data',async()=>{
  const {surfaceFailureSummary}=await import('../js/surface-review.mjs');
  const d={protocol:'surface-connectivity-v1',resolution:64,occupiedVoxels:1000,componentCount:2,largestComponentFraction:.99,components:[{voxels:990,fromFloorFraction:0,toFloorFraction:1},{voxels:10,fromFloorFraction:.02,toFloorFraction:.05}]};
  const result=surfaceFailureSummary({code:'DISCONNECTED_SURFACE',message:'private raw error',diagnostics:d,photo:'private'},'reconstruction');
  assert.equal(result.diagnostics.componentCount,2);d.components[0].voxels=1;assert.equal(result.diagnostics.components[0].voxels,990);
  assert.ok(!JSON.stringify(result).includes('private'));
  for(const change of [{resolution:999},{componentCount:10000000},{largestComponentFraction:NaN},{components:[{voxels:1,fromFloorFraction:-1,toFloorFraction:1}]}])assert.equal(surfaceFailureSummary({code:'DISCONNECTED_SURFACE',diagnostics:{...d,...change}},'reconstruction').diagnostics,null);
  d.components[1].closestBridgeVoxels=1;assert.equal(surfaceFailureSummary({code:'DISCONNECTED_SURFACE',diagnostics:d},'reconstruction').diagnostics.components[1].closestBridgeVoxels,1);
  d.components[1].closestBridgeVoxels=4;assert.equal(surfaceFailureSummary({code:'DISCONNECTED_SURFACE',diagnostics:d},'reconstruction').diagnostics,null);
});

test('opposite-view comparison mirrors asymmetric masks and reveals alignment changes without changing inputs',async()=>{
  const {compareSurfaceProjections}=await import('../js/surface-review.mjs');
  function asymmetric(left,right){const width=80,height=120,data=new Float32Array(width*height);for(let y=10;y<110;y++)for(let x=left;x<=right;x++)data[y*width+x]=1;return Hull.prepareMask({width,height,data,centerX:39.5});}
  const first=asymmetric(20,45),opposite=asymmetric(34,59),before=first.bits.slice();
  const aligned=compareSurfaceProjections(first,opposite);assert.ok(aligned.pixels.some(p=>p===3));assert.ok(aligned.pixels.every(p=>p===0||p===3));
  opposite.centerX+=5;const shifted=compareSurfaceProjections(first,opposite);assert.ok(shifted.pixels.some(p=>p===1));assert.ok(shifted.pixels.some(p=>p===2));
  assert.deepEqual(first.bits,before);assert.equal(first.centerX,39.5);
});

test('comparison requires bounded prepared masks and bounded display dimensions',async()=>{
  const {compareSurfaceProjections}=await import('../js/surface-review.mjs'),m=mask();
  for(const bad of [null,{...m,bits:[]},{...m,centerX:NaN},{...m,top:m.bottom},{...m,bottom:m.height+10}])assert.throws(()=>compareSurfaceProjections(m,bad));
  for(const options of [{width:10000},{height:0},{width:2.4}])assert.throws(()=>compareSurfaceProjections(m,m,options));
});

test('projection agreement reports full and lower-region overlap without changing the comparison',async()=>{
  const {summarizeProjectionAgreement}=await import('../js/surface-review.mjs');
  const pixels=new Uint8Array(8*10).fill(3),before=pixels.slice();
  const aligned=summarizeProjectionAgreement({width:8,height:10,pixels});
  assert.equal(aligned.protocol,'opposite-silhouette-agreement-v1');assert.equal(aligned.overall.iou,1);assert.equal(aligned.lower.iou,1);assert.deepEqual(pixels,before);
  for(let i=8*8;i<pixels.length;i++)pixels[i]=i%2?1:2;
  const lowerMismatch=summarizeProjectionAgreement({width:8,height:10,pixels});
  assert.equal(lowerMismatch.overall.iou,.8);assert.equal(lowerMismatch.lower.iou,0);
});

test('projection agreement rejects malformed comparisons and returns unavailable for an empty region',async()=>{
  const {summarizeProjectionAgreement}=await import('../js/surface-review.mjs');
  const empty={width:8,height:8,pixels:new Uint8Array(64)};
  assert.equal(summarizeProjectionAgreement(empty).overall.iou,null);
  for(const bad of [null,{...empty,pixels:[]},{...empty,width:7},{...empty,pixels:new Uint8Array(63)}])assert.throws(()=>summarizeProjectionAgreement(bad));
  const invalid={...empty,pixels:empty.pixels.slice()};invalid.pixels[2]=4;assert.throws(()=>summarizeProjectionAgreement(invalid));
  for(const lowerFraction of [0,.51,NaN])assert.throws(()=>summarizeProjectionAgreement(empty,{lowerFraction}));
});
