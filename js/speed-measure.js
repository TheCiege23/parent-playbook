// ===================================================================
//  SPEED MEASURE — reaction time and footwork cadence, from video
// ===================================================================
// Same engine, same on-device promise, same "geometry the model can see, nothing
// invented" discipline as pose-measure.js and jump-measure.js. Reuses this file's
// neighbours directly rather than redeclaring anything: `median`, `P`, `dist`, `mid`,
// and `extractJumpFrames` come from jump-measure.js/pose-measure.js, already loaded
// into the same global scope. Load order does not matter — nothing here reads those
// values until a function runs, long after both have parsed.
//
// ---------------------------------------------------------------------------
//  WHY THESE ARE TWO DIFFERENT PROBLEMS, NOT ONE "SPEED" FEATURE
// ---------------------------------------------------------------------------
// Vertical jump needed no reference distance because flight time alone gives height —
// gravity does the scaling. These two are different again from each other:
//
//   FOOTWORK CADENCE needs no distance either. It's a RATE — foot-contacts per
//   second — and a rate is time-only, the same way jump height is. Count the cycles,
//   divide by the seconds they happened in.
//
//   REACTION TIME needs no distance, but it needs something jump didn't: a STIMULUS.
//   "Time to first move" means nothing without a fixed instant to measure from — a
//   child who moves whenever they feel like it isn't being timed, they're being
//   watched. That instant has to come from something in the recording itself, not
//   from a countdown said out loud and hoped to line up. The video's own AUDIO TRACK
//   supplies it: a single sharp clap or "go" is a large, sudden amplitude spike
//   against a quiet background — ordinary signal processing on samples already in the
//   file, not a new model.
//
// What is explicitly NOT attempted here: real sprint SPEED (distance over time).
// Unlike a jump, a body translating across the ground has no formula that recovers
// distance from time alone — that needs a measured course and a stationary,
// calibrated camera, which is a separate, larger feature. See
// BODY-SCAN-EXPANSION-PLAN.md, Part 4, "Phase 2."
//
// ---------------------------------------------------------------------------
//  WHY THE SAMPLING RATE IS FINER HERE THAN FOR A JUMP
// ---------------------------------------------------------------------------
// Jump height only cares about two instants — takeoff and landing — separated by a
// few hundred milliseconds, and the 50ms sampling jump-measure.js already uses
// resolves that comfortably. These two need more:
//   * A fast footwork cycle can be under 200ms, and counting it correctly needs at
//     least a few samples inside that window, not one.
//   * A reaction time IS a duration on the order of 150-400ms — sampling at 50ms
//     would make the measurement itself mostly quantisation error.
// So both request a finer `sampleMs` from extractJumpFrames() than the jump default,
// and reaction time additionally caps the recording much shorter (a few seconds is
// the whole test) to keep the extra per-frame detection cost from growing with it.

const REACT_SAMPLE_MS = 20;      // 50 samples/sec — keeps reaction-time quantisation small
const REACT_MAX_SECONDS = 4;     // the whole test: a still beat, the cue, one move
const REACT_MOVE_M = 0.04;       // hip-midpoint displacement that counts as "moved"
const REACT_STILL_M = 0.03;      // pre-cue wobble below this still counts as "still"
const REACT_MIN_S = 0.08;        // faster than this is not a tracked reaction, it's noise
const REACT_MAX_S = 1.2;         // slower than this and something was missed, not measured

const CADENCE_SAMPLE_MS = 33;    // ~30 samples/sec — resolves a sub-200ms footwork cycle
const CADENCE_MAX_SECONDS = 6;
const FOOT_LIFT_M = 0.025;       // smaller than a jump's liftoff — footwork lifts are subtler
const FOOT_MIN_CYCLE_S = 0.12;
const FOOT_MAX_CYCLE_S = 1.2;
const CADENCE_MIN_STEPS = 6;     // fewer than this isn't enough to trust a rate
const CADENCE_MIN_HZ = 1.0;      // combined both feet, steps per second
const CADENCE_MAX_HZ = 8.0;

