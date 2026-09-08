// ===================================================================
//  JUMP SCAN — capture and consent for the vertical-jump measurement
// ===================================================================
// Same shape as js/body-scan.js on purpose: a written release before anything opens the
// camera, checked again immediately before the video is measured, on-device only, never
// uploaded, a published retention date, revocable anytime. The two features share the
// same biometric_consents table and the same private.sweep_biometric_retention() job —
// what's different is the subject (motion, not a still pose) and the payload (one short
// video instead of four photos). See js/jump-measure.js for why this needs no reference
// height the way the body scan does.
//
// This file deliberately does NOT reuse body-scan.js's BS state object or its bs*
// functions — a different scan_engine means a genuinely separate consent, and keeping
// the state separate means a half-finished body scan and a half-finished jump capture
// can never cross-contaminate each other's in-memory frames.

const JUMP_POLICY_VERSION = '2026-09-08.jump.v1';
const JUMP_RETENTION_MONTHS = 12;
const JUMP_ENGINE_ID = 'ondevice-jump';

const JMP = { videoBlob:null, consent:false, subject:null, consentId:null };

function jmpRetentionDate(){
  const d = new Date();
  d.setMonth(d.getMonth() + JUMP_RETENTION_MONTHS);
  return d.toISOString().slice(0, 10);
}

const JMP_FLAG = 'pp_jump_active';
function jmpMarkActive(on){
  try{ on ? sessionStorage.setItem(JMP_FLAG, String(Date.now()))
          : sessionStorage.removeItem(JMP_FLAG); }catch(e){}
}
function jumpScanWasInterrupted(){
  try{
    const t = sessionStorage.getItem(JMP_FLAG);
    if(!t) return false;
    sessionStorage.removeItem(JMP_FLAG);
    return (Date.now() - Number(t)) < 30 * 60 * 1000;
  }catch(e){ return false; }
}
function jmpInterruptedNotice(){
  const bg = sheet(H`<h3>That capture didn't finish</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">The page reloaded while the camera was open.
      <b>Nothing was saved and no video was kept</b> — it only ever existed in this browser.</p>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="jmpLater">Not now</button>
      <button class="btn amber" id="jmpAgain">Try again</button>
    </div>`);
  bg.querySelector('#jmpLater').onclick = () => bg.remove();
  const g = bg.querySelector('#jmpAgain');
  if(g) g.onclick = () => { bg.remove(); renderApp('growth'); };
}

// Entry point. Mirrors openBodyScan's gate order: edit access, then a live consent
// check, then either straight to setup or the release screen. No height requirement —
// see js/jump-measure.js for why flight time needs none.
async function openJumpScan(subject){
  logUsageEvent('scan_jump_started');
  JMP.videoBlob = null; JMP.consent = false; JMP.consentId = null;
  JMP.subject = subject || state.active;
  if(!JMP.subject || !JMP.subject.id) return;

  if(!state.canEdit) return jmpBlocked('Only a parent or co-parent can start this.',
    `You have view access to ${esc(JMP.subject.first_name || 'this athlete')}, which does not include this.`);

  const age = JMP.subject.birthdate ? ageFrom(JMP.subject.birthdate) : null;
  if(age == null) return jmpBlocked('We need a date of birth first.',
    `Add ${esc(JMP.subject.first_name || 'their')} date of birth in Edit, then come back — it decides which
     release applies.`);

  const bg = sheet(H`<div class="center-screen" style="min-height:24dvh">
    <span class="spinner"></span><div>Checking…</div></div>`);
  const consent = await loadScanConsent(JMP.subject.id, JUMP_ENGINE_ID);
  bg.remove();

  if(consent){ JMP.consent = true; JMP.consentId = consent.id; return jmpPrepareEngine(); }
  jmpConsent(age);
}

function jmpBlocked(title, why){
  const bg = sheet(H`<h3>${esc(title)}</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">${esc(why)}</p>
    <button class="btn" id="jmpOkay" style="margin-top:16px">Got it</button>`);
  bg.querySelector('#jmpOkay').onclick = () => bg.remove();
}

