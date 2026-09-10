// Cancelable local HEIC-to-PNG conversion for capture UIs. JPEG/PNG stay unchanged.
export function importScanPhoto(frame,{signal,onProgress,permissionAcknowledged=false}={}){
  return new Promise((resolve,reject)=>{
    if(!permissionAcknowledged)return reject(Error('Permission is required before converting this photo.'));
    if(signal?.aborted)return reject(new DOMException('Photo import canceled.','AbortError'));
    let worker,timer,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(result);};
    const abort=()=>finish(new DOMException('Photo import canceled.','AbortError'));
    try{
      worker=new Worker(new URL('./photo-import-worker.js',import.meta.url));
      worker.onmessage=({data})=>{
        if(settled)return;
        if(data?.type==='progress'){try{onProgress?.(data.message);}catch{}}
        else if(data?.type==='result')finish(null,data.result);
        else {
          const advice={invalid_photo:'Choose a photo up to 25 MB.',photo_dimensions:'This HEIC photo exceeds 16 megapixels. Export a smaller copy.',heic_multiple_images:'Choose a single-photo HEIC file, not an image sequence.',heic_decode_failed:'This HEIC photo could not be decoded. Try a fresh JPEG or PNG export.'};
          finish(Error(advice[data?.message]||'Local photo conversion failed. Try a fresh JPEG or PNG copy.'));
        }
      };
      worker.onerror=e=>{e.preventDefault?.();finish(Error('Local HEIC decoder could not run. Try a PNG or JPEG copy.'));};
      worker.onmessageerror=()=>finish(Error('Photo import returned unreadable data.'));
      signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(Error('Photo import timed out. Try a smaller photo.')),90000);
      if(signal?.aborted)return abort();worker.postMessage({frame});
    }catch(error){finish(error);}
  });
}
