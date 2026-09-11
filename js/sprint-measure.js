// ===================================================================
//  SPRINT MEASURE — calibrated speed from video, Phase 2 of the sprint work
// ===================================================================
// The stopwatch (sprint-scan.js) times a sprint from two human button-taps — honest,
// simple, no camera needed. This is the harder, more capable sibling BODY-SCAN-
// EXPANSION-PLAN.md's Part 4 scoped as "Phase 2": a real speed number, computed from
// video, needing a calibrated distance the same way body-scan needs a measured height.
//
// ---------------------------------------------------------------------------
//  WHY THIS NEEDS A CALIBRATION STEP JUMP/REACTION/FOOTWORK DON'T
// ---------------------------------------------------------------------------
// Jump height comes from flight TIME alone — gravity does the scaling, no distance
// needed. A sprint is the opposite: the number this produces is distance ÷ time, and
// there is no physics trick that recovers distance from time the way flight time
// recovers height. The distance has to come from somewhere real — a parent measuring a
// straight course with a tape, the same act as measuring height for the body scan — and
// the two ends of that course have to be located in the VIDEO FRAME so a crossing time
// can be measured against them. That location step is the calibration tap.
//
// ---------------------------------------------------------------------------
//  WHY CALIBRATION HAPPENS ON THE RECORDED VIDEO, NOT A LIVE PREVIEW
// ---------------------------------------------------------------------------
// Capture here uses the same native-camera handoff every other scan in this app uses —
// the OS owns the camera screen, and this code never touches getUserMedia directly.
// That means there is no live preview to draw calibration marks on. Instead, the parent
// taps the start and finish line's position on the ALREADY-RECORDED clip, played back
// in an ordinary <video> element — a completely different, much simpler problem (a tap
// on a paused frame) than overlaying UI on a live camera feed would have been.

const SPRINT_SAMPLE_MS = 33;      // fine enough to resolve a fast youth sprint's crossing instants
// How much of the clip is examined. This has to cover the whole run PLUS whatever lead-in
// the parent recorded before it started — they press record, the child gets set, then goes.
// At 8s it did not: a 40-yard dash takes a young child 8-9 seconds on its own, so the finish
// crossing fell outside the window and came back as "no crossing detected", which told the
// parent to re-check their marks. They could re-mark forever and never succeed. It also
// contradicted SPRINT_MEAS_MAX_S below, which accepts an elapsed time this could never see.
// Only a long clip pays the extra frames; a short one still stops at its own duration.
const SPRINT_MAX_SECONDS = 20;
const SPRINT_MEAS_MIN_S = 0.8;    // same sanity floor as the stopwatch — faster isn't a real sprint
const SPRINT_MEAS_MAX_S = 15;
const YD_TO_MI = 1 / 1760;

// ---------------------------------------------------------------------------
//  CALIBRATION TAP -> NORMALIZED VIDEO COORDINATES
// ---------------------------------------------------------------------------
// The calibration <video> element is always styled object-fit:contain, so the full
// frame is visible with letterbox bars rather than cropped — cropping (object-fit:
// cover) would silently break this mapping, since a tap's position relative to the
// element wouldn't match its position relative to the actual video content anymore.
// This function is pure and independent of any DOM/video state beyond the four numbers
// it takes, so it can be verified with synthetic dimensions before ever touching a real
// recording.
function tapToNormalized(clientX, clientY, rect, videoWidth, videoHeight){
  const boxW = rect.width, boxH = rect.height;
  const videoAspect = videoWidth / videoHeight, boxAspect = boxW / boxH;
  let dispW, dispH, offX, offY;
  if(videoAspect > boxAspect){
    dispW = boxW; dispH = boxW / videoAspect; offX = 0; offY = (boxH - dispH) / 2;
  } else {
    dispH = boxH; dispW = boxH * videoAspect; offY = 0; offX = (boxW - dispW) / 2;
  }
  const nx = (clientX - rect.left - offX) / dispW;
  const ny = (clientY - rect.top - offY) / dispH;
  return { x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) };
}

// ---------------------------------------------------------------------------
//  CROSSING-TIME DETECTION
// ---------------------------------------------------------------------------
// series: [{t, x}] — the tracked point's normalized horizontal position over time.
// Finds the interpolated instant the series crosses targetX, in whichever direction it
// happens to be moving. Generic on purpose: used once for the start line, once for the
// finish line, with no assumption baked in about which side of the frame is which.
function crossingTime(series, targetX){
  for(let i = 1; i < series.length; i++){
    const a = series[i-1], b = series[i];
    const crossedUp = a.x <= targetX && b.x >= targetX;
    const crossedDown = a.x >= targetX && b.x <= targetX;
    if(crossedUp || crossedDown){
      const frac = (b.x === a.x) ? 0 : (targetX - a.x) / (b.x - a.x);
      return a.t + frac * (b.t - a.t);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
//  THE MEASUREMENT
// ---------------------------------------------------------------------------
// startPoint/finishPoint: {x,y} normalized taps from the calibration step. Only .x is
// used for crossing detection — a stationary, side-on camera is the setup this asks
// for, so the athlete's path is expected to be a straight horizontal line across frame.
async function measureSprintFromVideo({ videoBlob, startPoint, finishPoint, distanceYards, onProgress }){
  const frames = await extractJumpFrames(videoBlob, onProgress,
    { sampleMs: SPRINT_SAMPLE_MS, maxSeconds: SPRINT_MAX_SECONDS });
  if(frames.length < 6) throw new Error('no_pose');

  if(onProgress) onProgress('Finding the crossings…');
  const vis = (norm, i) => {
    const n = norm[i];
    const v = n ? (n.visibility != null ? n.visibility : (n.presence != null ? n.presence : 0)) : 0;
    return typeof v === 'number' ? v : 0;
  };
  const series = frames
    .filter(f => vis(f.norm, P.HIP_L) >= 0.4 && vis(f.norm, P.HIP_R) >= 0.4)
    .map(f => ({ t: f.t, x: (f.norm[P.HIP_L].x + f.norm[P.HIP_R].x) / 2 }));
  if(series.length < 6) throw new Error('no_pose');

  const tStart = crossingTime(series, startPoint.x);
  const tFinish = crossingTime(series, finishPoint.x);
  if(tStart == null || tFinish == null){
    // Distinguish the two causes. If the clip ran past the window we read, the marks may be
    // perfect and the run simply happened after we stopped looking — telling the parent to
    // re-check their marks would send them round in circles.
    const truncated = frames.sourceDurationS > frames.readDurationS + 0.05;
    throw new Error(truncated ? 'clip_too_long' : 'no_crossing_detected');
  }
  // The athlete has to actually cross the start line before the finish line in time —
  // not just have both x-positions appear somewhere in the clip. A finish-before-start
  // reading means the marks were likely swapped, or the run happened backwards, and
  // either way the number that would come out is not a sprint time.
  if(tFinish <= tStart) throw new Error('crossed_out_of_order');

  const elapsedS = tFinish - tStart;
  if(!(elapsedS >= SPRINT_MEAS_MIN_S && elapsedS <= SPRINT_MEAS_MAX_S)) throw new Error('implausible');

  const speedYdPerSec = distanceYards / elapsedS;
  const speedMph = speedYdPerSec * 3600 * YD_TO_MI;

  return {
    elapsedS: Math.round(elapsedS * 100) / 100,
    speedMph: Math.round(speedMph * 10) / 10,
    detail: { framesRead: frames.length, tStart: Math.round(tStart*1000)/1000, tFinish: Math.round(tFinish*1000)/1000 },
  };
}
