// ===================================================================
//  GROWTH & MATURATION — arithmetic, not a body scan
// ===================================================================
// The commercial version of this is a body-AI platform: four photos, a 3D avatar,
// body composition, predicted height. The scanner is their moat. The part that
// actually changes how a parent reads a season is published science that runs on a
// tape measure, and that is what this file is.
//
// Nothing here touches a photo, a body-composition estimate, or a biometric
// identifier. Body scans of minors are regulated biometric data — Illinois BIPA and
// several state analogues carry a private right of action — and collecting them
// would also reverse this product's own "no weight suggested under 13" decision.
//
// EVERY function returns a range or a null, never a bare confident number. The
// failure mode that matters is a parent reading a point estimate as a promise.

const MATURITY_SOURCES = {
  mph:  'Tanner mid-parental height',
  rae:  'Relative age effect',
};

// ---- 1. Predicted adult height -----------------------------------------------
// Tanner mid-parental height. Exact published formula:
//   boys  ((mother + 13cm) + father) / 2
//   girls ((father - 13cm) + mother) / 2
// 13cm = 5.118in, the average adult sex difference in stature.
//
// This is the CRUDE method, and the band says so. The more accurate non-invasive
// method (Khamis-Roche, ~±2.2cm for half of boys) needs age-and-sex-specific
// regression coefficients from a 1994 paper plus its 1995 erratum, AND it needs the
// child's weight. Neither is available here, and inventing coefficients for a number
// about someone's child is not a thing to do.
const SEX_DIFF_IN = 5.118;   // 13 cm
// Mirrors the CHECK on athletes.mother_height_in / father_height_in. Bounds rather
// than isFinite() because Number(null) is 0 and isFinite(0) is true — a single
// missing parent height would otherwise compute a predicted adult height of 2'10"
// and present it as a real number.
const PARENT_H_MIN = 48, PARENT_H_MAX = 84;
const usableHeight = v => { const n = Number(v);
  return (v!==null && v!=='' && isFinite(n) && n>=PARENT_H_MIN && n<=PARENT_H_MAX) ? n : null; };
function midParentalHeight(motherIn, fatherIn, sex){
  const m = usableHeight(motherIn), f = usableHeight(fatherIn);
  if(m===null || f===null || (sex!=='male' && sex!=='female')) return null;
  const mid = sex==='male' ? ((m + SEX_DIFF_IN) + f) / 2
                           : ((f - SEX_DIFF_IN) + m) / 2;
  // Tanner carries roughly ±3.3in at 2SD. Reporting the midpoint alone would imply a
  // precision the method does not have — a four-inch spread is the honest answer.
  return { mid, lo: mid - 3.3, hi: mid + 3.3, method:'tanner', sd2: 3.3 };
}

// ---- 2. Percentage of adult height attained ----------------------------------
// Current height as a share of predicted adult height. In sports science this is the
// standard NON-INVASIVE maturity proxy, used where a hand X-ray isn't available.
//
// DELIBERATELY NOT BANDED into early / on-time / late. The published work reaching
// that classification routes through skeletal age (on time = within ±1.0 year of
// chronological age), and does not give age-by-sex cut-points for banding straight
// off this percentage. Shipping invented thresholds would be a confident-sounding
// fabrication in the one place it does the most damage. The number and its direction
// of travel are real; the label would not be.
function pctAdultHeight(currentIn, predicted){
  const c = Number(currentIn);
  if(!predicted || !isFinite(c) || !predicted.mid) return null;
  const pct = (c / predicted.mid) * 100;
  if(!(pct > 20 && pct <= 100.5)) return null;   // nonsense guard
  return { pct,
           // The same spread carried through, so the reader sees a range not a point.
           lo: (c / predicted.hi) * 100,
           hi: (c / predicted.lo) * 100 };
}

