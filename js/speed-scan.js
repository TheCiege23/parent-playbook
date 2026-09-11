// ===================================================================
//  SPEED SCAN — capture and consent for reaction time and footwork cadence
// ===================================================================
// Same shape as jump-scan.js on purpose: a written release before anything opens the
// camera, checked again immediately before the video is measured, on-device only,
// never uploaded, a published retention date, revocable anytime. One consent covers
// BOTH capabilities here — the same "one release for everything an engine produces"
// choice jump-scan.js already made for jump height and landing symmetry — because
// they're the same recording risk (a short video of the athlete moving) even though
// the two capture flows and results are different.

const SPD_POLICY_VERSION = '2026-09-08.speed.v1';
const SPD_RETENTION_MONTHS = 12;
const SPD_ENGINE_ID = 'ondevice-speed';

const SPD = { videoBlob:null, consent:false, subject:null, consentId:null, mode:null };

const SPD_MODE = {
  reaction: {
    label: 'reaction time',
    title: subj => `Measure ${subj}'s reaction time`,
    setupTitle: 'One still beat, then go',
    setupHint: 'Phone braced, whole body in frame. Have someone off-camera clap sharply or say "go" — then '
             + `${'the'} athlete explodes into their first move.`,
    pills: ['Whole body in frame', 'Quiet room, no music', 'Stand still until the cue', 'One clear clap or "go"'],
    captureHint: 'Still, then a clap or "go," then move.',
    startLabel: 'Start recording',
  },
  footwork: {
    label: 'footwork cadence',
    title: subj => `Measure ${subj}'s footwork`,
    setupTitle: 'Quick feet, for the whole recording',
    setupHint: 'Phone braced, whole body in frame. Move both feet as fast as possible, in place, for about five '
             + 'seconds — a ladder drill or just quick feet on the spot both work.',
    pills: ['Whole body in frame', '~5 seconds of quick feet', 'In place — no travelling', 'Feet fully visible'],
    captureHint: 'Quick feet, in place, whole recording.',
    startLabel: 'Start recording',
  },
};

function spdRetentionDate(){
  const d = new Date();
  d.setMonth(d.getMonth() + SPD_RETENTION_MONTHS);
  return localDay(d);
}

const SPD_FLAG = 'pp_speed_active';
function spdMarkActive(on){
  try{ on ? sessionStorage.setItem(SPD_FLAG, String(Date.now()))
          : sessionStorage.removeItem(SPD_FLAG); }catch(e){}
}
function speedScanWasInterrupted(){
  try{
    const t = sessionStorage.getItem(SPD_FLAG);
    if(!t) return false;
    sessionStorage.removeItem(SPD_FLAG);
    return (Date.now() - Number(t)) < 30 * 60 * 1000;
  }catch(e){ return false; }
}
function spdInterruptedNotice(){
  const bg = sheet(H`<h3>That recording didn't finish</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">The page reloaded while the camera was open.
      <b>Nothing was saved and no video was kept</b> — it only ever existed in this browser.</p>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="spdLater">Not now</button>
      <button class="btn amber" id="spdAgain">Try again</button>
    </div>`);
  bg.querySelector('#spdLater').onclick = () => bg.remove();
  const g = bg.querySelector('#spdAgain');
  if(g) g.onclick = () => { bg.remove(); renderApp('scan'); };
}

// Entry points. mode decides which drill's instructions and analysis run once consent
// (shared across both) is in place.
async function openReactionScan(subject){ return spdOpen('reaction', subject); }
async function openFootworkScan(subject){ return spdOpen('footwork', subject); }

