const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const VisualHull=require('../tools/reconstruction/visual-hull.js'),crypto=require('node:crypto');
const SurfaceReference=require('../tools/reconstruction/surface-reference.js');
const SurfaceArchive=require('../tools/reconstruction/surface-archive.js');
function mask(){const width=80,height=120,data=new Float32Array(width*height);for(let y=10;y<110;y++)for(let x=25;x<55;x++)data[y*width+x]=1;return VisualHull.prepareMask({width,height,data,centerX:39.5});}
function setup({hold=false}={}){
  const elements={},downloads=[],jobs=[],stats={terminated:0,closed:0};
  const ctx={drawImage(){},clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},closePath(){},fill(){},putImageData(){},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};}};
  function el(id){return elements[id]??=( {value:'',checked:false,hidden:true,disabled:false,width:256,height:256,textContent:'',getContext:()=>ctx,appendChild(){},remove(){},click(){}} );}
  class Worker{
    postMessage(data){jobs.push(async()=>{
      try{
        const response=data.type==='reopen'?{...await SurfaceArchive.open(data.objBytes,data.methodText),objBytes:data.objBytes}:data.type==='reference'?{comparison:SurfaceReference.compare(data.mesh,data.options)}:data.type==='segment'?{mask:mask(),model:'test-model',delegate:'TEST',durationMs:20}:{mesh:VisualHull.reconstruct(data.masks,data.options),durationMs:50};
        this.onmessage({data:{id:data.id,...response}});
      }catch(error){this.onmessage({data:{id:data.id,error:error.message}});}
    });if(!hold)queueMicrotask(()=>jobs.shift()());}
    terminate(){stats.terminated++;}
  }
  const c=vm.createContext({VisualHull,Worker,console,crypto:crypto.webcrypto,TextEncoder,Blob,Uint8Array,Float32Array,setTimeout,clearTimeout,window:{addEventListener(){}},URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},document:{getElementById:el,createElement:()=>el('created-'+Math.random()),body:{appendChild(){}}},createImageBitmap:async()=>({width:80,height:120,close(){stats.closed++;}})});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/reconstruction/silhouette-lab.js'),'utf8'),c);
  return {c,el,downloads,jobs,stats};
}
test('four distinct image inputs build a fingerprinted experimental export; invalid alignment blocks build',async()=>{
  const {c,el,downloads}=setup();el('authorize').checked=true;el('authorize').onchange();
  for(const view of VisualHull.VIEWS)await c.segment(view,new Blob([view],{type:'image/png'}));
  assert.equal(el('build').disabled,true);
  for(const view of VisualHull.VIEWS){el('reviewed-'+view).checked=true;el('reviewed-'+view).onchange();}
  assert.equal(el('build').disabled,false);
  el('center-front').value='';el('center-front').oninput();el('center-right').oninput();assert.equal(el('build').disabled,true);
  el('center-front').value='49.375';el('center-front').oninput();assert.equal(el('build').disabled,true);
  for(const view of VisualHull.VIEWS){el('reviewed-'+view).checked=true;el('reviewed-'+view).onchange();}
  assert.equal(el('build').disabled,false);
  el('height').value='180';await el('build').onclick();assert.equal(el('output').hidden,false);
  el('obj').onclick();el('manifest').onclick();assert.equal(downloads.length,2);
  const obj=await downloads[0].text(),record=JSON.parse(await downloads[1].text());
  assert.equal(record.meshSha256,crypto.createHash('sha256').update(obj).digest('hex'));
  assert.equal(record.views.length,4);assert.equal(record.experimental,true);assert.equal(record.scaleStatus,'assumed-stature-not-validated');assert.ok(!JSON.stringify(record).includes('digest'));assert.ok(!JSON.stringify(record).includes('bits'));
  assert.ok(record.views.every(v=>v.review.protocol==='manual-view-review-v1'&&v.review.confirmed===true));assert.equal(record.previews,undefined);
  assert.equal(el('reference-panel').hidden,false);
  el('reference-label').value='Marked test line';el('reference-plane').value='95';el('reference-cm').value='210';
  await el('compare').onclick();assert.match(el('reference-status').textContent,/Surface perimeter/);assert.equal(el('reference-contour').hidden,false);
  el('manifest').onclick();let updated=JSON.parse(await downloads.at(-1).text());
  assert.equal(updated.referenceComparison.status,'computed');assert.equal(updated.referenceComparison.referenceCm,210);assert.equal(updated.referenceComparison.points,undefined);assert.equal(updated.meshSha256,record.meshSha256);
  el('reference-plane').value='190';el('reference-plane').oninput();assert.equal(el('reference-contour').hidden,true);
  await el('compare').onclick();el('manifest').onclick();updated=JSON.parse(await downloads.at(-1).text());assert.equal(updated.referenceComparison.status,'rejected');assert.match(updated.referenceComparison.reason,/below/);
  el('height').value='181';el('height').oninput();assert.equal(el('output').hidden,true);
  assert.equal(el('reference-panel').hidden,true);
  c.clearSession();assert.equal(el('authorize').checked,false);assert.equal(el('file-front').disabled,true);
});
test('duplicate files never reach another inference and clear cancels late results',async()=>{
  const first=setup();first.el('authorize').checked=true;
  const photo=new Blob(['same'],{type:'image/png'});await first.c.segment('front',photo);await first.c.segment('back',photo);
  assert.match(first.el('status').textContent,/already used/);assert.equal(first.el('build').disabled,true);
  const second=setup({hold:true});second.el('authorize').checked=true;
  const staged=[],create=second.c.document.createElement;second.c.document.createElement=(...args)=>{const canvas=create(...args);staged.push(canvas);return canvas;};
  const operation=second.c.segment('front',photo);
  for(let i=0;i<30&&!second.jobs.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(second.jobs.length,1);second.c.clearSession();second.jobs.shift()();await operation;
  assert.equal(second.el('note-front').textContent,'No silhouette yet.');assert.equal(second.el('file-front').disabled,true);assert.equal(second.el('output').hidden,true);assert.equal(second.stats.terminated,1);
  assert.ok(staged.length>0);assert.ok(staged.every(canvas=>canvas.width===0&&canvas.height===0));
});
test('removing or replacing a photo releases its preview and requires a fresh review',async()=>{
  const {c,el}=setup();el('authorize').checked=true;
  await c.segment('front',new Blob(['first'],{type:'image/png'}));
  const first=vm.runInContext('previews.front',c);assert.equal(first.width,80);
  el('reviewed-front').checked=true;el('reviewed-front').onchange();assert.equal(el('review-count').textContent,'1 of 4 views reviewed');
  await c.segment('front',new Blob(['replacement'],{type:'image/png'}));
  assert.equal(first.width,0);assert.equal(first.height,0);assert.equal(el('reviewed-front').checked,false);
  const replacement=vm.runInContext('previews.front',c);
  el('display-front').value='photo';el('display-front').onchange();
  el('display-front').value='mask';el('display-front').onchange();
  el('remove-front').onclick();assert.equal(replacement.width,0);assert.equal(vm.runInContext('previews.front',c),undefined);assert.equal(el('review-count').textContent,'0 of 4 views reviewed');assert.equal(el('reviewed-front').disabled,true);
  await c.segment('front',new Blob(['third'],{type:'image/png'}));const last=vm.runInContext('previews.front',c);c.clearSession();assert.equal(last.width,0);assert.equal(vm.runInContext('Object.keys(previews).length',c),0);
  const failed=[],create=c.document.createElement;c.document.createElement=(...args)=>{const canvas=create(...args);failed.push(canvas);return canvas;};
  c.Worker.prototype.postMessage=function(data){this.onmessage({data:{id:data.id,error:'Test inference failure'}});};
  el('authorize').checked=true;await c.segment('front',new Blob(['failure'],{type:'image/png'}));
  assert.match(el('note-front').textContent,/Test inference failure/);assert.ok(failed.every(canvas=>canvas.width===0));assert.equal(vm.runInContext('Object.keys(previews).length',c),0);
});
test('overlay paints a translucent mask over the matching photo without covering unsegmented pixels',()=>{
  const {c,el}=setup(),m=mask(),photo={id:'source'};let drawn=[],layerPixels;
  const sourceCreate=c.document.createElement;
  c.document.createElement=()=>({width:0,height:0,getContext:()=>({putImageData(p){layerPixels=p;}})});
  const canvas=el('overlay'),context=canvas.getContext('2d');context.drawImage=(...args)=>drawn.push(args);
  c.drawMask(canvas,m,photo,'overlay');
  assert.equal(drawn[0][0],photo);assert.deepEqual(drawn[0].slice(1),[0,0,m.width,m.height]);
  assert.equal(layerPixels.data[3],0);assert.equal(layerPixels.data[(20*m.width+30)*4+3],110);assert.equal(drawn[1][0].width,0);
  drawn=[];c.drawMask(canvas,m,photo,'photo');assert.equal(drawn.length,1);
  drawn=[];c.drawMask(canvas,m,photo,'mask');assert.equal(drawn.length,0);
  c.document.createElement=sourceCreate;
});
test('clearing the reconstruction lab aborts a pending HEIC import before segmentation',async()=>{
  const s=setup();s.c.AbortController=AbortController;s.el('authorize').checked=true;let signal,resolve;
  s.c.bitmapFor=async(blob,currentSignal)=>{signal=currentSignal;return new Promise(r=>resolve=r);};
  const pending=s.c.segment('front',new Blob(['heic'],{type:'image/heic'}));
  for(let i=0;i<30&&!signal;i++)await new Promise(r=>setTimeout(r,5));assert.ok(signal);
  s.c.clearSession();assert.equal(signal.aborted,true);resolve({close(){s.stats.closed++;}});await pending;assert.equal(s.jobs.length,0);assert.equal(s.stats.closed,1);assert.equal(s.el('output').hidden,true);
});
test('a full export/reopen keeps exact OBJ bytes, clears photo views and can recalculate references',async()=>{
  const {c,el,downloads}=setup();el('authorize').checked=true;
  for(const view of VisualHull.VIEWS){await c.segment(view,new Blob([view],{type:'image/png'}));el('reviewed-'+view).checked=true;}
  el('height').value='180';await el('build').onclick();
  el('reference-label').value='Test level';el('reference-plane').value='90';el('reference-cm').value='210';await el('compare').onclick();
  el('obj').onclick();el('manifest').onclick();const [obj,method]=downloads;
  const oldPreview=vm.runInContext('previews.front',c);
  el('saved-obj').files=[obj];el('saved-method').files=[method];await el('reopen').onclick();
  assert.match(el('summary').textContent,/REOPENED/);assert.equal(oldPreview.width,0);assert.equal(el('review-count').textContent,'0 of 4 views reviewed');assert.equal(el('height').disabled,true);assert.equal(el('reference-cm').value,210);
  assert.equal(vm.runInContext('record.referenceComparison',c),undefined);await el('compare').onclick();assert.match(el('reference-status').textContent,/Surface perimeter/);
  el('obj').onclick();assert.equal(await downloads.at(-1).text(),await obj.text());
  const oldMesh=vm.runInContext('mesh',c);el('saved-obj').files=[new Blob(['bad'])];el('saved-method').files=[method];await el('reopen').onclick();assert.equal(vm.runInContext('mesh',c),oldMesh);assert.match(el('status').textContent,/do not match/);
  const buffer=vm.runInContext('originalOBJ',c);c.clearSession();assert.ok(buffer.every(n=>n===0));assert.equal(el('output').hidden,true);
  let respond;
  c.Worker.prototype.postMessage=function(data){respond=()=>this.onmessage({data:{id:data.id,error:'Late test response'}});};
  el('authorize').checked=true;el('saved-obj').files=[obj];el('saved-method').files=[method];
  const pendingImport=el('reopen').onclick();for(let i=0;i<30&&!respond;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(typeof respond,'function');c.clearSession();respond();await pendingImport;
  assert.equal(vm.runInContext('originalOBJ',c),null);assert.equal(el('output').hidden,true);assert.match(el('status').textContent,/Session cleared/);
});
function workerSetup(){
  const posts=[],stats={closed:0,bitmaps:0};
  const c=vm.createContext({Uint8Array,Int32Array,Float32Array,performance,OffscreenCanvas:class{},self:{postMessage:r=>posts.push(r)},importScripts(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/visual-hull.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/mesh-section.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/reconstruction/surface-reference.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/surface-worker.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/reconstruction/silhouette-worker.js'),'utf8'),c);
  const landmarks=Array.from({length:33},()=>({x:.49375,y:.5,visibility:.9})),m=mask();landmarks[11].y=landmarks[12].y=.3;landmarks[23].y=landmarks[24].y=.58;
  let result={landmarks:[landmarks],segmentationMasks:[{width:m.width,height:m.height,getAsFloat32Array:()=>Float32Array.from(m.bits)}],close(){stats.closed++;}};
  c.model=async()=>({detector:{detect:()=>result},delegate:'TEST',model:'test-model'});
  return {c,posts,stats,setResult:r=>result=r,bitmap:()=>({close(){stats.bitmaps++;}})};
}
test('worker copies mask output and releases inference resources on successful and rejected photos',async()=>{
  const {c,posts,stats,setResult,bitmap}=workerSetup();
  await c.self.onmessage({data:{id:1,type:'segment',bitmap:bitmap()}});
  assert.ok(posts[0].mask.bits.length);assert.equal(posts[0].levels.protocol,'pose-silhouette-levels-v1');assert.ok(posts[0].levels.shoulderFraction>posts[0].levels.hipFraction);assert.ok(!JSON.stringify(posts[0]).includes('landmarks'));assert.equal(stats.closed,1);assert.equal(stats.bitmaps,1);
  setResult({landmarks:[[],[]],close(){stats.closed++;}});
  await c.self.onmessage({data:{id:2,type:'segment',bitmap:bitmap()}});
  assert.match(posts[1].error,/Exactly one/);assert.equal(stats.closed,2);assert.equal(stats.bitmaps,2);
  c.model=async()=>{throw Error('Model unavailable');};
  await c.self.onmessage({data:{id:3,type:'segment',bitmap:bitmap()}});
  assert.match(posts[2].error,/Model unavailable/);assert.equal(stats.bitmaps,3);
});
