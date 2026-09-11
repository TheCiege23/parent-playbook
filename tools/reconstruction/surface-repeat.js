// Repeatability evidence at operator-selected levels, not anatomical accuracy.
(function(root){
  'use strict';
  const node=typeof module==='object'&&module.exports;
  const archive=node?require('./surface-archive.js'):root.SurfaceArchive;
  const geometry=node?require('./mesh-section.cjs'):root.MeshSection;
  const VIEWS=['front','right','back','left'];
  function levels(input,heightM){
    if(!Array.isArray(input)||!input.length||input.length>12||input.some(n=>!Number.isFinite(n)||n<=0||n>=heightM*100))throw Error('Choose 1–12 distinct levels in cm, above the floor and below the recorded height.');
    const sorted=[...input].sort((a,b)=>a-b);
    if(sorted.some((n,i)=>i>0&&n-sorted[i-1]<.1))throw Error('Comparison levels must be at least 0.1 cm apart.');
    return sorted;
  }
  function section(mesh,planeCm){
    const s=geometry.sectionMesh({vertices:mesh.vertices,triangles:mesh.faces},{axis:'y',plane:planeCm/100,unit:'m'});
    if(s.loop_count!==1)throw Error('Expected one closed contour; found '+s.loop_count+'. Arms, legs and torso are not combined.');
    const points=s.loops[0].points_m;
    let xmin=Infinity,xmax=-Infinity,zmin=Infinity,zmax=-Infinity;
    for(const [x,,z] of points){xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);zmin=Math.min(zmin,z);zmax=Math.max(zmax,z);}
    return {perimeterCm:s.loops[0].perimeter_m*100,widthCm:(xmax-xmin)*100,depthCm:(zmax-zmin)*100};
  }
  function sameVertices(a,b){
    if(a.vertices.length!==b.vertices.length)return false;
    // Ignores OBJ comments, vertex order and face order. Reopening/re-exporting a
    // surface is not an independent capture. This is not a near-duplicate detector.
    const key=p=>p.map(n=>n.toFixed(7)).join(',');
    const first=a.vertices.map(key).sort(),second=b.vertices.map(key).sort();
    return first.every((p,i)=>p===second[i]);
  }
  function compare(first,second,options={}){
    if(options.independentCapturesConfirmed!==true)throw Error('Confirm two independently captured scans of the same adult, in the same session and pose.');
    const a=first.record,b=second.record;
    if(a.protocol!==b.protocol||a.scaleStatus!==b.scaleStatus||a.units!==b.units||Math.abs(a.heightM-b.heightM)>1e-8||a.resolution!==b.resolution)throw Error('Use the same reconstruction protocol, recorded height, units and voxel resolution for both scans.');
    const models=VIEWS.map(view=>{
      const av=a.views.find(v=>v.view===view),bv=b.views.find(v=>v.view===view);
      if(av?.model!==bv?.model)throw Error('The segmentation model differs for the '+view+' view. Repeat both scans with the same model.');
      return {view,model:av.model,firstDelegate:av.delegate,secondDelegate:bv.delegate};
    });
    if(a.meshSha256===b.meshSha256||sameVertices(first.mesh,second.mesh))throw Error('These contain the same saved surface geometry. Capture a new set of photos; copying or reopening a file is not a repeat scan.');
    const planes=levels(options.levelsCm,a.heightM);
    const sections=planes.map(planeCm=>{
      let one,two;const rejected=[];
      try{one=section(first.mesh,planeCm);}catch(error){rejected.push({scan:'first',reason:error.message});}
      try{two=section(second.mesh,planeCm);}catch(error){rejected.push({scan:'second',reason:error.message});}
      if(rejected.length)return {planeCm,status:'rejected',rejected};
      const delta={};
      for(const key of ['perimeterCm','widthCm','depthCm'])delta[key]={signed:two[key]-one[key],absolute:Math.abs(two[key]-one[key])};
      return {planeCm,status:'computed',first:one,second:two,difference:delta};
    });
    const good=sections.filter(s=>s.status==='computed');
    return {schema:'PP_SURFACE_REPEAT_V1',protocol:'same-height-operator-sections-v1',createdAt:new Date().toISOString(),experimental:true,
      scaleStatus:a.scaleStatus,heightM:a.heightM,resolution:a.resolution,voxelStepCm:a.voxelStepM*100,
      operatorDeclaration:'Two independent captures of the same adult in one session and pose; not authenticated.',
      sources:[a,b].map(r=>({meshSha256:r.meshSha256,createdAt:r.createdAt})),models,
      sections,summary:{requestedLevels:sections.length,computedLevels:good.length,rejectedLevels:sections.length-good.length,
        maximumAbsolutePerimeterDifferenceCm:good.length?Math.max(...good.map(s=>s.difference.perimeterCm.absolute)):null},
      warnings:models.some(m=>m.firstDelegate!==m.secondDelegate)?['The compute delegate differs between scans; this can affect segmentation results.']:[],
      limitations:['Two scans are insufficient to establish population repeatability or anatomical accuracy.',
        'Both surfaces may agree and still be wrong. Independent reference measurements are needed for accuracy.',
        'No automatic alignment or scale fitting is applied. Levels use the same recorded distance from the floor.',
        'Pose, segmentation, clothing, hair, centering and voxel edges can change these geometric sections.',
        'Identical vertex sets are rejected; edited duplicates and operator declarations are not authenticated.',
        'No anatomical landmark labels, pass threshold, clinical interpretation or FITMATCH equivalence are inferred.']};
  }
  async function compareFiles(first,second,options){
    // Each file pair must pass the existing format, fingerprint and geometry gate.
    const a=await archive.open(first.objBytes,first.methodText);
    const b=await archive.open(second.objBytes,second.methodText);
    return compare(a,b,options);
  }
  const api={compareFiles};
  if(node)module.exports=api;else root.SurfaceRepeat=api;
})(globalThis);
