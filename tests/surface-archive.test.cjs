const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Archive=require('../tools/reconstruction/surface-archive.js'),Hull=require('../tools/reconstruction/visual-hull.js');
function fixture(){
  const mesh={protocol:'orthographic-four-silhouette-v1',vertices:[[-.27,0,-.27],[.27,0,-.27],[.27,1.8,-.27],[-.27,1.8,-.27],[-.27,0,.27],[.27,0,.27],[.27,1.8,.27],[-.27,1.8,.27]],faces:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};
  const obj=Hull.toOBJ(mesh),record={schema:'PP_EXPERIMENTAL_SURFACE_V1',createdAt:'2026-09-09T12:00:00Z',meshSha256:crypto.createHash('sha256').update(obj).digest('hex'),protocol:mesh.protocol,experimental:true,units:'m',scaleStatus:'assumed-stature-not-validated',heightM:1.8,resolution:96,voxelStepM:1.8/96,vertices:8,triangles:12,reconstructionMs:50,views:Hull.VIEWS.map(view=>({view,model:'test-model',delegate:'TEST',segmentationMs:25,alignment:{width:80,height:120,centerX:39.5,top:9.5,bottom:109.5}}))};
  return {obj,record};
}
function read(f){return Archive.open(new TextEncoder().encode(f.obj),JSON.stringify(f.record));}
test('saved surface reopens with explicit unverified provenance and sanitized metadata',async()=>{
  const f=fixture();f.record.externalURL='https://example.invalid/private';f.record.views[0].pixels=[1,2];
  const result=await read(f);assert.equal(result.mesh.faces.length,12);assert.equal(result.record.meshSha256,f.record.meshSha256);assert.equal(result.record.reopened.captureProvenance,'not-authenticated');assert.equal(result.record.externalURL,undefined);assert.equal(result.record.views[0].pixels,undefined);assert.equal(result.mesh.heightM,1.8);
});
test('changed files, wrong schema, bad scale, counts and repeated view metadata are rejected',async()=>{
  const changed=fixture();changed.obj+='\n';await assert.rejects(read(changed),/do not match/);
  for(const mutate of [m=>m.schema='other',m=>m.units='cm',m=>m.heightM=0,m=>m.voxelStepM=.1,m=>m.vertices=9,m=>m.views[1].view='front',m=>m.views[0].alignment.centerX=Infinity]){const f=fixture();mutate(f.record);await assert.rejects(read(f));}
});
test('external OBJ directives and open geometry are refused even with matching fingerprints',async()=>{
  const f=fixture();f.obj+='mtllib https://example.invalid/material\n';f.record.meshSha256=crypto.createHash('sha256').update(f.obj).digest('hex');await assert.rejects(read(f),/Unsupported/);
  const open=fixture();open.obj=open.obj.trim().split('\n').slice(0,-1).join('\n')+'\n';open.record.triangles--;open.record.meshSha256=crypto.createHash('sha256').update(open.obj).digest('hex');await assert.rejects(read(open),/open/);
});
test('saved tape inputs are recoverable but computed errors and pass claims are never trusted',async()=>{
  const f=fixture();f.record.referenceComparison={label:'Recorded line',planeCm:90,referenceCm:215,surfacePerimeterCm:215,signedErrorCm:0,validated:true};
  const r=await read(f);assert.deepEqual(r.referenceInputs,{label:'Recorded line',planeCm:90,referenceCm:215});assert.equal(r.record.referenceComparison,undefined);
  f.record.referenceComparison.planeCm=200;assert.equal((await read(f)).referenceInputs,null);
});
