// Offline measurement experiment. Operator landmarks/planes are not anatomical detection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseOBJ,sectionMesh}=require('./mesh-section.cjs');
const UNITS=Object.freeze({m:1,cm:.01,mm:.001,in:.0254});
const VERSION='mesh-assessment-0.1.0';
const LIMIT='Experimental geometry measurements. Operator-selected landmarks, scale and planes require reference validation. No body composition, injury prediction or FITMATCH-equivalence claim.';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function quantity(q){
  if(!q||!finite(q.value)||q.value<=0||!Object.hasOwn(UNITS,q.unit))throw Error('A positive value and unit m/cm/mm/in are required');
  return q.value*UNITS[q.unit];
}
function point(mesh,index){
  if(!Number.isSafeInteger(index)||index<0||index>=mesh.vertices.length)throw Error('Landmark vertex index is outside the pinned mesh');
  return mesh.vertices[index];
}
function line(mesh,ids){
  if(!Array.isArray(ids)||ids.length!==2||ids[0]===ids[1])throw Error('Two distinct zero-based landmark vertex indices are required');
  const length=distance(point(mesh,ids[0]),point(mesh,ids[1]));
  if(length<=1e-12)throw Error('Calibration or landmark distance is zero');
  return length;
}
function requiredText(v,name){if(typeof v!=='string'||!v.trim()||v.length>1000)throw Error(name+' must be nonempty text of at most 1000 characters');return v;}
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onEdge(p,a,b,epsilon){
  const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
  return l>0&&Math.abs(cross(a,b,p))/l<=epsilon&&p[0]>=Math.min(a[0],b[0])-epsilon&&p[0]<=Math.max(a[0],b[0])+epsilon&&p[1]>=Math.min(a[1],b[1])-epsilon&&p[1]<=Math.max(a[1],b[1])+epsilon;
}
function simplePolygon(poly,epsilon){
  const area=poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
  if(Math.abs(area)<=epsilon*epsilon)throw Error('Degenerate section contour');
  for(let i=0;i<poly.length;i++)for(let j=i+1;j<poly.length;j++){
    if(j===i+1||(i===0&&j===poly.length-1))continue;
    const a=poly[i],b=poly[(i+1)%poly.length],c=poly[j],d=poly[(j+1)%poly.length];
    const proper=cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
    if(proper||onEdge(a,c,d,epsilon)||onEdge(b,c,d,epsilon)||onEdge(c,a,b,epsilon)||onEdge(d,a,b,epsilon))throw Error('Self-intersecting or touching section contour');
  }
}
function contains(poly,p,epsilon){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[j],b=poly[i];
    if(onEdge(p,a,b,epsilon))throw Error('Selection point lies on a contour; choose an interior point');
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function perimeter(mesh,spec,scale){
  if(!Object.hasOwn({x:0,y:1,z:2},spec.axis)||!finite(spec.plane))throw Error('A mesh-coordinate plane and axis x/y/z are required');
  const axis={x:0,y:1,z:2}[spec.axis],epsilon=spec.tolerance??1e-7;
  // Unit m here is a numeric identity, not an assumption about model units.
  // Explicit calibration below converts the native coordinates to metres.
  const section=sectionMesh(mesh,{axis:spec.axis,plane:spec.plane,unit:'m',tolerance:epsilon});
  const project=p=>p.filter((_,i)=>i!==axis);
  const polygons=section.loops.map(l=>l.points_m.map(project));
  for(const polygon of polygons)simplePolygon(polygon,epsilon);
  let selected=0;
  if(spec.interior_point!==undefined){
    const seed=spec.interior_point;
    if(!Array.isArray(seed)||seed.length!==3||!seed.every(finite)||Math.abs(seed[axis]-spec.plane)>epsilon)throw Error('Interior point must be finite and on the declared plane');
    const matches=polygons.map((p,i)=>contains(p,project(seed),epsilon)?i:-1).filter(i=>i>=0);
    if(matches.length!==1)throw Error('Interior point must select exactly one contour');
    selected=matches[0];
  }else if(section.loop_count!==1)throw Error('Multiple contours require an explicit interior point; no automatic largest-loop selection');
  const loop=section.loops[selected];
  return {value_m:loop.perimeter_m*scale,section:{axis:spec.axis,plane_native:spec.plane,tolerance_native:epsilon,loop_count:section.loop_count,selected_loop:selected,points_m:loop.points_m.map(p=>p.map(v=>v*scale))}};
}
function assessMesh(objText,protocol){
  if(!protocol||protocol.schema!==1)throw Error('Protocol schema 1 is required');
  const meshHash=hash(objText);
  if(protocol.mesh_sha256!==meshHash)throw Error('Mesh fingerprint differs from protocol; landmarks and planes must be reviewed for this exact mesh');
  requiredText(protocol.protocol_id,'Protocol ID');
  requiredText(protocol.calibration?.definition,'Calibration definition');
  const mesh=parseOBJ(objText),nativeDistance=line(mesh,protocol.calibration.vertices);
  const referenceM=quantity(protocol.calibration.measured),scale=referenceM/nativeDistance;
  if(!finite(scale)||scale<=0)throw Error('Calibration scale is invalid');
  if(!Array.isArray(protocol.measurements)||!protocol.measurements.length||protocol.measurements.length>100)throw Error('Declare between 1 and 100 measurements');
  const keys=new Set();
  for(const s of protocol.measurements){
    if(!s||typeof s.key!=='string'||!/^[-a-z0-9_]{1,80}$/.test(s.key)||keys.has(s.key))throw Error('Measurement keys must be unique simple identifiers');
    keys.add(s.key);requiredText(s.definition,'Measurement definition');
    if(!['landmark_distance','plane_perimeter'].includes(s.kind))throw Error('Unsupported measurement kind');
    if(s.reference){
      quantity(s.reference.measured);requiredText(s.reference.method,'Reference method');
      if(s.reference.max_abs_error!==undefined)quantity(s.reference.max_abs_error);
    }
  }
  const measurements=protocol.measurements.map(s=>{
    const result={key:s.key,definition:s.definition,kind:s.kind,status:'rejected',unit:'m',value:null,reference:s.reference||null};
    try{
      const computed=s.kind==='landmark_distance'?{value_m:line(mesh,s.vertices)*scale}:perimeter(mesh,s,scale);
      if(!finite(computed.value_m)||computed.value_m<=0)throw Error('Computed value is invalid');
      Object.assign(result,{status:'computed',value:computed.value_m});
      if(computed.section)result.section=computed.section;
      if(s.reference){
        const expected=quantity(s.reference.measured),error=computed.value_m-expected;
        const tolerance=s.reference.max_abs_error===undefined?null:quantity(s.reference.max_abs_error);
        const reusesCalibration=s.kind==='landmark_distance'&&s.vertices.every(i=>protocol.calibration.vertices.includes(i));
        result.comparison={reference_m:expected,signed_error_m:error,absolute_error_m:Math.abs(error),absolute_percent_error:Math.abs(error)/expected*100,max_abs_error_m:tolerance,reuses_calibration_landmarks:reusesCalibration,
          within_declared_threshold:tolerance===null?null:Math.abs(error)<=tolerance+1e-12};
      }
    }catch(error){result.reason=error.message;}
    return result;
  });
  return {schema:1,kind:'calibrated_mesh_experiment',engine:VERSION,mesh_sha256:meshHash,protocol_sha256:hash(JSON.stringify(protocol)),protocol_id:protocol.protocol_id,
    calibration:{...protocol.calibration,measured_m:referenceM,native_distance:nativeDistance,meters_per_native_unit:scale,method:'operator_reference_uniform_scale'},
    counts:{requested:measurements.length,computed:measurements.filter(m=>m.status==='computed').length,rejected:measurements.filter(m=>m.status==='rejected').length,reference_compared:measurements.filter(m=>m.comparison).length},
    measurements,limitations:LIMIT};
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cm=v=>finite(v)?(v*100).toFixed(2)+' cm':'—';
function comparisonLabel(m){
  if(m.reason)return m.reason;
  if(m.comparison?.reuses_calibration_landmarks)return 'Uses calibration landmarks; not an independent accuracy check';
  if(m.comparison?.within_declared_threshold===true)return 'Within declared threshold';
  if(m.comparison?.within_declared_threshold===false)return 'Outside declared threshold';
  return m.comparison?'No threshold declared':'No reference comparison';
}
function reportHTML(result){
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Mesh measurement experiment</title><style>body{font:16px system-ui;color:#193d34;max-width:1100px;margin:32px auto;padding:0 20px}h1{font-size:32px}p,dd{line-height:1.6}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:12px;border:1px solid #cbd7d1;text-align:left;vertical-align:top}th{background:#edf3ef}.scroll{overflow:auto}.notice{padding:16px;background:#f5ecd8}code{overflow-wrap:anywhere}@media print{body{margin:0}th,td{padding:6px}}</style><h1>Mesh measurement experiment</h1><p class="notice">${esc(result.limitations)}</p><p>Protocol: ${esc(result.protocol_id)}<br>Computed ${result.counts.computed} of ${result.counts.requested}; rejected ${result.counts.rejected}; compared to reference ${result.counts.reference_compared}.</p><h2>Scale calibration</h2><p>${esc(result.calibration.definition)}<br>Reference: ${cm(result.calibration.measured_m)}. Uniform scale: ${esc(result.calibration.meters_per_native_unit)} metres per native unit. Matching this calibration distance is not an independent accuracy check.</p><div class="scroll"><table><thead><tr><th>Measurement / definition</th><th>Result</th><th>Reference</th><th>Absolute error</th><th>Declared error threshold</th><th>Comparison / rejection</th></tr></thead><tbody>${result.measurements.map(m=>`<tr><td>${esc(m.key)}<br>${esc(m.definition)}</td><td>${cm(m.value)}</td><td>${m.reference?cm(quantity(m.reference.measured)):'Not supplied'}${m.reference?'<br>'+esc(m.reference.method):''}</td><td>${cm(m.comparison?.absolute_error_m)}</td><td>${cm(m.comparison?.max_abs_error_m)}</td><td>${esc(comparisonLabel(m))}</td></tr>`).join('')}</tbody></table></div><h2>Reproducibility</h2><p>Engine: ${esc(result.engine)}<br>Mesh SHA-256: <code>${esc(result.mesh_sha256)}</code><br>Protocol SHA-256: <code>${esc(result.protocol_sha256)}</code></p><p>Thresholds are operator supplied. One successful comparison does not validate an engine or population. Rejected measurements remain in the denominator. This report contains private geometry-derived measurements; keep it with the authorized experiment.</p></html>`;
}
function writeAssessment(directory,objText,protocol){
  const result=assessMesh(objText,protocol),html=reportHTML(result);
  // Refuse prior output and validate everything before creating this directory.
  fs.mkdirSync(directory,{recursive:false});
  fs.writeFileSync(path.join(directory,'assessment.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(directory,'report.html'),html,{flag:'wx'});
  fs.writeFileSync(path.join(directory,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
  return result;
}
module.exports={assessMesh,reportHTML,writeAssessment,hash,simplePolygon};
if(require.main===module){
  try{
    const [meshFile,protocolFile,out,...extra]=process.argv.slice(2);
    if(!meshFile||!protocolFile||!out||extra.length)throw Error('Usage: node mesh-assessment.cjs mesh.obj protocol.json NEW_OUTPUT_DIRECTORY (parent must exist)');
    const result=writeAssessment(out,fs.readFileSync(meshFile,'utf8'),JSON.parse(fs.readFileSync(protocolFile,'utf8')));
    process.stdout.write(JSON.stringify({status:'experimental_geometry_only',...result.counts})+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
