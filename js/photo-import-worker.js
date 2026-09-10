importScripts('heic-decode.js');
self.onmessage=async({data})=>{
  try{self.postMessage({type:'result',result:await HeicImport.normalize(data.frame,message=>self.postMessage({type:'progress',message}))});}
  catch(error){self.postMessage({type:'error',message:error.message||'HEIC conversion failed.'});}
};
