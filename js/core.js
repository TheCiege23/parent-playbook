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

// Premium (item 8): billing, the price-point test, and both feature caps are fully
// wired and live-ready in Stripe — same "built but not imposed" posture as the
// marketplace flag above. The difference here is who it affects: flipping this on
// changes what EXISTING free families can already do (a second child, unlimited
// scans) the moment it's true, so it stays off until that's a deliberate call, not
// a side effect of a deploy. Nothing is deleted or blocked while it's false.
const PREMIUM_ENABLED = false;
const PREMIUM_PRICES = { a:499, b:699, c:999 }; // cents/mo — must match the Stripe Price objects
// Same deterministic bucketing the stripe-subscribe Edge Function uses server-side
// (SHA-256 of the guardian id, first byte mod 3), so the price shown here always
// matches what Checkout actually charges — no separate round trip just to display it.
async function premiumBucket(guardianId){
  const enc = new TextEncoder().encode(guardianId);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const n = new Uint8Array(digest)[0];
  return ['a','b','c'][n % 3];
}
async function loadPremium(){
  if(!PREMIUM_ENABLED || !state.user){ state.premium=false; return; }
  const { data } = await sb.from('subscriptions').select('status,current_period_end').eq('guardian_id',state.user.id).maybeSingle();
  state.premium = !!(data && data.status==='active' && (!data.current_period_end || new Date(data.current_period_end)>new Date()));
}
function isPremium(){ return !!state.premium; }

// Adult Training (a parent's own training record) is built behind two locks and is off for everyone in production.
// This flag would show it to every account. Until then, public.adult_training_access names the test accounts that
// see it, and the database refuses a write from anyone not on that list whatever this flag says. A parent's record is
// theirs alone: no co-parent, family viewer, coach or organization can read it. See js/screen-adult.js.
const ADULT_TRAINING_ENABLED = false;
async function loadAdultTrainingAccess(){
  state.adultTrainingAllowed = false;
  if(!state.user) return;
  // A database without the table answers with an error, which simply means "not allowed".
  const { data, error } = await sb.from('adult_training_access').select('guardian_id').eq('guardian_id',state.user.id).limit(1);
  state.adultTrainingAllowed = !error && !!(data && data.length);
}
function adultTrainingOn(){ return ADULT_TRAINING_ENABLED || !!state.adultTrainingAllowed; }
function adultTrainingOff(){
  if(adultTrainingOn()) return false;
  toast('Adult training isn\'t available yet');
  renderApp('profile');
  return true;
}
const SCAN_FREE_MONTHLY_CAP = 3;
// Approximates "scans this month" as distinct capture days in the last 30 days —
// there's no dedicated attempts log, and a single capture can write several
// measurement rows at once (body scan writes 5 lengths from one session), so
// counting raw rows would overcount. source in ('photo','guided') covers the
// on-device engines (photo = body scan, guided = jump/speed/sprint's video
// flows); 'manual'/'import' entries never counted against the cap.
async function scanCapOk(athleteId){
  athleteId = athleteId || state.active?.id;
  if(!PREMIUM_ENABLED || isPremium() || !athleteId) return true;
  const since=localDay(new Date(Date.now()-30*24*60*60*1000));
  const { data } = await sb.from('measurements').select('measured_on')
    .eq('athlete_id',athleteId).in('source',['photo','guided']).gte('measured_on',since);
  const days=new Set((data||[]).map(r=>r.measured_on));
  if(days.size < SCAN_FREE_MONTHLY_CAP) return true;
  await openPaywall(`Free accounts get ${SCAN_FREE_MONTHLY_CAP} scans a month — Premium removes the limit.`);
  return false;
}
// The paywall itself — shown wherever a free-tier cap is hit. `reason` is one short
// sentence naming what triggered it (e.g. "Free accounts can add one athlete.").
async function openPaywall(reason){
  if(!PREMIUM_ENABLED) return; // caps never fire while the flag is off, but stay defensive
  logUsageEvent('paywall_shown');
  const bucket = await premiumBucket(state.user.id);
  const price = (PREMIUM_PRICES[bucket]/100).toFixed(2);
  const bg = sheet(H`<h3>Parent Playbook Premium</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 14px">${esc(reason||'')}</p>
    <div class="card app-pad">
      <div class="mrow"><span>A second child (and beyond)</span><b>✓</b></div>
      <div class="mrow"><span>Unlimited on-device scans</span><b>✓</b></div>
      <div class="mrow"><span>Advanced growth insights</span><b>✓</b></div>
    </div>
    <p style="font-size:22px;font-weight:700;margin:16px 2px 0">$${price}<span style="font-size:13px;font-weight:500;color:var(--muted)">/month</span></p>
    <div class="err" id="pwErr"></div>
    <button class="btn amber" id="pwGo" style="margin-top:14px">Upgrade</button>
    <button class="btn ghost" id="pwCancel" style="margin-top:8px">Not now</button>`);
  bg.querySelector('#pwCancel').onclick=()=>bg.remove();
  bg.querySelector('#pwGo').onclick=async e=>{
    logUsageEvent('paywall_upgrade_clicked');
    e.target.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; e.target.disabled=true;
    const err=bg.querySelector('#pwErr'); err.textContent='';
    try{
      const { data, error } = await sb.functions.invoke('stripe-subscribe',{ body:{} });
      if(error){ err.textContent=await fnError(error,'Could not start checkout'); e.target.innerHTML='Upgrade'; e.target.disabled=false; return; }
      if(data&&data.url){ location.href=data.url; } else { err.textContent=(data&&data.error)||'Could not start checkout'; e.target.innerHTML='Upgrade'; e.target.disabled=false; }
    }catch(ex){ console.error(ex); err.textContent='Could not start checkout'; e.target.innerHTML='Upgrade'; e.target.disabled=false; }
  };
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
const state = { user:null, ref:null, athletes:[], active:null, activeSportKey:null, coach:null, premium:false };
