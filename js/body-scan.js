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

// ---------------------------------------------------------------------------
//  GUIDES — stroke only, no fill, no palette
// ---------------------------------------------------------------------------
// Deliberately not a fitness-app body outline. These exist to help someone stand
// in the right place, and a shapely filled silhouette would turn a measuring tool
// into a mirror. Two assets cover four poses: Front and Back share one (the
// instruction differentiates them, not the drawing), and Left is Right mirrored
// in CSS rather than drawn twice.

// Head, shoulders, arms slightly out, legs apart. Symmetrical, so it serves both
// the front and the back pose.
const SIL_FACING = `<svg class="bs-sil" viewBox="0 0 120 260" aria-hidden="true">
  <circle cx="60" cy="30" r="19"/>
  <path d="M60 49 L60 150"/>
  <path d="M26 76 Q60 62 94 76"/>
  <path d="M28 78 Q16 118 20 156"/>
  <path d="M92 78 Q104 118 100 156"/>
  <path d="M36 150 Q60 142 84 150"/>
  <path d="M46 152 Q40 200 42 246"/>
  <path d="M74 152 Q80 200 78 246"/>
</svg>`;

// Profile: head, one curved back line, one curved chest line, a single bent arm.
// `.flip` mirrors it for the left-side pose.
const SIL_PROFILE = `<svg class="bs-sil" viewBox="0 0 120 260" aria-hidden="true">
  <circle cx="58" cy="30" r="19"/>
  <path d="M58 49 Q52 96 54 150"/>
  <path d="M72 60 Q84 104 76 150"/>
  <path d="M70 78 Q88 112 72 146"/>
  <path d="M54 150 Q66 148 76 150"/>
  <path d="M58 152 Q54 200 56 246"/>
  <path d="M72 152 Q76 200 72 246"/>
</svg>`;

function silFor(key){
  if(key === 'front' || key === 'back') return SIL_FACING;
  return key === 'left' ? SIL_PROFILE.replace('class="bs-sil"', 'class="bs-sil flip"') : SIL_PROFILE;
}

// One diagram instead of four bullet points: phone braced at hip height, roughly
// eight feet from a figure against a wall, with the distance dashed between them.
const SETUP_DIAGRAM = `<svg viewBox="0 0 300 132" aria-label="Phone at hip height, about eight feet from a person standing against a wall">
  <line x1="12" y1="14" x2="12" y2="118"/>
  <line x1="12" y1="118" x2="288" y2="118"/>
  <circle cx="46" cy="42" r="9"/>
  <path d="M46 51 L46 88"/><path d="M32 62 L60 62"/>
  <path d="M46 88 L37 116"/><path d="M46 88 L55 116"/>
  <rect x="246" y="66" width="20" height="34" rx="3"/>
  <line x1="256" y1="100" x2="256" y2="118"/>
  <line x1="248" y1="118" x2="264" y2="118"/>
  <path class="dash" d="M62 108 L242 108"/>
  <path class="dash" d="M62 104 L62 112"/><path class="dash" d="M242 104 L242 112"/>
</svg>`;


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
  const bg = sheet(H`<div class="bs-refuse">
    <div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="#EFA33B" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/>
      <path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
    <h3>This is for adults.</h3>
    <p>${gate.msg}</p>
    <div class="bs-alt">
      <b>The growth read does the useful part</b>
      <span>Height percentile, how that is trending, and when a growth spurt is loading the knees — all from a
        tape measure, with nothing measured off a photograph.</span>
    </div>
    <button class="btn amber" id="bsToGrowth">Go to Growth</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsBackLink" style="background:transparent;color:rgba(246,242,233,.7)">Back</button>
    </div>
    <p class="bs-foot">Body geometry taken from photographs is treated as a biometric identifier for a minor
      under the Illinois Biometric Information Privacy Act, the Texas Capture or Use of Biometric Identifier Act,
      and Washington's My Health My Data Act. This product does not collect it from children.</p>
  </div>`);
  bg.querySelector('#bsBackLink').onclick = () => bg.remove();
  { const g = bg.querySelector('#bsToGrowth');
    if(g) g.onclick = () => { bg.remove(); renderApp('growth'); }; }
}

