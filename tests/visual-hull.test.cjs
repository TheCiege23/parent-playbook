const test=require('node:test'),assert=require('node:assert/strict');
const {VIEWS,prepareMask,reconstruct,toOBJ}=require('../tools/reconstruction/visual-hull.js');
function rectangle({width=100,height=140,left=30,right=69,top=20,bottom=119,centerX=49.5}={}){
  const data=new Float32Array(width*height);for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)data[y*width+x]=1;
  return {width,height,data,centerX};
}
function four(){return Object.fromEntries(VIEWS.map(v=>[v,prepareMask(rectangle())]));}
test('mask extraction retains a connected silhouette, explicit alignment and pixel extent',()=>{
  const r=rectangle();r.data[5*100+5]=1;const m=prepareMask(r);
  assert.equal(m.top,19.5);assert.equal(m.bottom,119.5);assert.equal(m.centerX,49.5);assert.equal(m.bits[505],0);assert.equal(m.discardedPixels,1);
});
test('invalid probabilities, cropped/empty/multiple regions and absent alignment fail closed',()=>{
  for(const change of [r=>r.data[0]=NaN,r=>r.data[0]=2,r=>r.data.fill(0),r=>r.centerX=undefined,r=>{for(let y=20;y<120;y++)r.data[y*100]=1;},r=>{for(let y=20;y<60;y++)for(let x=3;x<10;x++)r.data[y*100+x]=1;}]){
    const r=rectangle();change(r);assert.throws(()=>prepareMask(r));
  }
  assert.throws(()=>prepareMask(rectangle({top:0})),/edge/);
});
test('four rectangular projections yield an analytical closed box with outward faces and explicit assumed scale',()=>{
  const m=reconstruct(four(),{heightM:2,resolution:100});
  const sizes=[0,1,2].map(i=>Math.max(...m.vertices.map(v=>v[i]))-Math.min(...m.vertices.map(v=>v[i])));
  assert.ok(Math.abs(sizes[0]-.8)<1e-8);assert.equal(sizes[1],2);assert.ok(Math.abs(sizes[2]-.8)<1e-8);
  assert.equal(m.scaleStatus,'assumed-stature-not-validated');assert.equal(m.experimental,true);
  const edges=new Map();let volume=0;
  for(const f of m.faces){const [a,b,c]=f.map(i=>m.vertices[i]);volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let i=0;i<3;i++){const edge=[f[i],f[(i+1)%3]].sort((a,b)=>a-b).join(',');edges.set(edge,(edges.get(edge)||0)+1);}
  }
  assert.ok([...edges.values()].every(n=>n===2));assert.ok(Math.abs(volume-1.28)<1e-8);
});
test('back and left projections reverse horizontal coordinates instead of reusing front orientation',()=>{
  const masks=four();
  // Front is asymmetric relative to center; correct opposite photo is mirrored.
  masks.front=prepareMask(rectangle({left:20,right:59}));
  masks.back=prepareMask(rectangle({left:40,right:79}));
  const m=reconstruct(masks,{heightM:2,resolution:100});
  const xs=m.vertices.map(v=>v[0]);assert.ok(Math.abs(Math.min(...xs)+.6)<1e-8);assert.ok(Math.abs(Math.max(...xs)-.2)<1e-8);
});
test('all four views constrain the surface and invalid scale/resolution cannot produce geometry',()=>{
  const masks=four();masks.left=prepareMask(rectangle({left:40,right:59}));
  const m=reconstruct(masks,{heightM:2,resolution:100});const z=m.vertices.map(v=>v[2]);assert.ok(Math.abs(Math.max(...z)-Math.min(...z)-.4)<1e-8);
  for(const options of [{heightM:NaN},{heightM:0},{heightM:2,resolution:1000}])assert.throws(()=>reconstruct(masks,options));
  delete masks.back;assert.throws(()=>reconstruct(masks,{heightM:2}),/Four/);
});
test('OBJ carries scientific limitations and valid one-based triangle indices',()=>{
  const m=reconstruct(four(),{heightM:1.8,resolution:24}),obj=toOBJ(m);
  assert.match(obj,/# EXPERIMENTAL/);assert.match(obj,/NOT independently calibrated/);
  assert.equal(obj.split('\n').filter(l=>l.startsWith('v ')).length,m.vertices.length);
  for(const line of obj.split('\n').filter(l=>l.startsWith('f ')))for(const i of line.slice(2).split(' ').map(Number))assert.ok(i>=1&&i<=m.vertices.length);
});

test('disconnected geometry remains rejected and provides bounded scalar component evidence',()=>{
  const masks=four();for(const m of Object.values(masks))for(let y=110;y<115;y++)m.bits.fill(0,y*m.width,(y+1)*m.width);
  assert.throws(()=>reconstruct(masks,{heightM:2,resolution:100}),e=>{
    assert.equal(e.code,'DISCONNECTED_SURFACE');const d=e.diagnostics;assert.equal(d.componentCount,2);assert.equal(d.resolution,100);
    assert.equal(d.components.reduce((n,c)=>n+c.voxels,0),d.occupiedVoxels);
    assert.equal(d.largestComponentFraction,d.components[0].voxels/d.occupiedVoxels);
    assert.ok(d.components[1].toFloorFraction<=.1);assert.ok(!JSON.stringify(d).includes('bits'));return true;
  });
});

test('actual surface worker forwards the connectivity rejection without returning a mesh',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),Hull=require('../js/visual-hull.js'),messages=[];
  const masks=four();for(const m of Object.values(masks))m.bits.fill(0,70*m.width,75*m.width);
  const self={postMessage:m=>messages.push(m)},c=vm.createContext({self,VisualHull:Hull,importScripts(){},performance});
  vm.runInContext(fs.readFileSync(require.resolve('../js/surface-worker.js'),'utf8'),c);
  await self.onmessage({data:{id:1,type:'reconstruct',masks,options:{heightM:2,resolution:100}}});
  assert.equal(messages.length,1);assert.equal(messages[0].code,'DISCONNECTED_SURFACE');assert.equal(messages[0].diagnostics.componentCount,2);assert.equal(messages[0].mesh,undefined);
});

