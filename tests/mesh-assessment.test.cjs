const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {assessMesh,reportHTML,writeAssessment,hash,simplePolygon}=require('../tools/reconstruction/mesh-assessment.cjs');
function box(offset=0){return {vertices:[[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,2],[2,0,2],[2,2,2],[0,2,2]].map(p=>[p[0]+offset,p[1],p[2]]),faces:[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[3,2,6],[3,6,7],[0,3,7],[0,7,4],[1,5,6],[1,6,2]]};}
function obj(mesh=box()){return mesh.vertices.map(p=>'v '+p.join(' ')).concat(mesh.faces.map(f=>'f '+f.map(i=>i+1).join(' '))).join('\n')+'\n';}
function protocol(text){return {schema:1,protocol_id:'synthetic-cube-not-a-body',mesh_sha256:hash(text),calibration:{definition:'Synthetic edge reference, not stature',vertices:[0,1],measured:{value:20,unit:'cm'}},measurements:[{key:'test_edge',definition:'Synthetic second edge',kind:'landmark_distance',vertices:[1,2]},{key:'test_section',definition:'Synthetic midsection perimeter',kind:'plane_perimeter',axis:'y',plane:1}]};}
test('known mesh scale, distances and sections agree across reference units',()=>{
  const text=obj();for(const measured of [{value:20,unit:'cm'},{value:.2,unit:'m'},{value:200,unit:'mm'},{value:.2/.0254,unit:'in'}]){
    const p=protocol(text);p.calibration.measured=measured;
    const r=assessMesh(text,p);assert.ok(Math.abs(r.calibration.meters_per_native_unit-.1)<1e-12);
    assert.ok(Math.abs(r.measurements[0].value-.2)<1e-12);assert.ok(Math.abs(r.measurements[1].value-.8)<1e-12);
    assert.equal(r.counts.computed,2);assert.equal(r.counts.reference_compared,0);
    const points=r.measurements[1].section.points_m;
    assert.ok(points.every(p=>Math.abs(p[1]-.1)<1e-12));
    for(const axis of [0,2]){assert.equal(Math.min(...points.map(p=>p[axis])),0);assert.ok(Math.abs(Math.max(...points.map(p=>p[axis]))-.2)<1e-12);}
  }
});
test('mesh fingerprint, calibration, units and duplicate definitions fail closed',()=>{
  const text=obj(),p=protocol(text);
  assert.throws(()=>assessMesh(text+'# changed\n',p),/fingerprint/);
  for(const unit of ['constructor','native','',null]){const bad=structuredClone(p);bad.calibration.measured.unit=unit;assert.throws(()=>assessMesh(text,bad),/positive value/);}
  for(const vertices of [[0,0],[0,50],[0,-1],[0,.5]]){const bad=structuredClone(p);bad.calibration.vertices=vertices;assert.throws(()=>assessMesh(text,bad),/vertex|indices/);}
  const bad=structuredClone(p);bad.measurements.push(bad.measurements[0]);assert.throws(()=>assessMesh(text,bad),/unique/);
});
test('reference errors convert units, preserve signs and do not invent thresholds',()=>{
  const text=obj(),p=protocol(text);
  p.measurements[0].reference={measured:{value:19,unit:'cm'},method:'Synthetic analytical reference',max_abs_error:{value:10,unit:'mm'}};
  p.measurements[1].reference={measured:{value:90,unit:'cm'},method:'Synthetic analytical reference'};
  const r=assessMesh(text,p),[edge,section]=r.measurements;
  assert.ok(Math.abs(edge.comparison.signed_error_m-.01)<1e-12);assert.equal(edge.comparison.within_declared_threshold,true);
  assert.ok(Math.abs(section.comparison.signed_error_m+.1)<1e-12);assert.equal(section.comparison.within_declared_threshold,null);
  p.measurements[0].reference.max_abs_error.value=9;assert.equal(assessMesh(text,p).measurements[0].comparison.within_declared_threshold,false);
  assert.equal(r.counts.reference_compared,2);
});
test('reusing the calibration landmarks is explicitly excluded as an independent check',()=>{
  const text=obj(),p=protocol(text);p.measurements[0].vertices=[1,0];
  p.measurements[0].reference={measured:{value:20,unit:'cm'},method:'Calibration ruler reused',max_abs_error:{value:1,unit:'mm'}};
  const r=assessMesh(text,p);assert.equal(r.measurements[0].comparison.reuses_calibration_landmarks,true);
  assert.match(reportHTML(r),/Uses calibration landmarks; not an independent accuracy check/);
});
test('disconnected contours require unambiguous interior selection',()=>{
  const a=box(),b=box(4);a.vertices.push(...b.vertices);a.faces.push(...b.faces.map(f=>f.map(i=>i+8)));
  const text=obj(a),p=protocol(text);
  let r=assessMesh(text,p);assert.equal(r.measurements[1].status,'rejected');assert.match(r.measurements[1].reason,/Multiple contours/);
  p.measurements[1].interior_point=[5,1,1];r=assessMesh(text,p);assert.equal(r.measurements[1].status,'computed');assert.equal(r.measurements[1].section.loop_count,2);assert.equal(r.measurements[1].value,.8);
  for(const seed of [[3,1,1],[4,1,1],[5,1.5,1]]){p.measurements[1].interior_point=seed;assert.equal(assessMesh(text,p).measurements[1].status,'rejected');}
});
test('bad sections stay rejected without removing successful outputs or the denominator',()=>{
  const text=obj(),p=protocol(text);p.measurements[1].plane=0;
  const r=assessMesh(text,p);assert.deepEqual(r.counts,{requested:2,computed:1,rejected:1,reference_compared:0});assert.equal(r.measurements[1].value,null);assert.match(r.measurements[1].reason,/overlaps/);
  p.measurements[1].axis='constructor';assert.equal(assessMesh(text,p).measurements[1].status,'rejected');
  assert.throws(()=>simplePolygon([[0,0],[3,2],[0,3],[2,0]],1e-7),/intersecting/);
});
test('HTML report escapes operator content and distinguishes rejection and missing reference',()=>{
  const text=obj(),p=protocol(text);p.protocol_id='<script>unsafe()</script>';p.measurements[0].definition='<img src=x onerror=unsafe()>';p.measurements[1].plane=9;
  const html=reportHTML(assessMesh(text,p));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes("default-src 'none'"));assert.match(html,/No reference comparison/);assert.match(html,/does not intersect/);
});
test('artifacts are reproducible, preserve source files and refuse overwrite or invalid input',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pp-mesh-assessment-'));
  try{
    const text=obj(),p=protocol(text),out=path.join(folder,'result');
    const r=writeAssessment(out,text,p);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'assessment.json'))),r);
    assert.equal(r.protocol_sha256,hash(JSON.stringify(p)));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'protocol.json'))),p);
    assert.throws(()=>writeAssessment(out,text,p),/EEXIST/);
    const bad=path.join(folder,'bad');assert.throws(()=>writeAssessment(bad,text,{...p,mesh_sha256:'wrong'}),/fingerprint/);assert.equal(fs.existsSync(bad),false);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('CLI executes a complete synthetic mesh-to-report experiment and rejects a repeated destination',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pp-mesh-cli-'));
  try{
    const examples=path.join(__dirname,'../tools/reconstruction/examples');
    const text=fs.readFileSync(path.join(examples,'synthetic-cube.obj'),'utf8'),p=JSON.parse(fs.readFileSync(path.join(examples,'synthetic-cube.protocol.json'),'utf8'));
    const mesh=path.join(folder,'mesh.obj'),config=path.join(folder,'protocol.json'),out=path.join(folder,'result');
    fs.writeFileSync(mesh,text);fs.writeFileSync(config,JSON.stringify(p));
    const args=[path.join(__dirname,'../tools/reconstruction/mesh-assessment.cjs'),mesh,config,out];
    const run=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).computed,2);
    assert.equal(JSON.parse(run.stdout).rejected,1);
    assert.equal(fs.readFileSync(mesh,'utf8'),text);assert.ok(fs.readFileSync(path.join(out,'report.html'),'utf8').includes('Perimeter through the synthetic cube'));
    assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true}).status,1);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
