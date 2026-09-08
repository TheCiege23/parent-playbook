// ===================================================================
//  POP WARNER — the national Age/Weight Matrix, and what it can honestly say
// ===================================================================
// Source: Pop Warner Little Scholars, Inc.'s official Age/Weight Matrix. Division
// eligibility by age and weight is set NATIONALLY and has been stable in shape across
// seasons (only the birth-date cutoffs shift each year) — verify against the current
// season's matrix at popwarner.com if that ever changes underneath this table.
//
// This file answers exactly one question honestly: which division does this age and
// weight qualify for. It does NOT know a specific league's ball-carrier weight limit —
// the rule that a player over a threshold plays line-only (often enforced through a
// local "X-Man" stripe or sticker system) is real and widespread, but the THRESHOLD is
// set by the local league or conference, not nationally. Two real leagues checked
// while building this disagreed with each other (130 lb vs. 125 lb for adjacent
// divisions). Inventing a number here would be worse than not having the feature — see
// athlete_sports.pw_ball_carrier_lb, which a parent fills in from their own league
// instead of this file guessing at it.
const PW_DIVISIONS = [
  { key:'tiny_mite',  label:'Tiny-Mite',   ageMin:5,  ageMax:7,  wMin:35,  wMax:80  },
  { key:'mitey_mite', label:'Mitey-Mite',  ageMin:7,  ageMax:9,  wMin:45,  wMax:105 },
  { key:'jr_pee_wee', label:'Jr. Pee Wee', ageMin:8,  ageMax:10, wMin:60,  wMax:120, olAge:11, olWMin:60,  olWMax:100 },
  { key:'pee_wee',    label:'Pee Wee',     ageMin:9,  ageMax:11, wMin:75,  wMax:135, olAge:12, olWMin:75,  olWMax:115 },
  { key:'jr_varsity', label:'Jr. Varsity', ageMin:10, ageMax:12, wMin:90,  wMax:160, olAge:13, olWMin:90,  olWMax:140 },
  { key:'varsity',    label:'Varsity',     ageMin:12, ageMax:14, wMin:105, wMax:185, olAge:15, olWMin:105, olWMax:165 },
];

// Every division a given age+weight could play in — a child near a boundary often
// qualifies for more than one, and the matrix itself is explicit that placement is
// "possible ... depending upon weight," not automatic. Returns [] rather than a guess
// if either input is missing, and never rounds the weight — a scale doesn't either.
function pwEligibleDivisions(ageYears, weightLb){
  if(ageYears==null || weightLb==null || !isFinite(weightLb)) return [];
  const out=[];
  for(const d of PW_DIVISIONS){
    if(ageYears>=d.ageMin && ageYears<=d.ageMax && weightLb>=d.wMin && weightLb<=d.wMax)
      out.push({ ...d, via:'age' });
    else if(d.olAge!=null && ageYears===d.olAge && weightLb>=d.olWMin && weightLb<=d.olWMax)
      out.push({ ...d, via:'older-lighter' });
  }
  return out;
}

function pwDivisionRange(d, via){
  return via==='older-lighter' ? `${d.olWMin}–${d.olWMax} lb, older/lighter` : `${d.wMin}–${d.wMax} lb`;
}

// The position note is the one thing this file refuses to make up a number for. With a
// league limit on file it is a direct comparison; without one it explains the mechanism
// by name and says who actually knows the cutoff, rather than pretending there isn't one.
function pwPositionNote(weightLb, ballCarrierLb, firstName){
  const nm = firstName || 'they';
  if(ballCarrierLb==null){
    return `Many Pop Warner leagues cap how much a ball-carrier can weigh in each division and require heavier `
      + `players to play the line instead — often called the "X-Man" rule. The cutoff is set locally, not `
      + `nationally, so it isn't shown here until you add your league's number below.`;
  }
  if(weightLb==null){
    return `Your league's ball-carrier limit is ${ballCarrierLb} lb. Record a weight to see where ${nm} stands `
      + `against it.`;
  }
  if(weightLb>ballCarrierLb){
    return `${weightLb} lb is over your league's ${ballCarrierLb} lb ball-carrier limit — likely line positions `
      + `only under that rule. Leagues re-check this at official weigh-ins, not from a number typed in here.`;
  }
  return `${weightLb} lb is under your league's ${ballCarrierLb} lb ball-carrier limit — no weight-based `
    + `position restriction under that rule right now.`;
}
