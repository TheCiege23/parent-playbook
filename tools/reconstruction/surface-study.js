// Descriptive reference observations; no acceptance threshold or accuracy claim.
(function(root){
  'use strict';
  const node=typeof module==='object'&&module.exports;
  const archive=node?require('./surface-archive.js'):root.SurfaceArchive;
  const reference=node?require('./surface-reference.js'):root.SurfaceReference;
  const views=['front','right','back','left'];
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const code=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(s);
  const description=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
  async function run(cases,options={},onProgress=()=>{}){
    if(options.permissionConfirmed!==true)throw Error('Confirm permission and independently recorded adult reference measurements.');
    if(!description(options.location,120)||!description(options.procedure,600))throw Error('Describe one reference location and its measurement procedure.');
    if(!Array.isArray(cases)||!cases.length||cases.length>8)throw Error('Use 1–8 reference scans per report.');
    if(new Set(cases.map(c=>c.id)).size!==cases.length||cases.some(c=>!code(c.id)||!code(c.participantCode)||!finite(c.planeCm,.1,249.9)||!finite(c.referenceCm,.1,500)))throw Error('Each scan needs a unique ID, participant code and valid floor/tape measurements.');
    if(cases.reduce((sum,c)=>sum+(c.objBytes?.byteLength||0),0)>64*1024*1024)throw Error('Combined OBJ files exceed 64 MB.');
    const rows=[],groups=new Map(),seen=new Set();
    for(const input of cases){
      onProgress('Checking '+input.id+' ('+(rows.length+1)+' of '+cases.length+')…');
      const row={id:input.id,participantCode:input.participantCode,planeCm:input.planeCm,referenceCm:input.referenceCm};
      let opened,group;
      try{
        opened=await archive.open(input.objBytes,input.methodText);
        const r=opened.record;
        const signature=JSON.stringify([r.protocol,r.scaleStatus,r.units,r.resolution,...views.map(view=>{const v=r.views.find(v=>v.view===view);return [view,v.model,v.delegate];})]);
        if(!groups.has(signature))groups.set(signature,{id:'method-'+(groups.size+1),protocol:r.protocol,scaleStatus:r.scaleStatus,resolution:r.resolution,
          models:views.map(view=>{const v=r.views.find(v=>v.view===view);return {view,model:v.model,delegate:v.delegate};}),rows:[]});
        group=groups.get(signature);row.methodGroup=group.id;row.meshSha256=r.meshSha256;row.recordedHeightCm=r.heightM*100;row.voxelStepCm=r.voxelStepM*100;
        // A comment edit, reordered vertices, or resaving one scan cannot inflate n.
        const canonical=new TextEncoder().encode(opened.mesh.vertices.map(p=>p.map(n=>n.toFixed(7)).join(',')).sort().join('\n'));
        const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canonical)),b=>b.toString(16).padStart(2,'0')).join('');
        if(seen.has(fingerprint))throw Error('Repeated saved surface geometry; it cannot count as another independent reference scan.');
        seen.add(fingerprint);
        const measured=reference.compare(opened.mesh,{planeCm:input.planeCm,referenceCm:input.referenceCm,label:options.location});
        Object.assign(row,{status:'computed',surfacePerimeterCm:measured.surfacePerimeterCm,signedErrorCm:measured.signedErrorCm,absoluteErrorCm:measured.absoluteErrorCm});
      }catch(error){row.status='rejected';row.reason=error.message||'Reference comparison failed.';}
      rows.push(row);group?.rows.push(row);
      opened=null;
    }
    const methodGroups=[...groups.values()].map(({rows:members,...group})=>{
      const good=members.filter(r=>r.status==='computed'),n=good.length;
      return {...group,attempted:members.length,computed:n,rejected:members.length-n,
        participantsWithResults:new Set(good.map(r=>r.participantCode)).size,
        meanSignedErrorCm:n?good.reduce((s,r)=>s+r.signedErrorCm,0)/n:null,
        meanAbsoluteErrorCm:n?good.reduce((s,r)=>s+r.absoluteErrorCm,0)/n:null,
        maximumAbsoluteErrorCm:n?Math.max(...good.map(r=>r.absoluteErrorCm)):null};
    });
    return {schema:'PP_SURFACE_REFERENCE_STUDY_V1',protocol:'operator-reference-series-v1',createdAt:new Date().toISOString(),experimental:true,
      location:options.location.trim(),procedure:options.procedure.trim(),
      declaration:'Operator confirms permission and tape/floor measurements recorded independently of the model result; not authenticated.',
      summary:{attempted:rows.length,computed:rows.filter(r=>r.status==='computed').length,rejected:rows.filter(r=>r.status==='rejected').length,
        submittedParticipantCodes:new Set(rows.map(r=>r.participantCode)).size},methodGroups,rows,
      limitations:['Descriptive observations from operator-selected sections, not validated anatomical circumferences.',
        'Counts of scans and participant codes are separate; repeated observations are not independent people.',
        'Results are grouped by recorded method, model, delegate and grid resolution; groups are not pooled.',
        'Height sets the assumed surface scale. Clothing, pose, segmentation and tape technique can affect error.',
        'Rejected cases remain visible. No acceptance threshold, population inference or FITMATCH-equivalence claim is made.',
        'Files, participant codes, reference measurements and capture provenance are supplied by the operator and are not authenticated.']};
  }
  if(node)module.exports={run};else root.SurfaceStudy={run};
})(globalThis);
