import {reviewSurface,surfaceFailureSummary} from './surface-review.mjs';
import {importScanPhoto} from './photo-import.mjs';
const error=(code,message)=>Object.assign(new Error(message),{code,name:'BodyScanError'});
// Race host permission lookups against cancellation; a hung backend cannot trap dispose().
async function permissionCheck(checkPermission,signal,isCurrent){
  if(!isCurrent())throw new DOMException('Scan canceled.','AbortError');
  let abort,timer;
  try{
    const value=await Promise.race([
      Promise.resolve().then(checkPermission),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('PERMISSION_CHECK_FAILED','The host permission check timed out.')),30000);}),
      new Promise((_,reject)=>{abort=()=>reject(new DOMException('Scan canceled.','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})
    ]);
    if(!isCurrent())throw new DOMException('Scan canceled.','AbortError');
    if(value!==true)throw error('PERMISSION_CHANGED','The host no longer authorizes this scan and its experimental geometry.');
    return true;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export async function runSurfaceScan({options,sdkVersion,isCurrent,scan}){
  const {signal,checkPermission}=options;
  const authorize=()=>permissionCheck(checkPermission,signal,isCurrent);
  await authorize();
  const assessment=await scan(options);
  await authorize();
  let surface=null,surfaceStatus='skipped',permissionFailure=null,surfaceFailure=null;
  const progress=message=>{if(isCurrent())try{options.onProgress?.(message);}catch{}};
  try{
    progress('Review four silhouettes for the experimental 3D surface.');
    surface=await reviewSurface({frames:options.frames,heightM:options.heightIn*.0254,mount:options.mountReview,isCurrent,signal,
      onFailure:failure=>{surfaceFailure=failure;},
      retentionNotice:'The SDK releases its processing copies after this step. Your host application still controls its selected photos and returned geometry, including any saving or sharing.',
      authorize:async()=>{try{return await authorize();}catch(e){permissionFailure=e;throw new DOMException('Permission changed.','AbortError');}},
      prepareBitmap:async frame=>{
        let bitmap;
        try{
          const normalized=await importScanPhoto(frame,{signal,permissionAcknowledged:true,onProgress:progress});
          if(!isCurrent())throw new DOMException('Canceled.','AbortError');
          bitmap=await createImageBitmap(normalized.blob);
          if(!isCurrent())throw new DOMException('Canceled.','AbortError');
          if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>16e6)throw error('PHOTO_DIMENSIONS','Photo exceeds 16 megapixels.');
          if(Math.max(bitmap.width,bitmap.height)>1600){
            const scale=1600/Math.max(bitmap.width,bitmap.height),original=bitmap;bitmap=null;
            try{bitmap=await createImageBitmap(original,{resizeWidth:Math.round(original.width*scale),resizeHeight:Math.round(original.height*scale),resizeQuality:'high'});}finally{original.close();}
          }
          if(!isCurrent())throw new DOMException('Canceled.','AbortError');
          const output=bitmap;bitmap=null;return output;
        }finally{bitmap?.close();}
      }});
    surfaceStatus=surface?'generated':surfaceFailure?'rejected':'skipped';
    if(surface)surfaceFailure=null;
  }catch(e){
    if(permissionFailure)throw permissionFailure;
    if(e.name==='AbortError'||!isCurrent())throw new DOMException('Scan canceled.','AbortError');
    surfaceStatus='unavailable';
    surfaceFailure=surfaceFailureSummary(e,'segmentation');
  }
  try{await authorize();}catch(e){if(surface?.mesh){surface.mesh.vertices.length=surface.mesh.faces.length=0;}throw e;}
  return {schema:'PP_BODY_SDK_SURFACE_RESULT_V1',sdkVersion,assessment,surfaceStatus,surface,surfaceFailure,
    limitations:['Experimental clothed-surface geometry, not validated anatomy or body composition.',
      'Geometry is sensitive derived data. The host controls access, storage, retention and deletion.',
      'No photos, silhouette masks or landmarks are included. Processing is on-device.']};
}
