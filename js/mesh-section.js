// Dependency-free geometry probe. A plane perimeter is NOT automatically a waist/chest measurement.
// Explicit units, orientation and plane are required; no population-derived body dimensions.
function parseOBJ(text){
  const vertices=[],triangles=[];
  for(const raw of text.split(/\r?\n/)){
    const parts=raw.split('#')[0].trim().split(/\s+/);
    if(parts[0]==='v'){
      const p=parts.slice(1,4).map(Number);
      if(p.length!==3 || !p.every(Number.isFinite)) throw Error('Invalid vertex');
      vertices.push(p);
    }else if(parts[0]==='f'){
      if(parts.length!==4) throw Error('Only triangulated OBJ faces are supported; triangulate the mesh first');
      const face=parts.slice(1).map(token=>{
        const rawIndex=token.split('/')[0];
        if(!/^-?[1-9]\d*$/.test(rawIndex)) throw Error('Invalid face index');
        const n=Number(rawIndex),i=n>0?n-1:vertices.length+n;
        if(i<0 || i>=vertices.length) throw Error('Face references missing vertex');return i;
      });
      if(new Set(face).size!==3) throw Error('Degenerate face');
      triangles.push(face);
    }
  }
  if(vertices.length<3 || !triangles.length) throw Error('No triangular surface found');
  return {vertices,triangles};
}
function sectionMesh(mesh,{axis,plane,unit,tolerance=1e-7}){
  const axes={x:0,y:1,z:2},scale={m:1,cm:.01,mm:.001,in:.0254};
  if(!Object.hasOwn(axes,axis) || !Object.hasOwn(scale,unit) || !Number.isFinite(plane) || !Number.isFinite(tolerance) || tolerance<=0) throw Error('Specify axis x/y/z, a finite plane coordinate, unit m/cm/mm/in and positive tolerance');
  const ax=axes[axis],segments=[],points=[];
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  // Spatial buckets weld neighboring triangle intersections within declared tolerance.
  const buckets=new Map();
  const node=p=>{
    const cell=p.map(v=>Math.floor(v/tolerance));
    for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++){
      const ids=buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[];
      for(const id of ids) if(distance(points[id],p)<=tolerance) return id;
    }
    const id=points.length,key=cell.join(',');points.push(p);if(!buckets.has(key)) buckets.set(key,[]);buckets.get(key).push(id);return id;
  };
  const seen=new Set();
  for(const face of mesh.triangles){
    const v=face.map(i=>mesh.vertices[i]),d=v.map(p=>p[ax]-plane);
    if(d.every(x=>Math.abs(x)<=tolerance)) throw Error('Plane overlaps a surface face; choose a non-coplanar section');
    const hits=[];
    for(let i=0;i<3;i++){
      const j=(i+1)%3;
      if(Math.abs(d[i])<=tolerance) hits.push(v[i]);
      if((d[i]<-tolerance && d[j]>tolerance)||(d[i]>tolerance && d[j]<-tolerance)){
        const t=d[i]/(d[i]-d[j]);hits.push(v[i].map((n,k)=>n+t*(v[j][k]-n)));
      }
    }
    const unique=[];for(const p of hits) if(!unique.some(q=>distance(p,q)<=tolerance)) unique.push(p);
    if(unique.length<2) continue;
    if(unique.length!==2) throw Error('Ambiguous plane intersection');
    const a=node(unique[0]),b=node(unique[1]);if(a===b) continue;
    const key=[Math.min(a,b),Math.max(a,b)].join(':');
    if(seen.has(key)) continue;seen.add(key);segments.push([a,b]);
  }
  if(!segments.length) throw Error('Plane does not intersect a measurable surface');
  const adjacency=new Map();
  for(const [a,b] of segments){if(!adjacency.has(a)) adjacency.set(a,[]);if(!adjacency.has(b)) adjacency.set(b,[]);adjacency.get(a).push(b);adjacency.get(b).push(a);}
  if([...adjacency.values()].some(x=>x.length!==2)) throw Error('Section is open or branching; refusing a circumference');
  const visited=new Set(),loops=[];
  for(const start of adjacency.keys()){
    if(visited.has(start)) continue;
    const ids=[];let previous=null,current=start;
    do{
      if(visited.has(current)) throw Error('Intersecting contour');
      visited.add(current);ids.push(current);
      const next=adjacency.get(current).find(n=>n!==previous);previous=current;current=next;
    }while(current!==start);
    if(ids.length<3) throw Error('Degenerate contour');
    const perimeter=ids.reduce((sum,id,i)=>sum+distance(points[id],points[ids[(i+1)%ids.length]]),0);
    loops.push({perimeter_m:perimeter*scale[unit],points_m:ids.map(id=>points[id].map(v=>v*scale[unit]))});
  }
  loops.sort((a,b)=>b.perimeter_m-a.perimeter_m);
  return {schema:1,kind:'mesh_plane_section',axis,plane,input_unit:unit,tolerance,loop_count:loops.length,loops,
    interpretation:'Geometric cross-sections only. Anatomical plane selection, body shape accuracy and clinical validity are not established.'};
}
if(typeof module==='object'&&module.exports)module.exports={parseOBJ,sectionMesh};
else globalThis.MeshSection={parseOBJ,sectionMesh};
