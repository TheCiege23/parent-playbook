// ===================================================================
//  BODY SCAN — capture, consent, and the seam a measuring engine plugs into
// ===================================================================
// This file is the surface: capture, pose guidance, the release, retention, revocation
// and the result. It still contains no measurement model of its own, deliberately — the
// engine arrives through registerBodyProvider(), and today that is js/pose-measure.js
// running MediaPipe on the phone.
//
// The distinction is worth keeping straight, because it is the reason this feature is
// honest. GIRTHS — chest, waist, hip — need a parametric body model fitted to a
// silhouette, and the standard one is not licensed for commercial use. Nothing here
// estimates one, and a plausible-looking guess at a child's waist would be worse than
// no feature at all. LENGTHS between joints the model can see are a different problem:
// two detected points, the distance between them, scaled by a height someone measured
// with a tape. That is what the engine returns and all it returns.
//
// ---------------------------------------------------------------------------
//  THE THREE RULES THIS FILE ENFORCES IN CODE, NOT IN DOCUMENTATION
// ---------------------------------------------------------------------------
//  1. NO SCAN WITHOUT A RECORDED RELEASE. This file used to refuse minors outright.
//     That block was a business decision standing in for a legal one, and it has been
//     replaced — not removed — by the thing the statutes actually ask for: a written
//     release from the subject or, for a child, their legally authorised
//     representative, obtained BEFORE capture, pinned to the exact wording agreed to,
//     carrying a retention date, and revocable. A missing or stale consent refuses
//     just as hard as the age check ever did. See bsConsent() and the
//     biometric_consents table.
//  2. THE IMAGE IS NEVER PERSISTED. Frames live in memory as Blobs, are measured, and
//     are released. Nothing is written to storage and no row references a photo. With
//     the on-device engine this is stronger than a promise: the frames are never sent
//     anywhere at all, so there is no server that could keep one.
//  3. DERIVED NUMBERS ONLY. What may be stored is what a tape measure could also have
//     produced — a length. Never the frames, never a composition estimate, never an
//     identifier.
// ---------------------------------------------------------------------------

// The wording a parent agreed to, versioned. Change the release text and this MUST
// change with it: an old consent then stops matching, and the parent is asked again.
// Silently reusing a release for terms it never covered is the failure this prevents.
const SCAN_POLICY_VERSION = '2026-09-05.ondevice.v1';

// BIPA wants a retention schedule that is published and honoured, with destruction no
// later than the purpose being satisfied. A season is the purpose, so a year is the
// schedule — long enough to compare this autumn with last, short enough that a family
// who drifts away is not on file indefinitely.
const SCAN_RETENTION_MONTHS = 12;

// Kept, but no longer a gate. It decides which release text is shown and whether the
// signer is attesting for themselves or for a child in their care.
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
// Called before the flow opens AND again before any frame is measured. Two checks,
// because a guard that only runs at the entrance is one refactor away from being
// bypassed — and because a parent can revoke consent from another device while the
// camera is open on this one.
//
// What changed: the question is no longer "how old is this person" but "is there a
// live release covering this person, this wording, and this engine". Age still matters,
// but only to decide which release was needed — not whether one exists.
function scanAllowed(subject, consent){
  const age = subject && subject.birthdate ? ageFrom(subject.birthdate) : null;
  // A missing date of birth is a question we have not asked, not a refusal. It has to
  // be answered before consent can be recorded, because the release text and the
  // signer's role both depend on it.
  if(age == null) return { ok:false, why:'needs_dob', needsDob:true };
  if(!consent)    return { ok:false, why:'needs_consent', age };
  return { ok:true, age };
}

// The live release for this athlete, or null. Four things can make one dead, and all
// four have to be checked here rather than trusted from a cached flag:
//   revoked  — a parent withdrew it, possibly from another device a minute ago
//   expired  — the retention date passed, which is the schedule doing its job
//   stale    — the release wording moved on and this consent predates it
//   engine   — consent to on-device measurement is not consent to send a child's
//              photograph to a third party, and vice versa
async function loadScanConsent(athleteId, engineId){
  if(!athleteId) return null;
  try{
    const { data, error } = await sb.from('biometric_consents')
      .select('id, policy_version, scan_engine, retention_until, granted_at')
      .eq('athlete_id', athleteId)
      .is('revoked_at', null)
      .gte('retention_until', new Date().toISOString().slice(0, 10))
      .eq('policy_version', SCAN_POLICY_VERSION)
      .eq('scan_engine', engineId || 'none')
      .order('granted_at', { ascending: false })
      .limit(1);
    if(error){ console.error(error); return null; }
    return (data && data[0]) || null;
  }catch(e){ console.error(e); return null; }
}

// The scan measures proportions; a measured height turns them into lengths. Without one
// there is nothing to scale against, so this is a hard prerequisite rather than a
// nice-to-have — and it is deliberately the athlete's OWN most recent height, never a
// default for their age, because a default would silently make every child average.
async function latestHeightIn(athleteId){
  try{
    const { data } = await sb.from('measurements')
      .select('value, measured_on')
      .eq('athlete_id', athleteId).eq('metric_key', 'height')
      .order('measured_on', { ascending: false }).limit(1);
    if(!data || !data[0]) return null;
    const v = Number(data[0].value);
    return isFinite(v) && v > 0 ? { value: v, on: data[0].measured_on } : null;
  }catch(e){ console.error(e); return null; }
}