async function spdOpen(mode, subject){
  logUsageEvent(mode === 'reaction' ? 'scan_reaction_started' : 'scan_footwork_started');
  SPD.videoBlob = null; SPD.consent = false; SPD.consentId = null; SPD.mode = mode;
  SPD.subject = subject || state.active;
  if(!SPD.subject || !SPD.subject.id) return;

  if(!state.canEdit) return spdBlocked('Only a parent or co-parent can start this.',
    `You have view access to ${esc(SPD.subject.first_name || 'this athlete')}, which does not include this.`);

  const age = SPD.subject.birthdate ? ageFrom(SPD.subject.birthdate) : null;
  if(age == null) return spdBlocked('We need a date of birth first.',
    `Add ${esc(SPD.subject.first_name || 'their')} date of birth in Edit, then come back — it decides which
     release applies.`);

  const bg = sheet(H`<div class="center-screen" style="min-height:24dvh">
    <span class="spinner" role="status" aria-label="Loading"></span><div>Checking…</div></div>`);
  const consent = await loadScanConsent(SPD.subject.id, SPD_ENGINE_ID);
  bg.remove();

  if(consent){ SPD.consent = true; SPD.consentId = consent.id; return spdPrepareEngine(); }
  spdConsent(age);
}

function spdBlocked(title, why){
  const bg = sheet(H`<h3>${esc(title)}</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">${esc(why)}</p>
    <button class="btn" id="spdOkay" style="margin-top:16px">Got it</button>`);
  bg.querySelector('#spdOkay').onclick = () => bg.remove();
}

// Same three-promise shape as body-scan.js and jump-scan.js's release, listing BOTH
// capabilities regardless of which one this session is actually about — a parent
// covering the recording risk once, honestly told what either drill can produce.
function spdConsent(age){
  const minor = age < ADULT_AGE;
  const nm = esc(SPD.subject.first_name || 'this athlete');
  const until = spdRetentionDate();
  const untilHuman = new Date(until + 'T00:00:00')
    .toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' });

  const bg = sheet(H`<h3>Measure ${nm}'s speed & footwork</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">A few seconds of video, with sound. This part
      is the agreement — it is short, and it is the whole of it.</p>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>What gets measured</b>
      <span>Reaction time — how long from a clap or "go" to ${nm}'s first move. Footwork cadence — how many foot
        contacts per second in a quick-feet drill. Nothing about strength, technique or injury risk, and no
        distance or speed number — that needs a measured course, which this does not use.</span></div></div>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>The video is never saved</b>
      <span>Measured on this phone, sound included, and discarded the moment it's read. Nothing is uploaded to
        your account and no record points at a video.</span></div></div>

    <div class="bs-promise"><div class="tick">🗓️</div><div>
      <b>Kept until ${esc(untilHuman)}</b>
      <span>Then deleted, unless ${nm} is measured again — which starts the ${SPD_RETENTION_MONTHS} months over.
        You can delete the measurement and withdraw this permission from Account at any time, and it takes effect
        immediately.</span></div></div>

    <div class="bs-release">
      ${minor
        ? H`<label><input type="checkbox" id="spdOk1"/>
              <span>I am ${nm}'s parent or legal guardian, and I authorise this app to measure their reaction time
                and footwork from a video I record.</span></label>
            <label><input type="checkbox" id="spdOk2"/>
              <span>I understand what is measured, that the video is not uploaded or kept, and that the
                measurement is deleted on the date above.</span></label>`
        : H`<label><input type="checkbox" id="spdOk1"/>
              <span>${nm} is ${esc(String(age))} and has agreed to be measured this way. Over 18, the release is
                theirs to give — I am recording it, not giving it for them.</span></label>`}
    </div>

    <div class="err" id="spdCErr"></div>
    <button class="btn amber" id="spdGo" disabled>Agree and start</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="spdCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);

  const go = bg.querySelector('#spdGo');
  const boxes = Array.from(bg.querySelectorAll('.bs-release input[type=checkbox]'));
  const sync = () => { go.disabled = !boxes.every(b => b.checked); };
  boxes.forEach(b => { b.onchange = sync; });
  bg.querySelector('#spdCancel').onclick = () => bg.remove();

  go.onclick = async e => {
    const err = bg.querySelector('#spdCErr'); err.textContent = '';
    if(!boxes.every(b => b.checked)) return;
    e.target.innerHTML = '<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled = true;

    const { data, error } = await sb.from('biometric_consents').insert({
      athlete_id: SPD.subject.id,
      guardian_id: state.user.id,
      subject_is_minor: minor,
      subject_age_years: age,
      policy_version: SPD_POLICY_VERSION,
      scan_engine: SPD_ENGINE_ID,
      retention_until: until,
      method: 'in_app_written_release',
      detail: { produces: ['Reaction time', 'Footwork cadence'], engine_label: 'On-device speed & footwork measurement' },
    }).select('id').maybeSingle();

    if(error){
      console.error(error);
      err.textContent = 'Could not record that permission, so the capture has not started. ' + (error.message || '');
      e.target.innerHTML = 'Agree and start'; e.target.disabled = false;
      return;
    }

    SPD.consent = true;
    SPD.consentId = data ? data.id : null;
    bg.remove();
    spdPrepareEngine();
  };
}

async function spdPrepareEngine(){
  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner" role="status" aria-label="Loading"></span><div>Getting the camera ready…</div></div>`);
  try{
    await loadVideoPoseLandmarker();
    bg.remove();
    spdSetup();
  }catch(e){
    console.error('speed pose model failed to load', e);
    bg.remove();
    spdEngineUnavailable();
  }
}