// ---- 3. Relative age ---------------------------------------------------------
// The best-evidenced, least-known thing a youth sports parent can be told, and it
// needs no reference table at all — just the birthdate and the league's cut-off.
//
// A child born just before the cut-off is up to eleven months younger than a
// teammate born just after it. At six years old that is fifteen percent more life.
// Coaches read the resulting size and coordination gap as talent, the younger child
// gets less playing time, and quits. It is the most preventable dropout cause in
// youth sport and it is pure arithmetic.
//
// `cutoffMD` is 'MM-DD'. Null means the league's cut-off is unknown, and the honest
// answer is to say nothing rather than assume one.
function relativeAge(birthdate, cutoffMD){
  if(!birthdate || !cutoffMD) return null;
  const bd = new Date(birthdate + 'T00:00:00');
  if(isNaN(bd)) return null;
  const [cm, cd] = cutoffMD.split('-').map(Number);
  if(!(cm >= 1 && cm <= 12 && cd >= 1 && cd <= 31)) return null;

  // Which twelve-month band this child falls in is a property of their BIRTHDATE and
  // the cut-off, not of today's date — a child stays the youngest in their band every
  // season of their childhood. Anchoring to today would put a six-year-old in the
  // band of infants born this year.
  let bandOpen = new Date(bd.getFullYear(), cm - 1, cd);
  if(bandOpen > bd) bandOpen.setFullYear(bandOpen.getFullYear() - 1);

  const monthsInto = (bd - bandOpen) / (30.44 * 86400000);
  if(monthsInto < 0 || monthsInto >= 12.5) return null;

  // Quartile within the window. Q1 is the oldest quarter, Q4 the youngest.
  const quartile = Math.min(4, Math.floor(monthsInto / 3) + 1);
  return { quartile,
           // Clamped to 11. The band is twelve months wide, so the largest true gap is
           // a day under a year — rounding 11.6 up to "12 months older" would overstate
           // it by claiming a full extra year of life.
           monthsYoungerThanOldest: Math.min(11, Math.floor(monthsInto)),
           bandOpens: `${String(cm).padStart(2,'0')}-${String(cd).padStart(2,'0')}`,
           isYoungest: quartile === 4, isOldest: quartile === 1 };
}

// ---- 4. Growth velocity ------------------------------------------------------
// Inches per year from the height history. This is the signal that already drives
// the week: during a spurt the plan gets LIGHTER, never heavier.
//
// Needs two readings at least ~120 days apart. Closer together and measurement
// noise — shoes on, different door frame, time of day — swamps the real change.
const MIN_SPAN_DAYS = 120;
function growthVelocity(rows){
  const pts = (rows||[])
    .filter(r => r && r.metric_key === 'height' && isFinite(Number(r.value)) && r.measured_on)
    .map(r => ({ v: Number(r.value), d: new Date(r.measured_on + 'T00:00:00') }))
    .filter(p => !isNaN(p.d))
    .sort((a, b) => b.d - a.d);
  if(pts.length < 2) return null;
  const latest = pts[0];
  // Walk back to the first reading far enough away to be meaningful.
  const prior = pts.find(p => (latest.d - p.d) / 86400000 >= MIN_SPAN_DAYS);
  if(!prior) return null;
  const days = (latest.d - prior.d) / 86400000;
  const gainIn = latest.v - prior.v;
  const inPerYear = gainIn * (365.25 / days);
  // Shrinking means somebody mis-measured, not that a child got shorter.
  if(inPerYear < -0.5 || inPerYear > 12) return null;
  return { inPerYear, gainIn, days, latestIn: latest.v, from: prior.d, to: latest.d };
}

// A spurt is the training-relevant state, and the threshold is deliberately blunt:
// roughly 3 inches a year is fast for any school-age child, and the response is the
// same regardless of exactly how fast — take load off and watch the knees and heels.
const SPURT_IN_PER_YEAR = 3.0;
function inGrowthSpurt(vel){ return !!(vel && vel.inPerYear >= SPURT_IN_PER_YEAR); }

// ---- 5. Assemble -------------------------------------------------------------
// One call, so the UI never has to know which pieces are available. Anything that
// cannot be computed comes back null and the card explains what is missing instead
// of guessing.
function maturityReport(athlete, heightRows, sportRow){
  const sex = athlete && athlete.sex_at_birth;
  const vel = growthVelocity(heightRows);
  const latestIn = vel ? vel.latestIn
    : (heightRows||[]).filter(r=>r&&r.metric_key==='height'&&isFinite(Number(r.value)))
        .map(r=>Number(r.value))[0];

  const predicted = midParentalHeight(athlete&&athlete.mother_height_in,
                                      athlete&&athlete.father_height_in, sex);
  const pct = (predicted && isFinite(latestIn)) ? pctAdultHeight(latestIn, predicted) : null;
  const rae = relativeAge(athlete&&athlete.birthdate, sportRow&&sportRow.age_cutoff_md);

  return {
    velocity: vel,
    spurt: inGrowthSpurt(vel),
    predicted, pctAdult: pct, relativeAge: rae,
    // What the parent would have to add to unlock the rest, in the order it helps.
    missing: [
      !sex && 'sex',
      !(athlete&&athlete.mother_height_in&&athlete.father_height_in) && 'parentHeights',
      !isFinite(latestIn) && 'height',
      !(sportRow&&sportRow.age_cutoff_md) && 'cutoff',
    ].filter(Boolean),
  };
}

// Feet/inches, because no American parent thinks in decimal inches.
function fmtHeightIn(v){
  if(!isFinite(v)) return '';
  const total = Math.round(v);
  return `${Math.floor(total/12)}′ ${total%12}″`;
}