// ---------------------------------------------------------------------------
//  MEMORY PRESSURE — why a frame is downscaled the instant it is taken
// ---------------------------------------------------------------------------
// A modern phone camera returns a 12MP JPEG of roughly 3-5MB, and iOS decodes it to a
// bitmap several times that in RAM. Holding four of those while the camera app is
// foregrounded is a good way to have WKWebView evict the page — at which point the
// frames are gone, the sheet stack is gone, and the parent lands back on whatever
// route the hash says, with no idea what happened.
//
// Downscaling on capture cuts that by an order of magnitude. It also makes the upload
// to a provider faster and costs nothing in accuracy: photogrammetric fitting works on
// silhouettes, and no vendor needs 4000px of shoulder.
const FRAME_MAX_EDGE = 1600;
const FRAME_QUALITY  = 0.85;
async function shrinkFrame(file){
  try{
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(bmp.width, bmp.height));
    if(scale >= 1){ bmp.close?.(); return file; }          // already small — leave it alone
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', FRAME_QUALITY));
    cv.width = cv.height = 0;                               // release the backing store
    return blob || file;
  }catch(e){
    console.warn('frame downscale failed, keeping the original', e);
    return file;                                            // never lose a shot over this
  }
}

// ---------------------------------------------------------------------------
//  INTERRUPTION BREADCRUMB
// ---------------------------------------------------------------------------
// Deliberately NOT the frames — never those. Just a flag saying a scan was underway,
// so that if the page is reloaded mid-capture the app can say what happened instead of
// silently dumping someone back on a settings screen. sessionStorage, so it dies with
// the tab.
const BS_FLAG = 'pp_scan_active';
function bsMarkActive(on){
  try{ on ? sessionStorage.setItem(BS_FLAG, String(Date.now()))
          : sessionStorage.removeItem(BS_FLAG); }catch(e){}
}
// Called on boot. Returns true if the previous page life ended mid-scan.
function bodyScanWasInterrupted(){
  try{
    const t = sessionStorage.getItem(BS_FLAG);
    if(!t) return false;
    sessionStorage.removeItem(BS_FLAG);
    return (Date.now() - Number(t)) < 30 * 60 * 1000;      // stale flags are not news
  }catch(e){ return false; }
}
function bsInterruptedNotice(){
  const bg = sheet(H`<h3>That scan didn't finish</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">The page reloaded while the camera was open —
      iOS does this when it needs the memory back. <b>Nothing was saved and no photo was kept</b>, because the
      frames only ever existed in this browser.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">💡</div><div>
      <h4>It usually works second time</h4>
      <p>Closing other apps and other browser tabs first makes it far less likely. The photos are also smaller
      now, which is the real fix.</p></div></div>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="bsLater">Not now</button>
      <button class="btn amber" id="bsAgain">Try again</button>
    </div>`);
  bg.querySelector('#bsLater').onclick = () => bg.remove();
  bg.querySelector('#bsAgain').onclick = () => { bg.remove(); renderApp('account'); };
}

// ---------------------------------------------------------------------------
//  THE FLOW
// ---------------------------------------------------------------------------
const BS = { frames:{}, consent:false, subject:null, heightIn:null, consentId:null };

// The subject is an ATHLETE row, always. It used to be the signed-in adult, because the
// feature was adults-only and there was no adult athlete to point at — which quietly
// broke the save path, since measurements.athlete_id is a foreign key to athletes and a
// user id is not an athlete id. Nothing ever hit it, because no provider existed to
// produce a result worth saving. Now one does.
async function openBodyScan(subject){
  logUsageEvent('scan_body_started');
  BS.frames = {}; BS.consent = false; BS.consentId = null; BS.heightIn = null;
  BS.subject = subject || state.active;
  if(!BS.subject || !BS.subject.id) return;

  if(!state.canEdit) return bsBlocked('Only a parent or co-parent can start a scan.',
    `You have view access to ${esc(BS.subject.first_name || 'this athlete')}, which does not include this.`);

  const p = bodyProvider();
  if(!p) return bsNoProviderUp();

  const bg = sheet(H`<div class="center-screen" style="min-height:24dvh">
    <span class="spinner"></span><div>Checking…</div></div>`);
  const [consent, height] = await Promise.all([
    loadScanConsent(BS.subject.id, p.id),
    latestHeightIn(BS.subject.id),
  ]);
  bg.remove();

  const gate = scanAllowed(BS.subject, consent);
  if(!gate.ok && gate.needsDob) return bsBlocked('We need a date of birth first.',
    `Add ${esc(BS.subject.first_name || 'their')} date of birth in Edit, then come back — `
    + 'it decides which release applies and it is part of the record.');

  // A scan measures proportions. Without a real height there is nothing to scale them
  // against, and the honest move is to say so rather than to invent a starting point.
  if(!height) return bsNeedsHeight();
  BS.heightIn = height.value;

  if(consent){ BS.consent = true; BS.consentId = consent.id; return bsPrepareEngine(); }
  bsConsent(gate.age, p, height);
}

// Generic "not from here, not yet". Replaces the old refusal screen for everything that
// is a missing prerequisite rather than a prohibition.
function bsBlocked(title, why){
  const bg = sheet(H`<h3>${esc(title)}</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">${esc(why)}</p>
    <button class="btn" id="bsOkay" style="margin-top:16px">Got it</button>`);
  bg.querySelector('#bsOkay').onclick = () => bg.remove();
}