test('connectivity diagnostics quantify only small face-voxel gaps without repairing geometry',()=>{
  const masks=four();for(const m of Object.values(masks))m.bits.fill(0,117*m.width,118*m.width);
  assert.throws(()=>reconstruct(masks,{heightM:2,resolution:100}),e=>{
    assert.equal(e.code,'DISCONNECTED_SURFACE');assert.equal(e.diagnostics.componentCount,2);
    assert.equal(e.diagnostics.components[1].closestBridgeVoxels,1);assert.equal(e.mesh,undefined);return true;
  });
  for(const m of Object.values(masks))m.bits.fill(0,111*m.width,117*m.width);
  assert.throws(()=>reconstruct(masks,{heightM:2,resolution:100}),e=>{
    assert.equal(e.diagnostics.components[1].closestBridgeVoxels,null);return true;
  });
});

test('bounded lower-artifact removal is opt-in, tiny and disclosed',()=>{
  const input=()=>rectangle({left:35,right:64}),masks=Object.fromEntries(VIEWS.map(v=>[v,prepareMask(input())]));
  for(const m of Object.values(masks))m.bits[119*m.width+(m===masks.front||m===masks.right?75:24)]=1;
  masks.front.right=masks.right.right=79.5;masks.back.left=masks.left.left=19.5;
  assert.throws(()=>reconstruct(masks,{heightM:2,resolution:64}),/disconnected/i);
  const repaired=reconstruct(masks,{heightM:2,resolution:64,allowLowerArtifactRemoval:true}),a=repaired.topologyAdjustment;
  assert.equal(a.protocol,'surface-lower-artifact-removal-v1');assert.equal(a.removedVoxels,41);assert.equal(a.originalOccupiedVoxels,25641);
  assert.equal(repaired.occupiedVoxels,25600);assert.ok(a.removedFraction<.005);assert.ok(a.affectedToFloorFraction<=.1);
});

test('highly fragmented inputs keep exact component totals but retain only eight diagnostic regions',()=>{
  const masks=four();for(const m of Object.values(masks))for(let y=29;y<119;y+=10)m.bits.fill(0,y*m.width,(y+1)*m.width);
  assert.throws(()=>reconstruct(masks,{heightM:2,resolution:100}),e=>{
    assert.equal(e.code,'DISCONNECTED_SURFACE');assert.equal(e.diagnostics.componentCount,10);assert.equal(e.diagnostics.components.length,8);return true;
  });
});