// ===================================================================
//  THE CARD
// ===================================================================
// Ordered by what actually helps a parent, which is the reverse of what impresses:
// the growth spurt (changes this week's training), then relative age (changes how you
// read the whole season), then predicted height last and behind a tap, because it is
// the number most likely to be misread as a target.
function growthCard(mat, a){
  if(!mat) return '';
  const nm = esc(a.first_name);
  const v = mat.velocity, rae = mat.relativeAge, pred = mat.predicted, pct = mat.pctAdult;
  const bits = [];

  // 1. In a spurt right now — the one piece that changes today.
  if(mat.spurt && v){
    bits.push(H`<div class="teach" style="background:#EAF3F0;border-color:#CFE3DC"><div class="ic">📏</div><div>
      <h4>${nm} is growing fast right now</h4>
      <p><b>${v.inPerYear.toFixed(1)}″ a year</b> over the last ${Math.round(v.days/30)} months. Bone outruns the
      tendons attached to it during a stretch like this, so knees and heels get sore and coordination can go
      backwards for a while — both normal. The week already takes a session off rather than adding one.
      Pain just below the kneecap or at the back of the heel that lasts more than a couple of weeks is worth a
      doctor's look.</p></div></div>`);
  } else if(v){
    bits.push(H`<div class="mt-note"><b>${v.inPerYear.toFixed(1)}″ a year</b> — steady. We'll flag it here if that
      speeds up, because a growth spurt is when the plan should get lighter, not heavier.</div>`);
  }

  // 2. Relative age. No reference table, no model — a birthdate and a cut-off date.
  //    This is the thing nobody tells a youth sports parent.
  if(rae && (rae.isYoungest || rae.isOldest)){
    bits.push(rae.isYoungest
      ? H`<div class="teach" style="background:#EAF3F0;border-color:#CFE3DC"><div class="ic">🗓️</div><div>
          <h4>${nm} is one of the youngest on the field</h4>
          <p>Born in the last quarter before the cut-off, so teammates can be up to
          <b>${rae.monthsYoungerThanOldest} months older</b> — at this age that's a real gap in size and
          coordination, and it is routinely mistaken for talent. Kids in this quarter get less playing time,
          get told they're behind, and quit. They are not behind. Judge the effort, not the depth chart.</p>
          </div></div>`
      : H`<div class="teach" style="background:#EAF3F0;border-color:#CFE3DC"><div class="ic">🗓️</div><div>
          <h4>${nm} is one of the oldest on the field</h4>
          <p>Born just after the cut-off, so ${nm} can be up to a year older than teammates. That usually
          looks like an edge at this age and it evens out. Worth knowing so early wins get read as a head
          start rather than a ceiling.</p></div></div>`);
  }

  // 3. Predicted adult height, last and folded away.
  if(pred && pct){
    bits.push(H`<div class="refbar" id="phToggle" role="button" tabindex="0" aria-expanded="false" aria-controls="phList">
        <div class="gi">📐</div>
        <div class="gt"><b>Predicted adult height</b><span>A range, not a number — tap if you want it</span></div>
        <span class="pill"><i class="caret">›</i></span>
      </div>
      <div id="phList" hidden>
        <div class="card app-pad">
          <div style="font-family:'Archivo';font-weight:900;font-size:26px;letter-spacing:-.02em">
            ${esc(fmtHeightIn(pred.lo))} – ${esc(fmtHeightIn(pred.hi))}</div>
          <p style="font-size:13px;color:var(--muted);margin:8px 0 0;line-height:1.55">
            ${nm} is about <b>${Math.round(pct.pct)}%</b> of the way there. This is the mid-parental method —
            the parents' own heights and nothing measured off your child. It is a wide, rough estimate: two children
            with identical parents can finish more than six inches apart, and the range above is the honest
            width of it.</p>
          <p style="font-size:12.5px;color:var(--muted);margin:10px 0 0;line-height:1.55">
            It is not a target, and not a prediction of what your child can do. Plenty of the best athletes in every
            sport finished shorter than this estimate.</p>
        </div>
      </div>`);
  }

  if(!bits.length) return '';
  return H`<div class="sec-title" style="margin-top:22px">Growing</div>${bits.join('')}`;
}

// What the parent still has to add, phrased as one ask rather than a list of gaps.
function growthPrompt(mat){
  if(!mat || !mat.missing.length) return '';
  const need = mat.missing;
  if(need.includes('height')) return '';   // Measurements already asks for this
  const wantsParents = need.includes('parentHeights') || need.includes('sex');
  if(!wantsParents) return '';
  return H`<div class="card app-pad" id="growAsk" style="cursor:pointer;margin-top:12px">
    <div class="grow" style="border:none;padding:0"><div class="gi">📐</div>
      <div class="gt"><b>Want the growth read?</b>
        <span>Add both parents' heights and we'll show where they're at — no photos, no scans.</span></div>
      <span class="pill">Add ›</span></div></div>`;
}

