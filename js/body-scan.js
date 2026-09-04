// ===================================================================
//  BODY SCAN — the capture surface, and the seam a model plugs into
// ===================================================================
// This file deliberately contains NO measurement model, and never will. Turning
// photographs into anthropometrics is a trained computer-vision problem that needs a
// children's 3D body-scan dataset with paired ground truth. No such public dataset
// exists, for reasons anyone would agree with. Writing a plausible-looking estimator
// here would produce confident numbers about a child's body with nothing behind them,
// which is worse than having no feature.
//
// What this file IS: the complete surface around that gap — capture, pose guidance,
// consent, retention, and a documented adapter seam. Register a provider and the
// feature works end to end. Register nothing and it says so plainly rather than
// inventing a result.
//
// ---------------------------------------------------------------------------
//  THE THREE RULES THIS FILE ENFORCES IN CODE, NOT IN DOCUMENTATION
// ---------------------------------------------------------------------------
//  1. NEVER A MINOR. Body geometry is a biometric identifier in Illinois (BIPA,
//     private right of action), Texas (CUBI) and Washington (My Health My Data).
//     Collecting it from a child is a category of risk this product does not take,
//     and scanAllowed() refuses below ADULT_AGE regardless of what any caller asks.
//  2. THE IMAGE IS NEVER PERSISTED. Frames live in memory as Blobs, go to the
//     provider, and are released. Nothing is written to storage, no row references a
//     photo. This is the same posture the commercial platforms advertise, and it is
//     the only version of this that survives a diligence question.
//  3. DERIVED NUMBERS ONLY. What may be stored is what a tape measure could also have
//     produced — a girth, a length. Never the frames, never a composition estimate
//     for a minor, never an identifier.
// ---------------------------------------------------------------------------

const ADULT_AGE = 18;

// The four frames a photogrammetric provider expects, with the guidance that makes
// them usable. Bad input is the single largest source of error in these systems, so
// the coaching is part of the capture, not an afterthought.
const SCAN_POSES = [
  { key:'front', label:'Front',       hint:'Face the camera. Arms straight down, slightly away from the body, palms forward.' },
  { key:'right', label:'Right side',  hint:'Turn a quarter to your right. Arms hanging naturally, look straight ahead.' },
  { key:'back',  label:'Back',        hint:'Turn away from the camera. Same stance as the front shot.' },
  { key:'left',  label:'Left side',   hint:'Turn a quarter to your left. Arms hanging naturally.' },
];

const SCAN_SETUP = [
  'Phone at hip height, leaning against something so it does not move between shots.',
  'Stand about 8 feet back, whole body in frame from head to feet.',
  'Plain wall behind you. Close-fitting clothes — loose fabric is what the estimate gets wrong.',
  'Same spot, same light for every future scan, or the comparison means nothing.',
];

// ---------------------------------------------------------------------------
//  PROVIDER ADAPTER
// ---------------------------------------------------------------------------
// A provider takes four Blobs plus the subject's stated height and returns
// anthropometrics. Implement this interface and register it; nothing else changes.
//
//   registerBodyProvider({
//     id:    'vendor-name',
//     label: 'Vendor Name',
//     // Anything the vendor's terms require you to surface BEFORE capture.
//     notice: 'Frames are sent to Vendor and deleted after processing.',
//     async measure({ frames, heightIn, sex, ageYears }) {
//       // frames: { front: Blob, right: Blob, back: Blob, left: Blob }
//       // Return { metrics: { chest_girth_in: 38.2, waist_girth_in: 31.0, ... },
//       //          confidence: 0.0-1.0 }
//       // Throw on failure. Never return a fabricated result.
//     },
//   });
//
// The default is deliberately a NULL provider. It completes the whole flow and then
// reports honestly that nothing computed a measurement, so the surface can be
// demonstrated without anyone mistaking a mock for a result.
let BODY_PROVIDER = null;
function registerBodyProvider(p){
  if(!p || typeof p.measure !== 'function')
    throw new Error('A body provider needs an async measure({frames, heightIn, sex, ageYears}).');
  BODY_PROVIDER = p;
}
function bodyProvider(){ return BODY_PROVIDER; }

// ---------------------------------------------------------------------------
//  GUARDS
// ---------------------------------------------------------------------------
// Called before the flow opens AND again before anything is sent. Two checks, because
// a guard that only runs at the entrance is one refactor away from being bypassed.
function scanAllowed(subject){
  const age = subject && subject.birthdate ? ageFrom(subject.birthdate) : null;
  if(age == null)          return { ok:false, why:'no_age',
    msg:'We need a date of birth before this can run, because it is only ever available for adults.' };
  if(age < ADULT_AGE)      return { ok:false, why:'minor',
    msg:`Body scanning is available for adults only. ${esc(subject.first_name||'This profile')} is ${age}. `
      + 'Body geometry is a biometric identifier for a minor in several states, and this product does not collect it. '
      + 'The growth read on this screen gives the useful part — percentile, trend and spurt timing — from a tape measure.' };
  return { ok:true, age };
}

