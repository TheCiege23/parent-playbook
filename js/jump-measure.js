// ===================================================================
//  JUMP MEASURE — vertical jump height and landing symmetry, from video
// ===================================================================
// Same engine as the body scan (js/pose-measure.js), same on-device promise, same
// "geometry the model can see, nothing invented" discipline — applied to motion instead
// of a still pose. This file reuses that file's landmark map (P), vector helpers (dist,
// mid) and MediaPipe asset constants (MP_BUNDLE, MP_WASM, MP_MODEL) directly rather than
// redeclaring them; load order between the two files does not matter because neither
// reads those values until a function in it actually runs, long after both have parsed.
//
// ---------------------------------------------------------------------------
//  WHY THIS ONE NEEDS NO REFERENCE HEIGHT
// ---------------------------------------------------------------------------
// The body scan turns proportions into inches by scaling against a height someone
// measured with a tape — without that, it has geometry but no scale. Jump height is
// different: it comes from FLIGHT TIME, not distance. Two detected instants — the frame
// the feet leave the ground, the frame they return to it — and a formula from ordinary
// projectile motion:
//
//     height = g * t_flight^2 / 8
//
// No scale factor, no crown estimate, no anthropometric ratio standing in for something
// unmeasured. The one number this needs is a clock, and MediaPipe's video timestamps are
// exactly that. This is why the scan asks for a height on file first and this does not.
//
// ---------------------------------------------------------------------------
//  WHAT THIS DOES NOT DO
// ---------------------------------------------------------------------------
// No "biomechanics score," no injury-risk verdict, no numeric grade for how a landing
// looked. What it returns is two knee angles at the moment of landing and how far apart
// they are — a single descriptive data point, not a diagnosis. A parent reading "12°
// apart" gets a fact; a parent reading "asymmetry: 61/100" gets a number that sounds
// like medicine and is not.

// Sampling the whole video at full frame rate would mean running full-model pose
// detection 100+ times per capture — real GPU work on a phone, for precision the
// physics does not need. A jump's flight phase is a few hundred milliseconds; sampling
// every 50ms (20 "frames" per second of video, regardless of the source frame rate)
// resolves takeoff and landing to within that same window, which is well inside the
// "close, and comparable to last time" standard this whole engine already holds itself
// to. Capped at 8 seconds of video so a long, confused recording can't turn into minutes
// of processing.
const JUMP_SAMPLE_MS = 50;
const JUMP_MAX_SECONDS = 8;

// How far the ankle midpoint has to rise above its standing baseline, in MediaPipe's own
// world units (metres-ish), before a frame counts as "airborne." Deliberately not tiny:
// tracking noise on a standing person is real, and the failure this guards against is a
// phantom jump detected from a person shifting their weight, not a missed real one.
const JUMP_LIFT_M = 0.05;
// Flight-time sanity bounds. Below this is noise; above it is not a jump this method
// should trust — a growing child's vertical jump does not take more than a second, and a
// value in that territory almost always means the ankles were lost and reacquired rather
// than that the child left the ground for that long.
const JUMP_MIN_FLIGHT_S = 0.12;
const JUMP_MAX_FLIGHT_S = 1.0;
const M_TO_IN = 39.3701;
const G = 9.81;

let VIDEO_MP_CACHE = null;
// A SEPARATE landmarker instance from the still-photo one in pose-measure.js.
// MediaPipe's PoseLandmarker is created for one running mode — IMAGE or VIDEO — and a
// detector built for stills cannot be reused for video timestamps or vice versa. The
// model and WASM bytes are the same files, so the browser's own HTTP cache serves this
// without a second download if the body scan already ran; only the small JS wrapper
// object is duplicated.
async function loadVideoPoseLandmarker(onProgress){
  if(VIDEO_MP_CACHE) return VIDEO_MP_CACHE;
  if(onProgress) onProgress('Loading the movement model…');
  const vision = await import(MP_BUNDLE);
  const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
  VIDEO_MP_CACHE = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  return VIDEO_MP_CACHE;
}

function median(nums){
  const s = [...nums].sort((a,b)=>a-b);
  const mid2 = Math.floor(s.length/2);
  return s.length % 2 ? s[mid2] : (s[mid2-1] + s[mid2]) / 2;
}