// The release. Same three-promise shape as the body scan's, in the order a person would
// ask them, with the same two-tier checkbox split for a minor vs. an adult subject.
function jmpConsent(age){
  const minor = age < ADULT_AGE;
  const nm = esc(JMP.subject.first_name || 'this athlete');
  const until = jmpRetentionDate();
  const untilHuman = new Date(until + 'T00:00:00')
    .toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' });

  const bg = sheet(H`<h3>Measure ${nm}'s vertical jump</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">About five seconds of video, three jumps.
      This part is the agreement — it is short, and it is the whole of it.</p>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>What gets measured</b>
      <span>Jump height, from how long ${nm} is in the air. Landing symmetry — how the left and right knee
        compare at the moment of landing — when it can be read clearly. Nothing about strength, technique or
        injury risk.</span></div></div>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>The video is never saved</b>
      <span>Measured on this phone and discarded the moment it's read. Nothing is uploaded to your account and
        no record points at a video.</span></div></div>

    <div class="bs-promise"><div class="tick">🗓️</div><div>
      <b>Kept until ${esc(untilHuman)}</b>
      <span>Then deleted, unless ${nm} is measured again — which starts the ${JUMP_RETENTION_MONTHS} months
        over. You can delete the measurement and withdraw this permission from Account at any time, and it
        takes effect immediately.</span></div></div>

    <div class="bs-release">
      ${minor
        ? H`<label><input type="checkbox" id="jmpOk1"/>
              <span>I am ${nm}'s parent or legal guardian, and I authorise this app to measure their vertical
                jump from a video I record.</span></label>
            <label><input type="checkbox" id="jmpOk2"/>
              <span>I understand what is measured, that the video is not uploaded or kept, and that the
                measurement is deleted on the date above.</span></label>`
        : H`<label><input type="checkbox" id="jmpOk1"/>
              <span>${nm} is ${esc(String(age))} and has agreed to be measured this way. Over 18, the release
                is theirs to give — I am recording it, not giving it for them.</span></label>`}
    </div>

    <div class="err" id="jmpCErr"></div>
    <button class="btn amber" id="jmpGo" disabled>Agree and start</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="jmpCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);

  const go = bg.querySelector('#jmpGo');
  const boxes = Array.from(bg.querySelectorAll('.bs-release input[type=checkbox]'));
  const sync = () => { go.disabled = !boxes.every(b => b.checked); };
  boxes.forEach(b => { b.onchange = sync; });
  bg.querySelector('#jmpCancel').onclick = () => bg.remove();

  go.onclick = async e => {
    const err = bg.querySelector('#jmpCErr'); err.textContent = '';
    if(!boxes.every(b => b.checked)) return;
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;

    const { data, error } = await sb.from('biometric_consents').insert({
      athlete_id: JMP.subject.id,
      guardian_id: state.user.id,
      subject_is_minor: minor,
      subject_age_years: age,
      policy_version: JUMP_POLICY_VERSION,
      scan_engine: JUMP_ENGINE_ID,
      retention_until: until,
      method: 'in_app_written_release',
      detail: { produces: ['Vertical jump height', 'Landing symmetry'], engine_label: 'On-device jump measurement' },
    }).select('id').maybeSingle();

    if(error){
      console.error(error);
      err.textContent = 'Could not record that permission, so the capture has not started. ' + (error.message || '');
      e.target.innerHTML = 'Agree and start'; e.target.disabled = false;
      return;
    }

    JMP.consent = true;
    JMP.consentId = data ? data.id : null;
    bg.remove();
    jmpPrepareEngine();
  };
}

// Same reasoning as body-scan.js's bsPrepareEngine: a device that can't run the pose
// model (no WebGL2, a blocked connection) should say so before a parent records a video
// of their kid jumping, not after.
async function jmpPrepareEngine(){
  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner"></span><div>Getting the camera ready…</div></div>`);
  try{
    await loadVideoPoseLandmarker();
    bg.remove();
    jmpSetup();
  }catch(e){
    console.error('jump pose model failed to load', e);
    bg.remove();
    jmpEngineUnavailable();
  }
}

function jmpEngineUnavailable(){
  const bg = sheet(H`<h3>Can't load the jump measurement</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">This is about the model that reads the video, not
      about the recording itself — usually a dropped connection while it downloads, or a browser this phone
      doesn't support yet.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">📶</div><div>
      <h4>Try Wi-Fi, and the newest browser update</h4>
      <p>If the body scan has already run on this phone, this reuses the same downloaded model and should be
      instant — this screen usually means neither has run here yet.</p></div></div>
    <button class="btn amber" id="jmpEngRetry" style="margin-top:16px">Try again</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="jmpEngLater" style="background:transparent;color:var(--muted)">Not now</button>
    </div>`);
  bg.querySelector('#jmpEngLater').onclick = () => { bg.remove(); jmpDiscard(); };
  bg.querySelector('#jmpEngRetry').onclick = () => { bg.remove(); jmpPrepareEngine(); };
}