// ---------------------------------------------------------------------------
//  AUDIO — finding the cue
// ---------------------------------------------------------------------------
// Decodes the recording's own audio track into PCM samples. This is standard Web
// Audio, not a model: the same decodeAudioData() call any waveform-drawing site uses.
// A video recorded muted, or on a browser that can't pull audio out of this specific
// container, throws here — a real and named failure mode, not silently skipped.
async function decodeAudioSamples(videoBlob){
  const buf = await videoBlob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) throw new Error('no_audio');
  const ctx = new Ctx();
  try{
    const audioBuf = await ctx.decodeAudioData(buf.slice(0));
    return { data: audioBuf.getChannelData(0), rate: audioBuf.sampleRate };
  }catch(e){
    throw new Error('no_audio');
  }finally{
    try{ ctx.close(); }catch(_){}
  }
}

// RMS (root-mean-square) amplitude in fixed-width windows — the standard, simple way
// to turn raw waveform samples into a loudness-over-time envelope. A window, not a
// single sample, because one loud sample is as likely to be a click of noise as it is
// the clap; a whole 10ms window being loud is much harder to fake.
function rmsEnvelope(samples, rate, hopS){
  const hop = Math.max(1, Math.round(rate * hopS));
  const out = [];
  for(let i = 0; i < samples.length; i += hop){
    const end = Math.min(i + hop, samples.length);
    let sum = 0;
    for(let j = i; j < end; j++) sum += samples[j] * samples[j];
    out.push({ t: i / rate, rms: Math.sqrt(sum / Math.max(1, end - i)) });
  }
  return out;
}

// The cue is the first loud window that clearly beats the room's own quiet — not the
// loudest moment in the whole clip, which could just as easily be the athlete landing
// a step. "Clearly beats" is BOTH a multiple of the measured quiet floor AND an
// absolute floor, because a perfectly silent recording would otherwise make the
// multiplier trivially easy to satisfy with nothing more than encoder noise.
const CUE_QUIET_WINDOW_S = 0.3;
const CUE_RMS_HOP_S = 0.01;
const CUE_SPIKE_MULT = 6;
const CUE_MIN_ABS_RMS = 0.02;
function findCue(envelope){
  const quiet = envelope.filter(e => e.t < CUE_QUIET_WINDOW_S);
  if(quiet.length < 3) throw new Error('no_audio');
  const quietRms = median(quiet.map(e => e.rms));
  const gate = Math.max(quietRms * CUE_SPIKE_MULT, CUE_MIN_ABS_RMS);
  const hit = envelope.find(e => e.t >= CUE_QUIET_WINDOW_S && e.rms >= gate);
  if(!hit) throw new Error('no_cue');
  return hit.t;
}

// ---------------------------------------------------------------------------
//  REACTION TIME
// ---------------------------------------------------------------------------
async function measureReactionTimeFromVideo({ videoBlob, onProgress }){
  if(onProgress) onProgress('Listening for the cue…');
  const { data, rate } = await decodeAudioSamples(videoBlob);
  const envelope = rmsEnvelope(data, rate, CUE_RMS_HOP_S);
  const cueT = findCue(envelope);

  const frames = await extractJumpFrames(videoBlob, onProgress,
    { sampleMs: REACT_SAMPLE_MS, maxSeconds: REACT_MAX_SECONDS });
  if(frames.length < 6) throw new Error('no_pose');

  if(onProgress) onProgress('Finding the first move…');
  const vis = (norm, i) => {
    const n = norm[i];
    const v = n ? (n.visibility != null ? n.visibility : (n.presence != null ? n.presence : 0)) : 0;
    return typeof v === 'number' ? v : 0;
  };
  const hipMid = f => mid(f.world[P.HIP_L], f.world[P.HIP_R]);
  const okHip = f => vis(f.norm, P.HIP_L) >= 0.4 && vis(f.norm, P.HIP_R) >= 0.4;

  const before = frames.filter(f => f.t < cueT && okHip(f));
  if(before.length < 3) throw new Error('no_pose');
  // The stance baseline. Averaging the pre-cue positions rather than taking one frame
  // absorbs ordinary tracking jitter without absorbing real movement.
  const baseX = before.reduce((s, f) => s + hipMid(f).x, 0) / before.length;
  const baseY = before.reduce((s, f) => s + hipMid(f).y, 0) / before.length;
  const baseZ = before.reduce((s, f) => s + hipMid(f).z, 0) / before.length;
  const base = { x: baseX, y: baseY, z: baseZ };

  // A "reaction" measured from a moving start isn't a reaction — it's whatever the
  // athlete was already doing. Reject rather than credit a false start with a number.
  const preSpread = Math.max(...before.map(f => dist(hipMid(f), base)));
  if(preSpread > REACT_STILL_M) throw new Error('false_start');

  const after = frames.filter(f => f.t >= cueT && okHip(f));
  const moved = after.find(f => dist(hipMid(f), base) > REACT_MOVE_M);
  if(!moved) throw new Error('no_movement');

  const reactionS = moved.t - cueT;
  if(!(reactionS >= REACT_MIN_S && reactionS <= REACT_MAX_S)) throw new Error('implausible');

  return {
    reactionS: Math.round(reactionS * 1000) / 1000,
    detail: { cueT: Math.round(cueT * 1000) / 1000, movedT: Math.round(moved.t * 1000) / 1000,
               framesRead: frames.length },
  };
}

