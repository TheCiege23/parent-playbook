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
      sptSetup();
    };
  });
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
    cleanup(); bg.remove(); toast('Saved'); renderApp('growth');
  };
}
