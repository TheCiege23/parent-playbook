const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const Section=require('../js/surface-section.js');
function box(){return {protocol:'orthographic-four-silhouette-v1',experimental:true,units:'m',scaleStatus:'assumed-stature-not-validated',heightM:2,resolution:64,
  vertices:[[-.4,0,-.3],[.4,0,-.3],[.4,2,-.3],[-.4,2,-.3],[-.4,0,.3],[.4,0,.3],[.4,2,.3],[-.4,2,.3]],
  faces:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};}
const input=()=>({planeCm:100,label:'Marked test line'});
test('SDK section reports analytic perimeter, width and depth without inventing a tape reference',()=>{
  const r=Section.measure(box(),input());assert.ok(Math.abs(r.section.surfacePerimeterCm-280)<1e-8);assert.equal(r.section.widthCm,80);assert.equal(r.section.depthCm,60);assert.equal(r.section.reference,null);assert.ok(r.contourPoints.every(p=>p[1]===1));assert.equal(r.section.pass,undefined);
});
test('independent tape reference gives signed and absolute errors without validation claims',()=>{
  for(const tape of [260,300]){const r=Section.measure(box(),{...input(),referenceCm:tape}).section.reference;assert.ok(Math.abs(r.signedErrorCm-(280-tape))<1e-8);assert.ok(Math.abs(r.absoluteErrorCm-20)<1e-8);assert.ok(Math.abs(r.absoluteErrorPercent-20/tape*100)<1e-8);}
});
test('pose-derived plane sections preserve bounded scalar provenance and reject mismatched markers',()=>{
  const marker={protocol:'four-view-pose-plane-markers-v1',key:'torso_midpoint',label:'Pose-inferred torso midpoint plane',inputViewCount:4,planeCm:100,maxViewSpreadCm:2.4};
  const r=Section.measure(box(),{...input(),marker});assert.equal(r.section.protocol,'pose-plane-surface-section-v1');assert.deepEqual(r.section.planeSource,marker);assert.match(r.section.limitations,/not a validated chest/);
  assert.throws(()=>Section.measure(box(),{...input(),marker:{...marker,planeCm:101}}),/does not match/);
  assert.throws(()=>Section.measure(box(),{...input(),marker:{...marker,key:'waist'}}),/invalid/);
});
test('pose-guided sections select only one contour containing the reconstruction axis',()=>{
  const marker={protocol:'four-view-pose-plane-markers-v1',key:'hip_midpoint',label:'Pose-inferred hip midpoint plane',inputViewCount:4,planeCm:100,maxViewSpreadCm:2.4};
  const merge=(first,second)=>{const offset=first.vertices.length;first.vertices.push(...second.vertices);first.faces.push(...second.faces.map(face=>face.map(i=>i+offset)));return first;};
  const transform=(mesh,{x=0,z=0,scale=1})=>{mesh.vertices=mesh.vertices.map(([vx,y,vz])=>[vx*scale+x,y,vz*scale+z]);return mesh;};
  const separated=merge(box(),transform(box(),{x:1.5})),result=Section.measure(separated,{...input(),label:marker.label,marker});
  assert.equal(result.section.contourSelection.protocol,'unique-contour-containing-reconstruction-axis-v1');assert.equal(result.section.contourSelection.candidateContourCount,2);assert.ok(Math.abs(result.section.surfacePerimeterCm-280)<1e-8);
  const nested=merge(box(),transform(box(),{scale:.5}));assert.throws(()=>Section.measure(nested,{...input(),label:marker.label,marker}),/cannot be selected unambiguously/);
  const absent=merge(transform(box(),{x:1}),transform(box(),{x:2}));assert.throws(()=>Section.measure(absent,{...input(),label:marker.label,marker}),/0 uniquely containing/);
});
test('invalid scales, coordinates, references, labels and triangle indices cannot produce a section',()=>{
  for(const options of [{planeCm:0},{planeCm:200},{referenceCm:0},{referenceCm:NaN},{referenceCm:Number.MIN_VALUE},{label:''},{label:'x'.repeat(121)}])assert.throws(()=>Section.measure(box(),{...input(),...options}));
  for(const change of [m=>m.units='in',m=>m.heightM=NaN,m=>m.resolution=0,m=>m.vertices[0][0]=Infinity,m=>m.faces[0][0]=999,m=>m.scaleStatus='validated']){const m=box();change(m);assert.throws(()=>Section.measure(m,input()));}
});
test('separate body-part contours and open intersections are rejected rather than summed or selected',()=>{
  const a=box(),b=box(),offset=a.vertices.length;a.vertices.push(...b.vertices.map(([x,y,z])=>[x+1.5,y,z]));a.faces.push(...b.faces.map(f=>f.map(i=>i+offset)));assert.throws(()=>Section.measure(a,input()),/2 separate contours/);
  const open=box();open.faces.splice(0,1);assert.throws(()=>Section.measure(open,input()),/open|branching/);
});
test('section worker fingerprints the exact source and returns curated scalar report separately from contour',async()=>{
  const posts=[],c=vm.createContext({console,performance,TextEncoder,Uint8Array,crypto:crypto.webcrypto,self:{postMessage:r=>posts.push(r)}});
  c.importScripts=(...files)=>{for(const f of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),c);};vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/body-section-worker.js'),'utf8'),c);
  const original=box(),copied=structuredClone(original);await c.self.onmessage({data:{mesh:copied,options:input(),account:'PRIVATE'}});
  const r=posts[0].result;assert.equal(r.sdkVersion,'0.13.0');assert.equal(r.schema,'PP_BODY_SDK_SECTION_V1');assert.equal(r.section.source.sha256,crypto.createHash('sha256').update(JSON.stringify({protocol:original.protocol,heightM:original.heightM,resolution:original.resolution,vertices:original.vertices,faces:original.faces})).digest('hex'));
  assert.ok(!JSON.stringify(r.section).includes('vertices'));assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(r.contourPoints.length);assert.equal(copied.vertices.length,0);assert.equal(original.vertices.length,8);
});
test('SDK section request uses dedicated worker, permission gates, allowlisted payload and cancellation',async t=>{
  const {createBodyScanner}=await import('../js/body-sdk.mjs'),old=global.Worker,created=[];global.Worker=class{constructor(url){this.url=url;created.push(this);}postMessage(d){this.sent=d;}terminate(){this.stopped=true;}};t.after(()=>global.Worker=old);
  const scanner=createBodyScanner(),opts={...input(),surface:{mesh:box(),photos:'PRIVATE'},permissionAcknowledged:true,surfacePermissionAcknowledged:true};
  await assert.rejects(scanner.measureSurfaceSection({...opts,surfacePermissionAcknowledged:false}),{code:'SURFACE_PERMISSION_REQUIRED'});assert.equal(created.length,0);
  const controller=new AbortController(),p=scanner.measureSurfaceSection({...opts,signal:controller.signal,account:'PRIVATE'});assert.ok(created[0].url.pathname.endsWith('body-section-worker.js'));assert.ok(!JSON.stringify(created[0].sent).includes('PRIVATE'));
  await assert.rejects(scanner.measureSurfaceSection(opts),{code:'BUSY'});controller.abort();await assert.rejects(p,{code:'ABORTED'});assert.equal(created[0].stopped,true);assert.equal(opts.surface.mesh.vertices.length,8);
  const again=scanner.measureSurfaceSection(opts);created[1].onmessage({data:{type:'error',code:'SECTION_REJECTED',message:'multiple contours'}});await assert.rejects(again,{code:'SECTION_REJECTED'});assert.equal(created[1].stopped,true);scanner.dispose();
});
test('SDK resolves marker keys only from the exact returned surface summary',async t=>{
  const {createBodyScanner}=await import('../js/body-sdk.mjs'),old=global.Worker,created=[];global.Worker=class{constructor(){created.push(this);}postMessage(data){this.sent=data;}terminate(){}};t.after(()=>global.Worker=old);
  const marker={key:'torso_midpoint',label:'Pose-inferred torso midpoint plane',planeCm:100,maxViewSpreadCm:2.4},surface={mesh:box(),posePlanes:{protocol:'four-view-pose-plane-markers-v1',status:'experimental',inputViewCount:4,scaleStatus:'assumed-stature-not-validated',markers:[{key:'shoulder_midpoint',label:'Pose-inferred shoulder midpoint plane',planeCm:140,maxViewSpreadCm:3},marker,{key:'hip_midpoint',label:'Pose-inferred hip midpoint plane',planeCm:90,maxViewSpreadCm:2}]}};
  const scanner=createBodyScanner(),common={surface,planeCm:100,label:marker.label,markerKey:marker.key,permissionAcknowledged:true,surfacePermissionAcknowledged:true};
  const pending=scanner.measureSurfaceSection(common);assert.deepEqual(created[0].sent.options.marker,{protocol:'four-view-pose-plane-markers-v1',...marker,inputViewCount:4});created[0].onmessage({data:{type:'result',result:{ok:true}}});assert.deepEqual(await pending,{ok:true});
  await assert.rejects(scanner.measureSurfaceSection({...common,planeCm:101}),{code:'INVALID_PLANE_MARKER'});await assert.rejects(scanner.measureSurfaceSection({...common,label:'waist'}),{code:'INVALID_PLANE_MARKER'});await assert.rejects(scanner.measureSurfaceSection({...common,markerKey:'waist'}),{code:'INVALID_PLANE_MARKER'});scanner.dispose();
});
