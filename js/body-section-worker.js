importScripts('mesh-section.js','surface-section.js');
let started=false;
self.onmessage=async({data})=>{
  if(started)return;started=true;
  try{
    const start=performance.now(),result=SurfaceSection.measure(data.mesh,data.options);
    // Hash only canonical geometry/method fields, never host identifiers or photos.
    const bytes=new TextEncoder().encode(JSON.stringify({protocol:data.mesh.protocol,heightM:data.mesh.heightM,resolution:data.mesh.resolution,vertices:data.mesh.vertices,faces:data.mesh.faces}));
    const digest=await crypto.subtle.digest('SHA-256',bytes);bytes.fill(0);
    result.section.source={protocol:data.mesh.protocol,heightM:data.mesh.heightM,resolution:data.mesh.resolution,
      fingerprintProtocol:'surface-json-sha256-v1',sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
    result.sdkVersion='0.13.0';result.processingMs=Math.round(performance.now()-start);
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',code:'SECTION_REJECTED',message:error.message||'Surface section failed.'});}
  finally{if(Array.isArray(data.mesh?.vertices))data.mesh.vertices.length=0;if(Array.isArray(data.mesh?.faces))data.mesh.faces.length=0;}
};