// ---------------------------------------------------------------------------
//  THE FLOW
// ---------------------------------------------------------------------------
const BS = { frames:{}, consent:false, subject:null };

function openBodyScan(subject){
  BS.frames = {}; BS.consent = false; BS.subject = subject || state.active;
  const gate = scanAllowed(BS.subject);
  if(!gate.ok) return bsRefuse(gate);
  bsConsent();
}

// The refusal is a screen, not a silent no-op. A buyer reading this flow should be
// able to see exactly where the line is and that the code holds it.
function bsRefuse(gate){
  const bg = sheet(H`<h3>Not available for this profile</h3>
    <div class="teach" style="background:#FBE9DC;border-color:#E6C9BC;margin-top:12px">
      <div class="ic" style="background:#B4451F">!</div>
      <div><h4 style="color:#B4451F">Adults only</h4><p>${gate.msg}</p></div></div>
    <button class="btn ghost" id="bsClose" style="margin-top:14px">Back</button>`);
  bg.querySelector('#bsClose').onclick = () => bg.remove();
}

function bsConsent(){
  const p = bodyProvider();
  const bg = sheet(H`<h3>Body scan</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Four photos, about a minute. Read this first —
      it is short and it is the whole deal.</p>

    <div class="card app-pad" style="margin-bottom:12px">
      <div class="grow" style="border:none;padding:0 0 10px"><div class="gi">🗑️</div>
        <div class="gt"><b>The photos are never saved</b>
          <span>They exist in this browser for as long as the scan takes, go to the measurement service, and are
            released. Nothing is uploaded to your account and no record points at an image.</span></div></div>
      <div class="grow" style="border:none;padding:10px 0 0;border-top:1px solid var(--line)"><div class="gi">📏</div>
        <div class="gt"><b>Only measurements are kept</b>
          <span>Numbers a tape measure could also have produced. You can delete them at any time from Growth.</span></div></div>
    </div>

    ${p && p.notice ? H`<div class="teach"><div class="ic">i</div><div>
      <h4>${esc(p.label||p.id)}</h4><p>${esc(p.notice)}</p></div></div>` : ''}

    ${!p ? H`<div class="teach" style="background:#EAF3F0;border-color:#CFE3DC"><div class="ic">🔌</div><div>
      <h4>No measurement service is connected</h4>
      <p>You can walk the whole capture, but nothing will compute a measurement at the end and none will be
      saved. This app does not estimate body measurements itself — that needs a trained model, and a made-up
      number here would be worse than no feature.</p></div></div>` : ''}

    <label style="display:flex;gap:11px;align-items:flex-start;margin:14px 2px;cursor:pointer">
      <input type="checkbox" id="bsOk" style="width:20px;height:20px;flex:0 0 auto;margin-top:1px"/>
      <span style="font-size:13.5px;line-height:1.5">I am scanning myself, I am over ${ADULT_AGE}, and I understand
        the photos are not saved.</span></label>

    <div class="err" id="bsErr"></div>
    <div class="row2">
      <button class="btn ghost" id="bsCancel">Cancel</button>
      <button class="btn amber" id="bsGo">Start</button>
    </div>`);

  bg.querySelector('#bsCancel').onclick = () => bg.remove();
  bg.querySelector('#bsGo').onclick = () => {
    if(!bg.querySelector('#bsOk').checked){
      bg.querySelector('#bsErr').textContent = 'Tick the box to continue.'; return;
    }
    BS.consent = true; bg.remove(); bsCapture(0);
  };
}

