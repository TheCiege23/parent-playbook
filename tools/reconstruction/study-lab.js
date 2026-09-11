'use strict';
const $=id=>document.getElementById(id);
let scans=[],serial=0,generation=0,busy=false,active=null,report=null,evidenceHTML=null,isSynthetic=false;
function reset(){report=null;evidenceHTML=null;for(const id of ['output','evidence','evidence-frame'])$(id).hidden=true;$('evidence-frame').srcdoc='';$('rows').replaceChildren();$('groups').replaceChildren();for(const id of ['json','html','preview'])$(id).disabled=true;}
function controls(){for(const e of document.querySelectorAll('input,textarea,button'))e.disabled=busy;$('cancel').disabled=!busy;$('clear').disabled=false;$('json').disabled=busy||!report||isSynthetic;$('preview').disabled=busy||!report;$('html').disabled=busy||!evidenceHTML||isSynthetic;}
function queue(){
  $('queue').replaceChildren();
  for(const scan of scans){const div=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');text.textContent=scan.id+' · '+scan.participantCode+' · floor '+scan.planeCm+' cm · tape '+scan.referenceCm+' cm ';button.textContent='Remove '+scan.id;button.onclick=()=>{if(busy)return;scans=scans.filter(c=>c!==scan);reset();queue();controls();};div.appendChild(text);div.appendChild(button);$('queue').appendChild(div);}
}
$('add').onclick=()=>{
  if(busy)return;
  const obj=$('obj').files?.[0],method=$('method').files?.[0],participantCode=$('participant').value.trim(),planeCm=Number($('plane').value),referenceCm=Number($('tape').value);
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(participantCode)||!Number.isFinite(planeCm)||planeCm<.1||planeCm>249.9||!Number.isFinite(referenceCm)||referenceCm<.1||referenceCm>500){$('status').textContent='Enter a participant code and valid floor/tape measurements.';return;}
  if(!obj?.size||obj.size>16*1024*1024||!method?.size||method.size>256*1024){$('status').textContent='Choose an OBJ under 16 MB and matching JSON under 256 KB.';return;}
  if(scans.length>=8||scans.reduce((s,c)=>s+c.obj.size,0)+obj.size>64*1024*1024){$('status').textContent='Use at most 8 scans and 64 MB combined OBJ files.';return;}
  scans.push({id:'scan-'+(++serial),participantCode,planeCm,referenceCm,obj,method});reset();queue();controls();$('obj').value='';$('method').value='';$('status').textContent='Scan added. File matching and geometry will be checked when you compute the report.';
};
function stop(){generation++;if(active){const old=active;active=null;clearTimeout(old.timer);old.worker?.terminate();old.reject?.(Error('Canceled.'));}busy=false;controls();}
function workerRun(cases,options,token){return new Promise((resolve,reject)=>{
  let worker;
  const finish=(error,result)=>{if(active?.token!==token)return;clearTimeout(active.timer);active=null;worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();error?reject(error):resolve(result);};
  try{
    worker=new Worker('/study-worker.js');active={worker,reject,token,timer:setTimeout(()=>finish(Error('Reference computation timed out. Try fewer or smaller meshes.')),90000)};
    worker.onmessage=({data})=>{if(token!==generation)return;if(data?.type==='progress')$('status').textContent=data.message;else if(data?.type==='result')finish(null,data.result);else finish(Error(data?.message||'Invalid worker response.'));};
    worker.onerror=e=>{e.preventDefault?.();finish(Error('Reference worker failed.'));};worker.onmessageerror=()=>finish(Error('Unreadable worker response.'));
    worker.postMessage({cases,options},cases.map(c=>c.objBytes.buffer));
  }catch(error){if(active?.token===token)finish(error);else{worker?.terminate();reject(error);}}
});}
function cm(n){return Number.isFinite(n)?n.toFixed(2)+' cm':'—';}
function show(result){
  report=result;$('output').hidden=false;$('evidence').hidden=false;
  $('report-title').textContent=isSynthetic?'SYNTHETIC REFERENCE SERIES — no person scanned':'Experimental reference observations';
  $('summary').textContent=result.summary.computed+' computed / '+result.summary.attempted+' attempted · '+result.summary.rejected+' rejected · '+result.summary.submittedParticipantCodes+' submitted participant codes.';
  for(const r of result.rows){const tr=document.createElement('tr');for(const value of [r.id+' / '+r.participantCode,cm(r.planeCm),cm(r.referenceCm),cm(r.surfacePerimeterCm),r.status==='computed'?cm(r.signedErrorCm):r.reason]){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}$('rows').appendChild(tr);}
  for(const g of result.methodGroups){const p=document.createElement('p');p.textContent=g.id+': '+g.computed+' / '+g.attempted+' computed; '+g.participantsWithResults+' participant codes with results. Mean signed error '+cm(g.meanSignedErrorCm)+'; mean absolute error '+cm(g.meanAbsoluteErrorCm)+'; maximum absolute error '+cm(g.maximumAbsoluteErrorCm)+'.';$('groups').appendChild(p);}
  $('status').textContent=isSynthetic?'Synthetic reference check complete. Two computed observations and one duplicate rejection expected. Exports disabled.':'Reference report computed. Review all rejections before using the evidence brief.';
}
async function run(synthetic=false){
  if(busy)return;
  const token=++generation;isSynthetic=synthetic;reset();busy=true;controls();let cases=[];
  try{
    const options=synthetic?{permissionConfirmed:true,location:'SYNTHETIC box midpoint',procedure:'Analytical fixture references; no person or physical tape measurement.'}:{permissionConfirmed:$('permission').checked,location:$('location').value,procedure:$('procedure').value};
    if(!options.permissionConfirmed)throw Error('Confirm permission and independently recorded references.');
    if(!options.location.trim()||!options.procedure.trim())throw Error('Describe the location and measurement procedure.');
    if(synthetic)cases=await syntheticCases();
    else{
      if(!scans.length)throw Error('Add at least one reference scan.');
      for(const scan of scans){
        $('status').textContent='Reading '+scan.id+' locally…';const objBytes=new Uint8Array(await scan.obj.arrayBuffer());
        const item={id:scan.id,participantCode:scan.participantCode,planeCm:scan.planeCm,referenceCm:scan.referenceCm,objBytes};cases.push(item);
        if(token!==generation)return;item.methodText=await scan.method.text();if(token!==generation)return;
      }
    }
    if(token!==generation)return;
    const result=await workerRun(cases,options,token);if(token===generation)show(result);
  }catch(error){if(token===generation)$('status').textContent='Reference report failed: '+error.message;}
  finally{for(const c of cases)if(c.objBytes?.byteLength)c.objBytes.fill(0);if(token===generation){busy=false;controls();}}
}
async function preview(){
  if(busy||!report)return;
  const token=generation,snapshot=report;busy=true;controls();
  try{
    const response=await fetch('/progress.json',{cache:'no-store'});if(!response.ok)throw Error('Could not load the fixed parity rubric.');
    const progress=await response.json();if(token!==generation||report!==snapshot)return;
    evidenceHTML=EvidenceReport.render(snapshot,progress,{synthetic:isSynthetic});$('evidence-frame').srcdoc=evidenceHTML;$('evidence-frame').hidden=false;
    $('status').textContent='Evidence brief ready. The parity score comes from the existing rubric; reference results do not change it.';
  }catch(error){if(token===generation)$('status').textContent=error.message;}
  finally{if(token===generation){busy=false;controls();}}
}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('run').onclick=()=>run();$('synthetic').onclick=()=>run(true);$('preview').onclick=preview;
$('json').onclick=()=>{if(report&&!isSynthetic)download(JSON.stringify(report,null,2),'experimental-reference-series.json','application/json');};
$('html').onclick=()=>{if(evidenceHTML&&!isSynthetic)download(evidenceHTML,'parent-playbook-evidence.html','text/html');};
$('cancel').onclick=()=>{stop();reset();$('status').textContent='Computation canceled; worker released.';};
$('clear').onclick=()=>{stop();scans=[];serial=0;isSynthetic=false;for(const id of ['obj','method','participant','plane','tape','location','procedure'])$(id).value='';$('permission').checked=false;reset();queue();$('status').textContent='All file references, observations and evidence previews cleared.';};
for(const id of ['location','procedure'])$(id).oninput=()=>{reset();controls();};
$('permission').onchange=()=>{reset();controls();};window.addEventListener('pagehide',()=>{$('clear').onclick();});
async function syntheticCases(){
  const result=[];
  for(const [i,width,referenceCm] of [[1,.54,214],[2,.56,222],[3,.54,214]]){
    const x=width/2,z=.27,h=1.8,vertices=[[-x,0,-z],[x,0,-z],[x,h,-z],[-x,h,-z],[-x,0,z],[x,0,z],[x,h,z],[-x,h,z]],faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
    const text='# SYNTHETIC FIXTURE\n'+vertices.map(v=>'v '+v.join(' ')).join('\n')+'\n'+faces.map(f=>'f '+f.map(i=>i+1).join(' ')).join('\n');
    const objBytes=new TextEncoder().encode(text),hash=await crypto.subtle.digest('SHA-256',objBytes);
    const record={schema:'PP_EXPERIMENTAL_SURFACE_V1',createdAt:new Date().toISOString(),meshSha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''),protocol:'orthographic-four-silhouette-v1',experimental:true,units:'m',scaleStatus:'assumed-stature-not-validated',heightM:h,resolution:96,voxelStepM:h/96,vertices:8,triangles:12,reconstructionMs:0,views:['front','right','back','left'].map(view=>({view,model:'SYNTHETIC BOX FIXTURE',delegate:'NONE',segmentationMs:0,alignment:{width:80,height:120,centerX:40,top:10,bottom:110}}))};
    result.push({id:'synthetic-'+i,participantCode:'fixture_01',planeCm:90,referenceCm,objBytes,methodText:JSON.stringify(record)});
  }
  return result;
}