// The only thing this feature ever asks for: the two parents' own adult heights, the
// child's sex (every growth reference is sex-specific — there is no correct
// sex-neutral version of this maths), and optionally the league's age cut-off.
// Deliberately NOT in onboarding: it is asked once, in Growth, after the parent has
// seen why it matters.
function openGrowthInputs(cur, sportRow, onSaved){
  const c = cur || {};
  const inToFt = v => (v==null||v==='') ? '' : v;
  const bg = sheet(H`<h3>The growth read</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">Both parents' heights and we can show where
      ${esc(state.active.first_name)} is on their own curve. Nothing is measured off your child — no photo, no scan.</p>

    <div class="field"><label>${esc(state.active.first_name)}'s sex at birth</label>
      <div class="chipgrid two" id="gxSex">
        <div class="chip ${c.sex_at_birth==='male'?'on':''}" data-v="male">Male</div>
        <div class="chip ${c.sex_at_birth==='female'?'on':''}" data-v="female">Female</div>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Growth charts and the height formula are
        different for boys and girls — there's no accurate way to skip this one.</p></div>

    <div class="row2">
      <div class="field"><label>Birth mother's height (inches)</label>
        <input id="gxM" inputmode="decimal" placeholder="e.g. 64" value="${esc(inToFt(c.mother_height_in))}"/></div>
      <div class="field"><label>Birth father's height (inches)</label>
        <input id="gxF" inputmode="decimal" placeholder="e.g. 70" value="${esc(inToFt(c.father_height_in))}"/></div>
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:-6px 2px 14px">5′4″ is 64. 5′10″ is 70. Estimates are fine —
      the result is a range either way.</p>

    <div class="field"><label>League age cut-off (optional)</label>
      <input id="gxC" placeholder="MM-DD — e.g. 08-01" value="${esc(sportRow&&sportRow.age_cutoff_md||'')}"/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">The date the league uses to set age groups.
        It's on the registration form. Without it we don't guess.</p></div>

    <div class="err" id="gxErr"></div>
    <button class="btn amber" id="gxSave">Save</button>
    <p class="muted-note" style="margin-top:10px">General guidance, not medical advice.</p>`);

  bg.querySelectorAll('#gxSex .chip').forEach(el=>el.onclick=()=>{
    bg.querySelectorAll('#gxSex .chip').forEach(x=>x.classList.toggle('on',x===el)); });

  bg.querySelector('#gxSave').onclick=async e=>{
    const err=bg.querySelector('#gxErr'); err.textContent='';
    const sexEl=bg.querySelector('#gxSex .chip.on');
    const sex=sexEl?sexEl.dataset.v:null;
    const num=v=>{ const s=String(v||'').trim(); if(!s) return null;
                   const n=Number(s); return isFinite(n)?n:NaN; };
    const m=num(bg.querySelector('#gxM').value), f=num(bg.querySelector('#gxF').value);
    const cut=String(bg.querySelector('#gxC').value||'').trim();

    if(Number.isNaN(m)||Number.isNaN(f)) { err.textContent='Heights need to be numbers, in inches.'; return; }
    // Reject out-of-range rather than storing it — the DB constraint would refuse
    // anyway, and a clear sentence beats a Postgres error.
    for(const [v,who] of [[m,'mother'],[f,'father']])
      if(v!==null && (v<48||v>84)) { err.textContent=`That ${who}'s height looks off — we expect inches, roughly 48 to 84.`; return; }
    if(cut && !/^\d{2}-\d{2}$/.test(cut)) { err.textContent='Cut-off should look like 08-01 (month-day).'; return; }

    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const upd={};
    if(sex) upd.sex_at_birth=sex;
    if(m!==null) upd.mother_height_in=m;
    if(f!==null) upd.father_height_in=f;
    if(Object.keys(upd).length){
      const { error }=await sb.from('athletes').update(upd).eq('id',state.active.id);
      if(error){ console.error(error); err.textContent='Could not save. '+(error.message||'');
                 e.target.innerHTML='Save'; e.target.disabled=false; return; }
    }
    if(cut && sportRow && sportRow.sport_key){
      const { error }=await sb.from('athlete_sports').update({age_cutoff_md:cut})
        .eq('athlete_id',state.active.id).eq('sport_key',sportRow.sport_key);
      if(error) console.error(error);   // non-fatal: relative age just stays hidden
    }
    bg.remove();
    if(typeof onSaved==='function') onSaved(); else renderApp('growth');
  };
}