function spdEngineUnavailable(){
  const bg = sheet(H`<h3>Can't load the measurement</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">This is about the model that reads the video, not
      about the recording itself — usually a dropped connection while it downloads, or a browser this phone
      doesn't support yet.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">📶</div><div>
      <h4>Try Wi-Fi, and the newest browser update</h4>
      <p>If the body scan or jump measurement has already run on this phone, this reuses the same downloaded
      model and should be instant — this screen usually means none of them have run here yet.</p></div></div>
    <button class="btn amber" id="spdEngRetry" style="margin-top:16px">Try again</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="spdEngLater" style="background:transparent;color:var(--muted)">Not now</button>
    </div>`);
  bg.querySelector('#spdEngLater').onclick = () => { bg.remove(); spdDiscard(); };
  bg.querySelector('#spdEngRetry').onclick = () => { bg.remove(); spdPrepareEngine(); };
}

function spdSetup(){
  const m = SPD_MODE[SPD.mode];
  const bg = sheet(H`<h3>${esc(m.setupTitle)}</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">${esc(m.setupHint)}</p>
    <div class="bs-setup">
      ${SETUP_DIAGRAM}
      <div class="bs-pills">${m.pills.map(p => `<span>${esc(p)}</span>`).join('')}</div>
    </div>
    <button class="btn amber" id="spdStart" style="margin-top:16px">${esc(m.startLabel)}</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="spdBail" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#spdBail').onclick = () => { bg.remove(); spdDiscard(); };
  bg.querySelector('#spdStart').onclick = () => { bg.remove(); spdMarkActive(true); spdCapture(); };
}

// Same native-camera capture as jump-scan.js. Audio is not requested separately — the
// video file the OS camera app produces carries its own sound track, which is all
// measureReactionTimeFromVideo needs; footwork cadence never looks at it.
function spdCapture(){
  const m = SPD_MODE[SPD.mode];
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="spdBack" aria-label="Back">✕</button>
      <h3>Record</h3>
    </div>
    <div class="bs-view">
      <span class="brk tl"></span><span class="brk tr"></span>
      <span class="brk bl"></span><span class="brk br"></span>
      <div class="bs-hint">${esc(m.captureHint)}</div>
    </div>
    <input id="spdFile" type="file" accept="video/*" capture="environment" hidden/>
    <button class="bs-shutter" id="spdShot" aria-label="Record video"></button>
    <p class="muted-note" style="margin-top:12px">Stays on this device.</p>
    <div class="err" id="spdErr"></div>`);

  const file = bg.querySelector('#spdFile');
  bg.querySelector('#spdShot').onclick = () => file.click();
  bg.querySelector('#spdBack').onclick = () => { bg.remove(); spdDiscard(); };
  file.onchange = () => {
    const f = file.files[0];
    if(!f){ bg.querySelector('#spdErr').textContent = 'No video was recorded.'; return; }
    bg.remove();
    spdReview(f);
  };
}

