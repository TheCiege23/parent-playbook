// Reopen only the lab's bounded OBJ/method format. A hash matches files; it does
// not authenticate the operator, source photos, claimed model or accuracy.
(function(root){
  'use strict';
  const geometry=typeof module==='object'&&module.exports?require('./mesh-section.cjs'):root.MeshSection;
  const VIEWS=['front','right','back','left'];
  function bounded(n,min,max){return typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;}
  function text(s,max=200){if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('Invalid method text.');return s;}
  async function open(objBytes,methodText){
    if(!(objBytes instanceof Uint8Array)||!objBytes.length||objBytes.byteLength>16*1024*1024)throw Error('Choose an OBJ under 16 MB.');
    if(typeof methodText!=='string'||methodText.length>256*1024)throw Error('Choose a method JSON under 256 KB.');
    let m;try{m=JSON.parse(methodText);}catch(_){throw Error('Method file is not valid JSON.');}
    if(m?.schema!=='PP_EXPERIMENTAL_SURFACE_V1'||m.protocol!=='orthographic-four-silhouette-v1'||m.experimental!==true||m.units!=='m'||m.scaleStatus!=='assumed-stature-not-validated')throw Error('This is not a supported experimental surface method record.');
    if(typeof m.meshSha256!=='string'||!/^[a-f0-9]{64}$/.test(m.meshSha256))throw Error('Method record needs a mesh SHA-256 fingerprint.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',objBytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==m.meshSha256)throw Error('The OBJ and method file do not match. Select files exported together.');
    if(!bounded(m.heightM,.8,2.5)||!Number.isInteger(m.resolution)||!bounded(m.resolution,24,128)||!bounded(m.voxelStepM,.001,.2)||Math.abs(m.voxelStepM-m.heightM/m.resolution)>1e-8)throw Error('Invalid recorded height, resolution or scale.');
    if(!Number.isInteger(m.vertices)||!bounded(m.vertices,4,100000)||!Number.isInteger(m.triangles)||!bounded(m.triangles,4,150000))throw Error('Mesh counts exceed this lab’s limits.');
    if(typeof m.createdAt!=='string'||m.createdAt.length>40||!Number.isFinite(Date.parse(m.createdAt)))throw Error('Invalid recorded creation date.');
    if(!bounded(m.reconstructionMs,0,3600000))throw Error('Invalid reconstruction timing.');
    if(!Array.isArray(m.views)||m.views.length!==4||new Set(m.views.map(v=>v?.view)).size!==4)throw Error('Four distinct view records are required.');
    const views=m.views.map(v=>{
      if(!VIEWS.includes(v.view)||!bounded(v.segmentationMs,0,3600000))throw Error('Invalid view record.');
      const a=v.alignment;
      if(!a||!Number.isInteger(a.width)||!Number.isInteger(a.height)||!bounded(a.width,8,4096)||!bounded(a.height,8,4096)||a.width*a.height>4e6||!bounded(a.centerX,0,a.width)||!bounded(a.top,0,a.height)||!bounded(a.bottom,0,a.height)||a.bottom<=a.top)throw Error('Invalid view alignment.');
      return {view:v.view,model:text(v.model),delegate:text(v.delegate,40),segmentationMs:v.segmentationMs,alignment:{width:a.width,height:a.height,centerX:a.centerX,top:a.top,bottom:a.bottom},...(v.review?.protocol==='manual-view-review-v1'&&v.review.confirmed===true?{review:{protocol:'manual-view-review-v1',confirmed:true}}:{})};
    });
    let obj;try{obj=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(objBytes);}catch(_){throw Error('OBJ must be valid UTF-8 text.');}
    // The lab exports positions and triangular faces only. Never load materials,
    // textures, external resources, normals or arbitrary OBJ directives.
    let vertexCount=0,faceCount=0;
    for(const line of obj.split(/\r?\n/)){
      const s=line.trim();if(!s||s.startsWith('#'))continue;
      const parts=s.split(/\s+/);
      if(parts[0]==='v'&&parts.length===4){if(++vertexCount>m.vertices)throw Error('Vertex count differs from method record.');}
      else if(parts[0]==='f'&&parts.length===4&&parts.slice(1).every(p=>/^[1-9]\d*$/.test(p))){if(++faceCount>m.triangles)throw Error('Triangle count differs from method record.');}
      else throw Error('Unsupported OBJ content. Reopen an unchanged lab export.');
    }
    if(vertexCount!==m.vertices||faceCount!==m.triangles)throw Error('Mesh counts differ from method record.');
    const parsed=geometry.parseOBJ(obj),edges=new Map();
    for(const v of parsed.vertices)if(!v.every(n=>bounded(n,-10,10))||v[1]<-1e-6||v[1]>m.heightM+1e-6)throw Error('Mesh coordinates disagree with the recorded scale.');
    for(const f of parsed.triangles){
      const [a,b,c]=f.map(i=>parsed.vertices[i]),u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
      if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)throw Error('Degenerate surface triangle.');
      for(let i=0;i<3;i++){const a=f[i],b=f[(i+1)%3],key=a<b?a+','+b:b+','+a;edges.set(key,(edges.get(key)||0)+1);}
    }
    if([...edges.values()].some(n=>n!==2))throw Error('Mesh is open or has ambiguous edge contacts.');
    const record={schema:m.schema,createdAt:new Date(m.createdAt).toISOString(),meshSha256:digest,protocol:m.protocol,experimental:true,units:'m',scaleStatus:m.scaleStatus,heightM:m.heightM,resolution:m.resolution,voxelStepM:m.voxelStepM,vertices:m.vertices,triangles:m.triangles,reconstructionMs:m.reconstructionMs,views,
      reopened:{at:new Date().toISOString(),verification:'mesh-file-sha256-only',captureProvenance:'not-authenticated'},
      limitations:['Imported file pair; source photos and capture provenance not authenticated','Clothing and hair included','Orthographic cameras and stature scale assumed','No anatomical accuracy or population validation','No body composition or clinical interpretation']};
    const ref=m.referenceComparison;
    const referenceInputs=ref&&typeof ref.label==='string'&&ref.label.trim()&&ref.label.length<=120&&bounded(ref.planeCm,.001,m.heightM*100-.001)&&bounded(ref.referenceCm,.001,500)?{label:ref.label,planeCm:ref.planeCm,referenceCm:ref.referenceCm}:null;
    return {mesh:{vertices:parsed.vertices,faces:parsed.triangles,protocol:m.protocol,experimental:true,units:'m',scaleStatus:m.scaleStatus,heightM:m.heightM,resolution:m.resolution,stepM:m.voxelStepM},record,referenceInputs};
  }
  if(typeof module==='object'&&module.exports)module.exports={open};else root.SurfaceArchive={open};
})(globalThis);