function bsNoProviderUp(){
  const bg = sheet(H`<h3>The measuring engine didn't load</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">Nothing is connected to measure with, so there
      is no point taking the photos. This is usually a script that failed to load — reopening the app fixes it.</p>
    <button class="btn" id="bsOkay" style="margin-top:16px">Close</button>`);
  bg.querySelector('#bsOkay').onclick = () => bg.remove();
}

function bsNeedsHeight(){
  const nm = esc(BS.subject.first_name || 'This athlete');
  const bg = sheet(H`<h3>Measure ${nm} first</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">A scan works out <b>proportions</b> — how long a
      leg is compared with a torso. Turning those into inches needs one real number to scale against, and that
      is a height someone measured with a tape.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">📏</div><div>
      <h4>Against a door frame, shoes off</h4>
      <p>Heels and back to the wall, a book flat on the head, mark and measure. Thirty seconds, and every
      number the scan produces afterwards rests on it.</p></div></div>
    <button class="btn amber" id="bsAddH" style="margin-top:16px">Add a height</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsHLater" style="background:transparent;color:var(--muted)">Not now</button>
    </div>`);
  bg.querySelector('#bsHLater').onclick = () => bg.remove();
  bg.querySelector('#bsAddH').onclick = () => { bg.remove(); renderApp('growth'); };
}

// The refusal is a screen, not a silent no-op. It fires when the SECOND guard fails —
// consent that was live when the camera opened and is not live now, because a parent
// withdrew it on another device while these four photos were being taken. Rare, and
// exactly the case a single entrance check would get wrong.
function bsRefuse(gate){
  const bg = sheet(H`<div class="bs-refuse">
    <div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="#EFA33B" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/>
      <path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
    <h3>This scan was stopped.</h3>
    <p>${esc((gate && gate.msg) || 'The permission covering this scan is no longer active, so nothing was '
      + 'measured. The photos have been discarded.')}</p>
    <div class="bs-alt">
      <b>Nothing was kept</b>
      <span>No measurement was produced and no photograph was stored. If this is a surprise, someone with
        access withdrew the scan permission — it can be given again from Growth.</span>
    </div>
    <button class="btn amber" id="bsToGrowth">Go to Growth</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsBackLink" style="background:transparent;color:rgba(246,242,233,.7)">Back</button>
    </div>
    <p class="bs-foot">Body measurements taken from photographs are treated as biometric information under the
      Illinois Biometric Information Privacy Act, the Texas Capture or Use of Biometric Identifier Act and
      Washington's My Health My Data Act. This app measures only with a recorded release, keeps no photograph,
      and destroys the measurements on the schedule shown when the release was given.</p>
  </div>`);
  bg.querySelector('#bsBackLink').onclick = () => bg.remove();
  { const g = bg.querySelector('#bsToGrowth');
    if(g) g.onclick = () => { bg.remove(); renderApp('growth'); }; }
}

