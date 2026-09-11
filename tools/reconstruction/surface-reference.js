// Independent tape-reference comparison for the experimental surface only.
// The operator chooses a physical level; no anatomical level is inferred here.
(function(root){
  'use strict';
  const geometry=typeof module==='object'&&module.exports?require('./mesh-section.cjs'):root.MeshSection;
  function compare(mesh,{planeCm,referenceCm,label}={}){
    if(mesh?.protocol!=='orthographic-four-silhouette-v1'||mesh.experimental!==true||mesh.scaleStatus!=='assumed-stature-not-validated')throw Error('An experimental silhouette surface is required.');
    if(!Number.isFinite(planeCm)||planeCm<=0||planeCm>=mesh.heightM*100)throw Error('Enter a level above the floor and below the recorded height.');
    if(!Number.isFinite(referenceCm)||referenceCm<=0||referenceCm>500)throw Error('Enter a positive tape measurement in cm, no greater than 500.');
    if(typeof label!=='string'||!label.trim()||label.trim().length>120)throw Error('Describe the exact tape location in 1–120 characters.');
    const section=geometry.sectionMesh({vertices:mesh.vertices,triangles:mesh.faces},{axis:'y',plane:planeCm/100,unit:'m'});
    if(section.loop_count!==1)throw Error('This level has '+section.loop_count+' separate contours (for example arms and torso). Choose a single-contour level; no body circumference was selected.');
    const loop=section.loops[0],valueCm=loop.perimeter_m*100;
    if(!Number.isFinite(valueCm)||valueCm<=0)throw Error('No usable perimeter at this level.');
    return {protocol:'operator-tape-reference-v1',label:label.trim(),axis:'y',planeCm,referenceCm,surfacePerimeterCm:valueCm,signedErrorCm:valueCm-referenceCm,absoluteErrorCm:Math.abs(valueCm-referenceCm),absoluteErrorPercent:Math.abs(valueCm-referenceCm)/referenceCm*100,scaleStatus:mesh.scaleStatus,points:loop.points_m,limitations:'Single operator-selected comparison of a clothed voxel surface. Scale and camera assumptions remain unvalidated; this does not establish anatomical accuracy or FITMATCH equivalence.'};
  }
  if(typeof module==='object'&&module.exports)module.exports={compare};else root.SurfaceReference={compare};
})(globalThis);
