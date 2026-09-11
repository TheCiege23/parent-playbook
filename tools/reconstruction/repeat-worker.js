importScripts('/mesh-section.js','/surface-archive.js','/surface-repeat.js');
let started=false;
self.onmessage=async({data})=>{
  if(started)return;started=true;
  try{
    self.postMessage({type:'progress',message:'Checking both file pairs and computing matching horizontal sections…'});
    const result=await SurfaceRepeat.compareFiles(data.first,data.second,data.options);
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',message:error.message||'Comparison failed.'});}
  finally{for(const pair of [data.first,data.second])pair?.objBytes?.fill(0);}
};