function bsConsent(){
  const p = bodyProvider();
  const bg = sheet(H`<h3>Body scan</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Four photos, about a minute. Read this
      first — it is short, and it is the whole deal.</p>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>The photos are never saved</b>
      <span>They exist in this browser for as long as the scan takes, go to the measurement service, and are
        released. Nothing is uploaded to your account and no record points at an image.</span></div></div>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>Only measurements are kept</b>
      <span>Numbers a tape measure could also have produced. Delete them any time from Growth.</span></div></div>

    ${p ? H`<div class="bs-promise"><div class="tick">🔌</div><div>
      <b>${esc(p.label||p.id)}</b><span>${esc(p.notice||'Connected measurement service.')}</span></div></div>`
        : H`<div class="bs-slot"><b style="font-family:'Archivo',sans-serif;color:var(--ink)">Nothing is
      connected today.</b><br/>You can walk the whole capture, but no measurement will be produced and none
      saved. This app does not estimate body measurements itself — that needs a trained model, and a made-up
      number here would be worse than no feature.</div>`}

    <label style="display:flex;gap:11px;align-items:flex-start;margin:14px 2px;cursor:pointer">
      <input type="checkbox" id="bsOk" style="width:20px;height:20px;flex:0 0 auto;margin-top:1px"/>
      <span style="font-size:13.5px;line-height:1.5">I'm scanning myself, and I'm over ${ADULT_AGE}.</span></label>

    <button class="btn amber" id="bsGo" disabled>Continue</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);

  const go = bg.querySelector('#bsGo'), box = bg.querySelector('#bsOk');
  // Reuses the app's existing disabled-button token rather than inventing a state.
  box.onchange = () => { go.disabled = !box.checked; };
  bg.querySelector('#bsCancel').onclick = () => bg.remove();
  go.onclick = () => { if(!box.checked) return; BS.consent = true; bg.remove(); bsSetup(); };
}

// One diagram replaces four bullet points. The rules that survive as words become
// pills, not a list.
function bsSetup(){
  const bg = sheet(H`<h3>Set up once</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">Same spot and same light every time, or a future
      scan cannot be compared with this one.</p>
    <div class="bs-setup">
      ${SETUP_DIAGRAM}
      <div class="bs-pills"><span>Hip height, braced</span><span>~8 feet back</span><span>Whole body in frame</span>
        <span>Plain wall</span><span>Close-fitting clothes</span></div>
    </div>
    <button class="btn amber" id="bsStart" style="margin-top:16px">Start with the front</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsBail" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);
  bg.querySelector('#bsBail').onclick = () => { bg.remove(); bsDiscard(); };
  bg.querySelector('#bsStart').onclick = () => { bg.remove(); bsCapture(0); };
}

function bsDots(i){
  return H`<div class="bs-dots">${SCAN_POSES.map((p,n)=>H`<div>
    <i class="${n===i?'on':(BS.frames[p.key]?'done':'')}"></i><span>${esc(p.label.split(' ')[0])}</span>
  </div>`).join('')}</div>`;
}

function bsCapture(i){
  const pose = SCAN_POSES[i];
  const bg = sheet(H`
    <div class="lg-head">
      <button class="iconbtn" id="bsBack" aria-label="Back">${i ? '←' : '✕'}</button>
      <h3>${esc(pose.label)}</h3>
      <span class="lg-step">${i+1} of ${SCAN_POSES.length}</span>
    </div>
    ${bsDots(i)}
    <div class="bs-view">
      <span class="brk tl"></span><span class="brk tr"></span>
      <span class="brk bl"></span><span class="brk br"></span>
      ${silFor(pose.key)}
      <div class="bs-hint">${esc(pose.hint)}</div>
    </div>
    <input id="bsFile" type="file" accept="image/*" capture="environment" hidden/>
    <button class="bs-shutter" id="bsShot" aria-label="Take the ${esc(pose.label)} photo"></button>
    <p class="muted-note" style="margin-top:12px">Stays on this device.</p>
    <div class="err" id="bsErr"></div>`);

  const file = bg.querySelector('#bsFile');
  bg.querySelector('#bsShot').onclick = () => file.click();
  bg.querySelector('#bsBack').onclick = () => {
    bg.remove();
    if(i) bsCapture(i - 1); else bsDiscard();
  };
  // Progress dots jump back to a completed step.
  bg.querySelectorAll('.bs-dots div').forEach((d, n) => {
    if(n < i || BS.frames[SCAN_POSES[n].key]) d.onclick = () => { bg.remove(); bsCapture(n); };
  });
  file.onchange = () => {
    const f = file.files[0];
    if(!f){ bg.querySelector('#bsErr').textContent = 'No photo was taken.'; return; }
    bg.remove(); bsReview(i, f);
  };
}

// Review sits between every capture and the next one — a frame you cannot inspect is
// a frame you will retake at the end instead of now.
function bsReview(i, file){
  const pose = SCAN_POSES[i];
  const url = URL.createObjectURL(file);
  const bg = sheet(H`
    <div class="lg-head"><h3>${esc(pose.label)}</h3>
      <span class="lg-step">${i+1} of ${SCAN_POSES.length}</span></div>
    <div class="bs-view" style="aspect-ratio:3/4">
      <img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:cover"/>
      <div class="bs-hint">✓ Only this frame is analysed, then discarded</div>
    </div>
    <div class="row2" style="margin-top:12px">
      <button class="btn ghost" id="bsRetake">Retake</button>
      <button class="btn amber" id="bsUse">Use this shot</button>
    </div>`);
  const done = () => { try{ URL.revokeObjectURL(url); }catch(e){} bg.remove(); };
  bg.querySelector('#bsRetake').onclick = () => { done(); bsCapture(i); };
  bg.querySelector('#bsUse').onclick = () => {
    BS.frames[pose.key] = file;          // in memory only — never uploadMedia, never a path
    done();
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
  if(err) console.error('body scan provider failed', err);
  const bg = sheet(H`<h3>That didn't measure</h3>
    <div class="teach" style="background:#FBE9DC;border-color:#E6C9BC;margin-top:12px">
      <div class="ic" style="background:#FBE9DC;color:#B4451F;border:1.5px solid #E6C9BC">!</div>
      <div><h4 style="color:#B4451F">Try better light and re-centre in the guide</h4>
        <p>Whole body inside the brackets, a plain wall behind you, and close-fitting clothes. Loose fabric is
        what these get wrong most often. The photos have been discarded and nothing was saved.</p></div></div>
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
