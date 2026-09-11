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
  offset: 'Mirwald et al. 2002 combined-sample maturity-offset equation',
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
  // A child taller than the midpoint of their own prediction is ordinary, not nonsense.
  // The midpoint is a mean, so about half of children finish above it, and a sixteen- or
  // seventeen-year-old sitting above it is the common case rather than the strange one.
  // The old ceiling of 100.5 returned null there, and the caller renders this card only
  // `if(pred && pct)` — so a parent who had entered both their own heights watched the
  // whole card vanish with nothing said. Silence is the one answer this file is not
  // allowed to give.
  //
  // 125 is still a guard, against a mistyped parent height rather than against a tall
  // child: no real child is a quarter taller than their own predicted adult height.
  if(!(pct > 20 && pct <= 125)) return null;
  return { pct,
           // The same spread carried through, so the reader sees a range not a point.
           lo: (c / predicted.hi) * 100,
           hi: (c / predicted.lo) * 100,
           // Lets the card say "already past the middle of this estimate" instead of the
           // nonsense phrasing "about 102% of the way there".
           atOrAbovePrediction: pct >= 100 };
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

// ---- 5. Estimated maturity offset ------------------------------------------
// Mirwald et al., Med Sci Sports Exerc. 2002;34(4):689-694,
// DOI 10.1097/00005768-200204000-00020. These are the paper's recommended
// combined-sample equations. Units are centimeters, kilograms and decimal years.
// Later independent validation found meaningful bias for early/late maturers and
// limited individual utility, so the UI carries a ±1-year band and never uses this
// value to rank a child, diagnose puberty or prescribe training load.
function decimalAge(birthdate, measuredOn){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birthdate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn||''))return null;
  const born=new Date(birthdate+'T00:00:00Z'),measured=new Date(measuredOn+'T00:00:00Z');
  if(!Number.isFinite(born.getTime())||!Number.isFinite(measured.getTime())||born.toISOString().slice(0,10)!==birthdate||measured.toISOString().slice(0,10)!==measuredOn||measured<=born)return null;
  return (measured-born)/(365.2425*86400000);
}
function maturityOffsetEstimate({sex,birthdate,measuredOn,heightIn,sittingHeightIn,weightLb}={}){
  const age=decimalAge(birthdate,measuredOn),height=Number(heightIn)*2.54,sitting=Number(sittingHeightIn)*2.54,mass=Number(weightLb)*.45359237;
  if(!['male','female'].includes(sex)||!Number.isFinite(age)||age<8||age>16||![height,sitting,mass].every(Number.isFinite)||height<100||height>215||sitting<45||sitting>=height||mass<20||mass>180)return null;
  const leg=height-sitting,ratio=mass/height*100;
  if(leg<40||leg>125||sitting/height<.4||sitting/height>.65)return null;
  const offset=sex==='male'
    ? -9.236+.0002708*(leg*sitting)-.001663*(age*leg)+.007216*(age*sitting)+.02292*ratio
    : -9.376+.0001882*(leg*sitting)+.0022*(age*leg)+.005841*(age*sitting)-.002658*(age*mass)+.07693*ratio;
  if(!Number.isFinite(offset)||offset< -6||offset>6)return null;
  const ageAtPhv=age-offset;
  return {protocol:'mirwald-maturity-offset-v1',method:'mirwald-combined-2002',measuredOn,sex,
    ageYears:Math.round(age*100)/100,offsetYears:Math.round(offset*100)/100,ageAtPhvYears:Math.round(ageAtPhv*100)/100,
    uncertaintyYears:1,category:offset < -1?'estimated_pre_phv':offset > 1?'estimated_post_phv':'estimated_near_phv',
    inputs:{heightIn:Number(heightIn),sittingHeightIn:Number(sittingHeightIn),weightLb:Number(weightLb)}};
}
function maturityInputBatch(rows){
  const groups=new Map();
  for(const row of rows||[]){
    let note;try{note=JSON.parse(row?.note||'');}catch{continue;}
    if(note?.schema!=='PP_MATURITY_INPUT_V1'||typeof note.batchId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(note.batchId)||!['height','sitting_height','weight'].includes(row.metric_key)||row.source!=='manual'||!/^\d{4}-\d{2}-\d{2}$/.test(row.measured_on||''))continue;
    const group=groups.get(note.batchId)||{batchId:note.batchId,measuredOn:row.measured_on,createdAt:row.created_at||''};
    if(group.measuredOn!==row.measured_on||group[row.metric_key]){group.invalid=true;}else group[row.metric_key]=row;
    if((row.created_at||'')>group.createdAt)group.createdAt=row.created_at;
    groups.set(note.batchId,group);
  }
  return [...groups.values()].filter(g=>!g.invalid&&g.height&&g.sitting_height&&g.weight)
    .sort((a,b)=>b.measuredOn.localeCompare(a.measuredOn)||b.createdAt.localeCompare(a.createdAt))[0]||null;
}

