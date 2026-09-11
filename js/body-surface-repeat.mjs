import {createSurfaceReport} from './body-surface-report.mjs';

const KEYS=['shoulder_midpoint','torso_midpoint','hip_midpoint'];
const fail=message=>{throw Object.assign(new Error(message),{name:'BodyScanError',code:'INVALID_REPEAT_COMPARISON'});};
const finite=value=>typeof value==='number'&&Number.isFinite(value);

function validateSnapshot(input){
  if(input?.schema!=='PP_POSE_SECTION_SNAPSHOT_V1'||input.status!=='experimental'||!input.source||!Array.isArray(input.sections)||input.sections.length!==3)fail('Choose a complete three-plane pose section snapshot.');
  if(typeof input.createdAt!=='string'||input.createdAt.length>40||!Number.isFinite(Date.parse(input.createdAt)))fail('The repeat snapshot has an invalid creation time.');
  const source=input.source;
  if(source.protocol!=='orthographic-four-silhouette-v1'||source.fingerprintProtocol!=='surface-json-sha256-v1'||typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256)||!finite(source.heightM)||source.heightM<.8||source.heightM>2.5||!Number.isInteger(source.resolution)||source.resolution<24||source.resolution>128)fail('The repeat snapshot has invalid source provenance.');
  const seen=new Set(),sections=input.sections.map(section=>{
    const key=section?.key;
    if(!KEYS.includes(key)||seen.has(key)||section.protocol!=='pose-plane-surface-section-v1'||section.planeProtocol!=='four-view-pose-plane-markers-v1'||section.contourProtocol!=='unique-contour-containing-reconstruction-axis-v1')fail('The repeat snapshot must contain each supported pose plane exactly once.');
    seen.add(key);
    for(const value of [section.planeCm,section.maxViewSpreadCm,section.surfacePerimeterCm,section.widthCm,section.depthCm])if(!finite(value)||value<0)fail('The repeat snapshot contains an invalid measurement.');
    if(section.planeCm<=0||section.planeCm>=source.heightM*100||section.surfacePerimeterCm<=0||section.widthCm<=0||section.depthCm<=0||!Number.isInteger(section.candidateContourCount)||section.candidateContourCount<1||section.candidateContourCount>1000)fail('The repeat snapshot contains an invalid plane or contour selection.');
    if(typeof section.label!=='string'||!section.label.trim()||section.label.length>120)fail('The repeat snapshot has an invalid pose-plane label.');
    return {key,label:section.label.trim(),protocol:section.protocol,planeProtocol:section.planeProtocol,planeCm:section.planeCm,maxViewSpreadCm:section.maxViewSpreadCm,contourProtocol:section.contourProtocol,candidateContourCount:section.candidateContourCount,surfacePerimeterCm:section.surfacePerimeterCm,widthCm:section.widthCm,depthCm:section.depthCm};
  });
  if(KEYS.some(key=>!seen.has(key)))fail('The repeat snapshot is missing a supported pose plane.');
  return {schema:input.schema,status:'experimental',createdAt:String(input.createdAt||''),source:{protocol:source.protocol,heightM:source.heightM,resolution:source.resolution,fingerprintProtocol:source.fingerprintProtocol,sha256:source.sha256},sections};
}

export function createPoseRepeatSnapshot(sections){
  const report=createSurfaceReport(sections);
  if(report.sections.length!==3||report.sections.some(section=>section.protocol!=='pose-plane-surface-section-v1'))fail('Add shoulder, torso-midpoint and hip pose sections before keeping a repeat baseline.');
  const seen=new Set();
  const snapshot={schema:'PP_POSE_SECTION_SNAPSHOT_V1',status:'experimental',createdAt:new Date().toISOString(),source:report.source,sections:report.sections.map(section=>{
    const key=section.planeSource?.key;
    if(!KEYS.includes(key)||seen.has(key))fail('Add each supported pose plane exactly once before keeping a repeat baseline.');
    seen.add(key);
    return {key,label:section.label,protocol:section.protocol,planeProtocol:section.planeSource.protocol,planeCm:section.planeCm,maxViewSpreadCm:section.planeSource.maxViewSpreadCm,contourProtocol:section.contourSelection.protocol,candidateContourCount:section.contourSelection.candidateContourCount,surfacePerimeterCm:section.surfacePerimeterCm,widthCm:section.widthCm,depthCm:section.depthCm};
  })};
  return validateSnapshot(snapshot);
}

