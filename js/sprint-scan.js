// ===================================================================
//  SPRINT SCAN — a stopwatch, not a scan
// ===================================================================
// Deliberately the odd one out in this family of files. Body scan, jump measurement,
// reaction time and footwork cadence all derive a number from analysing video the
// model watches. This one doesn't watch anything — a PARENT decides the two instants
// that matter (takeoff, finish line) by tapping a button, the same way a coach with a
// stopwatch always has. See BODY-SCAN-EXPANSION-PLAN.md, Part 4, "Phase 2" for why:
// real sprint speed needs a measured distance and a fixed point to time from, and there
// is no video-analysis trick that recovers a real-world distance the way flight time
// recovers jump height. Rather than build camera calibration and automatic
// line-crossing detection — a materially bigger, less certain feature — this asks a
// human to do the one part a human is already good at, and gets the timing precision
// from performance.now() instead of a person's sense of seconds.
//
// Two consequences worth being explicit about:
//   1. NO CONSENT SCREEN. Nothing here extracts a biometric measurement from imagery —
//      the number comes from two button-press timestamps a parent chose. That is not
//      what the biometric_consents flow exists to gate, so this doesn't ask for one.
//   2. THE ACCURACY STORY IS DIFFERENT, AND SAID SO. Two human button-presses carry
//      the same reaction-lag noise any hand-timed sprint has always carried — this
//      automates what a coach's stopwatch already does, and doesn't pretend to be a
//      laser gate. The setup screen says this before the first tap, not after.
//
// The optional video step at the end is a THIRD kind of thing again: not measured, not
// saved, not uploaded, not gated by consent — a home video a parent can watch back and
// then it's gone, same privacy shape as any clip taken and never exported. It exists
// only because a parent asked for the option to see the run again, and is explicitly
// unconnected to the number that gets saved.

// Fixed distances only, matching the three combine splits already in the metrics
// reference table (dash_10, dash_20, dash_40). An arbitrary "type any distance" option
// was considered and rejected: this app's whole growth-tracking story is the TREND
// across sessions, and a trend only means something if the distance is the same every
// time. A one-off custom distance would produce a number with nothing to compare it
// to, which is the same trap the CDC-anchored height percentile and the wingspan
// envelope both go out of their way to avoid elsewhere in this codebase.
const SPRINT_DISTANCES = [
  { key:'dash_10', yards:10, label:'10 yards',  hint:'A first-step / acceleration read.' },
  { key:'dash_20', yards:20, label:'20 yards',  hint:'Common youth-combine distance.' },
  { key:'dash_40', yards:40, label:'40 yards',  hint:'The classic — top-end speed.' },
];

const SPT = { subject:null, distance:null, videoBlob:null };

async function openSprintScan(subject){
  logUsageEvent('scan_sprint_started');
  SPT.subject = subject || state.active;
  SPT.distance = null; SPT.videoBlob = null;
  if(!SPT.subject || !SPT.subject.id) return;

  if(!state.canEdit) return sptBlocked('Only a parent or co-parent can start this.',
    `You have view access to ${esc(SPT.subject.first_name || 'this athlete')}, which does not include this.`);

  sptPickDistance();
}

function sptBlocked(title, why){
  const bg = sheet(H`<h3>${esc(title)}</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">${esc(why)}</p>
    <button class="btn" id="sptOkay" style="margin-top:16px">Got it</button>`);
  bg.querySelector('#sptOkay').onclick = () => bg.remove();
}