// ---- 6. Assemble -------------------------------------------------------------
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
  const batch=maturityInputBatch(heightRows);
  const offset=batch?maturityOffsetEstimate({sex,birthdate:athlete&&athlete.birthdate,measuredOn:batch.measuredOn,
    heightIn:batch.height.value,sittingHeightIn:batch.sitting_height.value,weightLb:batch.weight.value}):null;

  // Height against the CDC reference for age and sex. This is the piece that turns a
  // measurement into something a parent can act on — "48 inches" is data, "48th
  // percentile" is meaning, and a percentile CROSSING is the bit a doctor asks about.
  const track = (typeof percentileTrack === 'function')
    ? percentileTrack(heightRows, athlete && athlete.birthdate, sex) : null;

  return {
    velocity: vel, maturityOffset:offset,
    spurt: inGrowthSpurt(vel),
    sex, predicted, pctAdult: pct, relativeAge: rae, track,
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


// ---------------------------------------------------------------------------
//  DIAGRAMS — stroke-only line art, redrawn rather than embedded
// ---------------------------------------------------------------------------
// All of these are outline only. This is a description of a child's body, and a
// filled, coloured, gym-styled chart would make it read as a score.

// A normal curve with the child's position marked. The curve is IDENTICAL on
// every screen — only the marker moves — which is the whole point: it shows a
// position in a population, not an achievement. Deliberately not a gauge, dial
// or progress bar; a growth chart has no "full" end.
function pctCurveSVG(pct){
  const W = 260, H = 62, pad = 10;
  // z from -2.5 to +2.5 maps across the width; 3rd/50th/97th land at -1.88/0/+1.88.
  const zOf = p => { const c = Math.min(99.4, Math.max(0.6, p)) / 100;
    // crude inverse-normal, good to ~0.02 across the drawn range
    const t = Math.sqrt(-2 * Math.log(c < 0.5 ? c : 1 - c));
    const z = t - (2.30753 + 0.27061*t) / (1 + 0.99229*t + 0.04481*t*t);
    return c < 0.5 ? -z : z; };
  const x = z => pad + ((z + 2.5) / 5) * (W - pad*2);
  const y = z => H - 4 - Math.exp(-0.5*z*z) * (H - 14);
  let d = '';
  for(let i = 0; i <= 60; i++){ const z = -2.5 + (i/60)*5;
    d += (i ? 'L' : 'M') + x(z).toFixed(1) + ' ' + y(z).toFixed(1); }
  const mz = zOf(pct), mx = x(mz), my = y(mz);
  return `<svg class="pct-curve" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Height for age, ${Math.round(pct)}th percentile on a normal distribution">
    <path class="bell" d="${d}"/>
    <line class="mark" x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${H-4}"/>
    <circle class="dot" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4"/>
  </svg>`;
}

// Two points and the line between them. The entire story is "it moved", so the
// diagram is two dots — older muted, newer green — and nothing else.
function crossSparkSVG(fromPct, toPct){
  const W = 78, H = 44, pad = 6;
  const y = p => H - pad - (Math.min(100, Math.max(0, p)) / 100) * (H - pad*2);
  const y1 = y(fromPct), y2 = y(toPct), x1 = pad, x2 = W - pad;
  const cx = (x1 + x2) / 2;
  return `<svg class="cross-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path class="ln" d="M${x1} ${y1.toFixed(1)} Q${cx} ${y1.toFixed(1)} ${cx} ${((y1+y2)/2).toFixed(1)} T${x2} ${y2.toFixed(1)}"/>
    <circle class="old" cx="${x1}" cy="${y1.toFixed(1)}" r="3.5"/>
    <circle class="new" cx="${x2}" cy="${y2.toFixed(1)}" r="4.5"/>
  </svg>`;
}

// Four equal segments — the four quarters of the cut-off year — with the child's
// quarter filled and dotted. Q1 is the oldest, so the band reads oldest to
// youngest left to right and the marker simply moves.
function raBandSVG(quartile){
  return `<div class="ra-band" role="img" aria-label="Born in quarter ${quartile} of four, oldest to youngest">
    ${[1,2,3,4].map(q=>`<i class="${q===quartile?'on':''}"></i>`).join('')}
  </div>
  <div class="ra-ends"><span>Oldest quarter</span><span>Youngest quarter</span></div>`;
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
  const v = mat.velocity, rae = mat.relativeAge, pred = mat.predicted, pct = mat.pctAdult, offset=mat.maturityOffset;
  const tr = mat.track;
  const bits = [];

  // 1. Height for age — a position on a distribution.
  if(tr && tr.latest){
    const p = Math.round(tr.latest.pct);
    bits.push(H`<div class="pct-card">
      <div class="k">Height for age</div>
      <h4>${esc(ordinalPct(tr.latest.pct))} percentile</h4>
      ${pctCurveSVG(tr.latest.pct)}
      <div class="pct-axis"><span>3rd</span><span>50th</span><span>97th</span></div>
      <p>Taller than about ${p} out of every 100 ${esc(mat.sex==='female'?'girls':'boys')} the same age, on the
        CDC growth chart. A description, not a score — the 20th and the 80th are both completely normal places
        to be.</p>
    </div>`);
  }

  // 2. Crossing — mounts only when the rule fires, so its absence leaves no gap.
  if(tr && tr.crossed && tr.prior){
    bits.push(H`<div class="cross-card">
      <div class="cross-top">
        ${crossSparkSVG(tr.prior.pct, tr.latest.pct)}
        <div><b>${esc(ordinalPct(tr.prior.pct))} → ${esc(ordinalPct(tr.latest.pct))}</b>
          <span>over ${tr.crossed.months} months</span></div>
      </div>
      <p>${nm} has moved from the ${esc(ordinalPct(tr.prior.pct))} to the ${esc(ordinalPct(tr.latest.pct))}.
        Children normally track along roughly the same line, so a shift this size is worth mentioning at the
        next check-up — ${tr.crossed.dir==='up'
          ? "usually it's simply a growth spurt arriving."
          : "often it just means the spurt hasn't started yet."}</p>
    </div>`);
  }

  // 3. Growth spurt — the app's existing amber teach card, reused rather than a new
  //    type. The doctor sentence is bold and never collapsed: it is the one line here
  //    with a real-world consequence.
  if(mat.spurt && v){
    bits.push(H`<div class="teach" style="margin-top:10px"><div class="ic">📏</div><div>
      <h4>Growing fast right now</h4>
      <p>${v.inPerYear.toFixed(1)}″ a year. Bone outruns the tendons attached to it during a stretch like this,
      so knees and heels get sore and coordination can go backwards for a while — both normal. This week already
      takes a session off rather than adding one. <b>Pain just below the kneecap or at the back of the heel that
      lasts more than a couple of weeks is worth a doctor's look.</b></p></div></div>`);
  } else if(v){
    bits.push(H`<div class="mt-note" style="margin-top:10px"><b>${v.inPerYear.toFixed(1)}″ a year</b> — steady.
      We'll flag it here if that speeds up, because a growth spurt is when the plan should get lighter, not
      heavier.</div>`);
  }

  if(offset){
    const timing=offset.category==='estimated_pre_phv'
      ? `about ${Math.abs(offset.offsetYears).toFixed(1)} years before peak height velocity`
      : offset.category==='estimated_post_phv'
        ? `about ${offset.offsetYears.toFixed(1)} years after peak height velocity`
        : 'within about one year of peak height velocity';
    bits.push(H`<div class="card app-pad" style="margin-top:10px">
      <div class="k-mono" style="color:var(--clay-ink)">Estimated growth-spurt timing</div>
      <h4 style="margin:8px 0">${esc(timing)}</h4>
      <p>Anthropometric maturity-offset estimate from standing height, sitting height, body mass and age recorded together on ${esc(fmtDate(offset.measuredOn))}. The calculated offset is ${esc(offset.offsetYears.toFixed(1))} years and estimated age at peak height velocity is ${esc(offset.ageAtPhvYears.toFixed(1))}, with a displayed uncertainty band of at least ±1 year.</p>
      <p><b>Use this as context only.</b> The equation can miss early and late maturers, does not diagnose puberty and does not change ${nm}'s training plan automatically.</p>
    </div>`);
  }

  // 4. Relative age — both directions, same layout, marker flips ends.
  if(rae && (rae.isYoungest || rae.isOldest)){
    bits.push(H`<div class="ra-card">
      <div class="k-mono" style="color:var(--clay-ink)">Where ${nm} falls in the age band</div>
      ${raBandSVG(rae.quartile)}
      <p>${rae.isYoungest
        ? H`Born in the last quarter before the cut-off, so teammates can be up to
            ${rae.monthsYoungerThanOldest} months older — at this age that's a real gap in size and coordination,
            and it's routinely mistaken for talent. ${nm} is not behind. Judge the effort, not the depth chart.`
        : H`Born in the first quarter after the cut-off, so some teammates can be up to
            ${11-rae.monthsYoungerThanOldest} months younger — size and coordination that look like a head start
            are often just a birthdate. Easy to mistake for being ahead. Judge the effort, not the calendar.`}</p>
    </div>`);
  }

  // 5. Predicted adult height — subordinate, collapsed, always a range.
  if(pred && pct){
    bits.push(H`<div class="ph-row" id="phToggle" role="button" tabindex="0" aria-expanded="false" aria-controls="phBody">
        <div class="gi">📐</div>
        <div class="gt"><b>Predicted adult height</b><span>Not a target. Tap to see the range.</span></div>
        <i class="caret">›</i>
      </div>
      <div class="ph-body" id="phBody" hidden>
        <div class="rng">${esc(fmtHeightIn(pred.lo))} – ${esc(fmtHeightIn(pred.hi))}</div>
        <p>${pct.atOrAbovePrediction
            ? H`${nm} has already passed the middle of this estimate. That is common — the midpoint is an
                average, so about half of children finish above it, and it was never a ceiling.`
            : H`${nm} is about ${Math.round(pct.pct)}% of the way there.`} Mid-parental method — the parents' own
          heights, nothing measured off your child. Two children with identical parents can finish more than six
          inches apart, and the range above is the honest width of that. It is not a target, and not a prediction
          of what your child can do.</p>
      </div>`);
  }

  if(!bits.length) return '';
  return H`<div class="sec-title" style="margin-top:22px">Growing</div>${bits.join('')}`;
}

// What the parent still has to add, phrased as one ask rather than a list of gaps.
function growthPrompt(mat){
  if(!mat || !mat.missing.length) return '';
  const need = mat.missing;
  // No longer gated on height: the prompt is the only place the growth read is
  // announced, and an athlete with no measurements is exactly who needs to see it.
  const wantsParents = need.includes('parentHeights') || need.includes('sex');
  if(!wantsParents) return '';
  return H`<div class="card app-pad" id="growAsk" style="cursor:pointer;margin-top:12px">
    <div class="grow" style="border:none;padding:0"><div class="gi">📐</div>
      <div class="gt"><b>Want the growth read?</b>
        <span>Add both parents' heights and we'll show where they're at — no photos, no scans.</span></div>
      <span class="pill">Add ›</span></div></div>`;
}

function maturityOffsetPrompt(mat,a){
  const age=ageFrom(a&&a.birthdate);
  if(!state.canEdit||age==null||age<8||age>16)return '';
  return H`<div class="card app-pad" id="phvEstimate" style="cursor:pointer;margin-top:12px">
    <div class="grow" style="border:none;padding:0"><div class="gi">↗</div>
      <div class="gt"><b>${mat&&mat.maturityOffset?'Update':'Estimate'} growth-spurt timing</b>
        <span>Manual standing height, sitting height and body mass · no photos</span></div>
      <span class="pill">${mat&&mat.maturityOffset?'Update':'Start'} ›</span></div></div>`;
}

function openMaturityInputs(athlete,rows,onSaved){
  const existing=maturityInputBatch(rows),value=key=>existing?existing[key].value:'';
  const bg=sheet(H`<h3>Estimate growth-spurt timing</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">For ages 8–16. Record all three measurements together. This uses the published Mirwald maturity-offset equation; it is not a scan or a puberty diagnosis.</p>
    <div class="field"><label>Standing height, shoes off (inches)</label><input id="moHeight" inputmode="decimal" value="${esc(value('height'))}" placeholder="e.g. 62.5"></div>
    <div class="field"><label>Sitting height on a hard box (inches)</label><input id="moSitting" inputmode="decimal" value="${esc(value('sitting_height'))}" placeholder="e.g. 32.0"><p class="muted-note">Sit tall against a wall; measure from the hard sitting surface to the top of the head.</p></div>
    <div class="field"><label>Body mass (lb)</label><input id="moWeight" inputmode="decimal" value="${esc(value('weight'))}" placeholder="e.g. 105"><p class="muted-note">Used only as one input to this estimate. Do not use the result to set weight goals.</p></div>
    <div class="err" id="moErr"></div><button class="btn amber" id="moSave">Save measurements and estimate</button>
    <p class="muted-note">The original verification error was about 0.65–0.68 years, and later validation found substantial individual bias for early and late maturers. We display at least ±1 year and do not use the estimate to rank athletes or prescribe training.</p>`);
  bg.querySelector('#moSave').onclick=async e=>{
    const read=id=>Number(String(bg.querySelector(id).value||'').trim()),measuredOn=new Date().toISOString().slice(0,10);
    const heightIn=read('#moHeight'),sittingHeightIn=read('#moSitting'),weightLb=read('#moWeight');
    const estimate=maturityOffsetEstimate({sex:athlete&&athlete.sex_at_birth,birthdate:athlete&&athlete.birthdate,measuredOn,heightIn,sittingHeightIn,weightLb});
    if(!estimate){bg.querySelector('#moErr').textContent='Check the profile sex at birth and enter plausible standing height, sitting height and body mass for an athlete age 8–16.';return;}
    e.target.disabled=true;e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>';
    const batchId=uuid(),note=JSON.stringify({schema:'PP_MATURITY_INPUT_V1',batchId,method:'parent_manual_same_session'});
    const inserts=[['height',heightIn,'in'],['sitting_height',sittingHeightIn,'in'],['weight',weightLb,'lb']].map(([metric_key,value,unit])=>({id:uuid(),athlete_id:state.active.id,metric_key,value,unit,measured_on:measuredOn,source:'manual',created_by:state.user.id,note}));
    const {error}=await sb.from('measurements').insert(inserts);
    if(error){console.error(error);bg.querySelector('#moErr').textContent='Could not save the measurements. '+(error.message||'');e.target.disabled=false;e.target.textContent='Save measurements and estimate';return;}
    bg.remove();if(typeof onSaved==='function')onSaved();else renderApp('growth');
  };
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
        <div class="chip ${c.sex_at_birth==='male'?'on':''}" role="button" tabindex="0" data-v="male">Male</div>
        <div class="chip ${c.sex_at_birth==='female'?'on':''}" role="button" tabindex="0" data-v="female">Female</div>
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

    <div class="field"><label>${esc(state.active.first_name)}'s height today (inches)</label>
      <input id="gxH" inputmode="decimal" placeholder="e.g. 48"/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Shoes off, heels to the wall.
        One reading gives a percentile; a second one a few months later is what shows the trend.</p></div>

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

    e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled=true;
    const upd={};
    if(sex) upd.sex_at_birth=sex;
    if(m!==null) upd.mother_height_in=m;
    if(f!==null) upd.father_height_in=f;
    if(Object.keys(upd).length){
      const { error }=await sb.from('athletes').update(upd).eq('id',state.active.id);
      if(error){ console.error(error); err.textContent='Could not save. '+(error.message||'');
                 e.target.innerHTML='Save'; e.target.disabled=false; return; }
    }
    const hIn = num(bg.querySelector('#gxH').value);
    if(!Number.isNaN(hIn) && hIn !== null){
      if(hIn < 20 || hIn > 84){
        err.textContent = "That height looks off — we expect inches, roughly 20 to 84.";
        e.target.innerHTML='Save'; e.target.disabled=false; return;
      }
      // Written to `measurements`, not somewhere new — the trend bars, the velocity and
      // the percentile track all read that table already.
      const { error }=await sb.from('measurements').insert({
        athlete_id:state.active.id, metric_key:'height', value:hIn, unit:'in',
        measured_on:new Date().toISOString().slice(0,10), source:'manual',
        created_by:state.user.id });
      if(error) console.error(error);   // non-fatal: the rest of the save still stands
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