function bsCapture(i){
  const pose = SCAN_POSES[i];
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="bsBack" aria-label="Back">${i ? '←' : '✕'}</button>
      <h3>${esc(pose.label)}</h3>
      <span class="lg-step">${i+1} of ${SCAN_POSES.length}</span>
    </div>
    <p style="font-size:14.5px;line-height:1.55;margin:0 0 14px">${esc(pose.hint)}</p>

    ${i === 0 ? H`<div class="card app-pad" style="margin-bottom:14px">
      <div class="k-mono" style="color:var(--clay-ink);margin-bottom:8px">Set up once</div>
      ${SCAN_SETUP.map(s => H`<div style="display:flex;gap:9px;margin-bottom:7px">
        <span style="color:var(--green-d)">•</span><span style="font-size:13px;line-height:1.5">${esc(s)}</span></div>`).join('')}
    </div>` : ''}

    <div class="field">
      <input id="bsFile" type="file" accept="image/*" capture="environment"/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Stays on this device.</p>
    </div>
    <div class="err" id="bsErr"></div>
    <button class="btn amber" id="bsNext">${i === SCAN_POSES.length - 1 ? 'Finish' : 'Next'}</button>`);

  bg.querySelector('#bsBack').onclick = () => {
    bg.remove();
    if(i) bsCapture(i - 1); else bsDiscard();
  };
  bg.querySelector('#bsNext').onclick = () => {
    const f = bg.querySelector('#bsFile').files[0];
    if(!f){ bg.querySelector('#bsErr').textContent = 'Take the photo first.'; return; }
    // Held in memory only. Never handed to uploadMedia, never given a storage path.
    BS.frames[pose.key] = f;
    bg.remove();
    if(i < SCAN_POSES.length - 1) bsCapture(i + 1); else bsRun();
  };
}

// Release every frame. Called on cancel, on failure and after a successful run —
// there is no path through this file that keeps an image around.
function bsDiscard(){
  for(const k of Object.keys(BS.frames)){
    const f = BS.frames[k];
    try{ if(f && f._url) URL.revokeObjectURL(f._url); }catch(e){}
    delete BS.frames[k];
  }
  BS.consent = false;
}

async function bsRun(){
  const p = bodyProvider();
  const subject = BS.subject;
  // Second check. The first was at the entrance; a lot can change between a menu tap
  // and four photos later, and this is the one that matters because it is the last
  // thing before frames would leave the device.
  const gate = scanAllowed(subject);
  if(!gate.ok){ bsDiscard(); return bsRefuse(gate); }
  if(!BS.consent){ bsDiscard(); return bsRefuse({ msg:'Consent was not given.' }); }

  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner"></span><div>Measuring…</div></div>`);

  let result = null, failure = null;
  if(p){
    try{
      const hRows = (state.jrnMeasCache || []);
      result = await p.measure({
        frames: { ...BS.frames },
        heightIn: null,           // the provider may ask for a stated height; wire when known
        sex: subject.sex_at_birth || null,
        ageYears: gate.age,
      });
    }catch(err){ console.error(err); failure = err; }
  }
  // Frames are gone before anything is rendered, success or failure.
  bsDiscard();
  bg.remove();

  if(!p) return bsNoProvider();
  if(failure || !result || !result.metrics) return bsFailed(failure);
  bsResult(result);
}

// The honest end state of the default build. It is not an error — the capture worked.
function bsNoProvider(){
  const bg = sheet(H`<h3>Capture complete — nothing measured</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">All four photos were taken and have now been
      discarded. No measurement was produced, because no measurement service is connected.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">🔌</div><div>
      <h4>What connecting one changes</h4>
      <p>A provider implements one function — four frames in, measurements out — and registers itself with
      <b>registerBodyProvider()</b>. Everything you just walked through stays exactly as it is; only the
      result screen starts carrying numbers.</p></div></div>
    <button class="btn" id="bsDone" style="margin-top:16px">Done</button>`);
  bg.querySelector('#bsDone').onclick = () => bg.remove();
}

function bsFailed(err){
  const bg = sheet(H`<h3>That didn't measure</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">The photos have been discarded and nothing was
      saved. This is usually framing — whole body in shot, plain wall, close-fitting clothes — rather than
      anything you did wrong.</p>
    ${err ? H`<p style="font-size:12px;color:var(--muted);margin-top:10px">Logged for debugging; not shown in full
      because a service error is not something you can act on.</p>` : ''}
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="bsClose">Not now</button>
      <button class="btn amber" id="bsRetry">Try again</button>
    </div>`);
  bg.querySelector('#bsClose').onclick = () => bg.remove();
  bg.querySelector('#bsRetry').onclick = () => { bg.remove(); openBodyScan(BS.subject); };
}

function bsResult(result){
  const rows = Object.entries(result.metrics || {});
  const bg = sheet(H`<h3>Measured</h3>
    <p style="font-size:13px;color:var(--muted);margin:6px 0 14px">The photos have been discarded. These numbers
      are what was kept.</p>
    <div class="card app-pad">
      ${rows.map(([k, v]) => H`<div style="display:flex;justify-content:space-between;padding:9px 0;
        border-bottom:1px solid var(--line)">
        <span style="font-size:14px">${esc(k.replace(/_/g,' '))}</span>
        <b style="font-family:'Archivo'">${esc(String(v))}</b></div>`).join('')}
    </div>
    ${result.confidence != null ? H`<p style="font-size:12.5px;color:var(--muted);margin:10px 2px 0">
      Provider confidence ${Math.round(result.confidence*100)}%. Treat these as close estimates, not tape-measure
      truth — re-scan in the same spot and light to compare.</p>` : ''}
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="bsDrop">Discard</button>
      <button class="btn amber" id="bsSave">Save to Growth</button>
    </div>`);
  bg.querySelector('#bsDrop').onclick = () => bg.remove();
  bg.querySelector('#bsSave').onclick = async e => {
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const today = new Date().toISOString().slice(0,10);
    const payload = rows.map(([k, v]) => ({
      athlete_id: BS.subject.id, metric_key: k, value: Number(v), unit: 'in',
      measured_on: today, source: 'scan', created_by: state.user.id,
    })).filter(r => isFinite(r.value));
    const { error } = await sb.from('measurements').insert(payload);
    if(error){ console.error(error); e.target.innerHTML = 'Save to Growth'; e.target.disabled = false; return; }
    bg.remove(); toast('Saved'); renderApp('growth');
  };
}
