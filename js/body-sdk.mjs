// Self-host these files together on the embedding application's origin.
export const SDK_VERSION = '0.13.0';
export {renderSurfacePreview,summarizeProjectionAgreement,derivePosePlaneMarkers} from './surface-review.mjs';
export {createSurfaceReport,surfaceReportHTML} from './body-surface-report.mjs';
export {summarizeMeasurementResult,measurementReportHTML} from './body-sdk-report.mjs';
export {COMPANY_ASSESSMENT_SCHEMA,prepareCompanyAssessment,createCompanyAssessmentStore} from './body-sdk-record.mjs';
export {createSupabaseCompanyAssessmentAdapter} from './body-sdk-supabase.mjs';
export {compareCompanyAssessmentRecords,companyAssessmentComparisonCSV} from './body-sdk-reference-history.mjs';
export {BODY_COMPOSITION_METRICS,validateCompositionModelManifest,validateCompositionEstimate,compositionUnavailableReason} from './body-composition-contract.mjs';
export {evaluateCompositionValidationStudy} from './body-composition-validation.mjs';
export function releaseSurfaceResult(result){
  const mesh=result?.surface?.mesh;
  if(mesh){mesh.vertices.length=0;mesh.faces.length=0;}
  if(result)result.surface=null;
}
const VIEWS = ['front', 'right', 'back', 'left'];
function failure(code, message = code) {
  return Object.assign(new Error(message), {name: code === 'ABORTED' ? 'AbortError' : 'BodyScanError', code});
}
function photo(frame) {
  const heic=frame instanceof Blob&&(/^image\/hei[cf]/i.test(frame.type)||/\.hei[cf]$/i.test(frame.name||''));
  if (!(frame instanceof Blob) || (!heic&&!['image/jpeg', 'image/png', 'image/webp'].includes(frame.type)) || !frame.size || frame.size > 25 * 1024 * 1024)
    throw failure('INVALID_PHOTO', 'Choose a HEIC, JPEG, PNG or WebP photo up to 25 MB.');
  return frame;
}
function sectionMarker(surface,key,planeCm,label){
  if(key==null)return null;
  const planes=surface?.posePlanes,keys=['shoulder_midpoint','torso_midpoint','hip_midpoint'];
  if(!keys.includes(key)||planes?.protocol!=='four-view-pose-plane-markers-v1'||planes.status!=='experimental'||planes.inputViewCount!==4||planes.scaleStatus!=='assumed-stature-not-validated'||!Array.isArray(planes.markers)||planes.markers.length!==3)throw failure('INVALID_PLANE_MARKER','Choose a pose-derived plane from this exact surface result.');
  const marker=planes.markers.find(item=>item?.key===key);
  if(!marker||typeof marker.label!=='string'||marker.label.length<1||marker.label.length>120||!Number.isFinite(marker.planeCm)||!Number.isFinite(marker.maxViewSpreadCm)||marker.maxViewSpreadCm<0||Math.abs(marker.planeCm-planeCm)>.051||String(label||'').trim()!==marker.label)throw failure('INVALID_PLANE_MARKER','The selected label and height must match the pose-derived plane in this surface result.');
  return {protocol:planes.protocol,key:marker.key,label:marker.label,inputViewCount:4,planeCm:marker.planeCm,maxViewSpreadCm:marker.maxViewSpreadCm};
}
/** No storage or uploads. The host application owns consent, access and retention. */
export function createBodyScanner({timeoutMs = 120000} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw failure('INVALID_TIMEOUT');
  let disposed = false, active = null, surfaceRun = null;
  async function run(operation, options = {}, owned = false) {
    if (disposed) throw failure('DISPOSED');
    if (active || (surfaceRun && !owned)) throw failure('BUSY', 'Wait for or cancel the current request.');
    const {signal, onProgress, permissionAcknowledged} = options;
    if (permissionAcknowledged !== true) throw failure('PERMISSION_REQUIRED', 'The host must obtain permission before processing photos.');
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw failure('INVALID_SIGNAL');
    if (signal?.aborted) throw failure('ABORTED');
    let payload;
    if (operation === 'scan') {
      if (!Number.isFinite(options.heightIn) || options.heightIn < 30 || options.heightIn > 90) throw failure('INVALID_HEIGHT', 'Recorded height must be 30–90 inches.');
      payload = {heightIn: options.heightIn, frames: Object.fromEntries(VIEWS.map(view => [view, photo(options.frames?.[view])]))};
    } else if(operation==='section') {
      if(options.surfacePermissionAcknowledged!==true)throw failure('SURFACE_PERMISSION_REQUIRED');
      const mesh=options.surface?.mesh;
      if(!mesh||!Array.isArray(mesh.vertices)||mesh.vertices.length<4||mesh.vertices.length>100000||!Array.isArray(mesh.faces)||mesh.faces.length>150000)throw failure('INVALID_SURFACE');
      const marker=sectionMarker(options.surface,options.markerKey,options.planeCm,options.label);
      payload={mesh:{protocol:mesh.protocol,experimental:mesh.experimental,units:mesh.units,scaleStatus:mesh.scaleStatus,heightM:mesh.heightM,resolution:mesh.resolution,vertices:mesh.vertices,faces:mesh.faces},
        options:{planeCm:options.planeCm,label:options.label,referenceCm:options.referenceCm??null,
          marker}};
    } else {
      if (!VIEWS.includes(options.view)) throw failure('INVALID_VIEW');
      payload = {view: options.view, frame: photo(options.frame)};
    }
    return new Promise((resolve, reject) => {
      let worker, timer, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
        active = null;
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(failure('ABORTED'));
      active = abort;
      try {
        worker = new Worker(new URL(operation==='section'?'./body-section-worker.js':'./body-sdk-worker.js', import.meta.url));
        worker.onmessage = ({data}) => {
          if (settled) return;
          if (data?.type === 'progress') {
            // A consumer callback cannot strand the worker or break its result promise.
            try { if (typeof onProgress === 'function') onProgress(String(data.message).slice(0, 200)); } catch {}
          } else if (data?.type === 'result') finish(null, data.result);
          else if (data?.type === 'error') {
            const error = failure(data.code || 'PROCESSING_FAILED', data.message || 'Processing failed.');
            if (Array.isArray(data.captureChecks)) error.captureChecks = data.captureChecks.slice(0, 4).filter(c => VIEWS.includes(c?.view)).map(c => ({
              view: c.view, accepted: c.accepted === true,
              reasons: Array.isArray(c.reasons) ? c.reasons.filter(s => typeof s === 'string' && /^[a-z_]{1,64}$/.test(s)).slice(0, 12) : [],
            }));
            finish(error);
          }
          else finish(failure('INVALID_RESPONSE'));
        };
        worker.onerror = event => { event.preventDefault?.(); finish(failure('WORKER_FAILED', 'The local measurement worker could not run.')); };
        worker.onmessageerror = () => finish(failure('INVALID_RESPONSE'));
        timer = setTimeout(() => finish(failure('TIMEOUT', 'Processing timed out. Retry on a supported device.')), timeoutMs);
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) return abort();
        worker.postMessage({operation, ...payload});
      } catch { finish(failure('WORKER_FAILED', 'Host the SDK and worker on the same origin with worker support enabled.')); }
    });
  }
  async function scanWithSurface(options={}) {
    if(disposed)throw failure('DISPOSED');
    if(active||surfaceRun)throw failure('BUSY');
    if(options.permissionAcknowledged!==true)throw failure('PERMISSION_REQUIRED');
    if(options.surfacePermissionAcknowledged!==true)throw failure('SURFACE_PERMISSION_REQUIRED','Permission must explicitly cover processing and returning experimental body geometry.');
    if(typeof options.mountReview!=='function'||typeof options.checkPermission!=='function')throw failure('INVALID_SURFACE_HOST','Provide mountReview and a fresh checkPermission callback.');
    if(!Number.isFinite(options.heightIn)||options.heightIn*.0254<.8||options.heightIn>90)throw failure('INVALID_HEIGHT','Experimental surfaces require recorded height of at least 80 cm and no more than 90 inches.');
    const frames=Object.fromEntries(VIEWS.map(v=>[v,photo(options.frames?.[v])]));
    const signal=options.signal;
    if(signal&&(typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw failure('INVALID_SIGNAL');
    if(signal?.aborted)throw failure('ABORTED');
    const controller=new AbortController(),abort=()=>controller.abort();surfaceRun=controller;
    signal?.addEventListener('abort',abort,{once:true});
    // Snapshot inputs before any host callback can change the selected photos/height.
    const snapshot={...options,frames,signal:controller.signal};
    try{
      if(signal?.aborted)controller.abort();
      const {runSurfaceScan}=await import('./body-sdk-surface.mjs');
      return await runSurfaceScan({options:snapshot,sdkVersion:SDK_VERSION,
        isCurrent:()=>!disposed&&!controller.signal.aborted&&surfaceRun===controller,
        scan:opts=>run('scan',opts,true)});
    }catch(error){
      if(controller.signal.aborted||error.name==='AbortError')throw failure('ABORTED');
      throw error;
    }finally{signal?.removeEventListener('abort',abort);if(surfaceRun===controller)surfaceRun=null;for(const v of VIEWS)delete frames[v];}
  }
  return Object.freeze({
    version: SDK_VERSION,
    scan: options => run('scan', options),
    reviewPhoto: options => run('review', options),
    scanWithSurface,
    measureSurfaceSection: options=>run('section',options),
    dispose() { disposed = true; surfaceRun?.abort(); active?.(); },
  });
}
