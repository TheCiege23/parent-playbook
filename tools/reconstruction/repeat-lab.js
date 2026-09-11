'use strict';
const $=id=>document.getElementById(id),fileIds=['first-obj','first-method','second-obj','second-method'];
let generation=0,active=null,report=null;
function resetResult(){report=null;$('output').hidden=true;$('rows').replaceChildren();$('chart').replaceChildren();$('errors').textContent='';$('warnings').textContent='';$('download').disabled=true;}
function controls(busy){for(const e of document.querySelectorAll('input,button'))e.disabled=busy;$('cancel').disabled=!busy;$('clear').disabled=false;$('download').disabled=busy||!report;}
function cancel(){
  generation++;
  if(active){const work=active;active=null;clearTimeout(work.timer);work.worker?.terminate();work.reject?.(Error('Comparison canceled.'));}
  controls(false);
}
function runWorker(payload,token){
  return new Promise((resolve,reject)=>{
    let worker;
    const finish=(error,result)=>{
      if(!active||active.token!==token)return;
      clearTimeout(active.timer);active=null;worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();
      error?reject(error):resolve(result);
    };
    try{
      worker=new Worker('/repeat-worker.js');
      active={worker,reject,token,timer:setTimeout(()=>finish(Error('Comparison timed out. Try smaller meshes.')),90000)};
      worker.onmessage=({data})=>{
        if(token!==generation)return;
        if(data?.type==='progress')$('status').textContent=data.message;
        else if(data?.type==='result')finish(null,data.result);
        else finish(Error(data?.message||'Invalid worker response.'));
      };
      worker.onerror=event=>{event.preventDefault?.();finish(Error('Comparison worker failed. Clear and retry.'));};
      worker.onmessageerror=()=>finish(Error('Comparison worker returned unreadable data.'));
      worker.postMessage(payload,[payload.first.objBytes.buffer,payload.second.objBytes.buffer]);
    }catch(error){
      if(active?.token===token)finish(error);else {worker?.terminate();reject(error);}
    }
  });
}
function number(n){return n.toFixed(2)+' cm';}
function signed(n){return (n>=0?'+':'')+number(n);}
function show(result,synthetic){
  report=synthetic?null:result;$('output').hidden=false;
  $('result-title').textContent=synthetic?'SYNTHETIC GEOMETRY CHECK — no person scanned':'Experimental repeat-scan comparison';
  $('summary').textContent=result.summary.computedLevels+' of '+result.summary.requestedLevels+' levels computed · '+number(result.heightM*100)+' recorded height · '+number(result.voxelStepCm)+' voxel grid. '+
    (result.summary.computedLevels?'Largest absolute perimeter difference: '+number(result.summary.maximumAbsolutePerimeterDifferenceCm)+'.':'No comparable single-contour levels.');
  const computed=result.sections.filter(s=>s.status==='computed');
  const maximum=Math.max(1,...computed.flatMap(s=>[s.first.perimeterCm,s.second.perimeterCm]));
  for(const row of result.sections){
    const tr=document.createElement('tr');
    const values=row.status==='computed'?[number(row.planeCm),number(row.first.perimeterCm),number(row.second.perimeterCm),signed(row.difference.perimeterCm.signed),signed(row.difference.widthCm.signed),signed(row.difference.depthCm.signed)]:[number(row.planeCm),'Rejected','—','—','—','—'];
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}$('rows').appendChild(tr);
    if(row.status!=='computed')continue;
    const group=document.createElement('div');group.className='bar-row';
    const label=document.createElement('div');label.textContent=number(row.planeCm)+' above floor';group.appendChild(label);
    for(const [key,labelText] of [['first','First'],['second','Second']]){
      const bar=document.createElement('div');bar.className='bar '+key+'-bar';bar.style.width=(row[key].perimeterCm/maximum*100)+'%';bar.setAttribute('aria-label',labelText+' perimeter '+number(row[key].perimeterCm));group.appendChild(bar);
    }
    $('chart').appendChild(group);
  }
  $('errors').textContent=result.sections.filter(s=>s.status==='rejected').map(s=>number(s.planeCm)+': '+s.rejected.map(r=>r.scan+' scan: '+r.reason).join(' ')).join('\n');
  $('warnings').textContent=result.warnings.join(' ');
  $('status').textContent=synthetic?'Synthetic worker check complete. Expected +4.00 cm perimeter, +2.00 cm width and 0.00 cm depth at each level. Export disabled.':'Comparison complete. Two scans can agree while sharing the same error; use independent references to evaluate accuracy.';
}
async function readPair(prefix){
  const obj=$(prefix+'-obj').files?.[0],method=$(prefix+'-method').files?.[0];
  if(!obj||!method)throw Error('Choose the '+prefix+' scan’s OBJ and matching method JSON.');
  if(!obj.size||obj.size>16*1024*1024||!method.size||method.size>256*1024)throw Error('Use OBJ files under 16 MB and method JSON files under 256 KB.');
  const objBytes=new Uint8Array(await obj.arrayBuffer());
  try{return {objBytes,methodText:await method.text()};}catch(error){objBytes.fill(0);throw error;}
}
async function execute(synthetic=false){
  if(active)return;
  const token=++generation;resetResult();controls(true);$('status').textContent='Reading local comparison files…';
  let first,second;
  try{
    if(!synthetic&&!$('permission').checked)throw Error('Confirm permission and independent captures before comparing.');
    const levelsCm=synthetic?[60,90,120]:$('levels').value.split(',').map(s=>s.trim()?Number(s):NaN);
    if(!levelsCm.length||levelsCm.length>12||levelsCm.some(n=>!Number.isFinite(n)||n<=0))throw Error('Enter 1–12 positive floor levels separated by commas.');
    first=synthetic?await syntheticPair(.54):await readPair('first');
    if(token!==generation)return;
    second=synthetic?await syntheticPair(.56):await readPair('second');
    if(token!==generation)return;
    const result=await runWorker({first,second,options:{levelsCm,independentCapturesConfirmed:true}},token);
    if(token===generation)show(result,synthetic);
  }catch(error){if(token===generation)$('status').textContent='Comparison rejected: '+error.message;}
  finally{
    // Transferred buffers are detached; any untransferred reads can be cleared here.
    for(const pair of [first,second])if(pair?.objBytes?.byteLength)pair.objBytes.fill(0);
    if(token===generation)controls(false);
  }
}
async function syntheticPair(width){
  const x=width/2,z=.27,h=1.8;
  const vertices=[[-x,0,-z],[x,0,-z],[x,h,-z],[-x,h,-z],[-x,0,z],[x,0,z],[x,h,z],[-x,h,z]],faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
  const text='# SYNTHETIC BOX — NO PERSON\n'+vertices.map(v=>'v '+v.join(' ')).join('\n')+'\n'+faces.map(f=>'f '+f.map(i=>i+1).join(' ')).join('\n')+'\n';
  const objBytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',objBytes);
  const record={schema:'PP_EXPERIMENTAL_SURFACE_V1',protocol:'orthographic-four-silhouette-v1',createdAt:new Date().toISOString(),meshSha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),experimental:true,units:'m',scaleStatus:'assumed-stature-not-validated',heightM:h,resolution:96,voxelStepM:h/96,vertices:8,triangles:12,reconstructionMs:0,
    views:['front','right','back','left'].map(view=>({view,model:'SYNTHETIC BOX FIXTURE',delegate:'NONE',segmentationMs:0,alignment:{width:80,height:120,centerX:40,top:10,bottom:110}}))};
  return {objBytes,methodText:JSON.stringify(record)};
}
for(const id of [...fileIds,'levels','permission'])$(id).onchange=resetResult;
$('levels').oninput=resetResult;
$('compare').onclick=()=>execute();$('synthetic').onclick=()=>execute(true);
$('cancel').onclick=()=>{cancel();resetResult();$('status').textContent='Comparison canceled. Worker released.';};
$('clear').onclick=()=>{cancel();for(const id of [...fileIds,'levels'])$(id).value='';$('permission').checked=false;resetResult();$('status').textContent='File references and results cleared from this page.';};
$('download').onclick=()=>{
  if(!report)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='experimental-repeat-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide',()=>{$('clear').onclick();});