// The retention date, computed once and shown to the parent BEFORE they agree rather
// than buried in a policy page. A schedule nobody was told about is not a schedule.
function bsRetentionDate(){
  const d = new Date();
  d.setMonth(d.getMonth() + SCAN_RETENTION_MONTHS);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
//  THE RELEASE
// ---------------------------------------------------------------------------
// This screen is the compliance artefact, so it is written to be read rather than
// scrolled past. Three things the statutes actually require, in the order a person
// would ask them: what is collected, what happens to it, and for how long. Then a
// specific affirmative act — not a pre-ticked box, not a continue button that implies
// agreement.
//
// For a minor there are TWO ticks, because two separate things are being attested and
// bundling them into one is how a release gets argued away later: that the signer is
// the child's legally authorised representative, and that they understand what is
// being collected.
function bsConsent(age, p, height){
  const minor = age < ADULT_AGE;
  const nm = esc(BS.subject.first_name || 'this athlete');
  const until = bsRetentionDate();
  const untilHuman = new Date(until + 'T00:00:00')
    .toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' });

  const bg = sheet(H`<h3>Scan ${nm}</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Four photos, about a minute. This part is
      the agreement — it is short, and it is the whole of it.</p>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>What gets measured</b>
      <span>${esc((p.produces || []).join(', ') || 'Lengths between joints')}. ${esc(p.excludes || '')}
        ${p.guaranteed && p.guaranteed.length && p.guaranteed.length < (p.produces||[]).length
          ? ` ${esc(p.guaranteed.join(' and '))} come back from every scan; the rest need a clear, unoccluded
            view of an arm or both shoulders, and can be missing from a scan where a sleeve or angle hid them —
            the result screen says which, if so.`
          : ''}</span></div></div>

    <div class="bs-promise"><div class="tick">✓</div><div>
      <b>The photos are never saved</b>
      <span>${esc(p.notice || 'They are measured and released.')} They exist in this browser for as long as the
        scan takes and are then discarded. Nothing is uploaded to your account and no record points at an
        image.</span></div></div>

    <div class="bs-promise"><div class="tick">🗓️</div><div>
      <b>Kept until ${esc(untilHuman)}</b>
      <span>Then deleted, unless ${nm} is scanned again — which starts the ${SCAN_RETENTION_MONTHS} months
        over. You can delete the measurements and withdraw this permission from Growth at any time, and it
        takes effect immediately.</span></div></div>

    <div class="bs-slot" style="margin-top:12px">
      <b style="font-family:'Archivo',sans-serif;color:var(--ink)">Scaled against ${esc(String(height.value))}"</b><br/>
      That height, measured ${esc(fmtDate(height.on))}, is what turns the proportions into inches. If it is out
      of date, every number from this scan will be out with it.
    </div>

    <div class="bs-release">
      ${minor
        ? H`<label><input type="checkbox" id="bsOk1"/>
              <span>I am ${nm}'s parent or legal guardian, and I authorise this app to measure their body from
                photographs I take.</span></label>
            <label><input type="checkbox" id="bsOk2"/>
              <span>I understand what is measured, that the photographs are not uploaded or kept, and that the
                measurements are deleted on the date above.</span></label>`
        : H`<label><input type="checkbox" id="bsOk1"/>
              <span>${nm} is ${esc(String(age))} and has agreed to be measured this way. Over 18, the release
                is theirs to give — I am recording it, not giving it for them.</span></label>`}
    </div>

    <div class="err" id="bsCErr"></div>
    <button class="btn amber" id="bsGo" disabled>Agree and start</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsCancel" style="background:transparent;color:var(--muted)">Cancel</button>
    </div>`);

  const go = bg.querySelector('#bsGo');
  const boxes = Array.from(bg.querySelectorAll('.bs-release input[type=checkbox]'));
  const sync = () => { go.disabled = !boxes.every(b => b.checked); };
  boxes.forEach(b => { b.onchange = sync; });
  bg.querySelector('#bsCancel').onclick = () => bg.remove();

  go.onclick = async e => {
    const err = bg.querySelector('#bsCErr'); err.textContent = '';
    if(!boxes.every(b => b.checked)) return;
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;

    // Recorded BEFORE the camera opens, never after. A release written once the photos
    // exist is a release for something that already happened.
    const { data, error } = await sb.from('biometric_consents').insert({
      athlete_id: BS.subject.id,
      guardian_id: state.user.id,
      subject_is_minor: minor,
      subject_age_years: age,
      policy_version: SCAN_POLICY_VERSION,
      scan_engine: p.id,
      retention_until: until,
      method: 'in_app_written_release',
      detail: { produces: p.produces || [], engine_label: p.label || p.id,
                height_in: height.value, height_on: height.on },
    }).select('id').maybeSingle();

    if(error){
      console.error(error);
      err.textContent = 'Could not record that permission, so the scan has not started. '
                      + (error.message || '');
      e.target.innerHTML = 'Agree and start'; e.target.disabled = false;
      return;
    }

    BS.consent = true;
    BS.consentId = data ? data.id : null;
    bg.remove();
    bsPrepareEngine();
  };
}

// ---------------------------------------------------------------------------
//  ENGINE PRELOAD — surfaces a device or network problem before four photos are
//  taken, not after. loadPoseLandmarker() downloads a ~9MB model; running it here,
//  behind a spinner a parent expects anyway between agreeing and shooting, means a
//  phone that can't run it (no WebGL2, a blocked CDN, an ad-blocker) says so before
//  anyone poses a child four times for a scan that was never going to finish.
// ---------------------------------------------------------------------------
async function bsPrepareEngine(){
  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner"></span><div>Getting the camera ready…</div></div>`);
  try{
    await loadPoseLandmarker();
    bg.remove();
    bsSetup();
  }catch(e){
    console.error('pose model failed to load', e);
    bg.remove();
    bsEngineUnavailable();
  }
}

function bsEngineUnavailable(){
  const nm = esc(BS.subject && BS.subject.first_name || 'this athlete');
  const bg = sheet(H`<h3>Can't load the on-device scan</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">This is about the model that reads the photos, not
      about ${nm} or anything you did — usually a dropped connection while it downloads (about 9MB, once), or a
      browser this phone doesn't support yet.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">📶</div><div>
      <h4>Try Wi-Fi, and the newest browser update</h4>
      <p>It only has to succeed once — after that it's cached on this phone for every future scan, so this is
      the only time it's slow.</p></div></div>
    <button class="btn amber" id="bsEngRetry" style="margin-top:16px">Try again</button>
    <div style="text-align:center;margin-top:12px">
      <button class="pill" id="bsEngLater" style="background:transparent;color:var(--muted)">Not now</button>
    </div>`);
  bg.querySelector('#bsEngLater').onclick = () => { bg.remove(); bsDiscard(); };
  bg.querySelector('#bsEngRetry').onclick = () => { bg.remove(); bsPrepareEngine(); };
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
  bg.querySelector('#bsStart').onclick = () => { bg.remove(); bsMarkActive(true); bsCapture(0); };
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
  file.onchange = async () => {
    const f = file.files[0];
    if(!f){ bg.querySelector('#bsErr').textContent = 'No photo was taken.'; return; }
    // Shrink BEFORE holding it. A full-resolution frame sitting in memory while the
    // camera is foregrounded is what gets the page evicted on iOS.
    const small = await shrinkFrame(f);
    bg.remove(); bsReview(i, small);
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
  bsMarkActive(false);
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

  const bg = sheet(H`<div class="center-screen" style="min-height:30dvh">
    <span class="spinner"></span><div id="bsProg">Measuring…</div></div>`);
  const say = t => { const el = bg.querySelector('#bsProg'); if(el) el.textContent = t; };

  // SECOND CHECK, and it re-reads the database rather than trusting BS.consent. The
  // first check ran before the camera opened; four photos later a co-parent may have
  // withdrawn the release from another phone, and a flag captured a minute ago would
  // not know. This is the last moment before a child's frames are measured, so it is
  // the one that has to be true rather than remembered.
  const live = await loadScanConsent(subject.id, p && p.id);
  const gate = scanAllowed(subject, live);
  if(!p || !gate.ok || !BS.consent){
    bsDiscard(); bg.remove();
    return bsRefuse({ msg: !p ? 'The measuring engine is no longer available.'
      : 'The permission covering this scan is no longer active.' });
  }

  let result = null, failure = null;
  try{
    result = await p.measure({
      frames: { ...BS.frames },
      heightIn: BS.heightIn,
      sex: subject.sex_at_birth || null,
      ageYears: gate.age,
      onProgress: say,
    });
  }catch(err){ console.error(err); failure = err; }

  // Frames are gone before anything is rendered, success or failure.
  bsDiscard();
  bg.remove();

  if(failure || !result || !result.metrics || !Object.keys(result.metrics).length)
    return bsFailed(failure);
  bsResult(result);
}

// Every way this can fail, told apart. A single "try again" for four different causes
// sends a parent back to redo the identical thing that just didn't work — and three of
// these are fixed by changing something specific, not by trying harder.
const BS_FAIL = {
  needs_height: { h:'No height to scale against',
    p:'The scan works out proportions; a measured height turns them into inches. Add one in Growth and the '
    + 'same photos would have worked.' },
  no_pose: { h:'A body could not be found in those photos',
    p:'Usually the whole body is not in frame, or the light is behind you so the outline is lost. Head to feet '
    + 'inside the brackets, light in front, plain wall behind.' },
  incomplete: { h:'Part of the body was out of frame',
    p:'Feet and head both need to be in every shot — a leg length with the ankles cropped off is the one thing '
    + 'this must not guess at. Step back a little and take them again.' },
  implausible: { h:'Those measurements did not add up',
    p:'The proportions that came back are not ones a body has — usually someone sitting or leaning, two people '
    + 'in frame, or a mirror behind. They have been thrown away rather than saved. Standing straight against a '
    + 'plain wall fixes it.' },
};

function bsFailed(err){
  bsMarkActive(false);
  if(err) console.error('body scan measurement failed', err);
  const code = err && err.message && BS_FAIL[err.message] ? err.message : null;
  // measureFromFrames throws only the four keys above for any capture-quality reason —
  // a body out of frame, cropped feet, an implausible result. Anything else landing here
  // is by construction NOT about the photos: the model dropped mid-run, a network blip,
  // a GPU context lost. Telling a parent to fix their lighting for a network error is
  // actively wrong, so this fallback says what it actually is instead.
  const f = code ? BS_FAIL[code] : { h:"That didn't go through — not about your photos",
    p:'Something interrupted the measuring model rather than the pictures themselves, usually a dropped '
    + 'connection partway through. The photos have been discarded either way; trying again on Wi-Fi usually '
    + 'clears it.' };

  const bg = sheet(H`<h3>That didn't measure</h3>
    <div class="teach" style="background:#FBE9DC;border-color:#E6C9BC;margin-top:12px">
      <div class="ic" style="background:#FBE9DC;color:#B4451F;border:1.5px solid #E6C9BC">!</div>
      <div><h4 style="color:#B4451F">${esc(f.h)}</h4>
        <p>${esc(f.p)} The photos have been discarded and nothing was saved.</p></div></div>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="bsClose">Not now</button>
      <button class="btn amber" id="bsRetry">${code === 'needs_height' ? 'Add a height' : 'Try again'}</button>
    </div>`);
  bg.querySelector('#bsClose').onclick = () => bg.remove();
  bg.querySelector('#bsRetry').onclick = () => {
    bg.remove();
    if(code === 'needs_height') renderApp('growth'); else openBodyScan(BS.subject);
  };
}

// Reading order is the argument. The RATIOS go first because they are the numbers the
// method actually supports — they are unaffected by the one modelled quantity in the
// chain (see pose-measure.js on the crown estimate) and they are what youth sport
// reads. The inches follow, labelled as close rather than exact.
//
// No target, no range, no colour. A child's proportions are not an achievement and
// there is no better value to be closer to — the same rule that keeps red off every
// other screen in this app applies hardest here, on a screen about a body.
function bsRatioCards(result){
  const r = result.ratios || {};
  const cards = [];
  if(r.ape != null){
    const pct = Math.round((r.ape - 1) * 1000) / 10;
    cards.push({ k:'Arm span vs height', v:(r.ape).toFixed(2) + '×',
      s: Math.abs(pct) < 1.5 ? 'Arm span and height are about the same, which is the most common build.'
        : pct > 0 ? `Arm span is about ${Math.abs(pct).toFixed(0)}% longer than height — reach that shows up in `
                    + 'catching and blocking.'
                  : `Height is about ${Math.abs(pct).toFixed(0)}% more than arm span — a build that tends to `
                    + 'favour running over reaching.' });
  }
  if(r.legShare != null){
    cards.push({ k:'Legs as a share of height', v:Math.round(r.legShare * 1000) / 10 + '%',
      s:'The number to watch across scans, not today. Legs lengthen first in a growth spurt, so this rising '
      + 'is the earliest sign one has started — usually months before the height curve bends.' });
  }
  if(!cards.length) return '';
  return H`<div class="bs-ratios">${cards.map(c => H`<div class="bs-ratio">
    <div class="k">${esc(c.k)}</div><b>${esc(c.v)}</b><span>${esc(c.s)}</span></div>`).join('')}</div>`;
}

function bsResult(result){
  bsMarkActive(false);
  const rows = Object.entries(result.metrics || {});
  const nameOf = k => (typeof metricName === 'function' ? metricName(k) : k.replace(/_/g, ' '));
  const d = result.detail || {};
  const conf = result.confidence != null ? Math.round(result.confidence * 100) : null;
  // The mesh frame is only put in the DOM if the provider actually returned a URL. An
  // empty 3D box saying "no model available" is worse than no box.
  const wantsMesh = !!result.meshUrl;
  const bg = sheet(H`<h3>Measured</h3>
    <p style="font-size:13px;color:var(--muted);margin:6px 0 14px">The photos have been discarded. These
      numbers are what was kept.</p>

    ${wantsMesh ? H`<div class="bs-mesh" id="bsMesh"><div class="bs-mesh-load"><span class="spinner"></span></div></div>` : ''}

    ${bsRatioCards(result)}

    <div class="sec-title" style="margin-top:18px">Lengths</div>
    <div class="card app-pad">
      ${rows.map(([k, v]) => H`<div style="display:flex;justify-content:space-between;padding:9px 0;
        border-bottom:1px solid var(--line)">
        <span style="font-size:14px">${esc(nameOf(k))}</span>
        <b style="font-family:'Archivo',sans-serif">${esc(String(v))}"</b></div>`).join('')}
    </div>

    <div class="teach" style="margin-top:14px"><div class="ic">📐</div><div>
      <h4>Close, and comparable — not a tape measure</h4>
      <p>These are scaled from the ${esc(String(result.heightIn))}" height on file, so they carry however far
      out that is. Treat the inches as approximate and the change between scans as the real signal — the same
      method makes the same small error every time, so it cancels.
      ${conf != null ? `Read of these four photos: ${conf}% confident.` : ''}
      ${d.framesMissed && d.framesMissed.length
        ? `The ${esc(d.framesMissed.join(' and '))} shot could not be read, so this used
           ${esc(String((d.framesUsed || []).length))}.` : ''}
      ${d.rejected && d.rejected.length
        ? `One reading (${esc(d.rejected.map(nameOf).join(', '))}) did not fit the height on file and was
           dropped rather than saved.` : ''}
      ${d.skipped && d.skipped.length
        ? ' ' + d.skipped.map(s => `${esc(nameOf(s.key))} isn't in this scan — ${esc(s.reason)}.`).join(' ')
        : ''}</p></div></div>

    <div id="bsMaturity"></div>

    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="bsDrop">Discard</button>
      <button class="btn amber" id="bsSave">Save to Growth</button>
    </div>`);

  // Rendered AFTER the sheet exists, and never awaited by anything that matters. If the
  // mesh fails, the frame is removed and the measurements stand on their own — the
  // avatar is decoration and decoration must not break a result.
  if(wantsMesh){
    const host = bg.querySelector('#bsMesh');
    renderBodyMesh(host, result.meshUrl).then(ok => { if(!ok && host) host.remove(); });
  }
  bsAppendMaturity(bg);

  const close = () => {
    const host = bg.querySelector('#bsMesh');
    if(host && host._disposeMesh) host._disposeMesh();   // stop the loop, free the GL context
    bg.remove();
  };
  bg.querySelector('#bsDrop').onclick = close;
  bg.querySelector('#bsSave').onclick = async e => {
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const today = new Date().toISOString().slice(0,10);
    // `photo` is a real value of the measure_source enum. This said 'scan' for as long
    // as the file has existed, which is not one of (manual, guided, photo, import) —
    // every save would have failed on the enum cast. Nothing caught it because no
    // provider existed to produce a result anyone could press Save on.
    const payload = rows.map(([k, v]) => ({
      athlete_id: BS.subject.id, metric_key: k, value: Number(v), unit: 'in',
      measured_on: today, source: 'photo', created_by: state.user.id,
      note: 'On-device scan, scaled to ' + result.heightIn + '" height',
    })).filter(r => isFinite(r.value));
    const { error } = await sb.from('measurements').insert(payload);
    if(error){
      console.error(error);
      toast('Could not save that');
      e.target.innerHTML = 'Save to Growth'; e.target.disabled = false; return;
    }
    logUsageEvent('scan_body_saved');
    close(); toast('Saved'); renderApp('growth');
  };
}

// Progressive, same idiom as the mesh above: the primary result renders immediately and
// this fills in behind it if the data for it exists. This is NOT computed from the scan
// — the scan measures proportions, not a standing height — it is the same published-
// science growth read maturity.js already shows on the Growth screen (predicted adult
// height, height percentile, growth spurt, relative age), pulled in here so a parent
// who just measured their kid sees it without a second trip. A family with no parent
// heights or height reading on file sees nothing added here, not a gap or an error —
// growthCard() itself returns '' when there is nothing it can show.
async function bsAppendMaturity(bg){
  const host = bg.querySelector('#bsMaturity');
  if(!host || typeof maturityReport !== 'function' || typeof growthCard !== 'function') return;
  try{
    const [{ data: ath }, { data: heightRows }, { data: sportRow }] = await Promise.all([
      sb.from('athletes').select('sex_at_birth,mother_height_in,father_height_in,birthdate')
        .eq('id', BS.subject.id).maybeSingle(),
      sb.from('measurements').select('metric_key,value,measured_on')
        .eq('athlete_id', BS.subject.id).eq('metric_key', 'height')
        .order('measured_on', { ascending:false }).limit(60),
      sb.from('athlete_sports').select('sport_key,age_cutoff_md')
        .eq('athlete_id', BS.subject.id).eq('is_primary', true).maybeSingle(),
    ]);
    if(!ath || !document.body.contains(host)) return;
    const mat = maturityReport({ ...ath, birthdate: ath.birthdate || BS.subject.birthdate },
                               heightRows || [], sportRow || null);
    const html = growthCard(mat, BS.subject);
    if(html) host.innerHTML = html;
  }catch(e){
    // Decoration on top of a result that already stands on its own — a failure here
    // must never be visible as anything other than the card simply not appearing.
    console.error('maturity card failed to load on scan result', e);
  }
}

// ===================================================================
//  MESH VIEWER — the 3D slot, wired to the same seam
// ===================================================================
// Displaying a body mesh is easy. DERIVING one from four photographs is the entire
// product, and it is the part this app does not have — see the header. So this is a
// viewer, not a generator: if a provider returns a mesh alongside its measurements,
// it renders. If not, nothing here runs and nothing here is downloaded.
//
// The provider contract gains one optional field:
//
//     return {
//       metrics:    { waist_girth_in: 31.0, ... },
//       confidence: 0.82,
//       meshUrl:    'https://vendor.example/scan/abc.glb',   // OPTIONAL
//     };
//
// A missing or broken meshUrl is NOT an error. The measurements are the deliverable;
// the avatar is decoration, and decoration must never block a result.
//
// three.js is ~600KB and is dynamic-imported on first use only. A parent who never
// scans never pays for it. Dynamic import() is a function call, so it is legal inside
// this classic non-module script — no build step, consistent with the rest of the app.

let THREE_CACHE = null;
async function loadThree(){
  if(THREE_CACHE) return THREE_CACHE;
  const [three, gltf] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
  ]);
  THREE_CACHE = { THREE: three, GLTFLoader: gltf.GLTFLoader };
  return THREE_CACHE;
}

// Renders `meshUrl` into `host`. Resolves true on success, false on any failure —
// callers use that to decide whether to leave the frame up or quietly remove it.
async function renderBodyMesh(host, meshUrl){
  if(!host || !meshUrl) return false;
  let lib;
  try{ lib = await loadThree(); }
  catch(e){ console.error('three.js failed to load', e); return false; }
  const { THREE, GLTFLoader } = lib;

  const w = host.clientWidth || 320, h = host.clientHeight || 380;
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  host.innerHTML = '';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);

  // Deliberately flat and neutral. Dramatic rim lighting on a photogrammetric scan of
  // a real person's body is the difference between a measuring tool and a mirror, and
  // this product is the former. Matte grey, soft fill, no shadows, no shine.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556059, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(1, 2, 2);
  scene.add(key);

  let root = null;
  try{
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().load(meshUrl, res, undefined, rej));
    root = gltf.scene;
  }catch(e){
    console.error('mesh load failed', e);
    try{ renderer.dispose(); }catch(_){}
    return false;
  }

  root.traverse(o => {
    if(o.isMesh) o.material = new THREE.MeshStandardMaterial({
      color: 0xB9BEB6, roughness: 0.95, metalness: 0.0, flatShading: false });
  });

  // Frame the body regardless of what scale the vendor exported in.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  root.position.sub(centre);
  const pivot = new THREE.Group();
  pivot.add(root);
  scene.add(pivot);
  const span = Math.max(size.x, size.y, size.z) || 1;
  camera.position.set(0, 0, span * 2.4);
  camera.lookAt(0, 0, 0);

  // Drag to turn it, and a slow idle spin so it reads as three-dimensional at a glance.
  // Vertical rotation is deliberately NOT offered: nobody needs to look at the underside
  // of a scan of a person.
  let dragging = false, lastX = 0, idle = true;
  const onDown = e => { dragging = true; idle = false;
    lastX = (e.touches ? e.touches[0].clientX : e.clientX); };
  const onMove = e => { if(!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    pivot.rotation.y += (x - lastX) * 0.01; lastX = x; };
  const onUp = () => { dragging = false; };
  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);

  let raf = 0, stopped = false;
  (function tick(){
    if(stopped) return;
    if(idle) pivot.rotation.y += 0.004;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  })();

  // The sheet is removed from the DOM when the parent closes it; without this the loop
  // and the GL context leak for the life of the session.
  host._disposeMesh = () => {
    stopped = true; cancelAnimationFrame(raf);
    removeEventListener('pointerup', onUp);
    scene.traverse(o => {
      if(o.geometry) o.geometry.dispose();
      if(o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    try{ renderer.dispose(); }catch(_){}
  };
  return true;
}

// ===================================================================
//  WITHDRAWING A RELEASE — the half nobody builds
// ===================================================================
// Every product that collects biometric information promises consent can be withdrawn.
// Most of them mean "email support and a human will do it", which is a right you have to
// ask permission to exercise. This is the control, in Account, next to the other things
// a parent owns rather than requests.
//
// It is an UPDATE and never a DELETE. The record that a release was given on one date
// and withdrawn on another IS the compliance artefact — destroying it to look tidy would
// destroy the only proof the withdrawal was honoured.
async function fillScanConsents(){
  const host = $("#scanConsents");
  if(!host) return;
  const set = html => { if(document.body.contains(host)) host.innerHTML = html; };

  let rows = [];
  try{
    const { data, error } = await sb.from('biometric_consents')
      .select('id, athlete_id, granted_at, retention_until, scan_engine, subject_is_minor')
      .is('revoked_at', null)
      .gte('retention_until', new Date().toISOString().slice(0, 10))
      .order('granted_at', { ascending: false });
    if(error) throw error;
    rows = data || [];
  }catch(e){
    console.error(e);
    return set(H`<div class="rail-empty" style="padding:4px 0">Could not load these.</div>`);
  }

  if(!rows.length){
    return set(H`<div class="rail-empty" style="padding:4px 0">No scan or measurement permission has been
      given. Each asks for one, from an athlete's Scan screen, before they open the camera.</div>`);
  }

  // One row per (athlete, engine) — a body-scan release and a jump-measurement release
  // are separate permissions even for the same child, so dedupe on the PAIR, not just
  // the athlete. Getting this wrong isn't cosmetic: before this, withdrawing the ONE
  // consent a parent could see would have silently revoked BOTH engines' permission for
  // that child the moment a second engine existed. Re-scanning with the same engine
  // still inserts a fresh consent, so several rows per engine are normal; the newest per
  // engine is the one that governs.
  const seen = new Set();
  const latest = rows.filter(r => {
    const k = r.athlete_id + '::' + r.scan_engine;
    return !seen.has(k) && seen.add(k);
  });
  const nameOf = id => {
    const a = (state.athletes || []).find(x => x.id === id);
    return a ? a.first_name : 'An athlete';
  };
  // A per-engine lookup, not a two-way fallback — the fallback used to quietly label
  // every engine that WASN'T 'ondevice-jump' as "Body scan," which was harmless with
  // two engines and would have mislabelled this new third one the same way the
  // athlete_id-only revocation bug once cross-affected engines it had never heard of.
  const ENGINE_LABELS = {
    'ondevice-pose': 'Body scan',
    'ondevice-jump': 'Jump measurement',
    'ondevice-speed': 'Speed & footwork measurement',
    'ondevice-sprint': 'Calibrated sprint speed',
  };
  const engineLabel = eng => ENGINE_LABELS[eng] || eng;

  set(latest.map(r => H`<div class="tgl">
      <div class="gt"><b>${esc(nameOf(r.athlete_id))} · ${esc(engineLabel(r.scan_engine))}</b>
        <span>Given ${esc(fmtDate(r.granted_at.slice(0, 10)))} · deletes
          ${esc(fmtDate(r.retention_until))}</span></div>
      <button class="btn sm ghost" data-revoke="${esc(r.athlete_id)}" data-engine="${esc(r.scan_engine)}">Withdraw</button>
    </div>`).join(''));

  host.querySelectorAll('[data-revoke]').forEach(btn => {
    const athleteId = btn.getAttribute('data-revoke'), engineId = btn.getAttribute('data-engine');
    btn.onclick = () => confirmWithdrawScan(athleteId, engineId, nameOf(athleteId), engineLabel(engineId));
  });
}

function confirmWithdrawScan(athleteId, engineId, name, label){
  const low = (label || 'scan').toLowerCase();
  const bg = sheet(H`<h3>Withdraw ${esc(low)} permission for ${esc(name)}?</h3>
    <p style="font-size:14.5px;line-height:1.6;margin:8px 0 0">No new ${esc(low)} can be started for ${esc(name)}
      until you give permission again. It takes effect immediately, including on any other phone with one
      part-way through.</p>
    <div class="teach" style="margin-top:14px"><div class="ic">📊</div><div>
      <h4>Measurements already saved stay</h4>
      <p>They are in ${esc(name)}'s Growth with everything else, and are deleted the same way — from Growth,
      one at a time, or by deleting the profile. Withdrawing permission stops new ones; it does not quietly
      erase the record you have been keeping.</p></div></div>
    <div class="row2" style="margin-top:16px">
      <button class="btn ghost" id="wdNo">Keep it</button>
      <button class="btn danger" id="wdYes">Withdraw</button>
    </div>`);
  bg.querySelector('#wdNo').onclick = () => bg.remove();
  bg.querySelector('#wdYes').onclick = async e => {
    e.target.innerHTML = '<span class="spinner"></span>'; e.target.disabled = true;
    const { error } = await sb.from('biometric_consents')
      .update({ revoked_at: new Date().toISOString(), revoked_by: state.user.id })
      .eq('athlete_id', athleteId).eq('scan_engine', engineId).is('revoked_at', null);
    if(error){
      console.error(error); toast('Could not withdraw that');
      e.target.innerHTML = 'Withdraw'; e.target.disabled = false; return;
    }
    bg.remove(); toast('Withdrawn'); fillScanConsents();
  };
}
