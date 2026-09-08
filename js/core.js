const SUPABASE_URL = "https://xqvqjkdxykowwpcmyudz.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- feature flags ----
// The trainer marketplace connects adults to other people's children, which needs a real
// screening vendor, FCRA-compliant consent and adverse-action handling, and insurance
// behind it — not just the database gate in B1. Off until that exists.
//
// Flip to true to bring it back: the Browse/Bookings and Become-a-Trainer entry points
// return, and the deep links start working again. The admin review queue and the drill
// library are NOT gated by this — they stay available either way. Nothing is deleted:
// no trainer, booking, or application data is touched by this flag.
const MARKETPLACE_ENABLED = false;
// Hiding the buttons isn't enough — the router made these screens linkable (E1), so a
// bookmark or a shared URL would still open them. Every entry point calls this first.
function marketplaceOff(){
  if(MARKETPLACE_ENABLED) return false;
  toast('Trainer booking isn\'t available yet');
  renderApp('profile');
  return true;
}

const $ = (s,el=document)=>el.querySelector(s);
const root = $("#root");
const esc = s => (s??"").toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H = (strings,...v)=>strings.reduce((a,s,i)=>a+s+(v[i]??''),'');
// client-side UUID so inserts don't need RETURNING (INSERT...RETURNING re-checks the
// SELECT policy, which fails on `families` because membership is added by an AFTER trigger)
const uuid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&0x3|0x8)).toString(16);});

// A .chip is rendered identically across every screen that uses one — a plain
// <div class="chip" onclick=...> — so rather than touching every bind site
// individually, Enter/Space on a focused chip just re-fires the click already
// wired to it. Chips themselves still need role="button" tabindex="0" in their
// markup for this to matter; that's on the template, not here.
document.addEventListener('keydown', e=>{
  if((e.key===' '||e.key==='Enter') && e.target && e.target.classList && e.target.classList.contains('chip')){
    e.preventDefault(); e.target.click();
  }
});
// A .card used as a button (a banner, a tappable summary) needs the same role +
// keyboard handling .navrow already gets — this is that pattern, shared, so a
// card-as-button is never mouse/touch-only.
function clickableCard(el,fn){
  if(!el) return;
  el.setAttribute('role','button'); el.setAttribute('tabindex','0');
  el.onclick=fn;
  el.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } };
}
function toast(msg){
  const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.setAttribute('aria-live','polite');
  t.textContent=msg;document.body.appendChild(t);
  setTimeout(()=>t.remove(),2600);
}
// ---------- usage telemetry ----------
// Aggregate, first-party, non-identifying: a daily count per feature, never a user, a
// child, or a session. This is NOT the third-party analytics / session recording
// privacy.html promises the product doesn't do — it's a separate, disclosed practice
// (see privacy.html's "Aggregate feature usage" section). Fire-and-forget: a metrics
// call must never be able to break, slow, or be noticed by the screen that triggered
// it, so failures are swallowed silently rather than surfaced or retried.
function logUsageEvent(key){
  try{ sb.rpc('log_usage_event', { p_key: key }).then(()=>{}, ()=>{}); }catch(e){}
}

function ageFrom(bd){ if(!bd) return null;
  // Parse 'YYYY-MM-DD' as a LOCAL date (new Date('YYYY-MM-DD') is UTC midnight,
  // which reads back as the previous day in western timezones → age off by one).
  const p=String(bd).slice(0,10).split('-');
  const d=(p.length===3)?new Date(+p[0],+p[1]-1,+p[2]):new Date(bd);
  const n=new Date();
  let a=n.getFullYear()-d.getFullYear(); if(n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate()))a--; return a; }

// ---------- app state ----------
const state = { user:null, ref:null, athletes:[], active:null, activeSportKey:null, coach:null };