function sptPickDistance(){
  const nm = esc(SPT.subject.first_name || 'them');
  const bg = sheet(H`<h3>Time ${nm}'s sprint</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Pick the distance. It has to be the same
      every time you time this, or the trend across sessions means nothing — these three match how youth
      combines already measure speed.</p>
    <div class="bs-release">
      ${SPRINT_DISTANCES.map(d => H`<label class="navrow" style="cursor:pointer" data-dist="${esc(d.key)}">
        <div class="gt"><b>${esc(d.label)}</b><span>${esc(d.hint)}</span></div><i>›</i></label>`).join('')}
    </div>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="sptCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#sptCancel').onclick = () => bg.remove();
  bg.querySelectorAll('[data-dist]').forEach(row => {
    row.onclick = () => {
      SPT.distance = SPRINT_DISTANCES.find(d => d.key === row.getAttribute('data-dist'));
      bg.remove();
      sptPickMethod();
    };
  });
}

// ---------------------------------------------------------------------------
//  METHOD CHOICE — the stopwatch above, or the calibrated-video engine below
// ---------------------------------------------------------------------------
function sptPickMethod(){
  const bg = sheet(H`<h3>How do you want to time it?</h3>
    <div class="bs-release" style="margin-top:10px">
      <label class="navrow" style="cursor:pointer" data-method="stopwatch">
        <div class="gt"><b>Stopwatch</b><span>Tap to start, tap to stop. Simple, no camera, ready in seconds.</span></div><i>›</i></label>
      <label class="navrow" style="cursor:pointer" data-method="video">
        <div class="gt"><b>Record &amp; measure automatically</b>
          <span>A real speed number from video — needs a stationary camera and marking the start/finish line once. More setup, and asks for a permission first.</span></div><i>›</i></label>
    </div>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="sptmCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#sptmCancel').onclick = () => bg.remove();
  bg.querySelector('[data-method="stopwatch"]').onclick = () => { bg.remove(); sptSetup(); };
  bg.querySelector('[data-method="video"]').onclick = () => { bg.remove(); sptvOpen(); };
}

function sptSetup(){
  const nm = esc(SPT.subject.first_name || 'them');
  const d = SPT.distance;
  const bg = sheet(H`<h3>How this works</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">${esc(d.label)}, measured with a tape or a
      measuring wheel before you start — mark the line ${nm} takes off from and the line they finish at.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">⏱️</div><div>
      <h4>One button, two taps</h4>
      <p>Stand where you can see both lines. Tap the button the instant ${nm} takes off, tap it again the
      instant they cross the finish line. This is a stopwatch, not a camera — it doesn't watch the run, it
      just times the two taps precisely.</p></div></div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:10px">Two human taps carry a small, normal reaction
      lag on both ends — about what a coach's hand-timed sprint always has. Treat the CHANGE between sessions as
      the real signal, the same as everywhere else in Growth.</p>
    <button class="btn amber" id="sptStart" style="margin-top:16px">I'm ready</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="sptBail" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#sptBail').onclick = () => bg.remove();
  bg.querySelector('#sptStart').onclick = () => { bg.remove(); sptTimer(); };
}

// The stopwatch itself. One big button, three states: ready -> running -> stopped.
// Precision comes from performance.now() at the moment of each tap; the live-ticking
// display is just a courtesy so the screen doesn't look frozen, and is never what gets
// saved.
function sptTimer(){
  const d = SPT.distance;
  let startPerf = null, raf = null;

  const bg = sheet(H`
    <div class="lg-head"><h3>${esc(d.label)}</h3></div>
    <div class="center-screen" style="min-height:38dvh;gap:18px">
      <div id="sptClock" style="font:700 52px 'Archivo',sans-serif;font-variant-numeric:tabular-nums">0.00</div>
      <button class="bs-shutter" id="sptBtn" style="width:96px;height:96px" aria-label="Start timing"></button>
      <div id="sptLabel" style="color:var(--muted);font-size:13.5px">Tap when ${esc(SPT.subject.first_name || 'they')} takes off</div>
    </div>`);

  const clock = bg.querySelector('#sptClock');
  const label = bg.querySelector('#sptLabel');
  const btn = bg.querySelector('#sptBtn');

  const tick = () => {
    if(startPerf == null) return;
    clock.textContent = ((performance.now() - startPerf) / 1000).toFixed(2);
    raf = requestAnimationFrame(tick);
  };

  btn.onclick = () => {
    if(startPerf == null){
      startPerf = performance.now();
      label.textContent = `Tap when ${esc(SPT.subject.first_name || 'they')} crosses the line`;
      btn.classList.add('recording');
      raf = requestAnimationFrame(tick);
      return;
    }
    const elapsedS = (performance.now() - startPerf) / 1000;
    cancelAnimationFrame(raf);
    bg.remove();
    sptReviewTime(elapsedS);
  };
}

// Sanity bounds, the same "reject rather than guess" instinct as everywhere else —
// this one has no model output to be wrong, but a fumbled double-tap (0.02s) or a
// forgotten-running stopwatch (400s) is just as much a bad number as anything a model
// could produce, and saving it silently would be worse than asking to retime.
const SPRINT_MIN_S = 0.8, SPRINT_MAX_S = 30;

function sptReviewTime(elapsedS){
  const d = SPT.distance;
  const bad = !(elapsedS >= SPRINT_MIN_S && elapsedS <= SPRINT_MAX_S);
  const bg = sheet(H`<h3>${bad ? "That doesn't look right" : 'Got it'}</h3>
    <div class="ghero" style="margin:14px 0">
      <div class="k">${esc(d.label)}</div>
      <div class="gh-num"><b>${elapsedS.toFixed(2)}</b><span>s</span></div>
    </div>
    ${bad ? H`<p style="font-size:13.5px;color:var(--muted)">A ${elapsedS < SPRINT_MIN_S ? 'very short' : 'very long'}
        time like this is almost always a mistimed tap, not a real sprint. Worth timing again rather than
        saving.</p>`
      : H`<p style="font-size:13.5px;color:var(--muted)">Looks right? You can time it again if that tap felt
        off, or keep going.</p>`}
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="sptRedo">Time again</button>
      <button class="btn amber" id="sptNext" ${bad?'disabled':''}>${bad ? 'Time again to continue' : 'Continue'}</button>
    </div>`);
  bg.querySelector('#sptRedo').onclick = () => { bg.remove(); sptTimer(); };
  const next = bg.querySelector('#sptNext');
  if(next && !bad) next.onclick = () => { bg.remove(); sptOfferVideo(elapsedS); };
}

// The one optional, unmeasured step. Entirely separate from the number already timed —
// this exists purely so a parent can watch the run back, and is discarded the moment
// they leave this screen either way.
function sptOfferVideo(elapsedS){
  const bg = sheet(H`<h3>Want a video to watch back?</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">Nothing to do with the time you just got — that's
      already set. This is just for you: a quick recording of the run, playable right after, never uploaded and
      never saved anywhere.</p>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="sptSkip">Skip</button>
      <button class="btn amber" id="sptRecord">Record a video</button>
    </div>`);
  bg.querySelector('#sptSkip').onclick = () => { bg.remove(); sptResult(elapsedS, null); };
  bg.querySelector('#sptRecord').onclick = () => { bg.remove(); sptCapture(elapsedS); };
}

// Same native-camera handoff as every other capture screen in this app — the OS owns
// the recording UI. Nothing here reads a single frame of it; it only ever gets handed
// straight to a <video> element for the parent to watch.
function sptCapture(elapsedS){
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="sptCapBack" aria-label="Back">✕</button>
      <h3>Record the run</h3>
    </div>
    <div class="bs-view">
      <span class="brk tl"></span><span class="brk tr"></span>
      <span class="brk bl"></span><span class="brk br"></span>
      <div class="bs-hint">Just for you to watch back.</div>
    </div>
    <input id="sptFile" type="file" accept="video/*" capture="environment" hidden/>
    <button class="bs-shutter" id="sptShot" aria-label="Record video"></button>
    <p class="muted-note" style="margin-top:12px">Stays on this device.</p>`);

  const file = bg.querySelector('#sptFile');
  bg.querySelector('#sptShot').onclick = () => file.click();
  bg.querySelector('#sptCapBack').onclick = () => { bg.remove(); sptResult(elapsedS, null); };
  file.onchange = () => {
    const f = file.files[0];
    bg.remove();
    sptResult(elapsedS, f || null);
  };
}

function sptResult(elapsedS, videoFile){
  const d = SPT.distance;
  const url = videoFile ? URL.createObjectURL(videoFile) : null;

  const bg = sheet(H`<h3>${esc(d.label)}</h3>
    <div class="ghero" style="margin:14px 0">
      <div class="k">Time</div>
      <div class="gh-num"><b>${elapsedS.toFixed(2)}</b><span>s</span></div>
    </div>

    ${url ? H`<div class="bs-view" style="aspect-ratio:3/4;margin-bottom:14px">
        <video src="${esc(url)}" controls playsinline style="width:100%;height:100%;object-fit:cover;background:#000"></video>
      </div>
      <p class="muted-note" style="margin-bottom:4px">This video is not saved — it disappears when you leave this
        screen.</p>` : ''}

    <div class="teach" style="margin-top:10px"><div class="ic">⏱️</div><div>
      <h4>Hand-timed, same as a coach's stopwatch</h4>
      <p>Two button taps, not a camera reading the run. Treat the change between sessions as the real signal,
      timed the same way every time.</p></div></div>

    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="sptDrop">Discard</button>
      <button class="btn amber" id="sptSave">Save to Growth</button>
    </div>`);

  const cleanup = () => { if(url){ try{ URL.revokeObjectURL(url); }catch(e){} } };
  bg.querySelector('#sptDrop').onclick = () => { cleanup(); bg.remove(); };
  bg.querySelector('#sptSave').onclick = async e => {
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const { error } = await sb.from('measurements').insert({
      athlete_id: SPT.subject.id, metric_key: d.key, value: Math.round(elapsedS * 100) / 100, unit: 's',
      measured_on: new Date().toISOString().slice(0,10), source: 'guided', created_by: state.user.id,
      note: 'Hand-timed with the in-app stopwatch, ' + d.label,
    });
    if(error){
      console.error(error);
      toast('Could not save that');
      e.target.innerHTML = 'Save to Growth'; e.target.disabled = false; return;
    }
    logUsageEvent('scan_sprint_saved');
    cleanup(); bg.remove(); toast('Saved'); renderApp('growth');
  };
}

// ===================================================================
//  CALIBRATED VIDEO — Phase 2, real speed from a measured, marked course
// ===================================================================
// A separate biometric consent from body-scan/jump/speed, on purpose — this is a
// genuinely different setup (a stationary camera and a one-time calibration tap)
// from any of those, and body-scan/jump each already have their own separate consent
// rather than being bundled, so a fourth distinct one here is consistent, not new.
const SPRINT_POLICY_VERSION = '2026-09-08.sprint.v1';
const SPRINT_RETENTION_MONTHS = 12;
const SPRINT_ENGINE_ID = 'ondevice-sprint';

const SPTV = { subject:null, consent:false, consentId:null, videoBlob:null, startPoint:null, finishPoint:null };

async function sptvOpen(){
  SPTV.subject = SPT.subject; SPTV.consent = false; SPTV.consentId = null;
  SPTV.videoBlob = null; SPTV.startPoint = null; SPTV.finishPoint = null;

  const age = SPTV.subject.birthdate ? ageFrom(SPTV.subject.birthdate) : null;
  if(age == null) return sptBlocked('We need a date of birth first.',
    `Add ${esc(SPTV.subject.first_name || 'their')} date of birth in Edit, then come back — it decides which
     release applies.`);

  const bg = sheet(H`<div class="center-screen" style="min-height:24dvh">
    <span class="spinner"></span><div>Checking…</div></div>`);
  const consent = await loadScanConsent(SPTV.subject.id, SPRINT_ENGINE_ID);
  bg.remove();

  if(consent){ SPTV.consent = true; SPTV.consentId = consent.id; return sptvSetup(); }
  sptvConsent(age);
}

function sptvConsent(age){
  const minor = age < ADULT_AGE;
  const nm = esc(SPTV.subject.first_name || 'this athlete');
  const d = SPT.distance;
  const until = (() => { const dt = new Date(); dt.setMonth(dt.getMonth() + SPRINT_RETENTION_MONTHS); return dt.toISOString().slice(0,10); })();
  const untilHuman = new Date(until + 'T00:00:00').toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' });

  const bg = sheet(H`<h3>Measure ${nm}'s sprint speed</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">A short video of the ${esc(d.label)} run. This
      part is the agreement — it is short, and it is the whole of it.</p>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>What gets measured</b>
      <span>Sprint time and speed over ${esc(d.label)}, from where ${nm}'s body crosses two points you mark
        yourself after recording. Nothing about strength, technique or body composition.</span></div></div>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>The video is never saved</b>
      <span>Measured on this phone and discarded the moment it's read. Nothing is uploaded to your account and
        no record points at a video.</span></div></div>

    <div class="bs-promise"><div class="tick">🗓️</div><div>
      <b>Kept until ${esc(untilHuman)}</b>
      <span>Then deleted, unless ${nm} is measured again — which starts the ${SPRINT_RETENTION_MONTHS} months over.
        You can delete the measurement and withdraw this permission from Account at any time, and it takes effect
        immediately.</span></div></div>

    <div class="bs-release">
      ${minor
        ? H`<label><input type="checkbox" id="sptvOk1"/>
              <span>I am ${nm}'s parent or legal guardian, and I authorise this app to measure their sprint speed
                from a video I record.</span></label>
            <label><input type="checkbox" id="sptvOk2"/>
              <span>I understand what is measured, that the video is not uploaded or kept, and that the
                measurement is deleted on the date above.</span></label>`
        : H`<label><input type="checkbox" id="sptvOk1"/>
              <span>${nm} is ${esc(String(age))} and has agreed to be measured this way. Over 18, the release is
                theirs to give — I am recording it, not giving it for them.</span></label>`}
    </div>

    <div class="err" id="sptvCErr"></div>
    <button class="btn amber" id="sptvGo" disabled>Agree and start</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="sptvCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);

  const go = bg.querySelector('#sptvGo');
  const boxes = Array.from(bg.querySelectorAll('.bs-release input[type=checkbox]'));
  const sync = () => { go.disabled = !boxes.every(b => b.checked); };
  boxes.forEach(b => { b.onchange = sync; });
  bg.querySelector('#sptvCancel').onclick = () => bg.remove();

  go.onclick = async e => {
    const err = bg.querySelector('#sptvCErr'); err.textContent = '';
    if(!boxes.every(b => b.checked)) return;
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;

    const { data, error } = await sb.from('biometric_consents').insert({
      athlete_id: SPTV.subject.id,
      guardian_id: state.user.id,
      subject_is_minor: minor,
      subject_age_years: age,
      policy_version: SPRINT_POLICY_VERSION,
      scan_engine: SPRINT_ENGINE_ID,
      retention_until: until,
      method: 'in_app_written_release',
      detail: { produces: ['Sprint time', 'Sprint speed'], engine_label: 'On-device calibrated sprint speed' },
    }).select('id').maybeSingle();

    if(error){
      console.error(error);
      err.textContent = 'Could not record that permission, so the capture has not started. ' + (error.message || '');
      e.target.innerHTML = 'Agree and start'; e.target.disabled = false;
      return;
    }

    SPTV.consent = true;
    SPTV.consentId = data ? data.id : null;
    bg.remove();
    sptvSetup();
  };
}

function sptvSetup(){
  const nm = esc(SPTV.subject.first_name || 'them');
  const d = SPT.distance;
  const bg = sheet(H`<h3>Set up the course</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">${esc(d.label)}, measured with a tape or a
      measuring wheel — mark both ends with a cone, a line, or anything visible on video.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">📷</div><div>
      <h4>Brace the phone — it can't move</h4>
      <p>Set the phone down or on a tripod, off to the side, so the whole course is in frame from start to
      finish. Once recording starts, the phone has to stay still — any movement breaks the measurement.</p></div></div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:10px">After recording, you'll tap where the start and
      finish marks are in the video — that's what turns the video into a real number.</p>
    <button class="btn amber" id="sptvStart" style="margin-top:16px">Start recording</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="sptvBail" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#sptvBail').onclick = () => bg.remove();
  bg.querySelector('#sptvStart').onclick = () => { bg.remove(); sptvCapture(); };
}

function sptvCapture(){
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="sptvCapBack" aria-label="Back">✕</button>
      <h3>Record the run</h3>
    </div>
    <div class="bs-view">
      <span class="brk tl"></span><span class="brk tr"></span>
      <span class="brk bl"></span><span class="brk br"></span>
      <div class="bs-hint">Whole course in frame. Phone stays still.</div>
    </div>
    <input id="sptvFile" type="file" accept="video/*" capture="environment" hidden/>
    <button class="bs-shutter" id="sptvShot" aria-label="Record video"></button>
    <p class="muted-note" style="margin-top:12px">Stays on this device.</p>
    <div class="err" id="sptvCapErr"></div>`);

  const file = bg.querySelector('#sptvFile');
  bg.querySelector('#sptvShot').onclick = () => file.click();
  bg.querySelector('#sptvCapBack').onclick = () => { bg.remove(); sptvDiscard(); };
  file.onchange = () => {
    const f = file.files[0];
    if(!f){ bg.querySelector('#sptvCapErr').textContent = 'No video was recorded.'; return; }
    bg.remove();
    sptvReview(f);
  };
}

function sptvReview(file){
  const url = URL.createObjectURL(file);
  const bg = sheet(H`
    <div class="lg-head"><h3>Look right?</h3></div>
    <div class="bs-view" style="aspect-ratio:3/4">
      <video src="${esc(url)}" controls playsinline style="width:100%;height:100%;object-fit:cover;background:#000"></video>
    </div>
    <p class="muted-note" style="margin-top:10px">Only measured on this phone, then discarded.</p>
    <div class="row2" style="margin-top:12px">
      <button class="btn ghost" id="sptvRetake">Retake</button>
      <button class="btn amber" id="sptvUse">Use this</button>
    </div>`);
  const done = () => { try{ URL.revokeObjectURL(url); }catch(e){} bg.remove(); };
  bg.querySelector('#sptvRetake').onclick = () => { done(); sptvCapture(); };
  bg.querySelector('#sptvUse').onclick = () => {
    SPTV.videoBlob = file;
    done();
    sptvCalibrate('start');
  };
}

// The calibration tap. Runs on the ALREADY-RECORDED clip in an ordinary <video> element
// — see sprint-measure.js's header for why this, and not a live camera overlay, is the
// right shape for this step. `which` is 'start' or 'finish'; the same screen is used
// for both taps in sequence.
function sptvCalibrate(which){
  const nm = esc(SPTV.subject.first_name || 'them');
  const isStart = which === 'start';
  const url = URL.createObjectURL(SPTV.videoBlob);
  const bg = sheet(H`
    <div class="lg-head"><h3>Tap the ${isStart?'start':'finish'} line</h3></div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 10px">Scrub to any clear moment — the marks stay in the
      same spot since the camera didn't move. Tap directly on the video image to mark where ${isStart?'the start':'the finish'}
      line is.</p>
    <div id="sptvCalWrap" style="position:relative;background:#000;border-radius:14px;overflow:hidden">
      <video id="sptvCalVid" src="${esc(url)}" controls playsinline style="width:100%;display:block;object-fit:contain;background:#000"></video>
      <div id="sptvMarker" style="position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;
        background:var(--amber);border:2px solid #fff;display:none;pointer-events:none"></div>
    </div>
    <div class="err" id="sptvCalErr" style="margin-top:8px"></div>
    <button class="btn amber" id="sptvCalNext" disabled style="margin-top:12px">${isStart?'Next: mark the finish line':'Measure'}</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="sptvCalBack" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);

  const vid = bg.querySelector('#sptvCalVid'), marker = bg.querySelector('#sptvMarker'), next = bg.querySelector('#sptvCalNext');
  let point = null;

  vid.addEventListener('click', e => {
    // A native <video controls> fires click on the picture area too; the bottom
    // controls strip is a separate hit target the browser handles itself, so a tap
    // there won't reach here in practice on the platforms this app targets.
    const rect = vid.getBoundingClientRect();
    if(!vid.videoWidth || !vid.videoHeight) return;
    point = tapToNormalized(e.clientX, e.clientY, rect, vid.videoWidth, vid.videoHeight);
    const boxW = rect.width, boxH = rect.height;
    const videoAspect = vid.videoWidth / vid.videoHeight, boxAspect = boxW / boxH;
    let dispW, dispH, offX, offY;
    if(videoAspect > boxAspect){ dispW = boxW; dispH = boxW / videoAspect; offX = 0; offY = (boxH - dispH) / 2; }
    else { dispH = boxH; dispW = boxH * videoAspect; offY = 0; offX = (boxW - dispW) / 2; }
    marker.style.left = (offX + point.x * dispW) + 'px';
    marker.style.top = (offY + point.y * dispH) + 'px';
    marker.style.display = 'block';
    next.disabled = false;
  });

  const done = () => { try{ URL.revokeObjectURL(url); }catch(e){} bg.remove(); };
  bg.querySelector('#sptvCalBack').onclick = () => { done(); sptvDiscard(); };
  next.onclick = () => {
    if(!point) return;
    done();
    if(isStart){ SPTV.startPoint = point; sptvCalibrate('finish'); }
    else { SPTV.finishPoint = point; sptvRun(); }
  };
}

function sptvDiscard(){
  SPTV.videoBlob = null; SPTV.consent = false; SPTV.startPoint = null; SPTV.finishPoint = null;
}

const SPRINT_FAIL = {
  no_pose: { h:'A body could not be tracked in that video',
    p:'Usually the whole run wasn\'t in frame, or the light made the outline hard to track. Whole course in frame, good light, phone steady — that fixes this most often.' },
  no_crossing_detected: { h:"Didn't see a clear crossing at one of the marks",
    p:'The video played and a body was tracked, but it never clearly passed through one of the two spots you marked. Re-check that the marks match where the run actually happened.' },
  crossed_out_of_order: { h:'The finish came before the start',
    p:'That usually means the two marks got swapped, or the run happened in the opposite direction from how the marks were placed. Try marking them again in order.' },
  implausible: { h:'That reading did not add up',
    p:'The time between the two marks is not one a person actually runs — usually the phone moved, or someone else crossed through the frame. It has been thrown away rather than saved.' },
};

async function sptvRun(){
  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner"></span><div id="sptvProg">Getting the camera ready…</div></div>`);
  const say = t => { const el = bg.querySelector('#sptvProg'); if(el) el.textContent = t; };

  try{ await loadVideoPoseLandmarker(say); }
  catch(e){ console.error('sprint pose model failed to load', e); bg.remove(); return sptvFailed(null); }

  // Second consent check, re-read from the database — same reason as every other
  // engine: a co-parent can revoke from another device mid-capture.
  const live = await loadScanConsent(SPTV.subject.id, SPRINT_ENGINE_ID);
  if(!live || !SPTV.consent){ sptvDiscard(); bg.remove(); return sptvRefuse(); }

  let result = null, failure = null;
  try{
    result = await measureSprintFromVideo({
      videoBlob: SPTV.videoBlob, startPoint: SPTV.startPoint, finishPoint: SPTV.finishPoint,
      distanceYards: SPT.distance.yards, onProgress: say,
    });
  }catch(err){ console.error(err); failure = err; }

  sptvDiscard();
  bg.remove();
  if(failure || !result) return sptvFailed(failure);
  sptvResult(result);
}

function sptvRefuse(){
  const bg = sheet(H`<div class="bs-refuse">
    <div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="#EFA33B" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/>
      <path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
    <h3>This capture was stopped.</h3>
    <p>The permission covering this measurement is no longer active, so nothing was measured. The video has
      been discarded.</p>
    <button class="btn amber" id="sptvRefGrowth">Go to Growth</button>
  </div>`);
  const g = bg.querySelector('#sptvRefGrowth');
  if(g) g.onclick = () => { bg.remove(); renderApp('growth'); };
}

function sptvFailed(err){
  if(err) console.error('calibrated sprint measurement failed', err);
  const code = err && err.message && SPRINT_FAIL[err.message] ? err.message : null;
  const f = code ? SPRINT_FAIL[code] : { h:"That didn't go through — not about your video",
    p:'Something interrupted the measuring model rather than the video itself, usually a dropped connection '
    + 'partway through. Trying again on Wi-Fi usually clears it.' };

  const bg = sheet(H`<h3>That didn't measure</h3>
    <div class="teach" style="background:#FBE9DC;border-color:#E6C9BC;margin-top:12px">
      <div class="ic" style="background:#FBE9DC;color:#B4451F;border:1.5px solid #E6C9BC">!</div>
      <div><h4 style="color:#B4451F">${esc(f.h)}</h4>
        <p>${esc(f.p)} The video has been discarded and nothing was saved.</p></div></div>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="sptvFClose">Not now</button>
      <button class="btn amber" id="sptvFRetry">Try again</button>
    </div>`);
  bg.querySelector('#sptvFClose').onclick = () => bg.remove();
  bg.querySelector('#sptvFRetry').onclick = () => { bg.remove(); sptvSetup(); };
}

function sptvResult(result){
  const d = SPT.distance;
  const bg = sheet(H`<h3>${esc(d.label)}</h3>
    <div class="ghero" style="margin:14px 0">
      <div class="k">Time</div>
      <div class="gh-num"><b>${result.elapsedS.toFixed(2)}</b><span>s</span></div>
    </div>
    <div class="bs-ratios"><div class="bs-ratio">
      <div class="k">Speed</div><b>${result.speedMph} mph</b>
      <span>Distance ÷ time, from the marks you set — not a lab-grade radar gun, but a real, consistent
        number to track the trend against.</span></div></div>

    <div class="teach" style="margin-top:14px"><div class="ic">📐</div><div>
      <h4>Timed from where the marks were crossed</h4>
      <p>The video is gone — this is what was kept. Treat the change between sessions as the real signal, the
      same as everywhere else in Growth.</p></div></div>

    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="sptvDrop">Discard</button>
      <button class="btn amber" id="sptvSave">Save to Growth</button>
    </div>`);

  bg.querySelector('#sptvDrop').onclick = () => bg.remove();
  bg.querySelector('#sptvSave').onclick = async e => {
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const { error } = await sb.from('measurements').insert({
      athlete_id: SPT.subject.id, metric_key: d.key, value: result.elapsedS, unit: 's',
      measured_on: new Date().toISOString().slice(0,10), source: 'video', created_by: state.user.id,
      note: `On-device calibrated sprint capture, ${d.label} — ${result.speedMph} mph`,
    });
    if(error){
      console.error(error);
      toast('Could not save that');
      e.target.innerHTML = 'Save to Growth'; e.target.disabled = false; return;
    }
    logUsageEvent('scan_sprint_saved');
    bg.remove(); toast('Saved'); renderApp('growth');
  };
}