// Angle at the knee, in degrees, from three world-landmark points. 180° is a straight
// leg; a bent landing knee reads well under that. Pure vector geometry — the same kind
// of arithmetic the body scan already leans on, no model of "what a good landing looks
// like" involved.
function jointAngleDeg(a, b, c){
  const v1 = { x:a.x-b.x, y:a.y-b.y, z:a.z-b.z };
  const v2 = { x:c.x-b.x, y:c.y-b.y, z:c.z-b.z };
  const m1 = Math.hypot(v1.x, v1.y, v1.z), m2 = Math.hypot(v2.x, v2.y, v2.z);
  if(!(m1 > 0) || !(m2 > 0)) return null;
  const cos = (v1.x*v2.x + v1.y*v2.y + v1.z*v2.z) / (m1 * m2);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

// ---------------------------------------------------------------------------
//  FRAME EXTRACTION — a video Blob, sampled on a clock, into pose landmarks
// ---------------------------------------------------------------------------
// `video.currentTime = t` followed by waiting for the `seeked` event is the standard,
// reliable way to pull a specific instant out of a video file in a browser — no
// server, no transcoding, the same file the camera produced.
// `opts` lets a caller sample at a different rate/cap than the jump default without
// forking this function — speed-measure.js needs both, for reasons specific to what
// it's timing (see the "why these need finer sampling than a jump" note there). Every
// existing caller passes nothing and gets the exact behaviour this always had.
async function extractJumpFrames(videoBlob, onProgress, opts){
  const sampleMs = (opts && opts.sampleMs) || JUMP_SAMPLE_MS;
  const maxSeconds = (opts && opts.maxSeconds) || JUMP_MAX_SECONDS;
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.src = url;
  try{
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('video_unreadable'));
    });
    const sourceDurationS = video.duration || 0;
    const duration = Math.min(sourceDurationS, maxSeconds);
    if(!(duration > 0.3)) throw new Error('video_unreadable');

    const landmarker = await loadVideoPoseLandmarker(onProgress);
    const frames = [];
    const stepS = sampleMs / 1000;
    for(let t = 0; t <= duration; t += stepS){
      await new Promise(res => {
        video.onseeked = res;
        video.currentTime = Math.min(t, duration);
      });
      const ts = Math.round(t * 1000);
      let res;
      try{ res = landmarker.detectForVideo(video, ts); }
      catch(e){ console.warn('frame detect failed at ' + t.toFixed(2) + 's', e); continue; }
      const world = res && res.worldLandmarks && res.worldLandmarks[0];
      const norm  = res && res.landmarks && res.landmarks[0];
      if(world && norm) frames.push({ t, world, norm });
      if(onProgress) onProgress(`Reading the video — ${Math.round((t/duration)*100)}%`);
    }
    // Not part of the frame data — metadata about how much of the clip was examined, so a
    // missing crossing can be reported as "we stopped reading before it happened" rather
    // than as "it never happened".
    frames.sourceDurationS = sourceDurationS;
    frames.readDurationS = duration;
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
//  JUMP DETECTION — ankle height over time, split into flight cycles
// ---------------------------------------------------------------------------
function findJumps(frames){
  const vis = (norm, i) => {
    const n = norm[i];
    const v = n ? (n.visibility != null ? n.visibility : (n.presence != null ? n.presence : 0)) : 0;
    return typeof v === 'number' ? v : 0;
  };
  const series = frames
    .filter(f => vis(f.norm, P.ANK_L) >= 0.4 && vis(f.norm, P.ANK_R) >= 0.4)
    .map(f => ({ t: f.t, y: (f.world[P.ANK_L].y + f.world[P.ANK_R].y) / 2, frame: f }));

  if(series.length < 6) throw new Error('no_pose');

  const baseline = median(series.slice(0, Math.min(6, series.length)).map(s => s.y));

  const jumps = [];
  let inFlight = false, takeoff = null;
  for(let i = 0; i < series.length; i++){
    const lifted = (series[i].y - baseline) > JUMP_LIFT_M;
    if(!inFlight && lifted){
      inFlight = true; takeoff = series[i];
    } else if(inFlight && !lifted){
      const landing = series[i];
      const flight = landing.t - takeoff.t;
      if(flight >= JUMP_MIN_FLIGHT_S && flight <= JUMP_MAX_FLIGHT_S){
        jumps.push({ takeoff, landing, flightS: flight, heightIn: (G * flight * flight / 8) * M_TO_IN });
      }
      inFlight = false; takeoff = null;
    }
  }
  if(!jumps.length) throw new Error('no_jump');
  return jumps;
}

// Left/right knee angle at the landing instant of the best jump. Omitted, not guessed,
// if either knee's landmarks weren't clearly tracked at that exact frame — a symmetry
// read built from a low-confidence landmark is worse than no read.
function landingSymmetry(landingFrame){
  const w = landingFrame.frame.world, n = landingFrame.frame.norm;
  const vis = i => {
    const v = n[i] ? (n[i].visibility != null ? n[i].visibility : (n[i].presence != null ? n[i].presence : 0)) : 0;
    return typeof v === 'number' ? v : 0;
  };
  const okL = vis(P.HIP_L) >= 0.5 && vis(P.KNEE_L) >= 0.5 && vis(P.ANK_L) >= 0.5;
  const okR = vis(P.HIP_R) >= 0.5 && vis(P.KNEE_R) >= 0.5 && vis(P.ANK_R) >= 0.5;
  if(!okL || !okR) return null;
  const left = jointAngleDeg(w[P.HIP_L], w[P.KNEE_L], w[P.ANK_L]);
  const right = jointAngleDeg(w[P.HIP_R], w[P.KNEE_R], w[P.ANK_R]);
  if(left == null || right == null) return null;
  return { leftDeg: Math.round(left), rightDeg: Math.round(right), diffDeg: Math.round(Math.abs(left - right)) };
}

// ---------------------------------------------------------------------------
//  THE MEASUREMENT
// ---------------------------------------------------------------------------
// videoBlob: a single recording containing (ideally) three jumps back to back.
async function measureJumpFromVideo({ videoBlob, onProgress }){
  const frames = await extractJumpFrames(videoBlob, onProgress);
  if(frames.length < 6) throw new Error('no_pose');

  if(onProgress) onProgress('Finding the jumps…');
  const jumps = findJumps(frames);

  // Reject implausible heights the same way the body scan rejects implausible lengths —
  // a flight time inside the sanity bounds can still imply a jump no child actually
  // makes, most often two people crossing in frame or the phone itself moving.
  const plausible = jumps.filter(j => j.heightIn > 1 && j.heightIn < 40);
  if(!plausible.length) throw new Error('implausible');

  const best = plausible.reduce((a, b) => (b.heightIn > a.heightIn ? b : a));
  const symmetry = landingSymmetry(best.landing);

  return {
    bestHeightIn: Math.round(best.heightIn * 10) / 10,
    jumps: plausible.map(j => Math.round(j.heightIn * 10) / 10).sort((a,b) => b - a),
    symmetry,
    detail: {
      jumpsDetected: jumps.length,
      jumpsUsed: plausible.length,
      framesRead: frames.length,
    },
  };
}
