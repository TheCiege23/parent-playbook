// Versioned scan provenance. A saved body scan is one row in body_scan_assessments, and each output
// row in measurements references it. The same metadata is still written to measurements.note, so every
// existing reader, export and legacy comparison keeps working.
// Only allowlisted scalar metadata is serialized: never frames, landmarks or asset URLs.
const SCAN_NOTE_PREFIX = 'PP_SCAN_V1:';
function scanFinite(value){ return typeof value==='number' && Number.isFinite(value) ? value : null; }
function scanStrings(value){ return Array.isArray(value)?value.filter(v=>typeof v==='string').slice(0,32).map(v=>v.slice(0,180)):[]; }
function scanProcessingLabel(meta){
  const ms=meta?.processing?.duration_ms;
  if(meta?.processing?.protocol!=='provider-wall-time-v1'||scanFinite(ms)===null||ms<0||ms>3600000)return '';
  return 'Measurement processing: '+(ms<100?'<0.1':(ms/1000).toFixed(1))+' s. Excludes photo capture, review and saving; includes any loading inside the measurement call.';
}
function buildScanRecord(result, context){
  if(!context?.athleteId || !context?.actorId || !context?.engine?.id || !context?.consentId) throw new Error('Missing scan identity');
  const capturedAt=context.capturedAt||new Date().toISOString();
  if(!Number.isFinite(Date.parse(capturedAt))) throw new Error('Invalid scan date');
  const detail=result.detail||{};
  const meta={schema:1,id:uuid(),athlete_id:context.athleteId,captured_at:capturedAt,
    engine:{id:context.engine.id,version:context.engine.version||'unversioned',model:context.engine.model||'unspecified'},
    consent_id:context.consentId,
    processing:scanFinite(context.processingMs)!==null&&context.processingMs>=0&&context.processingMs<=3600000?{protocol:'provider-wall-time-v1',duration_ms:Math.round(context.processingMs)}:null,
    photo_reuse_check:detail.photoIdentity?.protocol==='exact-photo-bytes-v1'&&detail.photoIdentity.checked_views===4&&detail.photoIdentity.distinct_files===true?{protocol:'exact-photo-bytes-v1',checked_views:4,distinct_files:true}:null,
    output_dictionary:typeof detail.outputDictionary==='string'?detail.outputDictionary.slice(0,80):null,
    side_method:typeof detail.sideMethod==='string'?detail.sideMethod.slice(0,80):null,
    input_height:{value:scanFinite(context.height?.value),unit:'in',measured_on:context.height?.measured_on||null,source:context.height?.source||null},
    quality:{kind:'heuristic',score:scanFinite(result.confidence),frames_used:scanStrings(detail.framesUsed),frames_missed:scanStrings(detail.framesMissed),rejected:scanStrings(detail.rejected),
      skipped:Array.isArray(detail.skipped)?detail.skipped.slice(0,32).map(s=>({key:String(s.key||'').slice(0,80),reason:String(s.reason||'').slice(0,180)})):[],
      disagreement:scanFinite(detail.disagreement),crown_from:typeof detail.crownFrom==='string'?detail.crownFrom.slice(0,80):null,
      capture_checks:Array.isArray(detail.captureChecks)?detail.captureChecks.slice(0,4).filter(c=>c && ['front','right','back','left'].includes(c.view)).map(c=>({view:c.view,protocol:String(c.protocol||'').slice(0,80),accepted:c.accepted===true,reasons:scanStrings(c.reasons),warnings:scanStrings(c.warnings)})):[]}};
  const note=SCAN_NOTE_PREFIX+JSON.stringify(meta);
  const rows=Object.entries(result.metrics||{}).map(([key,value])=>{
    const unit=result.units?.[key] || context.defaultUnit;
    if(!key || scanFinite(value)===null || value<=0 || !unit) throw new Error('Invalid measurement or missing unit');
    // measured_on is a plain calendar DATE, and capturedAt is a UTC instant. Slicing it
    // stamped a body scan taken at 8pm west of UTC with tomorrow: a future reading, which
    // biSnapshot then filters out of its own day. The jump, sprint and speed scans already
    // stamp todayISO(), so this also had the flagship 25-output scan disagreeing with the
    // other three about what day it was.
    return {id:uuid(),athlete_id:context.athleteId,metric_key:key,value,unit,source:'photo',measured_on:localDay(new Date(capturedAt)),created_by:context.actorId,note,scan_assessment_id:meta.id};
  });
  if(!rows.length) throw new Error('No measurements to save');
  return JSON.parse(JSON.stringify({meta,rows})); // detach from mutable provider/global state
}
function readScanRecord(row){
  if(typeof row?.note!=='string' || !row.note.startsWith(SCAN_NOTE_PREFIX) || row.note.length>16000) return null;
  try{
    const m=JSON.parse(row.note.slice(SCAN_NOTE_PREFIX.length));
    if(m.schema!==1 || typeof m.id!=='string' || !m.id || typeof m.engine?.id!=='string' || typeof m.engine.version!=='string' || typeof m.engine.model!=='string' || typeof m.captured_at!=='string' || !Number.isFinite(Date.parse(m.captured_at)) || (row.athlete_id && m.athlete_id!==row.athlete_id)) return null;
    return m;
  }catch(_){return null;}
}
function scanCompatibility(a,b){
  if(!a || !b || a.unit!==b.unit || !a.source || a.source!==b.source) return false;
  const x=readScanRecord(a),y=readScanRecord(b);
  if(!x && !y) return true; // legacy same-method comparisons remain available
  return !!(x && y && x.engine.id===y.engine.id && x.engine.version===y.engine.version && x.engine.model===y.engine.model);
}
// The provenance stored on the scan's own row in body_scan_assessments. The same allowlisted
// metadata as the note, with one key renamed: the database refuses any key naming a photo, and
// photo_reuse_check describes a check that the four files were distinct, not a photo.
function scanAssessmentPayload(record){
  const m=record.meta;
  return {id:m.id,athlete_id:m.athlete_id,consent_id:m.consent_id,captured_at:m.captured_at,engine:m.engine,
    record:{processing:m.processing,reuse_check:m.photo_reuse_check,output_dictionary:m.output_dictionary,side_method:m.side_method,input_height:m.input_height,quality:m.quality}};
}
async function saveScanRecord(record){
  if(state.user?.id!==record.rows[0].created_by) throw new Error('Sign in to the account that started this scan before saving.');
  const live=await loadScanConsent(record.meta.athlete_id,record.meta.engine.id);
  if(!live || live.id!==record.meta.consent_id) throw new Error('Permission changed. Start a new assessment before saving.');
  if(state.user?.id!==record.rows[0].created_by) throw new Error('Sign in to the account that started this scan before saving.');
  // One call saves the scan and its outputs in one transaction. Stable IDs make a retry after a
  // dropped connection a no-op on the server rather than a duplicate.
  let {error}=await sb.rpc('save_body_scan_assessment',{p_assessment:scanAssessmentPayload(record),p_rows:record.rows});
  // The site can reach families before the database migration that adds scan records does. Until
  // it has, the outputs are saved exactly as before, and that migration links them to a scan.
  if(error && (error.code==='PGRST202' || error.code==='42883')){
    const rows=record.rows.map(({scan_assessment_id,...row})=>row);
    ({error}=await sb.from('measurements').upsert(rows,{onConflict:'id',ignoreDuplicates:true}));
  }
  if(error) throw error;
}