function jmpSetup(){
  const nm = esc(JMP.subject.first_name || 'them');
  const bg = sheet(H`<h3>One recording, three jumps</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">Phone braced and steady, whole body in frame,
      the whole time — landing included.</p>
    <div class="bs-setup">
      ${SETUP_DIAGRAM}
      <div class="bs-pills"><span>Hip height, braced</span><span>~8 feet back</span><span>Whole body in frame</span>
        <span>Plain floor to land on</span><span>Jump straight up, 3 times</span></div>
    </div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:10px">Pause a second between each jump so the
      landing is clear before the next takeoff.</p>
    <button class="btn amber" id="jmpStart" style="margin-top:16px">Start recording</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="jmpBail" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#jmpBail').onclick = () => { bg.remove(); jmpDiscard(); };
  bg.querySelector('#jmpStart').onclick = () => { bg.remove(); jmpMarkActive(true); jmpCapture(); };
}

// A single video capture via the native camera, same pattern as body-scan.js's photo
// input — the OS handles the camera UI and permission prompt; nothing here touches
// getUserMedia directly.
function jmpCapture(){
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="jmpBack" aria-label="Back">✕</button>
      <h3>Record the jumps</h3>
    </div>
    <div class="bs-view">
      <span class="brk tl"></span><span class="brk tr"></span>
      <span class="brk bl"></span><span class="brk br"></span>
      <div class="bs-hint">Whole body in frame. Three jumps, a beat apart.</div>
    </div>
    <input id="jmpFile" type="file" accept="video/*" capture="environment" hidden/>
    <button class="bs-shutter" id="jmpShot" aria-label="Record video"></button>
    <p class="muted-note" style="margin-top:12px">Stays on this device.</p>
    <div class="err" id="jmpErr"></div>`);

  const file = bg.querySelector('#jmpFile');
  bg.querySelector('#jmpShot').onclick = () => file.click();
  bg.querySelector('#jmpBack').onclick = () => { bg.remove(); jmpDiscard(); };
  file.onchange = () => {
    const f = file.files[0];
    if(!f){ bg.querySelector('#jmpErr').textContent = 'No video was recorded.'; return; }
    bg.remove();
    jmpReview(f);
  };
}

function jmpReview(file){
  const url = URL.createObjectURL(file);
  const bg = sheet(H`
    <div class="lg-head"><h3>Look right?</h3></div>
    <div class="bs-view" style="aspect-ratio:3/4">
      <video src="${esc(url)}" controls playsinline style="width:100%;height:100%;object-fit:cover;background:#000"></video>
    </div>
    <p class="muted-note" style="margin-top:10px">Only measured on this phone, then discarded.</p>
    <div class="row2" style="margin-top:12px">
      <button class="btn ghost" id="jmpRetake">Retake</button>
      <button class="btn amber" id="jmpUse">Use this</button>
    </div>`);
  const done = () => { try{ URL.revokeObjectURL(url); }catch(e){} bg.remove(); };
  bg.querySelector('#jmpRetake').onclick = () => { done(); jmpCapture(); };
  bg.querySelector('#jmpUse').onclick = () => {
    JMP.videoBlob = file;
    done();
    jmpRun();
  };
}

function jmpDiscard(){
  jmpMarkActive(false);
  JMP.videoBlob = null;
  JMP.consent = false;
}

async function jmpRun(){
  const subject = JMP.subject;
  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner"></span><div id="jmpProg">Reading the video…</div></div>`);
  const say = t => { const el = bg.querySelector('#jmpProg'); if(el) el.textContent = t; };

  // Second consent check, re-read from the database — the same reason the body scan
  // checks twice: a co-parent can withdraw the release from another phone while this
  // one is mid-capture, and that has to win.
  const live = await loadScanConsent(subject.id, JUMP_ENGINE_ID);
  if(!live || !JMP.consent){
    jmpDiscard(); bg.remove();
    return jmpRefuse();
  }

  let result = null, failure = null;
  try{
    result = await measureJumpFromVideo({ videoBlob: JMP.videoBlob, onProgress: say });
  }catch(err){ console.error(err); failure = err; }

  jmpDiscard();
  bg.remove();

  if(failure || !result) return jmpFailed(failure);
  jmpResult(result);
}

