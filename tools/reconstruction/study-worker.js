importScripts('/mesh-section.js','/surface-archive.js','/surface-reference.js','/surface-study.js');
let started=false;
self.onmessage=async({data})=>{
  if(started)return;started=true;
  try{const result=await SurfaceStudy.run(data.cases,data.options,message=>self.postMessage({type:'progress',message}));self.postMessage({type:'result',result});}
  catch(error){self.postMessage({type:'error',message:error.message||'Reference report failed.'});}
  finally{for(const c of data.cases||[])c.objBytes?.fill(0);}
};