function spdReview(file){
  const url = URL.createObjectURL(file);
  const bg = sheet(H`
    <div class="lg-head"><h3>Look and sound right?</h3></div>
    <div class="bs-view" style="aspect-ratio:3/4">
      <video src="${esc(url)}" controls playsinline style="width:100%;height:100%;object-fit:cover;background:#000"></video>
    </div>
    <p class="muted-note" style="margin-top:10px">Only measured on this phone, then discarded.</p>
    <div class="row2" style="margin-top:12px">
      <button class="btn ghost" id="spdRetake">Retake</button>
      <button class="btn amber" id="spdUse">Use this</button>
    </div>`);
  const done = () => { try{ URL.revokeObjectURL(url); }catch(e){} bg.remove(); };
  bg.querySelector('#spdRetake').onclick = () => { done(); spdCapture(); };
  bg.querySelector('#spdUse').onclick = () => {
    SPD.videoBlob = file;
    done();
    spdRun();
  };
}

function spdDiscard(){
  spdMarkActive(false);
  SPD.videoBlob = null;
  SPD.consent = false;
}

async function spdRun(){
  const subject = SPD.subject, mode = SPD.mode;
  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner" role="status" aria-label="Loading"></span><div id="spdProg">Reading the video…</div></div>`);
  const say = t => { const el = bg.querySelector('#spdProg'); if(el) el.textContent = t; };

  // Second consent check, re-read from the database — same reason as body-scan.js and
  // jump-scan.js: a co-parent can withdraw the release from another phone mid-capture.
  const live = await loadScanConsent(subject.id, SPD_ENGINE_ID);
  if(!live || !SPD.consent){
    spdDiscard(); bg.remove();
    return spdRefuse();
  }

  let result = null, failure = null;
  try{
    result = mode === 'reaction'
      ? await measureReactionTimeFromVideo({ videoBlob: SPD.videoBlob, onProgress: say })
      : await measureFootworkCadenceFromVideo({ videoBlob: SPD.videoBlob, onProgress: say });
  }catch(err){ console.error(err); failure = err; }

  spdDiscard();
  bg.remove();

  if(failure || !result) return spdFailed(failure);
  spdResult(result);
}

function spdRefuse(){
  const bg = sheet(H`<div class="bs-refuse">
    <div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="#EFA33B" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/>
      <path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
    <h3>This capture was stopped.</h3>
    <p>The permission covering this measurement is no longer active, so nothing was measured. The video has
      been discarded.</p>
    <div class="bs-alt">
      <b>Nothing was kept</b>
      <span>If this is a surprise, someone with access withdrew the permission — it can be given again from
        Scan.</span>
    </div>
    <button class="btn amber" id="spdToScan">Go to Scan</button>
  </div>`);
  const g = bg.querySelector('#spdToScan');
  if(g) g.onclick = () => { bg.remove(); renderApp('scan'); };
}

const SPD_FAIL = {
  no_audio: { h:"Couldn't read the sound from that video",
    p:'Reaction time needs the cue on the recording itself. Make sure the video isn\'t muted and the microphone '
    + 'wasn\'t covered, then record again.' },
  no_cue: { h:"Didn't catch a clear cue",
    p:'The recording played but nothing in the first part of it stood out as a clap or a "go" — usually too much '
    + 'background noise, or the cue happened too quietly. A sharp, close, single sound works best.' },
  false_start: { h:'Movement started before the cue',
    p:"The athlete wasn't still right up until the clap or \"go,\" so there's no clean instant to time from. "
    + 'A short stationary beat before the cue is what this needs.' },
  cue_too_late: { h:'The cue came too late in the clip',
    p:'The cue was found, but so near the end of the recording that there was no footage left to see the move in. The athlete and the marks are fine — record again and clap a little sooner after starting the video.' },
  no_movement: { h:"Didn't see a clear first move after the cue",
    p:'The video played and a cue was found, but nothing after it looked like the athlete moving — usually the '
    + 'body left frame or the light made the outline hard to track. Whole body in frame for the whole clip fixes '
    + 'this most often.' },
  no_pose: { h:'A body could not be tracked in that video',
    p:'Usually the whole body wasn\'t in frame for long enough, or the light was behind you so the outline was '
    + 'lost. Head to feet inside the brackets, light in front, for the whole recording.' },
  too_few_steps: { h:"Didn't catch enough clear foot contacts",
    p:'Usually the feet weren\'t both in frame, the drill was too short, or the movement was too small for the '
    + 'model to pick up cleanly. A few more seconds of clearly visible quick feet usually fixes it.' },
  implausible: { h:'That reading did not add up',
    p:'The number that came back is outside what a person actually does — usually the phone moved, someone '
    + 'crossed through the frame, or tracking noise was mistaken for movement. It has been thrown away rather '
    + 'than saved.' },
};