function jmpRefuse(){
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
        Growth.</span>
    </div>
    <button class="btn amber" id="jmpToGrowth">Go to Growth</button>
  </div>`);
  const g = bg.querySelector('#jmpToGrowth');
  if(g) g.onclick = () => { bg.remove(); renderApp('growth'); };
}

const JMP_FAIL = {
  video_unreadable: { h:"That video couldn't be opened",
    p:'Usually a recording that got interrupted or a format this phone\'s camera didn\'t finish writing. '
    + 'Recording again usually fixes it.' },
  no_pose: { h:'A body could not be tracked in that video',
    p:'Usually the whole body wasn\'t in frame for long enough, or the light was behind you so the outline was '
    + 'lost. Head to feet inside the brackets, light in front, for the whole recording.' },
  no_jump: { h:"Didn't catch a clear jump",
    p:'The video played, but nothing in it looked like leaving the ground and landing. A pause before and '
    + 'after each jump, and the feet staying in frame the whole time, is what this needs most.' },
  implausible: { h:'That reading did not add up',
    p:'The flight time that came back does not match a jump a person actually makes — usually the phone moved, '
    + 'or someone crossed through the frame. It has been thrown away rather than saved.' },
};

function jmpFailed(err){
  jmpMarkActive(false);
  if(err) console.error('jump measurement failed', err);
  const code = err && err.message && JMP_FAIL[err.message] ? err.message : null;
  // Same logic as body-scan.js's bsFailed: measureJumpFromVideo only ever throws the
  // codes above for a capture-quality reason, so anything else here is a technical
  // failure, not a filming problem, and the fallback message says so rather than
  // guessing it was about the recording.
  const f = code ? JMP_FAIL[code] : { h:"That didn't go through — not about your recording",
    p:'Something interrupted the measuring model rather than the video itself, usually a dropped connection '
    + 'partway through. Trying again on Wi-Fi usually clears it.' };

  const bg = sheet(H`<h3>That didn't measure</h3>
    <div class="teach" style="background:#FBE9DC;border-color:#E6C9BC;margin-top:12px">
      <div class="ic" style="background:#FBE9DC;color:#B4451F;border:1.5px solid #E6C9BC">!</div>
      <div><h4 style="color:#B4451F">${esc(f.h)}</h4>
        <p>${esc(f.p)} The video has been discarded and nothing was saved.</p></div></div>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="jmpClose">Not now</button>
      <button class="btn amber" id="jmpRetry">Try again</button>
    </div>`);
  bg.querySelector('#jmpClose').onclick = () => bg.remove();
  bg.querySelector('#jmpRetry').onclick = () => { bg.remove(); openJumpScan(JMP.subject); };
}

function jmpResult(result){
  jmpMarkActive(false);
  const nm = esc(JMP.subject.first_name || 'They');
  const sym = result.symmetry;
  const others = result.jumps.slice(1);

  const bg = sheet(H`<h3>Measured</h3>
    <p style="font-size:13px;color:var(--muted);margin:6px 0 14px">The video has been discarded. This is what
      was kept.</p>

    <div class="ghero" style="margin-bottom:14px">
      <div class="k">Best of ${result.jumps.length} jump${result.jumps.length===1?'':'s'}</div>
      <div class="gh-num"><b>${esc(String(result.bestHeightIn))}</b><span>in</span></div>
    </div>

    ${others.length ? H`<p style="font-size:12.5px;color:var(--muted);margin:0 2px 14px">Other jumps this
      recording: ${others.map(j=>esc(String(j))+'"').join(', ')}.</p>` : ''}

    ${sym ? H`<div class="bs-ratios"><div class="bs-ratio">
        <div class="k">Landing — left vs. right knee</div>
        <b>${sym.diffDeg}° apart</b>
        <span>${sym.leftDeg}° left, ${sym.rightDeg}° right at the moment of landing. A description, not a
          score — some difference is normal, and this is one landing, not a diagnosis.</span>
      </div></div>`
      : H`<p style="font-size:12.5px;color:var(--muted);margin:0 2px 14px">Landing symmetry isn't shown this
          time — the knees weren't both clearly visible right at landing.</p>`}

    <div class="teach" style="margin-top:14px"><div class="ic">📐</div><div>
      <h4>From how long ${nm} was in the air</h4>
      <p>Standard flight-time physics — no reference height involved, so this doesn't carry the same scaling
      uncertainty the body scan does. Treat the trend across scans as the real signal, same as everywhere
      else in Growth.</p></div></div>

    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="jmpDrop">Discard</button>
      <button class="btn amber" id="jmpSave">Save to Growth</button>
    </div>`);

  bg.querySelector('#jmpDrop').onclick = () => bg.remove();
  bg.querySelector('#jmpSave').onclick = async e => {
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const { error } = await sb.from('measurements').insert({
      athlete_id: JMP.subject.id, metric_key: 'vertical', value: result.bestHeightIn, unit: 'in',
      measured_on: new Date().toISOString().slice(0,10), source: 'video', created_by: state.user.id,
      note: 'On-device jump capture, best of ' + result.jumps.length,
    });
    if(error){
      console.error(error);
      toast('Could not save that');
      e.target.innerHTML = 'Save to Growth'; e.target.disabled = false; return;
    }
    logUsageEvent('scan_jump_saved');
    bg.remove(); toast('Saved'); renderApp('growth');
  };
}
