// POSITION_SKILLS hardcodes position codes that must match `positions.code`. A drifted
// code is skipped silently in skillsFor — the athlete just quietly falls back to generic
// drills with nothing logged anywhere. Make the drift loud in the console instead.
function auditPositionCodes(rows){
  try{
    if(typeof POSITION_SKILLS==='undefined') return;
    const missing=[];
    (rows||[]).forEach(p=>{
      const map=POSITION_SKILLS[p.sport_key];
      if(map && !map[p.code]) missing.push(p.sport_key+'.'+p.code);
    });
    if(missing.length) console.warn('[playbook] positions with no drills in POSITION_SKILLS — these athletes fall back to generic content:', missing.join(', '));
  }catch(e){ /* diagnostic only, never break boot */ }
}

async function loadRef(){
  if(state.ref) return state.ref;
  const [sports,positions,metrics,drills] = await Promise.all([
    sb.from('sports').select('*').eq('selectable',true).order('sort'),
    sb.from('positions').select('*').order('sort'),
    sb.from('metrics').select('*').order('sort'),
    // Curated training content. Unlike the three above, an empty result here is fine —
    // the hardcoded library in program.js is the fallback, so the app works either way.
    sb.from('drills').select('*').eq('status','published').order('sort'),
  ]);
  if(drills.error){ console.error(drills.error); }   // non-fatal: fall back to the built-in library
  state.drills = (drills.data||[]).map(drillFromRow);
  const err = sports.error||positions.error||metrics.error;
  if(err){ console.error(err); throw err; }   // don't cache a failed load — allow a retry this session
  // These tables are readable only by `authenticated`, so an expired session comes back
  // as zero rows with NO error. Caching that would leave onboarding showing an empty
  // sport list and no way forward — treat it as a failure so the caller can retry.
  if(!(sports.data||[]).length){ const e=new Error('Reference data unavailable — session may have expired.'); console.error(e); throw e; }
  state.ref = { sports:sports.data||[], positions:positions.data||[], metrics:metrics.data||[] };
  auditPositionCodes(state.ref.positions);
  return state.ref;
}

