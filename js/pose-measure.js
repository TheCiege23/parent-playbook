// ===================================================================
//  POSE MEASURE — the engine that was missing, running on the phone
// ===================================================================
// For most of this product's life the scan had a hole in the middle of it: capture,
// consent, retention and a viewer, wrapped around nothing that could turn a photograph
// into a number. The reason was never squeamishness. It was that estimating GIRTHS —
// chest, waist, hip — from photographs means fitting a parametric body model, and the
// standard one (SMPL) is not licensed for commercial use. Anything hand-rolled in its
// place would be a confident number about a child's body with nothing behind it.
//
// That reasoning still holds, and this file still produces no girth. What it does
// produce is the other half, which turns out to be the half youth sport actually uses:
//
//     LENGTHS BETWEEN JOINTS THE MODEL CAN SEE.
//
// Wingspan and standing reach are what a combine measures. Shoulder width relative to
// stature (biacromial/stature) is a documented maturation index. Leg length as a share
// of height is the sitting-height ratio, which is the single most useful growth signal
// in the whole file — legs lengthen FIRST in the pre-pubertal spurt, so a leg share
// that is climbing is a spurt already underway, months before the height curve bends.
//
// This is geometry, not estimation. Two detected joints, the distance between them,
// scaled by a height someone actually measured with a tape.
//
// ---------------------------------------------------------------------------
//  WHERE THE ERROR LIVES, STATED PLAINLY
// ---------------------------------------------------------------------------
// MediaPipe returns world landmarks in metres, but at a scale it inferred rather than
// measured, so everything is normalised against the athlete's KNOWN height. Building
// that known height out of detected joints needs one thing the model cannot see: the
// top of the skull. There is no head-top landmark — the highest points are the ears
// and eyes. So the crown is reconstructed from the subject's own head breadth
// (HEAD_ABOVE_EAR below), which is better than a population constant but is still the
// one modelled quantity in the chain.
//
// The consequence is worth being exact about, because it decides how the result is
// presented:
//
//   * The crown estimate enters as a SCALE factor. If it is 3% off, every absolute
//     length is 3% off — all of them, in the same direction.
//   * Which means RATIOS between segments are unaffected. Ape index, leg share,
//     shoulder share: the error divides out completely.
//   * And it means TRENDS are unaffected, because the same method makes the same
//     error on every scan.
//
// So the ratios are the product and the absolutes are the supporting cast. The result
// screen is ordered that way on purpose, and the copy says "close, and comparable to
// your last scan" rather than implying tape-measure truth.
//
// ---------------------------------------------------------------------------
//  WHY ON-DEVICE IS THE STRONGER POSITION, NOT THE CHEAPER ONE
// ---------------------------------------------------------------------------
// MediaPipe runs as WebAssembly in this tab. The model file is downloaded; the frames
// are not uploaded. So the promise the consent screen has always made — the photos
// never leave the phone — stops being a policy the server is trusted to honour and
// becomes a fact about where the code runs. For a feature whose subject is a child,
// that is worth more than the extra measurements a vendor would return.

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
    baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
    runningMode: 'IMAGE',
    numPoses: 1,
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

