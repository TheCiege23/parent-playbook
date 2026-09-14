'use strict';
const $=id=>document.getElementById(id),views=VisualHull.VIEWS;
let masks={},sources={},previews={},worker=null,requestId=0,generation=0,pending=null,busy=false,mesh=null,record=null,originalOBJ=null,yaw=.45;
let photoImportAbort=null;
const statusText=text=>{$('status').textContent=text;};
function invalidate(){mesh=null;record=null;if(originalOBJ)originalOBJ.fill(0);originalOBJ=null;$('output').hidden=true;$('reference-panel').hidden=true;resetReference();const c=$('surface');c.getContext('2d').clearRect(0,0,c.width,c.height);}
function resetReference(){
  if(record)delete record.referenceComparison;
  $('reference-status').textContent='No reference comparison yet.';
  const c=$('reference-contour');c.getContext('2d').clearRect(0,0,c.width,c.height);c.hidden=true;
}
function refresh(){
  for(const v of views){$('file-'+v).disabled=busy||!$('authorize').checked;$('center-'+v).disabled=busy||!masks[v];for(const prefix of ['display-','reviewed-','remove-'])$(prefix+v).disabled=busy||!masks[v];}
  $('build').disabled=busy||!$('authorize').checked||!validAlignment()||!views.every(v=>$('reviewed-'+v).checked);
  $('review-count').textContent=views.filter(v=>masks[v]&&$('reviewed-'+v).checked).length+' of 4 views reviewed';
  $('obj').disabled=!record;$('usdz').disabled=!record;$('manifest').disabled=!record;
  $('smoke').disabled=busy;$('synthetic').disabled=busy;$('height').disabled=busy||!!originalOBJ;
  for(const id of ['reopen','saved-obj','saved-method'])$(id).disabled=busy||!$('authorize').checked;
  $('compare').disabled=busy||!record;
  for(const id of ['reference-label','reference-plane','reference-cm'])$(id).disabled=busy;
}
function validAlignment(){return views.every(v=>{const m=masks[v],value=Number($('center-'+v).value)/100*m?.width;return m&&$('center-'+v).value!==''&&Number.isFinite(value)&&value>=m.left&&value<=m.right;});}
function releasePreview(view){if(previews[view]){previews[view].width=previews[view].height=0;delete previews[view];}}
function paintView(view){if(masks[view])drawMask($('mask-'+view),masks[view],previews[view],$('display-'+view).value);}
function removeView(view){
  releasePreview(view);delete masks[view];delete sources[view];invalidate();
  $('file-'+view).value='';$('center-'+view).value='';$('reviewed-'+view).checked=false;$('display-'+view).value='overlay';
  $('note-'+view).textContent='No silhouette yet.';const c=$('mask-'+view);c.getContext('2d').clearRect(0,0,c.width,c.height);refresh();
}
function ask(type,payload,transfer=[]){
  if(pending)throw Error('An experiment is already running.');
  if(!worker){
    worker=new Worker('/silhouette-worker.js');
    const instance=worker;
    worker.onmessage=({data})=>{if(pending&&data.id===pending.id){const p=pending;pending=null;clearTimeout(p.timer);data.error?p.reject(Error(data.error)):p.resolve(data);}};
    worker.onerror=()=>{if(worker!==instance)return;const p=pending;pending=null;worker.terminate();worker=null;if(p){clearTimeout(p.timer);p.reject(Error('Model worker failed. Clear and retry in a browser with WebAssembly and WebGL support.'));}};
  }
  return new Promise((resolve,reject)=>{
    const id=++requestId;
    const timer=setTimeout(()=>{if(pending?.id!==id)return;worker?.terminate();worker=null;pending=null;reject(Error('Processing timed out after 90 seconds. Try again or use a smaller photo.'));},90000);
    pending={id,resolve,reject,timer};
    try{worker.postMessage({id,type,...payload},transfer);}catch(error){clearTimeout(timer);pending=null;reject(error);}
  });
}
function clearSession(){
  photoImportAbort?.abort();photoImportAbort=null;
  generation++;worker?.terminate();worker=null;
  if(pending){clearTimeout(pending.timer);pending.reject(Error('Session cleared.'));pending=null;}
  masks={};sources={};busy=false;invalidate();
  for(const v of views){releasePreview(v);$('file-'+v).value='';$('center-'+v).value='';$('reviewed-'+v).checked=false;$('display-'+v).value='overlay';$('note-'+v).textContent='No silhouette yet.';const c=$('mask-'+v);c.getContext('2d').clearRect(0,0,c.width,c.height);}
  const c=$('smoke-mask');c.getContext('2d').clearRect(0,0,c.width,c.height);c.hidden=true;
  $('height').value='';$('authorize').checked=false;refresh();statusText('Session cleared. No photos, masks or geometry saved to the app.');
  for(const id of ['reference-label','reference-plane','reference-cm'])$(id).value='';
  $('saved-obj').value='';$('saved-method').value='';
}
function drawMask(canvas,m,photo=null,mode='mask'){
  if(!photo)mode='mask';
  canvas.width=m.width;canvas.height=m.height;const ctx=canvas.getContext('2d');
  if(mode!=='mask')ctx.drawImage(photo,0,0,m.width,m.height);
  if(mode!=='photo'){
    const pixels=ctx.createImageData(m.width,m.height);
    for(let i=0;i<m.bits.length;i++){const j=i*4;pixels.data[j]=m.bits[i]?70:10;pixels.data[j+1]=m.bits[i]?232:33;pixels.data[j+2]=m.bits[i]?175:28;pixels.data[j+3]=mode==='overlay'?(m.bits[i]?110:0):255;}
    if(mode==='mask')ctx.putImageData(pixels,0,0);
    else{const layer=document.createElement('canvas');layer.width=m.width;layer.height=m.height;try{layer.getContext('2d').putImageData(pixels,0,0);ctx.drawImage(layer,0,0);}finally{layer.width=layer.height=0;}}
  }
  ctx.strokeStyle='#f4cf7b';ctx.lineWidth=Math.max(1,m.width/200);ctx.beginPath();ctx.moveTo(m.centerX,m.top);ctx.lineTo(m.centerX,m.bottom);ctx.moveTo(0,m.top);ctx.lineTo(m.width,m.top);ctx.moveTo(0,m.bottom);ctx.lineTo(m.width,m.bottom);ctx.stroke();
}
async function bitmapFor(blob,signal){
  if(blob&&(/^image\/hei[cf]/i.test(blob.type)||/\.hei[cf]$/i.test(blob.name||''))){
    const {importScanPhoto}=await import('/js/photo-import.mjs');
    blob=(await importScanPhoto(blob,{signal,permissionAcknowledged:$('authorize').checked,onProgress:statusText})).blob;
  }
  if(!blob||blob.size<=0||blob.size>25*1024*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw Error('Choose a JPEG, PNG or WebP photo under 25 MB.');
  let bitmap=await createImageBitmap(blob);
  if(bitmap.width*bitmap.height>32e6){bitmap.close();throw Error('Photo exceeds 32 megapixels. Resize before choosing it.');}
  if(Math.max(bitmap.width,bitmap.height)>1600){
    const scale=1600/Math.max(bitmap.width,bitmap.height),original=bitmap;
    try{bitmap=await createImageBitmap(original,{resizeWidth:Math.round(original.width*scale),resizeHeight:Math.round(original.height*scale),resizeQuality:'high'});}finally{original.close();}
  }
  return bitmap;
}
async function segment(view,blob){
  if(busy||!$('authorize').checked||!views.includes(view))return;
  removeView(view);const token=generation;busy=true;refresh();
  $('note-'+view).textContent='Processing…';const old=$('mask-'+view);old.getContext('2d').clearRect(0,0,old.width,old.height);
  let bitmap,preview;
  const importing=/^image\/hei[cf]/i.test(blob?.type||'')||/\.hei[cf]$/i.test(blob?.name||'');
  const controller=importing?new AbortController():null;photoImportAbort=controller;
  try{
    statusText('Loading and running the local model. First use can take longer.');
    if(!blob||blob.size>25*1024*1024)throw Error('Choose a photo under 25 MB.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
    if(token!==generation)return;
    if(Object.values(sources).some(s=>s.digest===digest))throw Error('This exact file is already used for another view. Choose a distinct photo.');
    bitmap=await bitmapFor(blob,controller?.signal);if(token!==generation)return;
    preview=document.createElement('canvas');preview.width=bitmap.width;preview.height=bitmap.height;
    preview.getContext('2d').drawImage(bitmap,0,0);
    const response=await ask('segment',{bitmap},[bitmap]);bitmap=null;
    if(token!==generation)return;
    masks[view]=response.mask;sources[view]={digest,model:response.model,delegate:response.delegate,durationMs:Math.round(response.durationMs)};
    previews[view]=preview;preview=null;
    $('center-'+view).value=(response.mask.centerX/response.mask.width*100).toFixed(2);
    $('note-'+view).textContent='Real model silhouette · '+(response.durationMs/1000).toFixed(1)+' s · '+response.delegate;
    paintView(view);statusText('Review the '+view+' overlay. Check the view, whole-body outline and hip center, then mark it reviewed.');
  }catch(error){if(token===generation){$('note-'+view).textContent=error.message;statusText(error.message);}}
  finally{if(photoImportAbort===controller)photoImportAbort=null;bitmap?.close();if(preview)preview.width=preview.height=0;if(token===generation){$('file-'+view).value='';busy=false;refresh();}}
}
for(const view of views){
  const card=document.createElement('section');card.className='card';
  const label={front:'Front',right:'Anatomical right',back:'Back',left:'Anatomical left'}[view];
  card.innerHTML='<h2>'+label+'</h2><canvas class="mask" id="mask-'+view+'" width="256" height="256" aria-label="'+label+' photo and silhouette review"></canvas><label>View display <select id="display-'+view+'" disabled><option value="overlay">Photo + silhouette</option><option value="photo">Photo only</option><option value="mask">Silhouette only</option></select></label><label>Choose '+label.toLowerCase()+' photo<input id="file-'+view+'" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled></label><label>Hip center (% image width) <input id="center-'+view+'" type="number" min="0" max="100" step="0.1" disabled></label><label><input id="reviewed-'+view+'" type="checkbox" disabled>I checked the '+label.toLowerCase()+' view, full outline and hip center.</label><button class="secondary" id="remove-'+view+'" disabled>Remove this view</button><p class="small" id="note-'+view+'">No silhouette yet.</p>';
  $('views').appendChild(card);
  $('file-'+view).onchange=e=>segment(view,e.target.files[0]);
  $('display-'+view).onchange=()=>paintView(view);
  $('reviewed-'+view).onchange=()=>{invalidate();refresh();};
  $('remove-'+view).onclick=()=>{if(!busy){removeView(view);statusText('Removed the '+view+' photo and silhouette from this session.');}};
  $('center-'+view).oninput=()=>{
    invalidate();$('reviewed-'+view).checked=false;const m=masks[view],value=Number($('center-'+view).value)/100*m.width;
    if($('center-'+view).value===''||!Number.isFinite(value)||value<m.left||value>m.right){$('build').disabled=true;statusText('Hip center must fall inside the silhouette bounds.');return;}
    m.centerX=value;paintView(view);refresh();
  };
}
function drawSurface(){
  if(!mesh)return;
  const c=$('surface'),ctx=c.getContext('2d');ctx.fillStyle='#0a211c';ctx.fillRect(0,0,c.width,c.height);
  const cos=Math.cos(yaw),sin=Math.sin(yaw),scale=Math.min(c.height*.82/mesh.heightM,c.width*.7/mesh.heightM);
  const pts=mesh.vertices.map(([x,y,z])=>{const rx=x*cos+z*sin,rz=-x*sin+z*cos;return [c.width/2+rx*scale,c.height*.92-y*scale,rz];});
  const faces=mesh.faces.map(f=>({f,depth:f.reduce((sum,i)=>sum+pts[i][2],0)})).sort((a,b)=>a.depth-b.depth);
  for(const {f} of faces){const [a,b,d]=f.map(i=>pts[i]);
    const [u,v,w]=f.map(i=>mesh.vertices[i]);
    const nx=(v[1]-u[1])*(w[2]-u[2])-(v[2]-u[2])*(w[1]-u[1]),ny=(v[2]-u[2])*(w[0]-u[0])-(v[0]-u[0])*(w[2]-u[2]),nz=(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
    const light=.4+.6*Math.max(0,((nx*cos+nz*sin)*-.35+ny*.45+(-nx*sin+nz*cos)*.82)/(Math.hypot(nx,ny,nz)||1));
    ctx.fillStyle='rgb('+Math.round(164*light)+','+Math.round(212*light)+','+Math.round(186*light)+')';ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(d[0],d[1]);ctx.closePath();ctx.fill();
  }
  const plane=Number($('reference-plane').value)/100;
  if(record&&plane>0&&plane<mesh.heightM){const y=c.height*.92-plane*scale;ctx.strokeStyle='#f4cf7b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(c.width*.12,y);ctx.lineTo(c.width*.88,y);ctx.stroke();}
}
function drawContour(points){
  const c=$('reference-contour'),ctx=c.getContext('2d');c.hidden=false;ctx.clearRect(0,0,c.width,c.height);
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);
  const xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs);
  const scale=Math.min((c.width-50)/(xmax-xmin||1),(c.height-50)/(zmax-zmin||1));
  ctx.strokeStyle='#f4cf7b';ctx.lineWidth=3;ctx.beginPath();
  points.forEach((p,i)=>{const x=c.width/2+(p[0]-(xmin+xmax)/2)*scale,y=c.height/2-(p[2]-(zmin+zmax)/2)*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.stroke();
}
for(const id of ['reference-label','reference-plane','reference-cm'])$(id).oninput=()=>{resetReference();drawSurface();};
$('compare').onclick=async()=>{
  if(busy||!mesh||!record)return;
  const token=generation,activeRecord=record,activeMesh=mesh;
  const options={label:$('reference-label').value,planeCm:Number($('reference-plane').value),referenceCm:Number($('reference-cm').value)};
  resetReference();busy=true;refresh();$('reference-status').textContent='Computing this section…';
  try{
    const response=await ask('reference',{mesh:activeMesh,options});
    if(token!==generation||record!==activeRecord||mesh!==activeMesh)return;
    const {points,...result}=response.comparison;
    record.referenceComparison={status:'computed',...result};
    const sign=result.signedErrorCm>=0?'+':'';
    $('reference-status').textContent='Surface perimeter: '+result.surfacePerimeterCm.toFixed(1)+' cm · Tape: '+result.referenceCm.toFixed(1)+' cm · Difference: '+sign+result.signedErrorCm.toFixed(1)+' cm · Absolute error: '+result.absoluteErrorPercent.toFixed(1)+'%. Single experimental comparison; accuracy remains unvalidated.';
    drawContour(points);drawSurface();
  }catch(error){if(token===generation&&record===activeRecord){
    record.referenceComparison={status:'rejected',label:String(options.label).slice(0,120),planeCm:Number.isFinite(options.planeCm)?options.planeCm:null,referenceCm:Number.isFinite(options.referenceCm)?options.referenceCm:null,reason:error.message};
    $('reference-status').textContent='Comparison rejected: '+error.message;
  }}finally{if(token===generation){busy=false;refresh();}}
};
$('build').onclick=async()=>{
  if(busy||!$('authorize').checked||!validAlignment()||!views.every(v=>$('reviewed-'+v).checked))return;
  const token=generation;busy=true;invalidate();refresh();statusText('Intersecting the four silhouettes…');
  try{
    const response=await ask('reconstruct',{masks,options:{heightM:Number($('height').value)/100}});
    if(token!==generation)return;
    const candidate=response.mesh;
    const hashBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(VisualHull.toOBJ(candidate)));
    if(token!==generation)return;
    mesh=candidate;record={schema:'PP_EXPERIMENTAL_SURFACE_V1',createdAt:new Date().toISOString(),meshSha256:Array.from(new Uint8Array(hashBytes),b=>b.toString(16).padStart(2,'0')).join(''),protocol:mesh.protocol,experimental:true,units:mesh.units,scaleStatus:mesh.scaleStatus,heightM:mesh.heightM,resolution:mesh.resolution,voxelStepM:mesh.stepM,vertices:mesh.vertices.length,triangles:mesh.faces.length,reconstructionMs:Math.round(response.durationMs),views:views.map(v=>({view:v,model:sources[v].model,delegate:sources[v].delegate,segmentationMs:sources[v].durationMs,review:{protocol:'manual-view-review-v1',confirmed:true},alignment:{centerX:masks[v].centerX,top:masks[v].top,bottom:masks[v].bottom,width:masks[v].width,height:masks[v].height}})),limitations:['Clothing and hair included','Orthographic cameras assumed','Pose and view identity manually reviewed','Scale assumes silhouette extent equals recorded stature','No anatomical accuracy or population validation','No body composition or clinical interpretation']};
    $('output').hidden=false;$('reference-panel').hidden=false;$('summary').textContent=mesh.vertices.length.toLocaleString()+' vertices · '+mesh.faces.length.toLocaleString()+' triangles · '+(mesh.stepM*1000).toFixed(1)+' mm voxel grid · '+(response.durationMs/1000).toFixed(2)+' s reconstruction (excludes photo processing)';
    yaw=.45;drawSurface();statusText('Experimental surface built from your four silhouettes. Inspect every angle; a successful surface is not an accuracy result.');
  }catch(error){if(token===generation)statusText(error.message);}finally{if(token===generation){busy=false;refresh();}}
};
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('obj').onclick=()=>{if(mesh&&record)download(originalOBJ||VisualHull.toOBJ(mesh),'experimental-silhouette.obj','text/plain');};
// The same triangles as a USDZ package (tools/reconstruction/avatar-files.js), carrying the same warnings inside the file.
$('usdz').onclick=()=>{if(!mesh||!record)return;try{download(AvatarFiles.toUSDZ(mesh),'experimental-silhouette.usdz',AvatarFiles.USDZ_MEDIA_TYPE);}catch(error){statusText(error.message);}};
$('manifest').onclick=()=>{if(record)download(JSON.stringify(record,null,2),'experimental-silhouette-method.json','application/json');};
$('reopen').onclick=async()=>{
  if(busy||!$('authorize').checked)return;
  const obj=$('saved-obj').files?.[0],method=$('saved-method').files?.[0];
  if(!obj||!method){statusText('Choose both the saved OBJ and its method JSON.');return;}
  if(!obj.size||obj.size>16*1024*1024||!method.size||method.size>256*1024){statusText('Use an OBJ under 16 MB and a method JSON under 256 KB.');return;}
  const token=generation;busy=true;refresh();statusText('Checking the saved mesh and method record…');let bytes;
  try{
    bytes=new Uint8Array(await obj.arrayBuffer());const methodText=await method.text();
    if(token!==generation)return;
    const reopened=await ask('reopen',{objBytes:bytes,methodText},[bytes.buffer]);bytes=null;
    if(token!==generation)return;
    // Commit only after validation. Invalid imports leave the current scan intact.
    for(const view of views)removeView(view);
    for(const id of ['reference-label','reference-plane','reference-cm'])$(id).value='';
    mesh=reopened.mesh;record=reopened.record;originalOBJ=reopened.objBytes;
    $('height').value=Number((mesh.heightM*100).toFixed(3));
    if(reopened.referenceInputs){$('reference-label').value=reopened.referenceInputs.label;$('reference-plane').value=reopened.referenceInputs.planeCm;$('reference-cm').value=reopened.referenceInputs.referenceCm;}
    $('output').hidden=false;$('reference-panel').hidden=false;
    $('summary').textContent='REOPENED EXPERIMENTAL RESULT · '+mesh.vertices.length.toLocaleString()+' vertices · file pair matched by SHA-256. Source photos and capture provenance are not authenticated.';
    yaw=.45;drawSurface();statusText('Saved surface reopened locally. Photos and masks are not restored.'+(reopened.referenceInputs?' Tape inputs restored; click Compare this level to recalculate.':''));
  }catch(error){if(token===generation)statusText('Could not reopen: '+error.message);}
  finally{if(bytes?.byteLength)bytes.fill(0);if(token===generation){$('saved-obj').value='';$('saved-method').value='';busy=false;refresh();}}
};
$('left').onclick=()=>{yaw-=Math.PI/8;drawSurface();};$('right').onclick=()=>{yaw+=Math.PI/8;drawSurface();};
$('height').oninput=invalidate;$('clear').onclick=clearSession;
$('authorize').onchange=()=>{$('authorize').checked?refresh():clearSession();};
window.addEventListener('pagehide',clearSession);
$('smoke').onclick=async()=>{
  const token=generation;busy=true;refresh();statusText('Running real model inference on Google’s public pose example. This is not a four-view scan.');let bitmap,preview;
  try{
    const response=await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg');if(!response.ok)throw Error('Public test image unavailable.');
    const blob=await response.blob();if(token!==generation)return;
    bitmap=await bitmapFor(blob);if(token!==generation)return;
    preview=document.createElement('canvas');preview.width=bitmap.width;preview.height=bitmap.height;preview.getContext('2d').drawImage(bitmap,0,0);
    const result=await ask('segment',{bitmap},[bitmap]);bitmap=null;if(token!==generation)return;
    $('smoke-mask').hidden=false;drawMask($('smoke-mask'),result.mask,preview,'overlay');
    statusText('Real model check passed: one person, '+result.mask.width+' × '+result.mask.height+' mask, '+result.delegate+', '+(result.durationMs/1000).toFixed(1)+' s including model load if cold. No four-view reconstruction tested.');
  }catch(error){if(token===generation)statusText(error.message);}finally{bitmap?.close();if(preview)preview.width=preview.height=0;if(token===generation){busy=false;refresh();}}
};
$('synthetic').onclick=async()=>{
  if(busy)return;
  invalidate();const fixture={};
  for(const view of views){const width=80,height=120,data=new Float32Array(width*height);for(let y=10;y<110;y++)for(let x=25;x<55;x++)data[y*width+x]=1;fixture[view]=VisualHull.prepareMask({width,height,data,centerX:39.5});}
  mesh=VisualHull.reconstruct(fixture,{heightM:1.8,resolution:100});
  $('output').hidden=false;$('summary').textContent='SYNTHETIC RECTANGULAR PRISM · geometry/rendering check only · not an athlete';drawSurface();busy=true;refresh();statusText('Checking the synthetic 54 × 54 cm section in the worker. Downloads disabled for this fixture.');
  const token=generation;
  try{
    const result=await ask('reference',{mesh,options:{planeCm:90,referenceCm:216,label:'Synthetic prism midpoint'}});
    if(token!==generation)return;
    const bytes=new TextEncoder().encode(VisualHull.toOBJ(mesh));
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(token!==generation)return;
    const method={schema:'PP_EXPERIMENTAL_SURFACE_V1',createdAt:new Date().toISOString(),meshSha256:digest,protocol:mesh.protocol,experimental:true,units:'m',scaleStatus:mesh.scaleStatus,heightM:mesh.heightM,resolution:mesh.resolution,voxelStepM:mesh.stepM,vertices:mesh.vertices.length,triangles:mesh.faces.length,reconstructionMs:0,views:views.map(view=>({view,model:'SYNTHETIC GEOMETRY CHECK',delegate:'NONE',segmentationMs:0,alignment:{width:fixture[view].width,height:fixture[view].height,centerX:fixture[view].centerX,top:fixture[view].top,bottom:fixture[view].bottom}}))};
    const restored=await ask('reopen',{objBytes:bytes,methodText:JSON.stringify(method)},[bytes.buffer]);
    restored.objBytes.fill(0);
    if(token===generation)statusText('Synthetic checks passed: '+result.comparison.surfacePerimeterCm.toFixed(1)+' cm perimeter vs 216.0 cm reference; saved-file round trip restored '+restored.mesh.vertices.length+' vertices. No person or body accuracy tested. Downloads disabled.');
  }catch(error){if(token===generation)statusText('Synthetic check failed: '+error.message);}finally{if(token===generation){busy=false;refresh();}}
};
refresh();
