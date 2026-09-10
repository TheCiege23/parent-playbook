// Manual or four-view pose-guided clothed-surface sections; no validated anatomical girth inference.
(function(root){
  const geometry=typeof module==='object'&&module.exports?require('./mesh-section.js'):root.MeshSection;
  function validate(mesh){
    if(mesh?.protocol!=='orthographic-four-silhouette-v1'||mesh.experimental!==true||mesh.units!=='m'||mesh.scaleStatus!=='assumed-stature-not-validated')throw Error('Only experimental silhouette geometry in meters is supported.');
    if(!Number.isFinite(mesh.heightM)||mesh.heightM<.8||mesh.heightM>2.5||!Number.isInteger(mesh.resolution)||mesh.resolution<24||mesh.resolution>128)throw Error('Invalid surface scale or resolution.');
    if(!Array.isArray(mesh.vertices)||mesh.vertices.length<4||mesh.vertices.length>100000||!Array.isArray(mesh.faces)||!mesh.faces.length||mesh.faces.length>150000)throw Error('Invalid or oversized surface.');
    for(const p of mesh.vertices)if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)||Math.abs(p[0])>3||Math.abs(p[2])>3||p[1]<-1e-6||p[1]>mesh.heightM+1e-6)throw Error('Invalid surface vertex.');
    for(const f of mesh.faces)if(!Array.isArray(f)||f.length!==3||new Set(f).size!==3||!f.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.vertices.length))throw Error('Invalid surface triangle.');
    return mesh;
  }
  function planeSource(marker,planeCm,heightM){
    if(marker==null)return null;
    const keys=['shoulder_midpoint','torso_midpoint','hip_midpoint'];
    if(marker.protocol!=='four-view-pose-plane-markers-v1'||!keys.includes(marker.key)||typeof marker.label!=='string'||marker.label.length<1||marker.label.length>120||marker.inputViewCount!==4||!Number.isFinite(marker.maxViewSpreadCm)||marker.maxViewSpreadCm<0||marker.maxViewSpreadCm>heightM*100||!Number.isFinite(marker.planeCm)||Math.abs(marker.planeCm-planeCm)>.051)throw Error('The pose-derived plane marker is invalid or does not match this section height.');
    return {protocol:marker.protocol,key:marker.key,label:marker.label,inputViewCount:4,planeCm:marker.planeCm,maxViewSpreadCm:marker.maxViewSpreadCm};
  }
  function containsAxis(points){
    const epsilon=1e-9,px=0,pz=0;let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const ax=points[j][0],az=points[j][2],bx=points[i][0],bz=points[i][2],dx=bx-ax,dz=bz-az,length2=dx*dx+dz*dz;
      if(length2){const t=Math.max(0,Math.min(1,(-(ax*dx+az*dz))/length2)),x=ax+t*dx,z=az+t*dz;if(Math.hypot(x,z)<=epsilon)return true;}
      if(((az>pz)!==(bz>pz))&&px<(bx-ax)*(pz-az)/(bz-az)+ax)inside=!inside;
    }
    return inside;
  }
  function measure(mesh,{planeCm,label,referenceCm=null,marker=null}={}){
    validate(mesh);
    if(!Number.isFinite(planeCm)||planeCm<=0||planeCm>=mesh.heightM*100)throw Error('Choose a level above the floor and below recorded height.');
    if(typeof label!=='string'||!label.trim()||label.trim().length>120)throw Error('Describe the marked location in 1–120 characters.');
    if(referenceCm!==null&&(!Number.isFinite(referenceCm)||referenceCm<=0||referenceCm>500))throw Error('Tape reference must be positive and at most 500 cm, or omitted.');
    const markerSource=planeSource(marker,planeCm,mesh.heightM);
    const section=geometry.sectionMesh({vertices:mesh.vertices,triangles:mesh.faces},{axis:'y',plane:planeCm/100,unit:'m'});
    let contour,contourSelection;
    if(markerSource){
      const central=section.loops.filter(loop=>containsAxis(loop.points_m));
      if(central.length!==1)throw Error('This pose-guided level has '+section.loop_count+' contours and '+central.length+' uniquely containing the reconstruction axis. A central body contour cannot be selected unambiguously.');
      contour=central[0];contourSelection={protocol:'unique-contour-containing-reconstruction-axis-v1',candidateContourCount:section.loop_count,containingAxisCount:1};
    }else{
      if(section.loop_count!==1)throw Error('This level has '+section.loop_count+' separate contours. No body part was selected; choose a single-contour level.');
      contour=section.loops[0];contourSelection={protocol:'single-closed-contour-v1',candidateContourCount:1};
    }
    const perimeter=contour.perimeter_m*100;
    if(!Number.isFinite(perimeter)||perimeter<=0)throw Error('No usable surface perimeter.');
    if(referenceCm!==null&&!Number.isFinite(Math.abs(perimeter-referenceCm)/referenceCm*100))throw Error('Tape reference is too small for a finite comparison.');
    const bounds=contour.points_m.reduce((b,p)=>[Math.min(b[0],p[0]),Math.max(b[1],p[0]),Math.min(b[2],p[2]),Math.max(b[3],p[2])],[Infinity,-Infinity,Infinity,-Infinity]);
    return {schema:'PP_BODY_SDK_SECTION_V1',section:{protocol:markerSource?'pose-plane-surface-section-v1':'operator-surface-section-v1',status:'experimental',label:label.trim(),axis:'y',planeCm,...(markerSource?{planeSource:markerSource}:{}),contourSelection,
      surfacePerimeterCm:perimeter,widthCm:(bounds[1]-bounds[0])*100,depthCm:(bounds[3]-bounds[2])*100,
      reference:referenceCm===null?null:{tapeCm:referenceCm,signedErrorCm:perimeter-referenceCm,absoluteErrorCm:Math.abs(perimeter-referenceCm),absoluteErrorPercent:Math.abs(perimeter-referenceCm)/referenceCm*100},
      scaleStatus:mesh.scaleStatus,limitations:markerSource?'Clothed-surface section at a four-view pose-inferred plane. When limbs create extra contours, selection requires exactly one contour containing the reconstruction axis; no contours are summed and no largest-contour rule is used. The plane and perimeter are experimental, not a validated chest, waist or hip circumference. Shape, scale and camera assumptions remain unvalidated.':'Operator-selected clothed-surface section. No anatomical landmark was detected. Shape, scale and camera assumptions are unvalidated; this is not a validated waist, chest or hip circumference.'},contourPoints:contour.points_m};
  }
  if(typeof module==='object'&&module.exports)module.exports={validate,measure};else root.SurfaceSection={validate,measure};
})(globalThis);
