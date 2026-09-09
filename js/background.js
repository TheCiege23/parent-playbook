
// ---- Background photos: rotate by the child's sport, fall back to daily rotation -----------
// Hosted permanently in this project's own Supabase Storage (public 'backgrounds' bucket).
const CDN = "https://xqvqjkdxykowwpcmyudz.supabase.co/storage/v1/object/public/backgrounds/";
const BG = {
  field: CDN+"field.png",
  court: CDN+"court.png",
  track: CDN+"track.png",
  night: CDN+"night.png",
};
const BG_LIST = [BG.field, BG.court, BG.track, BG.night];
// Which photo suits each sport; anything not listed uses the daily rotation.
const SPORT_BG = { football:BG.field, soccer:BG.field, baseball:BG.field, softball:BG.field, lacrosse:BG.field,
  basketball:BG.court, volleyball:BG.court, cheer:BG.court, wrestling:BG.court, gymnastics:BG.court,
  track:BG.track, cross_country:BG.track, swimming:BG.night, hockey:BG.night };
const BG_MODE = 'sport';   // 'sport' = match the child's sport (daily rotation when unknown); 'day' = always rotate daily
function pickBg(){
  const bySport = state.activeSportKey && SPORT_BG[state.activeSportKey];
  if(BG_MODE==='sport' && bySport) return bySport;
  const dayIndex = Math.floor(Date.now()/86400000);      // advances once per day
  return BG_LIST[dayIndex % BG_LIST.length];
}
function setAppBg(){
  const el = document.getElementById('appbg');
  if(el) el.style.backgroundImage = `url('${pickBg()}')`;
}
setAppBg();
function inviteTokenFromUrl(){ return new URLSearchParams(location.search).get('invite'); }

// A coach's link carries the team code: playbookbp.com/?team=BEARS26
// Stashed in sessionStorage because signup bounces through an email confirmation that
// lands on a fresh URL — the same trap that used to lose ?invite= (finding A1).
function teamCodeFromUrl(){
  const q=new URLSearchParams(location.search).get('team');
  if(q){ try{ sessionStorage.setItem('pp_team', q); }catch(e){} return q; }
  try{ return sessionStorage.getItem('pp_team')||''; }catch(e){ return ''; }
}
function clearTeamCode(){ try{ sessionStorage.removeItem('pp_team'); }catch(e){} }

// ---------- reference data (sports as config, pulled live) ----------
