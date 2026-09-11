importScripts('/js/surface-worker.js');
importScripts('/mesh-section.js','/surface-reference.js','/surface-archive.js');
const surfaceRequest=self.onmessage;
self.onmessage=async(event)=>{
  const data=event.data;
  try{
    if(data.type==='reopen'){
      const reopened=await SurfaceArchive.open(data.objBytes,data.methodText);
      self.postMessage({id:data.id,...reopened,objBytes:data.objBytes},[data.objBytes.buffer]);return;
    }
    if(data.type==='reference'){
      self.postMessage({id:data.id,comparison:SurfaceReference.compare(data.mesh,data.options)});return;
    }
    await surfaceRequest(event);
  }catch(error){self.postMessage({id:data.id,error:error.message||String(error)});}
};
