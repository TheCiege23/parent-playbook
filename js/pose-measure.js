// On-device photo length estimates from MediaPipe landmarks, scaled to recorded height.
// Joint detection, inferred depth, estimated crown/hand dimensions and camera conditions
// all contribute error. Repeat scans do not guarantee the same error, and ratios are
// not exempt from landmark or scaling uncertainty. No anatomical girths, body
// composition or predicted growth-spurt timing are produced by this provider.
// Photo quality gates are provisional heuristics, not calibrated accuracy tests.

// Pinned. A floating version means a model that silently changes what it returns
// between one scan and the next, which for a trend line is the same as lying.
const MP_VERSION = '1.0.1';
const MP_BUNDLE  = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM    = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
// `full` (9.4MB) over `lite` (5.8MB) and `heavy` (29MB). Lite loses precision exactly
// where this needs it — the ankle and wrist points at the ends of the longest levers.
// Heavy is not worth 20MB more on a phone on a sideline. Downloaded once, then the
// browser's HTTP cache serves every later scan.
const MP_MODEL   = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/'
                 + 'pose_landmarker_full/float16/1/pose_landmarker_full.task';

// BlazePose's 33 points. Named because `lm[24]` three hundred lines from here is how a
// left hip quietly becomes a right one.
const P = {
  NOSE:0, EYE_L:2, EYE_R:5, EAR_L:7, EAR_R:8,
  SHO_L:11, SHO_R:12, ELB_L:13, ELB_R:14, WRI_L:15, WRI_R:16,
  HIP_L:23, HIP_R:24, KNEE_L:25, KNEE_R:26, ANK_L:27, ANK_R:28,
  HEEL_L:29, HEEL_R:30, TOE_L:31, TOE_R:32,
};

// Distance from the ear line to the crown, as a multiple of the subject's own
// ear-to-ear breadth. Head breadth and head height covary tightly within a person,
// which is why this beats a fixed fraction of stature: children's heads are
// proportionally larger than adults', and a stature-based constant would bias every
// child's scan in the same direction. Roughly 0.62 across published child and adult
// head anthropometry.
const HEAD_ABOVE_EAR = 0.62;

// Hand length as a share of stature. Stable at ~0.108 from early childhood through
// adulthood — one of the more reliable ratios in anthropometry. Used because wingspan
// and standing reach both end at the FINGERTIP, and BlazePose's most distal hand point
// sits around the knuckles.
const HAND_OF_STATURE = 0.108;

// A landmark below this is a guess the model is telling you not to trust. Used to drop
// individual segments per frame rather than whole frames — a side view has an excellent
// near arm and a fabricated far one, and there is no reason to throw the good half away.
const VIS_MIN = 0.5;

// Sanity envelopes, as a share of measured height. Deliberately wide: these exist to
// catch a scan that went wrong — the wrong person in frame, a mirror, a child sitting
// down, a height record that belongs to a sibling — not to enforce a body type. A
// result outside these is discarded and the parent is asked to re-shoot, because a
// wrong number saved into a growth chart outlives every apology for it.
const ENVELOPE = {
  wingspan:       [0.88, 1.14],
  standing_reach: [1.15, 1.45],
  shoulder_width: [0.15, 0.30],
  hip_width:      [0.08, 0.30],
  ear_width:      [0.04, 0.18],
  torso_length:   [0.20, 0.42],
  leg_length:     [0.36, 0.60],
};