// ---------------------------------------------------------------------------
//  FOOTWORK CADENCE
// ---------------------------------------------------------------------------
// One ankle's height-over-time, independent of the other — footwork alternates feet,
// and averaging both together the way jump-measure.js averages both ankles for a
// single liftoff would blur two offset cycles into a flatter, harder-to-read one.
function ankleSeries(frames, ankleIdx){
  const vis = (norm, i) => {
    const n = norm[i];
    const v = n ? (n.visibility != null ? n.visibility : (n.presence != null ? n.presence : 0)) : 0;
    return typeof v === 'number' ? v : 0;
  };
  return frames.filter(f => vis(f.norm, ankleIdx) >= 0.4)
    .map(f => ({ t: f.t, y: f.world[ankleIdx].y }));
}

// The same liftoff/landing threshold-crossing findJumps() uses for one jump, run to
// completion instead of stopping at the first cycle — a footwork drill is many small
// jumps of one foot, not one big jump of both.
function footCycles(series, liftM, minCycleS, maxCycleS){
  if(series.length < 6) return [];
  const baseline = median(series.slice(0, Math.min(6, series.length)).map(s => s.y));
  const cycles = [];
  let inFlight = false, takeoff = null;
  for(let i = 0; i < series.length; i++){
    const lifted = (series[i].y - baseline) > liftM;
    if(!inFlight && lifted){ inFlight = true; takeoff = series[i]; }
    else if(inFlight && !lifted){
      const landing = series[i];
      const cycleS = landing.t - takeoff.t;
      if(cycleS >= minCycleS && cycleS <= maxCycleS) cycles.push({ startT: takeoff.t, endT: landing.t });
      inFlight = false; takeoff = null;
    }
  }
  return cycles;
}

async function measureFootworkCadenceFromVideo({ videoBlob, onProgress }){
  const frames = await extractJumpFrames(videoBlob, onProgress,
    { sampleMs: CADENCE_SAMPLE_MS, maxSeconds: CADENCE_MAX_SECONDS });
  if(frames.length < 6) throw new Error('no_pose');

  if(onProgress) onProgress('Counting the steps…');
  const left = footCycles(ankleSeries(frames, P.ANK_L), FOOT_LIFT_M, FOOT_MIN_CYCLE_S, FOOT_MAX_CYCLE_S);
  const right = footCycles(ankleSeries(frames, P.ANK_R), FOOT_LIFT_M, FOOT_MIN_CYCLE_S, FOOT_MAX_CYCLE_S);
  const all = [...left, ...right];
  if(all.length < CADENCE_MIN_STEPS) throw new Error('too_few_steps');

  // The ACTIVE window, not the whole recording — a drill that starts a beat after the
  // camera does and stops a beat before it stops shouldn't have that idle time counted
  // against the rate. The span between the first and last detected foot-contact is
  // what the athlete was actually moving.
  const starts = all.map(c => c.startT), ends = all.map(c => c.endT);
  const activeS = Math.max(...ends) - Math.min(...starts);
  if(!(activeS > 0.3)) throw new Error('too_few_steps');

  const hz = all.length / activeS;
  if(!(hz >= CADENCE_MIN_HZ && hz <= CADENCE_MAX_HZ)) throw new Error('implausible');

  return {
    stepsPerSec: Math.round(hz * 10) / 10,
    detail: { totalSteps: all.length, leftSteps: left.length, rightSteps: right.length,
               activeS: Math.round(activeS * 10) / 10, framesRead: frames.length },
  };
}