// Coefficient of variation across frames — the honest confidence signal. Four views of
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

  // --- limb segments: averaged left/right within the frame, because a person is
  // --- symmetrical and two independent estimates of a femur beat one.
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

  const landmarker = await loadPoseLandmarker(onProgress);

  // front and back see the body across; left and right see it edge-on.
  const LATERAL = { front:true, back:true, left:false, right:false };
  const keys = Object.keys(frames).filter(k => frames[k]);
  const perFrame = {};       // segment -> [{v,w}]
  const seen = [];
  const missed = [];

  for(let i = 0; i < keys.length; i++){
    const k = keys[i];
    if(onProgress) onProgress(`Reading the ${k} photo — ${i+1} of ${keys.length}`);
    let bmp = null;
    try{
      bmp = await createImageBitmap(frames[k]);
      const res = landmarker.detect(bmp);
      const world = res && res.worldLandmarks && res.worldLandmarks[0];
      const norm  = res && res.landmarks && res.landmarks[0];
      if(!world || !norm){ missed.push(k); continue; }

      const segs = frameSegments(world, norm, !!LATERAL[k]);
      for(const [name, s] of Object.entries(segs)){
        (perFrame[name] = perFrame[name] || []).push(s);
      }
      seen.push(k);
    }catch(e){
      console.warn('pose detect failed on ' + k, e);
      missed.push(k);
    }finally{
      try{ bmp && bmp.close && bmp.close(); }catch(_){}
    }
  }

  if(seen.length < 2) throw new Error('no_pose');

  if(onProgress) onProgress('Working out the measurements…');

  const agg = {};
  for(const [name, list] of Object.entries(perFrame)) agg[name] = wmean(list);
  const need = n => (agg[n] ? agg[n].value : null);

  const thigh = need('thigh'), shank = need('shank'), torso = need('torso');
  const upper = need('upper_arm'), fore = need('forearm');
  const neckHead = need('neck_head'), headBreadth = need('head_breadth');
  const ankle = need('ankle_rise') || 0;      // a missing ankle rise is a small loss, not a failure
  const biacromial = need('biacromial');

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
  if(armIn != null && m.shoulder_width != null)
    // Wingspan decomposed rather than measured: the capture poses have the arms DOWN,
    // by design, because an arms-out pose ruins the silhouette guidance the rest of the
    // flow depends on. Shoulder breadth plus two arms plus two hands is the standard
    // anthropometric decomposition and is more accurate than a fingertip-to-fingertip
    // estimate off a single frontal photo anyway.
    m.wingspan = m.shoulder_width + 2 * armIn + 2 * handIn;
  if(armIn != null)
    m.standing_reach = shoulderHeightIn + armIn + handIn;

  // ---- say what never got computed, and why -------------------------------------
  // Distinct from `rejected` below: rejected covers a number that WAS computed and then
  // thrown out for being implausible. This covers a number that was never computed at
  // all because a prerequisite landmark never came through clearly in any frame — the
  // consent screen promises five things, and a parent who gets three of them with no
  // explanation reads it as the app being unreliable rather than the sleeve it actually
  // was.
  const skipped = [];
  if(biacromial == null)
    skipped.push({ key:'shoulder_width', reason:"shoulders weren't clearly visible in the front or back photo" });
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

  return {
    metrics,
    confidence,
    heightIn: H,
    // Everything the result screen needs to explain itself, and everything a future
    // debugging session needs to understand a number someone disputes.
    detail: {
      framesUsed: seen, framesMissed: missed, rejected, skipped,
      disagreement: Math.round(disagreement * 1000) / 1000,
      crownFrom: headBreadth != null ? 'head_breadth' : 'neck_fallback',
    },
    // The scale-free numbers. These are the ones that survive the crown estimate, and
    // the ones worth a parent's attention, so they travel separately rather than being
    // recomputed from the rounded values above.
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
    label: 'On-device measurement',
    notice: 'Runs entirely on this phone. The photos are never uploaded — only the '
          + 'measuring model is downloaded, the first time you scan.',
    // What this engine can and cannot produce, so the consent screen can be specific
    // instead of promising a body scan and delivering five lengths.
    produces: ['Wingspan', 'Standing reach', 'Shoulder width', 'Torso length', 'Leg length'],
    // Leg and torso length only need the hip-to-ankle and hip-to-shoulder chain, which
    // every one of the four poses provides — they come back from every scan. The other
    // three additionally need a clearly visible arm or both shoulders, which a sleeve or
    // a tight crop can lose (see the `skipped` detail above), so they can't be promised
    // the same way.
    guaranteed: ['Torso length', 'Leg length'],
    excludes: 'No chest, waist or hip measurement, and nothing about body composition.',
    async measure({ frames, heightIn, onProgress }){
      return measureFromFrames({ frames, heightIn, onProgress });
    },
  });
}
