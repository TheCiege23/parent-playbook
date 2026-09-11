import {createBodyScanner,renderSurfacePreview} from '/js/body-sdk.mjs';
import {createSurfaceReport,surfaceReportHTML} from '/js/body-surface-report.mjs';
import {createPoseRepeatSnapshot,createPoseRepeatReport,poseRepeatReportHTML} from '/js/body-surface-repeat.mjs';
import {measurementSummaryHTML,measurementReportHTML,measurementReportStyles,summarizeMeasurementResult} from '/js/body-sdk-report.mjs';
import {createCompanyAssessmentStore} from '/js/body-sdk-record.mjs';
const scanner = createBodyScanner(), views = ['front', 'right', 'back', 'left'];
const $ = id => document.getElementById(id);
$('measurementStyles').textContent=measurementReportStyles;
let controller = null, result = null, generation = 0;
let surfaceResult=null,disposeSurface=null;
let sectionResult=null;
let selectedPoseMarker=null;
let locations=[];
let repeatBaseline=null,repeatCurrent=null,repeatReport=null;
let companyExportUrl=null;
const companyRecords=new Map();
const previews = new Map();
const companyKey=scope=>[scope.organizationId,scope.subjectId,scope.assessmentId].join('|');
function companySession(){
  if(!$('companySession').checked)return {authenticated:false};
  const actorId=$('companyActor').value.trim(),organizationId=$('companyOrg').value.trim();
  return {authenticated:true,actorId,organizationId,sessionId:'local-rehearsal:'+actorId+':'+organizationId};
}
function companySessionMatches(session){const current=companySession();return current.authenticated===true&&current.actorId===session.actorId&&current.organizationId===session.organizationId&&current.sessionId===session.sessionId;}
function clearCompanyExportDownload(){
  if(companyExportUrl)URL.revokeObjectURL(companyExportUrl);
  companyExportUrl=null;
  const link=$('companyExportDownload');
  link.hidden=true;link.removeAttribute('href');link.removeAttribute('download');
}
function prepareCompanyExportDownload(exported){
  clearCompanyExportDownload();
  companyExportUrl=URL.createObjectURL(new Blob([exported.content],{type:exported.mediaType}));
  const link=$('companyExportDownload');
  link.href=companyExportUrl;link.download=exported.filename;link.hidden=false;
}
const companyStore=createCompanyAssessmentStore({
  async getSession(){return companySession();},
  async authorize(scope,session){return companySessionMatches(session)&&scope.organizationId===session.organizationId&&scope.subjectId===$('companySubject').value.trim();},
  async put(record,scope,session){if(!companySessionMatches(session)||record.organizationId!==session.organizationId||record.createdBy!==session.actorId)throw Error('Local host write denied.');companyRecords.set(companyKey(scope),JSON.parse(JSON.stringify(record)));},
  async get(scope,session){if(!companySessionMatches(session))throw Error('Local host read denied.');const record=companyRecords.get(companyKey(scope));return record?JSON.parse(JSON.stringify(record)):null;},
  async remove(scope,session){if(!companySessionMatches(session))throw Error('Local host delete denied.');return companyRecords.delete(companyKey(scope));},
});
const advice = {
  no_person: 'The model could not locate a body. Check that the preview is the correct photo and is upright. Try a PNG or JPEG exported from the original.',
  multiple_people: 'More than one person was detected. Use a photo with only the subject visible.',
  frame_edge: 'The body reaches the photo edge. Retake with space above the head and below both feet.',
  body_hidden: 'Shoulders, hips, knees or ankles were not clear enough to measure.',
  head_or_feet_hidden: 'The model could not locate the head or feet clearly.',
  too_small_or_not_upright: 'Stand upright and fill more of the frame while keeping the head and feet fully visible.',
  incomplete_landmarks: 'The model could not read a complete body pose.',
};
function releasePreview(view) {
  const url=previews.get(view);if(url)URL.revokeObjectURL(url);previews.delete(view);
  const img=$('preview-'+view);img.hidden=true;img.removeAttribute('src');img.onload=null;img.onerror=null;
}
async function previewPhoto(view) {
  releasePreview(view);const file=$(view).files[0],note=$(view+'-status');if(!file){note.textContent='No photo selected.';return;}
  let previewFile=file;
  if(/^image\/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name||'')){
    if(!$('permission').checked){note.textContent='Confirm permission above, then select this HEIC photo again to convert it locally.';return;}
    const token=++generation;controller=new AbortController();const signal=controller.signal;setBusy(true);note.textContent='Converting HEIC on this device…';
    try{const {importScanPhoto}=await import('/js/photo-import.mjs');if(token!==generation)return;
      const converted=await importScanPhoto(file,{signal,permissionAcknowledged:true});if(token!==generation)return;previewFile=converted.blob;
    }catch(error){if(token===generation)note.textContent=error.message;return;}
    finally{if(token===generation){controller=null;setBusy(false);}}
  }
  const url=URL.createObjectURL(previewFile),img=$('preview-'+view);previews.set(view,url);
  img.onload=()=>{if(previews.get(view)!==url||note.textContent!=='Photo changed; review again.')return;note.textContent=file.name+' · '+img.naturalWidth+' × '+img.naturalHeight+' · not reviewed yet. Check the photo and orientation.';};
  img.onerror=()=>{if(previews.get(view)!==url)return;releasePreview(view);note.textContent='The selected file could not be displayed. Export a fresh PNG or JPEG from the original.';};
  img.hidden=false;img.src=url;note.textContent='Photo changed; review again.';
}
for (const view of views) {
  const div = document.createElement('div'); div.className = 'view';
  div.innerHTML = `<label>${view[0].toUpperCase()+view.slice(1)} photo <input type="file" id="${view}" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"></label><img id="preview-${view}" hidden alt="Selected ${view} photo preview" style="width:100%;height:240px;object-fit:contain"><button type="button" data-view="${view}">Review ${view}</button><p id="${view}-status">No review yet.</p>`;
  $('views').append(div);
  div.querySelector('button').onclick = () => perform(view);
  $(view).onchange = () => { resetResult(); return previewPhoto(view); };
}
function resetResult() {
  locations=[];renderLocations();
  resetSection();$('sectionTools').hidden=true;
  disposeSurface?.();disposeSurface=null;
  if(surfaceResult?.surface?.mesh){surfaceResult.surface.mesh.vertices.length=surfaceResult.surface.mesh.faces.length=0;}
  surfaceResult=null;selectedPoseMarker=null;$('surfacePreview').replaceChildren();$('surfacePreview').hidden=true;$('posePlanesNote').textContent='No pose-derived planes available.';
  $('surfaceOutcome').hidden=true;$('surfaceOutcomeResult').textContent='';$('surfaceOutcomeDownload').disabled=true;
  result = null; $('download').disabled = true; $('result').textContent = 'No result yet.';
  $('measurementDashboard').hidden=true;$('measurementCards').innerHTML='';$('measurementPrint').disabled=true;
  $('companySave').disabled=true;
}
function setBusy(busy) {
  for (const element of document.querySelectorAll('input,button')) element.disabled = busy;
  $('cancel').disabled = !busy; $('clear').disabled = false;
  $('download').disabled = busy || !result;
  $('sectionMeasure').disabled=busy||!surfaceResult?.surface?.mesh;
  const markerKeys=['shoulder_midpoint','torso_midpoint','hip_midpoint'];
  for(const [id,key] of [['sectionShoulder',markerKeys[0]],['sectionTorso',markerKeys[1]],['sectionHip',markerKeys[2]]])$(id).disabled=busy||!surfaceResult?.surface?.posePlanes?.markers?.some(marker=>marker.key===key);
  $('sectionDownload').disabled=busy||!sectionResult;
  $('locationAdd').disabled=busy||!sectionResult||locations.length>=12;
  $('locationsJSON').disabled=busy||!locations.length;
  $('locationsHTML').disabled=busy||!locations.length;
  $('repeatBaseline').disabled=busy||locations.length!==3;
  $('repeatCompare').disabled=busy||!repeatBaseline||locations.length!==3;
  $('repeatJSON').disabled=$('repeatHTML').disabled=busy||!repeatReport;
  $('surfaceOutcomeDownload').disabled=busy||!surfaceResult;
  $('measurementPrint').disabled=busy||!result||$('measurementDashboard').hidden;
  $('companySave').disabled=busy||!result;
  for(const id of ['companyReopen','companyExport','companyDelete'])$(id).disabled=busy;
}
function resetSection(){sectionResult=null;disposeSurface?.setSectionPlane?.(null);$('sectionDownload').disabled=true;$('locationAdd').disabled=true;$('sectionResult').textContent='No surface section yet.';const c=$('sectionContour');c.width=c.height=0;}
function resetRepeatReport(){repeatCurrent=null;repeatReport=null;$('repeatJSON').disabled=$('repeatHTML').disabled=true;$('repeatResult').textContent='No repeat comparison yet.';}
function clearRepeatBaseline(){repeatBaseline=null;resetRepeatReport();$('repeatStatus').textContent='No baseline saved.';$('repeatBaseline').disabled=locations.length!==3;$('repeatCompare').disabled=true;}
function poseMarker(key){
  const planes=surfaceResult?.surface?.posePlanes,marker=planes?.markers?.find(item=>item.key===key);
  return marker&&planes.protocol==='four-view-pose-plane-markers-v1'?{protocol:planes.protocol,key:marker.key,label:marker.label,inputViewCount:planes.inputViewCount,planeCm:marker.planeCm,maxViewSpreadCm:marker.maxViewSpreadCm}:null;
}
function usePoseMarker(key){
  const marker=poseMarker(key);if(!marker)return;selectedPoseMarker=marker;$('sectionLabel').value=marker.label;$('sectionPlane').value=marker.planeCm;resetSection();disposeSurface?.setSectionPlane?.(marker.planeCm);
  $('status').textContent=marker.label+' selected at '+marker.planeCm.toFixed(1)+' cm above floor. Four-view spread: '+marker.maxViewSpreadCm.toFixed(1)+' cm.';
}
function renderLocations(){
  resetRepeatReport();
  const host=$('locationList');host.replaceChildren();$('locationCount').textContent=locations.length+' of 12 locations kept for this surface';
  locations.forEach((entry,index)=>{const row=document.createElement('div'),text=document.createElement('p'),remove=document.createElement('button');
    text.textContent=entry.label+' · '+entry.planeCm+' cm above floor · '+entry.surfacePerimeterCm.toFixed(1)+' cm perimeter';
    remove.textContent='Remove location '+(index+1);remove.onclick=()=>{locations.splice(index,1);renderLocations();$('locationAdd').disabled=!sectionResult||locations.length>=12;};row.append(text,remove);host.append(row);
  });
  $('locationsJSON').disabled=$('locationsHTML').disabled=!locations.length;
  $('repeatBaseline').disabled=locations.length!==3;$('repeatCompare').disabled=!repeatBaseline||locations.length!==3;
}
$('locationAdd').onclick=()=>{
  if(!sectionResult)return;
  try{createSurfaceReport([...locations,sectionResult]);locations.push(JSON.parse(JSON.stringify(sectionResult)));renderLocations();$('locationAdd').disabled=true;$('status').textContent='Location added to this surface report. Measure another marked level to add it.';}
  catch(error){$('status').textContent=error.message;}
};
function downloadLocations(format){
  if(!locations.length||!$('permission').checked||!$('surfaceEnabled').checked)return;
  try{const content=format==='html'?surfaceReportHTML(locations):JSON.stringify(createSurfaceReport(locations),null,2),url=URL.createObjectURL(new Blob([content],{type:format==='html'?'text/html':'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='experimental-surface-locations.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){$('status').textContent=error.message;}
}
$('locationsJSON').onclick=()=>downloadLocations('json');
$('locationsHTML').onclick=()=>downloadLocations('html');
$('repeatBaseline').onclick=()=>{
  try{repeatBaseline=createPoseRepeatSnapshot(locations);resetRepeatReport();$('repeatStatus').textContent='Baseline kept from this surface. Load and run four new photos, then add the same three pose sections.';$('repeatCompare').disabled=true;}
  catch(error){$('repeatStatus').textContent=error.message;}
};
$('repeatCompare').onclick=()=>{
  try{repeatCurrent=createPoseRepeatSnapshot(locations);repeatReport=createPoseRepeatReport(repeatBaseline,repeatCurrent);$('repeatResult').textContent=JSON.stringify(repeatReport,null,2);$('repeatStatus').textContent='Repeat comparison computed. Agreement does not establish accuracy; compare both captures with tape references.';$('repeatJSON').disabled=$('repeatHTML').disabled=false;}
  catch(error){resetRepeatReport();$('repeatStatus').textContent=error.message;}
};
function downloadRepeat(format){
  if(!repeatReport||!repeatBaseline||!repeatCurrent||!$('permission').checked||!$('surfaceEnabled').checked)return;
  try{const content=format==='html'?poseRepeatReportHTML(repeatBaseline,repeatCurrent):JSON.stringify(repeatReport,null,2),url=URL.createObjectURL(new Blob([content],{type:format==='html'?'text/html':'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='experimental-pose-section-repeat.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){$('repeatStatus').textContent=error.message;}
}
$('repeatJSON').onclick=()=>downloadRepeat('json');$('repeatHTML').onclick=()=>downloadRepeat('html');
for(const id of ['sectionLabel','sectionPlane'])$(id).oninput=()=>{selectedPoseMarker=null;resetSection();};
$('sectionTape').oninput=resetSection;
$('sectionShoulder').onclick=()=>usePoseMarker('shoulder_midpoint');
$('sectionTorso').onclick=()=>usePoseMarker('torso_midpoint');
$('sectionHip').onclick=()=>usePoseMarker('hip_midpoint');
$('sectionMeasure').onclick=async()=>{
  if(!surfaceResult?.surface?.mesh)return;
  const run=++generation,source=surfaceResult;controller=new AbortController();resetSection();setBusy(true);$('status').textContent='Calculating the selected surface perimeter…';
  try{
    const output=await scanner.measureSurfaceSection({surface:source.surface,planeCm:Number($('sectionPlane').value),label:$('sectionLabel').value,
      referenceCm:$('sectionTape').value.trim()===''?null:Number($('sectionTape').value),markerKey:selectedPoseMarker?.key??null,permissionAcknowledged:$('permission').checked,surfacePermissionAcknowledged:$('surfaceEnabled').checked,signal:controller.signal});
    if(run!==generation||source!==surfaceResult)return;
    sectionResult=output.section;$('sectionResult').textContent=JSON.stringify(sectionResult,null,2);
    disposeSurface?.setSectionPlane?.(sectionResult.planeCm);
    const points=output.contourPoints,c=$('sectionContour'),ctx=c.getContext('2d');c.width=480;c.height=320;
    const xs=points.map(p=>p[0]),zs=points.map(p=>p[2]),xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs),scale=Math.min(420/(xmax-xmin||1),260/(zmax-zmin||1));
    ctx.strokeStyle='#b5e997';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>{const x=240+(p[0]-(xmin+xmax)/2)*scale,y=160-(p[2]-(zmin+zmax)/2)*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.stroke();output.contourPoints.length=0;
    const r=sectionResult.reference;$('status').textContent='Experimental surface perimeter: '+sectionResult.surfacePerimeterCm.toFixed(1)+' cm.'+(r?' Tape difference: '+(r.signedErrorCm>=0?'+':'')+r.signedErrorCm.toFixed(1)+' cm.':' No tape comparison entered.')+' Anatomical accuracy remains unvalidated.';
  }catch(error){if(run===generation)$('status').textContent=error.code+': '+error.message;}
  finally{if(run===generation){controller=null;setBusy(false);}}
};
$('sectionDownload').onclick=()=>{
  if(!sectionResult)return;const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'PP_SURFACE_SECTION_REPORT_V1',section:sectionResult},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='experimental-surface-section.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
async function perform(view) {
  const run = ++generation; controller = new AbortController(); resetResult(); setBusy(true);
  $('status').textContent = 'Starting local processing…';
  try {
    const common = {permissionAcknowledged: $('permission').checked, signal: controller.signal,
      onProgress: message => { if (run === generation) $('status').textContent = message; }};
    const scanOptions={...common,heightIn:Number($('height').value),frames:Object.fromEntries(views.map(v=>[v,$(v).files[0]]))};
    const combined=!view&&$('surfaceEnabled').checked;
    const output = view ? await scanner.reviewPhoto({...common, view, frame: $(view).files[0]}) : combined ? await scanner.scanWithSurface({...scanOptions,
      surfacePermissionAcknowledged:$('surfaceEnabled').checked,
      checkPermission:()=>run===generation&&$('permission').checked&&$('surfaceEnabled').checked,
      mountReview:html=>{const host=document.createElement('div');host.innerHTML=html;$('surfaceReview').append(host);host.scrollIntoView({block:'start'});return host;}
    }) : await scanner.scan(scanOptions);
    if (run !== generation) return;
    if (view) {
      $(view+'-status').textContent = (output.accepted ? 'Capture checks passed. ' : 'Retake: ') + [...output.reasons, ...output.warnings].map(r => r.message).join(' ');
      $('status').textContent = 'Photo review finished; it does not validate measurement accuracy.';
    } else {
      result=combined?output.assessment:output;
      for(const check of result.captureChecks||[])if(views.includes(check.view))$(check.view+'-status').textContent=check.accepted?'Capture checks passed.'+(check.warnings?.length?' Advisory: '+check.warnings.join(', ')+'.':''):'Capture checks did not pass.';
      if(combined){surfaceResult=output;if(output.surface){$('surfacePreview').hidden=false;$('sectionTools').hidden=false;disposeSurface=renderSurfacePreview($('surfacePreview'),output.surface,{retentionNotice:'This demo clears geometry when inputs change, you select Clear, or you leave. Geometry is excluded from the JSON download.'});
        const planes=output.surface.posePlanes;$('posePlanesNote').textContent=planes?.markers?.length===3?'Three experimental plane guides are available from four reviewed pose views. Each button shows the view-to-view spread when selected.':'No valid four-view pose-derived planes are available for this surface.';}}
      if(combined){$('surfaceOutcome').hidden=false;$('surfaceOutcomeResult').textContent=JSON.stringify(surfaceAttempt(),null,2);}
      $('status').textContent=`Returned ${result.measurements.length} provisional estimates. Measurement processing: ${(result.processingMs/1000).toFixed(1)} seconds.`+(combined?' Experimental 3D: '+output.surfaceStatus+'.':'');
      if(combined&&output.surfaceFailure)$('status').textContent+=' '+output.surfaceFailure.message+' Your length estimates are still available.';
      renderMeasurementDashboard();
      $('companySave').disabled=false;
      if(evidenceEnabled()&&globalThis.DeviceEvidence&&$('deviceEvidence')){$('deviceEvidence').hidden=false;$('deviceEvidence').disabled=false;}
    }
    $('result').textContent = JSON.stringify(view?output:result, null, 2);
  } catch (error) {
    if (run === generation) {
      const failed=(error.captureChecks||[]).filter(c=>!c.accepted);
      for(const check of error.captureChecks||[]) $(check.view+'-status').textContent=check.accepted?'Capture checks passed.':'Retake / re-export: '+check.reasons.map(code=>advice[code]||code.replaceAll('_',' ')).join(' ');
      $('status').textContent=failed.length?'Check '+failed.map(c=>c.view).join(', ')+'. '+failed.map(c=>c.view+': '+c.reasons.map(code=>advice[code]||code.replaceAll('_',' ')).join(' ')).join(' '):`${error.code || error.name}: ${error.message}`;
      if(view&&!failed.length)$(view+'-status').textContent=error.message;
    }
  }
  finally { if (run === generation) {controller = null; setBusy(false);} }
}
// ---- device-session evidence --------------------------------------------------------
// Records HOW a run happened — which build served the page, what device ran it, how long it
// took, how many of the defined outputs came back — and never WHAT it measured. Opt in with
// ?evidence=1; a company evaluating the SDK has no use for it and should not meet a control
// that exists so we can evidence our own capability claims.
//
// This demo is the surface the authorized adult reference set actually runs through, which
// is why the control has to exist here and not only in the parent application.
function evidenceEnabled(){
  try{ return new URLSearchParams(location.search).get('evidence')==='1'; }catch(e){ return false; }
}
// Bound only if the control is in this DOM. A host that trims the page, or a test harness
// that builds a minimal one, must not fail to load the whole demo module over a button that
// exists for our own evidence capture.
if($('deviceEvidence')) $('deviceEvidence').onclick = async () => {
  const button=$('deviceEvidence'), label=button.textContent;
  // Two different causes, told apart: a build without the module can do nothing, whereas a
  // build with no scan yet just needs a scan. One message for both sends the reader looking
  // in the wrong place.
  if(!globalThis.DeviceEvidence){ $('status').textContent='Session evidence is unavailable on this build.'; return; }
  if(!result){ $('status').textContent='Run a four-photo scan first; there is nothing to record yet.'; return; }
  button.disabled=true; button.textContent='Collecting…';
  try{
    const DE=globalThis.DeviceEvidence;
    const seen=await DE.collectDeviceEvidence();
    // runFromSummary reduces a result to counts and provenance. summarizeMeasurementResult
    // is what computes missingOutputs, so the count of what did NOT come back is the SDK's
    // own answer rather than something recomputed here.
    const summary=summarizeMeasurementResult({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:result.sdkVersion,
      createdAt:result.createdAt||new Date().toISOString(),status:'provisional',outputDictionary:'body-outputs-v2',
      heightIn:result.heightIn,processingMs:result.processingMs,engine:result.engine,
      measurements:(result.measurements||[]).map(m=>({key:m.key,value:m.value,unit:'in',definition:m.definition}))},
      {unit:'in',surfaceStatus:surfaceResult?.surfaceStatus||'not_requested'});
    const evidence=DE.buildDeviceEvidence({
      recordedAt:new Date().toISOString(),
      build:{serviceWorkerCache:seen.serviceWorkerCache,origin:seen.origin,buildSource:seen.buildSource},
      device:{userAgent:seen.userAgent,viewportWidth:seen.viewportWidth,viewportHeight:seen.viewportHeight,
        pixelRatio:seen.pixelRatio,standalone:seen.standalone,maxTouchPoints:seen.maxTouchPoints},
      run:DE.runFromSummary(summary),
      note:'Company SDK demo, four-photo scan.',
    });
    const name='device-session-'+evidence.build.serviceWorkerCache+'-'
      +evidence.recordedAt.slice(0,19).replace(/[:T-]/g,'')+'.json';
    const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('status').textContent='Session evidence saved as '+name+'. It contains no measurement, height or identifier.';
  }catch(error){
    console.error(error);
    $('status').textContent='Could not build session evidence: '+(error&&error.message||error);
  }
  button.disabled=false; button.textContent=label;
};
$('scan').onclick = () => perform();
function reportOptions(){return {unit:$('measurementUnit').value||'in',surfaceStatus:surfaceResult?.surfaceStatus||'not_requested'};}
function renderMeasurementDashboard(){
  try{$('measurementCards').innerHTML=measurementSummaryHTML(result,reportOptions());$('measurementDashboard').hidden=false;}
  catch{$('measurementDashboard').hidden=true;$('measurementCards').innerHTML='';}
}
$('measurementUnit').onchange=()=>{if(result)renderMeasurementDashboard();};
$('measurementPrint').onclick=()=>{
  if(!result||!$('permission').checked)return;
  try{const url=URL.createObjectURL(new Blob([measurementReportHTML(result,reportOptions())],{type:'text/html'})),a=document.createElement('a');a.href=url;a.download='parent-playbook-measurement-report.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(error){$('status').textContent=error.message;}
};
function companyPointer(){return {assessmentId:$('companyAssessmentId').value.trim(),subjectId:$('companySubject').value.trim()};}
function companyMessage(message,record=null){$('companyStatus').textContent=message;$('companyRecord').textContent=record?JSON.stringify(record,null,2):'No company record open.';}
$('companySave').onclick=async()=>{
  if(!result)return;
  clearCompanyExportDownload();
  const surfaceStatus=surfaceResult?.surfaceStatus||'not_requested',attempt=surfaceResult?surfaceAttempt():null;
  const surfaceProcessing=attempt?{schema:'PP_COMPANY_SURFACE_PROCESSING_V1',status:surfaceStatus,adjustment:attempt.surfaceAdjustment}:null;
  try{const record=await companyStore.save(result,{...companyPointer(),consentReference:$('companyConsent').value.trim(),surfaceStatus,surfaceProcessing});companyMessage('Saved through the authenticated host contract. A retry with this assessment ID is safe when the host implements an idempotent upsert.',record);}
  catch(error){companyMessage((error.code||error.name)+': '+error.message);}
};
$('companyReopen').onclick=async()=>{clearCompanyExportDownload();try{const record=await companyStore.reopen(companyPointer());companyMessage('Reopened after fresh session and access checks.',record);}catch(error){companyMessage((error.code||error.name)+': '+error.message);}};
$('companyExport').onclick=async()=>{clearCompanyExportDownload();try{const exported=await companyStore.exportRecord(companyPointer());prepareCompanyExportDownload(exported);companyMessage('Fresh authorization passed. Download the prepared scalar record below; it contains no photos, landmarks or geometry.',exported.record);}catch(error){companyMessage((error.code||error.name)+': '+error.message);}};
$('companyDelete').onclick=async()=>{clearCompanyExportDownload();try{await companyStore.delete(companyPointer());companyMessage('Deleted after a fresh session and access check.');}catch(error){companyMessage((error.code||error.name)+': '+error.message);}};
for(const id of ['companySession','companyOrg','companyActor','companySubject','companyAssessmentId'])$(id).addEventListener('change',clearCompanyExportDownload);
function surfaceAttempt(){const adjustment=surfaceResult.surface?.mesh?.topologyAdjustment;return {schema:'PP_SURFACE_ATTEMPT_V1',sdkVersion:surfaceResult.sdkVersion,assessmentCreatedAt:surfaceResult.assessment?.createdAt||null,
  surfaceStatus:surfaceResult.surfaceStatus,surfaceFailure:surfaceResult.surfaceFailure||null,
  surfaceAdjustment:adjustment?{protocol:adjustment.protocol,componentCountBefore:adjustment.componentCountBefore,originalOccupiedVoxels:adjustment.originalOccupiedVoxels,
    removedVoxels:adjustment.removedVoxels,removedFraction:adjustment.removedFraction,affectedFromFloorFraction:adjustment.affectedFromFloorFraction,affectedToFloorFraction:adjustment.affectedToFloorFraction}:null,
  limitations:'Scalar processing outcome only. No photos, masks, landmarks or mesh. Connectivity and topology-adjustment diagnostics are not measurement-accuracy scores.'};}
$('surfaceOutcomeDownload').onclick=()=>{
  if(!surfaceResult||!$('permission').checked||!$('surfaceEnabled').checked)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(surfaceAttempt(),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='experimental-surface-attempt.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('cancel').onclick = () => controller?.abort();
$('clear').onclick = () => {
  generation++; controller?.abort(); controller = null;
  for (const view of views) { releasePreview(view); $(view).value = ''; $(view+'-status').textContent = 'No review yet.'; }
  $('permission').checked = false; resetResult(); clearRepeatBaseline(); clearCompanyExportDownload(); setBusy(false); $('status').textContent = 'Photos and results cleared from this page.';
  $('surfaceEnabled').checked=false;
};
$('height').oninput = resetResult;
$('surfaceEnabled').onchange=()=>{if(!$('surfaceEnabled').checked)clearRepeatBaseline();resetResult();};
$('permission').onchange = async()=>{
  if(!$('permission').checked)clearRepeatBaseline();
  resetResult();
  if(!$('permission').checked)return;
  for(const view of views){
    if(!$('permission').checked)break;
    const file=$(view).files[0];
    if(file&&!previews.has(view)&&(/^image\/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name||'')))await previewPhoto(view);
  }
};
$('download').onclick = () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = 'parent-playbook-sdk-result.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('sample').onclick = async () => {
  const run = ++generation; controller = new AbortController(); resetResult(); setBusy(true); $('status').textContent = 'Downloading the public developer sample…';
  try {
    const response = await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg', {signal: controller.signal});
    if (!response.ok) throw Error('Public sample download failed.');
    const frame = await response.blob();
    const output = await scanner.reviewPhoto({frame, view: 'front', permissionAcknowledged: true, signal: controller.signal});
    if (run !== generation) return;
    $('result').textContent = JSON.stringify(output, null, 2); $('status').textContent = 'Real SDK worker review completed on the public sample. No body measurement or validation credit.';
  } catch (error) { if (run === generation) $('status').textContent = `${error.code || error.name}: ${error.message}`; }
  finally { if (run === generation) {controller = null; setBusy(false);} }
};
addEventListener('pagehide', () => {generation++; controller?.abort(); scanner.dispose();resetResult();clearCompanyExportDownload();companyRecords.clear();for(const view of views)releasePreview(view);});