// ---------------------------------------------------------------------------
//  LOADING
// ---------------------------------------------------------------------------
// Dynamic import() is a function call, so it is legal in this classic non-module
// script — same trick three.js uses in body-scan.js, same reason: no build step, and a
// parent who never scans never downloads 9MB of it.
let MP_CACHE = null;
async function loadPoseLandmarker(onProgress){
  if(MP_CACHE) return MP_CACHE;
  if(onProgress) onProgress('Loading the pose model…');
  const vision = await import(MP_BUNDLE);
  const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
  MP_CACHE = await vision.PoseLandmarker.createFromOptions(fileset, {
    // Dedicated SDK workers have no document from which to create a GPU canvas.
    ...(typeof document === 'undefined' && typeof OffscreenCanvas === 'function' ? {canvas: new OffscreenCanvas(1, 1)} : {}),
    baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
    runningMode: 'IMAGE',
    numPoses: 2, // detect a second person so capture review can reject an ambiguous frame
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  return MP_CACHE;
}

// ---------------------------------------------------------------------------
//  VECTOR HELPERS
// ---------------------------------------------------------------------------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid  = (a, b) => ({ x:(a.x + b.x)/2, y:(a.y + b.y)/2, z:(a.z + b.z)/2 });

// Weighted mean that ignores empty input rather than returning NaN. Every segment below
// can legitimately have no samples — a frame where the feet were cut off contributes
// nothing to leg length — and NaN propagating into a saved measurement is the failure
// mode this whole file is built to avoid.
function wmean(samples){
  let sw = 0, sv = 0;
  for(const s of samples){ if(!isFinite(s.v) || !(s.w > 0)) continue; sv += s.v * s.w; sw += s.w; }
  return sw > 0 ? { value: sv / sw, weight: sw, n: samples.length } : null;
}

// Coefficient of variation across frames: one uncalibrated quality indicator. Four views of
// the same body should agree on how long its femur is. When they don't, something in
// the capture was wrong (moved between shots, camera nudged, loose clothing) and the
// average of four disagreeing numbers is not better than one good one.
function spread(samples){
  const vals = samples.map(s => s.v).filter(isFinite);
  if(vals.length < 2) return 0;
  const m = vals.reduce((a,b) => a+b, 0) / vals.length;
  if(!m) return 0;
  const sd = Math.sqrt(vals.reduce((a,b) => a + (b-m)*(b-m), 0) / (vals.length - 1));
  return sd / Math.abs(m);
}

// ---------------------------------------------------------------------------
//  ONE FRAME -> SEGMENTS, IN MODEL UNITS
// ---------------------------------------------------------------------------
// Returns metres-ish at MediaPipe's own inferred scale. Nothing here is in inches yet;
// the scaling happens once, at the end, against the measured height.
//
// `lateral` says whether this view can be trusted for ACROSS-body widths. In a profile
// shot the two shoulders sit almost on top of each other and biacromial breadth
// collapses toward zero — the model still returns a number, and that number is the
// single most damaging thing this file could average in.
function frameSegments(world, norm, lateral){
  const vis = i => {
    const n = norm && norm[i];
    // `visibility` is absent on some builds; presence is the fallback, and an outright
    // missing point is a zero rather than an optimistic default.
    const v = n ? (n.visibility != null ? n.visibility : (n.presence != null ? n.presence : 0)) : 0;
    return typeof v === 'number' ? v : 0;
  };
  const ok = (...ids) => ids.every(i => vis(i) >= VIS_MIN);
  const w  = (...ids) => ids.reduce((a,i) => a + vis(i), 0) / ids.length;
  const L  = i => world[i];

  const out = {};
  const put = (key, value, weight) => {
    if(isFinite(value) && value > 0 && weight > 0) out[key] = { v:value, w:weight };
  };

  // Limb segments are averaged within the frame. This does not establish anatomical
  // symmetry and must not be used as a bilateral asymmetry measurement.
  const pair = (key, aL, bL, aR, bR) => {
    const s = [];
    if(ok(aL, bL)) s.push({ v:dist(L(aL), L(bL)), w:w(aL, bL) });
    if(ok(aR, bR)) s.push({ v:dist(L(aR), L(bR)), w:w(aR, bR) });
    const m = wmean(s);
    if(m) put(key, m.value, m.weight);
  };

  pair('upper_arm', P.SHO_L, P.ELB_L, P.SHO_R, P.ELB_R);
  pair('forearm',   P.ELB_L, P.WRI_L, P.ELB_R, P.WRI_R);
  pair('thigh',     P.HIP_L, P.KNEE_L, P.HIP_R, P.KNEE_R);
  pair('shank',     P.KNEE_L, P.ANK_L, P.KNEE_R, P.ANK_R);

  // --- torso: hip midpoint to shoulder midpoint. Needs all four points, so it is one
  // --- measurement rather than a left/right pair.
  if(ok(P.HIP_L, P.HIP_R, P.SHO_L, P.SHO_R)){
    const hipM = mid(L(P.HIP_L), L(P.HIP_R)), shoM = mid(L(P.SHO_L), L(P.SHO_R));
    put('torso', dist(hipM, shoM), w(P.HIP_L, P.HIP_R, P.SHO_L, P.SHO_R));
  }

  // --- ankle above the floor. The heel and toe sit ON the ground, so the vertical gap
  // --- to the ankle is the last piece of standing leg length. Skipping it loses about
  // --- two inches on a child, which is most of a season's growth.
  {
    const s = [];
    if(ok(P.ANK_L, P.HEEL_L)) s.push({ v:Math.abs(L(P.HEEL_L).y - L(P.ANK_L).y), w:w(P.ANK_L, P.HEEL_L) });
    if(ok(P.ANK_R, P.HEEL_R)) s.push({ v:Math.abs(L(P.HEEL_R).y - L(P.ANK_R).y), w:w(P.ANK_R, P.HEEL_R) });
    const m = wmean(s);
    if(m) put('ankle_rise', m.value, m.weight);
  }

  // --- shoulder midpoint to ear midpoint: the neck plus the lower half of the head.
  if(ok(P.SHO_L, P.SHO_R, P.EAR_L, P.EAR_R)){
    const shoM = mid(L(P.SHO_L), L(P.SHO_R)), earM = mid(L(P.EAR_L), L(P.EAR_R));
    put('neck_head', dist(shoM, earM), w(P.SHO_L, P.SHO_R, P.EAR_L, P.EAR_R));
  }

  // --- ACROSS-BODY widths. Front and back only. In profile the far shoulder and far
  // --- ear are occluded, MediaPipe infers them, and the inference is systematically
  // --- too narrow. Weighting them low is not enough; they are excluded.
  if(lateral){
    if(ok(P.SHO_L, P.SHO_R)) put('biacromial',   dist(L(P.SHO_L), L(P.SHO_R)), w(P.SHO_L, P.SHO_R));
    if(ok(P.HIP_L, P.HIP_R)) put('hip_breadth',  dist(L(P.HIP_L), L(P.HIP_R)), w(P.HIP_L, P.HIP_R));
    if(ok(P.EAR_L, P.EAR_R)) put('head_breadth', dist(L(P.EAR_L), L(P.EAR_R)), w(P.EAR_L, P.EAR_R));
  }
  return out;
}

// ---------------------------------------------------------------------------
//  THE MEASUREMENT
// ---------------------------------------------------------------------------
// frames:   { front: Blob, right: Blob, back: Blob, left: Blob }
// heightIn: a real, recently measured height. NOT optional — it is the only thing
//           standing between a set of proportions and a set of lengths.
async function measureFromFrames({ frames, heightIn, onProgress }){
  const H = Number(heightIn);
  if(!isFinite(H) || H < 30 || H > 90)
    throw new Error('needs_height');

  // front and back see the body across; left and right see it edge-on.
  const LATERAL = { front:true, back:true, left:false, right:false };
  const keys = ['front','right','back','left'];
  if(keys.some(k=>!frames?.[k])) throw new Error('needs_four_views');
  const photoIdentity=await requireDistinctPhotos(frames);
  const landmarker = await loadPoseLandmarker(onProgress);
  const perFrame = {};       // segment -> [{v,w}]
  const seen = [];
  const missed = [];
  const captureChecks = [];
  let frontPose=null;
  let detectionError = null;

  for(let i = 0; i < keys.length; i++){
    const k = keys[i];
    if(onProgress) onProgress(`Reading the ${k} photo — ${i+1} of ${keys.length}`);
    let bmp = null;
    try{
      bmp = await createImageBitmap(frames[k]);
      const res = landmarker.detect(bmp);
      const check=checkPhotoPose(res,k,{width:bmp.width,height:bmp.height});
      captureChecks.push(photoCheckSummary(check));
      if(!check.accepted){ missed.push(k); continue; }
      const world = res && res.worldLandmarks && res.worldLandmarks[0];
      const norm  = res && res.landmarks && res.landmarks[0];
      if(!world || !norm){ missed.push(k); continue; }
      if(k==='front') frontPose={world,norm};

      const segs = frameSegments(world, norm, !!LATERAL[k]);
      for(const [name, s] of Object.entries(segs)){
        (perFrame[name] = perFrame[name] || []).push(s);
      }
      seen.push(k);
    }catch(e){
      console.warn('pose detect failed on ' + k, e);
      detectionError = detectionError || e;
      missed.push(k);
    }finally{
      try{ bmp && bmp.close && bmp.close(); }catch(_){}
    }
  }

  if(detectionError) throw detectionError;
  if(missed.length){const error=new Error('capture_quality');error.captureChecks=captureChecks;throw error;}

  if(onProgress) onProgress('Working out the measurements…');

  const agg = {};
  for(const [name, list] of Object.entries(perFrame)) agg[name] = wmean(list);
  const need = n => (agg[n] ? agg[n].value : null);

  const thigh = need('thigh'), shank = need('shank'), torso = need('torso');
  const upper = need('upper_arm'), fore = need('forearm');
  const neckHead = need('neck_head'), headBreadth = need('head_breadth');
  const ankle = need('ankle_rise') || 0;      // a missing ankle rise is a small loss, not a failure
  const biacromial = need('biacromial'), hipBreadth=need('hip_breadth');

  if(thigh == null || shank == null || torso == null || neckHead == null)
    throw new Error('incomplete');

  // ---- stature in model units, built from the floor up -------------------------
  const legModel = thigh + shank + ankle;
  // The crown. headBreadth can be missing if both ears never came through cleanly on a
  // facing shot; fall back to a share of the neck-to-ear span, which is the same
  // quantity approached from the other side and is better than abandoning the scan.
  const crown = headBreadth != null ? headBreadth * HEAD_ABOVE_EAR : neckHead * 0.55;
  const statureModel = legModel + torso + neckHead + crown;
  if(!(statureModel > 0)) throw new Error('incomplete');

  // ---- the one scaling step ----------------------------------------------------
  // Everything above is in MediaPipe's inferred metres. Everything below is in inches,
  // anchored to a height a human being measured.
  const k = H / statureModel;

  const legIn   = legModel * k;
  const torsoIn = torso * k;
  const armIn   = (upper != null && fore != null) ? (upper + fore) * k : null;
  const handIn  = H * HAND_OF_STATURE;
  const shoulderHeightIn = legIn + torsoIn;

  const m = {};
  m.leg_length   = legIn;
  m.torso_length = torsoIn;
  if(biacromial != null) m.shoulder_width = biacromial * k;
  if(hipBreadth != null) m.hip_width = hipBreadth * k;
  if(headBreadth != null) m.ear_width = headBreadth * k;
  if(armIn != null && m.shoulder_width != null)
    // Wingspan decomposed rather than measured: the capture poses have the arms DOWN,
    // by design. This decomposition uses estimated hand length and is not a directly
    // measured fingertip span. Its accuracy has not been established.
    m.wingspan = m.shoulder_width + 2 * armIn + 2 * handIn;
  if(armIn != null)
    m.standing_reach = shoulderHeightIn + armIn + handIn;

  // ---- say what never got computed, and why -------------------------------------
  // Distinct from `rejected` below: rejected covers a number that WAS computed and then
  // thrown out for being implausible. This covers a number that was never computed at
  // all because a prerequisite landmark never came through clearly in any frame.
  // Report the missing output and observed reason without guessing why it failed.
  const skipped = [];
  if(biacromial == null)
    skipped.push({ key:'shoulder_width', reason:"shoulders weren't clearly visible in the front or back photo" });
  if(hipBreadth == null)
    skipped.push({ key:'hip_width', reason:"hips weren't clearly visible in the front or back photo" });
  if(headBreadth == null)
    skipped.push({ key:'ear_width', reason:"ear landmarks weren't clearly visible in the front or back photo" });
  if(armIn == null){
    skipped.push({ key:'standing_reach', reason:"an arm wasn't clearly visible in any photo" });
    skipped.push({ key:'wingspan', reason:"an arm wasn't clearly visible in any photo" });
  } else if(biacromial == null){
    skipped.push({ key:'wingspan', reason:"shoulders weren't clearly visible, which wingspan also needs" });
  }

  // ---- reject rather than round ------------------------------------------------
  const rejected = [];
  for(const [key, val] of Object.entries({ ...m })){
    const env = ENVELOPE[key];
    if(!env) continue;
    const share = val / H;
    if(share < env[0] || share > env[1]){ delete m[key]; rejected.push(key); }
  }
  if(!Object.keys(m).length) throw new Error('implausible');

  // ---- confidence ---------------------------------------------------------------
  // Three things degrade it, and they are independent: frames that produced no pose at
  // all, frames that disagreed with each other, and landmarks the model itself flagged
  // as guesses.
  const coverage = seen.length / 4;
  const disagreement = Math.max(
    spread(perFrame.thigh || []), spread(perFrame.shank || []), spread(perFrame.torso || []));
  const visibility = (() => {
    const all = Object.values(perFrame).flat();
    return all.length ? all.reduce((a, s) => a + s.w, 0) / all.length : 0;
  })();
  let confidence = coverage * Math.min(1, visibility) * Math.max(0, 1 - disagreement * 4);
  if(rejected.length) confidence *= 0.75;
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  // Rounded to a tenth of an inch. Two decimals on a photogrammetric estimate is a
  // precision claim the method cannot support.
  const metrics = {};
  for(const [key, val] of Object.entries(m)) metrics[key] = Math.round(val * 10) / 10;
  // Front-only side estimates avoid blending identities across side/back views.
  // Landmarks remain local to this function and are never part of the returned record.
  const sides=estimateFrontSegments(frontPose?.world,frontPose?.norm,H,statureModel);
  Object.assign(metrics,sides.metrics);
  skipped.push(...sides.skipped);

  return {
    metrics,
    confidence,
    heightIn: H,
    // Everything the result screen needs to explain itself, and everything a future
    // debugging session needs to understand a number someone disputes.
    detail: {
      framesUsed: seen, framesMissed: missed, rejected, skipped, captureChecks,photoIdentity,
      outputDictionary:BODY_OUTPUT_VERSION,sideMethod:'front-joint-proxy-v2',
      disagreement: Math.round(disagreement * 1000) / 1000,
      crownFrom: headBreadth != null ? 'head_breadth' : 'neck_fallback',
    },
    // Descriptive proportions. These still carry landmark and scaling uncertainty.
    ratios: {
      ape:      metrics.wingspan != null ? metrics.wingspan / H : null,
      legShare: legIn / H,
      shoShare: metrics.shoulder_width != null ? metrics.shoulder_width / H : null,
    },
  };
}

// ---------------------------------------------------------------------------
//  REGISTERED AS A PROVIDER
// ---------------------------------------------------------------------------
// Deliberately goes through the same registerBodyProvider() seam a paid vendor would
// use, rather than being wired into body-scan.js directly. Two reasons: the flow around
// it stays provider-agnostic, so a girth vendor can be added later without touching the
// capture; and this engine has to satisfy the same contract as anything commercial —
// including the rule that it throws rather than inventing a result.
if(typeof registerBodyProvider === 'function'){
  registerBodyProvider({
    id: 'ondevice-pose',
    version: '1.3.0',
    model: 'mediapipe-pose-full-float16-v1/tasks-vision-' + MP_VERSION,
    defaultUnit: 'in',
    label: 'On-device measurement',
    notice: 'Runs entirely on this phone. The photos are never uploaded — only the '
          + 'measuring model is downloaded, the first time you scan.',
    // What this engine can and cannot produce, so the consent screen can be specific
    // instead of promising a body scan and delivering five lengths.
    produces: ['Wingspan', 'Standing reach', 'shoulder, hip and ear-landmark widths', 'Torso length', 'Leg length', 'Left and right upper arm, forearm, thigh, lower leg, arm path, leg path, shoulder-to-hip, ankle-to-heel and foot-landmark estimates'],
    // Leg and torso length only need the hip-to-ankle and hip-to-shoulder chain, which
    // can be visible in any of the four poses. The other
    // three additionally need a clearly visible arm or both shoulders. All outputs
    // depend on passing capture and plausibility checks.
    guaranteed: [], // no output is guaranteed: landmarks and plausibility checks can reject a scan
    excludes: 'No chest, waist or hip measurement, and nothing about body composition.',
    reviewFrame: reviewPosePhoto,
    async measure({ frames, heightIn, onProgress }){
      return measureFromFrames({ frames, heightIn, onProgress });
    },
  });
}
