const test=require('node:test'),assert=require('node:assert/strict');
const {parseOBJ,sectionMesh}=require('../tools/reconstruction/mesh-section.cjs');
function cube(offset=0){return {vertices:[[0,0,0],[2,0,0],[2,2,0],[0,2,0],[0,0,2],[2,0,2],[2,2,2],[0,2,2]].map(p=>[p[0]+offset,p[1],p[2]]),triangles:[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[3,2,6],[3,6,7],[0,3,7],[0,7,4],[1,5,6],[1,6,2]]};}
test('known closed section yields analytical perimeter in declared units',()=>{
  for(const axis of ['x','y','z']){
    const result=sectionMesh(cube(),{axis,plane:1,unit:'cm'});assert.equal(result.loop_count,1);assert.ok(Math.abs(result.loops[0].perimeter_m-.08)<1e-10);
  }
});
test('separate contours stay separate instead of being mislabeled as one body circumference',()=>{
  const a=cube(),b=cube(4);a.vertices.push(...b.vertices);a.triangles.push(...b.triangles.map(f=>f.map(i=>i+8)));
  const result=sectionMesh(a,{axis:'y',plane:1,unit:'m'});assert.equal(result.loop_count,2);assert.ok(result.loops.every(l=>l.perimeter_m===8));
});
test('open mesh, coplanar surfaces and absent intersections fail explicitly',()=>{
  const a=cube();a.triangles=a.triangles.slice(2);
  assert.throws(()=>sectionMesh(a,{axis:'y',plane:1,unit:'m'}),/open or branching/);
  assert.throws(()=>sectionMesh(cube(),{axis:'y',plane:0,unit:'m'}),/overlaps/);
  assert.throws(()=>sectionMesh(cube(),{axis:'y',plane:3,unit:'m'}),/does not intersect/);
});
test('OBJ reader handles indexed triangles and rejects unsupported or invalid geometry',()=>{
  const mesh=parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3/1 -2/2 -1/3');assert.deepEqual(mesh.triangles,[[0,1,2]]);
  assert.throws(()=>parseOBJ('v NaN 0 0'),/vertex/);
  assert.throws(()=>parseOBJ('v 0 0 0\nf 1 2 3'),/missing vertex/);
  assert.throws(()=>parseOBJ('f 1 2 3 4'),/triangulated/);
  assert.throws(()=>sectionMesh(cube(),{axis:'y',plane:1}),/Specify/);
});
