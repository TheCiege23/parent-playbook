// Scalar reports only. Geometry fingerprints identify an input, not its accuracy.
const fail=message=>{throw Object.assign(new Error(message),{name:'BodyScanError',code:'INVALID_SURFACE_REPORT'});};
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function createSurfaceReport(sections){
  if(!Array.isArray(sections)||!sections.length||sections.length>12)fail('Choose 1–12 measured locations from one surface.');
  const levels=new Set();let source=null;
  const rows=sections.map(s=>{
    if(!['operator-surface-section-v1','pose-plane-surface-section-v1'].includes(s?.protocol)||s.status!=='experimental'||s.axis!=='y'||s.scaleStatus!=='assumed-stature-not-validated')fail('Only supported experimental surface sections are accepted.');
    const x=s.source;
    if(x?.protocol!=='orthographic-four-silhouette-v1'||x.fingerprintProtocol!=='surface-json-sha256-v1'||typeof x.sha256!=='string'||!/^([a-f0-9]{64})$/.test(x.sha256)||!positive(x.heightM)||x.heightM<.8||x.heightM>2.5||!Number.isInteger(x.resolution)||x.resolution<24||x.resolution>128)fail('A valid source geometry fingerprint and scale are required.');
    const origin={protocol:x.protocol,heightM:x.heightM,resolution:x.resolution,fingerprintProtocol:x.fingerprintProtocol,sha256:x.sha256};
    if(source&&JSON.stringify(source)!==JSON.stringify(origin))fail('Every location must come from the same source surface and method.');source=origin;
    if(!positive(s.planeCm)||s.planeCm>=x.heightM*100||levels.has(s.planeCm))fail('Each location needs a distinct valid height above the floor. Remove the earlier reading before replacing that level.');levels.add(s.planeCm);
    if(typeof s.label!=='string'||!s.label.trim()||s.label.trim().length>120)fail('Describe each marked location in 1–120 characters.');
    let planeSource=null;
    if(s.protocol==='pose-plane-surface-section-v1'){
      const p=s.planeSource,keys=['shoulder_midpoint','torso_midpoint','hip_midpoint'];
      if(p?.protocol!=='four-view-pose-plane-markers-v1'||!keys.includes(p.key)||p.inputViewCount!==4||p.label!==s.label||!positive(p.planeCm)||Math.abs(p.planeCm-s.planeCm)>.051||typeof p.maxViewSpreadCm!=='number'||!Number.isFinite(p.maxViewSpreadCm)||p.maxViewSpreadCm<0||p.maxViewSpreadCm>x.heightM*100)fail('Pose-plane provenance must match the section label and height.');
      planeSource={protocol:p.protocol,key:p.key,label:p.label,inputViewCount:4,planeCm:p.planeCm,maxViewSpreadCm:p.maxViewSpreadCm};
    }else if(s.planeSource!=null)fail('Manual sections cannot claim pose-plane provenance.');
    let contourSelection=null;
    if(s.protocol==='pose-plane-surface-section-v1'){
      const c=s.contourSelection;if(c?.protocol!=='unique-contour-containing-reconstruction-axis-v1'||!Number.isInteger(c.candidateContourCount)||c.candidateContourCount<1||c.candidateContourCount>1000||c.containingAxisCount!==1)fail('Pose-guided sections require an unambiguous reconstruction-axis contour selection.');
      contourSelection={protocol:c.protocol,candidateContourCount:c.candidateContourCount,containingAxisCount:1};
    }else{
      const c=s.contourSelection;if(c!=null&&(c.protocol!=='single-closed-contour-v1'||c.candidateContourCount!==1))fail('Manual section contour selection is invalid.');
      contourSelection={protocol:'single-closed-contour-v1',candidateContourCount:1};
    }
    if(!positive(s.surfacePerimeterCm)||!positive(s.widthCm)||!positive(s.depthCm))fail('Section measurements must be positive finite numbers.');
    let reference=null;
    if(s.reference!==null){const tape=s.reference?.tapeCm;if(!positive(tape)||tape>500)fail('Tape reference must be positive and at most 500 cm.');
      const error=s.surfacePerimeterCm-tape,percent=Math.abs(error)/tape*100;if(!Number.isFinite(percent))fail('Tape comparison is not finite.');
      reference={tapeCm:tape,signedErrorCm:error,absoluteErrorCm:Math.abs(error),absoluteErrorPercent:percent};
    }
    return {protocol:s.protocol,label:s.label.trim(),planeCm:s.planeCm,...(planeSource?{planeSource}:{}),contourSelection,surfacePerimeterCm:s.surfacePerimeterCm,widthCm:s.widthCm,depthCm:s.depthCm,reference};
  });
  return {schema:'PP_SURFACE_LOCATION_REPORT_V1',createdAt:new Date().toISOString(),status:'experimental',source,
    locationCount:rows.length,referenceCount:rows.filter(r=>r.reference).length,sections:rows,
    limitations:'Multiple manual or four-view pose-guided locations on one clothed surface, not independent scan trials. Pose guides are not validated anatomical girths. Photos, geometry, landmarks and contour points are excluded. Location descriptions and measurements remain sensitive derived data.'};
}
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function surfaceReportHTML(sections){
  const report=createSurfaceReport(sections),n=v=>Number(v).toFixed(1);
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Experimental surface location report</title><style>body{font:16px system-ui;color:#19382e;max-width:1000px;padding:32px;margin:auto}p{line-height:1.6}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;text-align:left;border:1px solid #c8d3ce}code{overflow-wrap:anywhere}small{display:block;margin-top:20px}@media print{body{padding:0}tr{break-inside:avoid}}</style><h1>Experimental surface location report</h1><p>'+escape(report.limitations)+'</p><p>'+report.locationCount+' locations · '+report.referenceCount+' tape references · one source surface.</p><div style="overflow-x:auto"><table><thead><tr><th>Marked location</th><th>Plane source</th><th>Above floor (cm)</th><th>Surface perimeter (cm)</th><th>Width / depth (cm)</th><th>Tape (cm)</th><th>Difference (cm)</th></tr></thead><tbody>'+report.sections.map(r=>'<tr><td>'+escape(r.label)+'</td><td>'+(r.planeSource?'Four-view pose guide; spread '+n(r.planeSource.maxViewSpreadCm)+' cm':'Manual floor height')+'</td><td>'+n(r.planeCm)+'</td><td>'+n(r.surfacePerimeterCm)+'</td><td>'+n(r.widthCm)+' / '+n(r.depthCm)+'</td><td>'+(r.reference?n(r.reference.tapeCm):'Not entered')+'</td><td>'+(r.reference?(r.reference.signedErrorCm>=0?'+':'')+n(r.reference.signedErrorCm):'Not compared')+'</td></tr>').join('')+'</tbody></table></div><p>Scale assumes recorded stature of '+n(report.source.heightM*100)+' cm. Resolution: '+report.source.resolution+'. No pass/fail accuracy threshold is applied.</p><small>Generated '+escape(report.createdAt)+'<br>Source fingerprint ('+escape(report.source.fingerprintProtocol)+'): <code>'+escape(report.source.sha256)+'</code></small></html>';
}