export function createPoseRepeatReport(firstInput,secondInput){
  const first=validateSnapshot(firstInput),second=validateSnapshot(secondInput);
  if(first.source.sha256===second.source.sha256)fail('The two section snapshots came from the same surface. Run a new four-photo capture.');
  if(first.source.protocol!==second.source.protocol||first.source.heightM!==second.source.heightM||first.source.resolution!==second.source.resolution)fail('Repeat comparison requires the same reconstruction protocol, recorded height and resolution.');
  const secondByKey=new Map(second.sections.map(section=>[section.key,section]));
  const sections=KEYS.map(key=>{
    const one=first.sections.find(section=>section.key===key),two=secondByKey.get(key);
    if(one.label!==two.label)fail('Both captures must use the same pose-plane labels.');
    const difference={planeCm:two.planeCm-one.planeCm,maxViewSpreadCm:two.maxViewSpreadCm-one.maxViewSpreadCm,surfacePerimeterCm:two.surfacePerimeterCm-one.surfacePerimeterCm,widthCm:two.widthCm-one.widthCm,depthCm:two.depthCm-one.depthCm};
    return {key,label:one.label,first:{planeCm:one.planeCm,maxViewSpreadCm:one.maxViewSpreadCm,candidateContourCount:one.candidateContourCount,surfacePerimeterCm:one.surfacePerimeterCm,widthCm:one.widthCm,depthCm:one.depthCm},second:{planeCm:two.planeCm,maxViewSpreadCm:two.maxViewSpreadCm,candidateContourCount:two.candidateContourCount,surfacePerimeterCm:two.surfacePerimeterCm,widthCm:two.widthCm,depthCm:two.depthCm},difference};
  });
  return {schema:'PP_POSE_SECTION_REPEAT_V1',protocol:'two-independent-four-view-pose-section-snapshots-v1',status:'experimental',createdAt:new Date().toISOString(),source:{heightM:first.source.heightM,resolution:first.source.resolution,firstSha256:first.source.sha256,secondSha256:second.source.sha256},sections,summary:{sectionCount:3,maximumAbsolutePlaneDifferenceCm:Math.max(...sections.map(section=>Math.abs(section.difference.planeCm))),maximumAbsolutePerimeterDifferenceCm:Math.max(...sections.map(section=>Math.abs(section.difference.surfacePerimeterCm)))},limitations:['Two captures are insufficient to establish population repeatability or anatomical accuracy.','Both scans may agree and still be wrong; independent tape references are required for accuracy.','Pose planes can move between captures, so plane-height and perimeter differences are reported together.','Only scalar section results and geometry fingerprints are retained; photos, landmarks, contours and meshes are excluded.','No pass threshold, anatomical girth label, clinical interpretation or FITMATCH equivalence is inferred.']};
}

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function poseRepeatReportHTML(first,second){
  const report=createPoseRepeatReport(first,second),n=value=>Number(value).toFixed(1),signed=value=>(value>=0?'+':'')+n(value);
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Experimental pose-section repeat comparison</title><style>body{font:16px system-ui;color:#19382e;max-width:1000px;padding:32px;margin:auto}p{line-height:1.6}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;text-align:left;border:1px solid #c8d3ce}code{overflow-wrap:anywhere}small{display:block;margin-top:20px}@media print{body{padding:0}tr{break-inside:avoid}}</style><h1>Experimental pose-section repeat comparison</h1><p>'+escape(report.limitations.join(' '))+'</p><p>Differences are second capture minus first capture. No accuracy or pass threshold is applied.</p><div style="overflow-x:auto"><table><thead><tr><th>Pose guide</th><th>Plane 1 / 2 (cm)</th><th>Plane change</th><th>Perimeter 1 / 2 (cm)</th><th>Perimeter change</th></tr></thead><tbody>'+report.sections.map(row=>'<tr><td>'+escape(row.label)+'</td><td>'+n(row.first.planeCm)+' / '+n(row.second.planeCm)+'</td><td>'+signed(row.difference.planeCm)+'</td><td>'+n(row.first.surfacePerimeterCm)+' / '+n(row.second.surfacePerimeterCm)+'</td><td>'+signed(row.difference.surfacePerimeterCm)+'</td></tr>').join('')+'</tbody></table></div><p>Largest absolute plane change: '+n(report.summary.maximumAbsolutePlaneDifferenceCm)+' cm. Largest absolute perimeter change: '+n(report.summary.maximumAbsolutePerimeterDifferenceCm)+' cm.</p><small>Generated '+escape(report.createdAt)+'<br>First surface: <code>'+escape(report.source.firstSha256)+'</code><br>Second surface: <code>'+escape(report.source.secondSha256)+'</code></small></html>';
}
