const test=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('../tools/reconstruction/surface-reference.js');
function box(){return {protocol:'orthographic-four-silhouette-v1',experimental:true,scaleStatus:'assumed-stature-not-validated',heightM:2,
  vertices:[[-.4,0,-.4],[.4,0,-.4],[.4,2,-.4],[-.4,2,-.4],[-.4,0,.4],[.4,0,.4],[.4,2,.4],[-.4,2,.4]],
  faces:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};}
test('reference comparison uses an independently supplied perimeter and reports signed/absolute error without pass claims',()=>{
  const r=compare(box(),{planeCm:100,referenceCm:300,label:'Recorded line'});
  assert.ok(Math.abs(r.surfacePerimeterCm-320)<1e-8);assert.ok(Math.abs(r.signedErrorCm-20)<1e-8);assert.ok(Math.abs(r.absoluteErrorPercent-20/3)<1e-8);
  assert.equal(r.scaleStatus,'assumed-stature-not-validated');assert.equal(r.pass,undefined);assert.ok(r.points.every(p=>p[1]===1));
  assert.ok(compare(box(),{planeCm:100,referenceCm:330,label:'Recorded line'}).signedErrorCm<0);
});
test('unmatched scale, invalid measurements and undefined locations cannot produce reference results',()=>{
  for(const options of [{planeCm:0,referenceCm:300,label:'line'},{planeCm:200,referenceCm:300,label:'line'},{planeCm:100,referenceCm:NaN,label:'line'},{planeCm:100,referenceCm:0,label:'line'},{planeCm:100,referenceCm:300,label:''}])assert.throws(()=>compare(box(),options));
  const mesh=box();mesh.scaleStatus='validated';assert.throws(()=>compare(mesh,{planeCm:100,referenceCm:300,label:'line'}),/experimental/);
});
test('multiple contours are rejected without choosing the largest or adding body parts together',()=>{
  const mesh=box(),second=box(),offset=mesh.vertices.length;
  mesh.vertices.push(...second.vertices.map(([x,y,z])=>[x+2,y,z]));mesh.faces.push(...second.faces.map(f=>f.map(i=>i+offset)));
  assert.throws(()=>compare(mesh,{planeCm:100,referenceCm:300,label:'line'}),/2 separate contours/);
});