function spdFailed(err){
  spdMarkActive(false);
  if(err) console.error('speed measurement failed', err);
  const code = err && err.message && SPD_FAIL[err.message] ? err.message : null;
  const f = code ? SPD_FAIL[code] : { h:"That didn't go through — not about your recording",
    p:'Something interrupted the measuring model rather than the video itself, usually a dropped connection '
    + 'partway through. Trying again on Wi-Fi usually clears it.' };

  const bg = sheet(H`<h3>That didn't measure</h3>
    <div class="teach" style="background:#FBE9DC;border-color:#E6C9BC;margin-top:12px">
      <div class="ic" style="background:#FBE9DC;color:#B4451F;border:1.5px solid #E6C9BC">!</div>
      <div><h4 style="color:#B4451F">${esc(f.h)}</h4>
        <p>${esc(f.p)} The video has been discarded and nothing was saved.</p></div></div>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="spdClose">Not now</button>
      <button class="btn amber" id="spdRetry">Try again</button>
    </div>`);
  bg.querySelector('#spdClose').onclick = () => bg.remove();
  bg.querySelector('#spdRetry').onclick = () => { bg.remove(); spdOpen(SPD.mode, SPD.subject); };
}

function spdResult(result){
  spdMarkActive(false);
  const mode = SPD.mode;
  const isReaction = mode === 'reaction';
  const nm = esc(SPD.subject.first_name || 'They');
  const value = isReaction ? result.reactionS : result.stepsPerSec;
  const unit = isReaction ? 's' : 'steps/s';
  const metricKey = isReaction ? 'reaction_time' : 'footwork_cadence';

  const bg = sheet(H`<h3>Measured</h3>
    <p style="font-size:13px;color:var(--muted);margin:6px 0 14px">The video has been discarded. This is what
      was kept.</p>

    <div class="ghero" style="margin-bottom:14px">
      <div class="k">${isReaction ? 'Reaction time' : 'Footwork cadence'}</div>
      <div class="gh-num"><b>${esc(String(value))}</b><span>${esc(unit)}</span></div>
    </div>

    <div class="teach" style="margin-top:14px"><div class="ic">📐</div><div>
      ${isReaction
        ? H`<h4>From the cue to ${nm}'s first move</h4>
            <p>Timed from a sound in the recording itself to the first tracked movement — not a lab-grade
            reaction tester, but the same instant every time, so the trend across sessions is the real signal.</p>`
        : H`<h4>${result.detail.totalSteps} foot contacts over ${result.detail.activeS}s</h4>
            <p>Counted from ankle movement in the video, both feet independently. Treat the trend across sessions
            as the real signal, the same as everywhere else in Growth.</p>`}
    </div></div>

    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="spdDrop">Discard</button>
      <button class="btn amber" id="spdSave">Save to Growth</button>
    </div>`);

  bg.querySelector('#spdDrop').onclick = () => bg.remove();
  bg.querySelector('#spdSave').onclick = async e => {
    e.target.innerHTML = '<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled = true;
    const { error } = await sb.from('measurements').insert({
      athlete_id: SPD.subject.id, metric_key: metricKey, value, unit,
      measured_on: todayISO(), source: 'video', created_by: state.user.id,
      note: isReaction ? 'On-device reaction-time capture' : 'On-device footwork-cadence capture',
    });
    if(error){
      console.error(error);
      toast('Could not save that');
      e.target.innerHTML = 'Save to Growth'; e.target.disabled = false; return;
    }
    logUsageEvent(isReaction ? 'scan_reaction_saved' : 'scan_footwork_saved');
    bg.remove(); toast('Saved'); renderApp('growth');
  };
}
