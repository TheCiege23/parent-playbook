// ===================================================================
//  BOOT
// ===================================================================
// Capture a password-recovery link before Supabase clears the URL hash.
const PP_RECOVERY = (typeof location!=='undefined' && location.hash && location.hash.indexOf('type=recovery')!==-1);

// Everything that runs on load lives here — see ARCHITECTURE.md.
// The service worker registers on every visit, marketing page included: it is what
// makes the install prompt available in the first place.
registerServiceWorker();
if(typeof owInit==='function') owInit();

// boot() no longer self-invokes. index.html now paints a marketing landing page
// first, and js/landing.js calls enterApp() — which calls this — when a visitor taps
// a CTA, or immediately for anyone installed, signed in, or on an app link.
// `mode` is 'signup' or 'login': which form a brand-new visitor lands on.
async function boot(mode){
  try{
    const { data:{ session } } = await sb.auth.getSession();
    state.user = session?.user || null;
    if(PP_RECOVERY){ return renderResetPassword(); }
    const token = inviteTokenFromUrl();
    if(token){ return renderRedeem(token); }
    if(!state.user){
      // Account-last: "Start free" drops them straight into onboarding. They build the
      // profile, see a real week, and are only then asked for an email. Log-in still
      // goes to the form, because a returning parent has nothing to build.
      if(mode==='signup') return renderOnboarding();
      return renderAuth('login');
    }
    await afterLogin();
  }catch(err){ console.error(err); bootError(err); }
}

// Safety net: if the landing markup is ever absent (a stripped-down deploy, a future
// /app route), nothing would call enterApp and the page would sit on the spinner
// forever. Boot directly in that case.
if(!document.getElementById('landing')){
  handleStripeReturn(); initInstallBanner(); boot();
}

function bootError(err){
  // One message used to cover offline, server-unreachable and signed-out. They need
  // different screens because the person reading them needs to do different things —
  // and for the first one, we may be able to show the week anyway.
  const kind = (typeof owFailureKind==='function') ? owFailureKind(err) : 'unreachable';

  if(kind==='offline'){
    const cache = (typeof owReadWeek==='function') ? owReadWeek() : null;
    if(cache) return owRenderCachedWeek(cache);
    // A saved week that belongs to a DIFFERENT week is not the same as never having saved
    // one. Since the cache became week-scoped, a parent who used the app all last week hits
    // this screen on Monday morning, and telling them nothing was ever saved would be false
    // and would read as the app having lost their week.
    const cacheState = (typeof owWeekCacheState==='function') ? owWeekCacheState() : 'none';
    return cacheState==='stale'
      ? owFailScreen('📡','No connection',
          "You're offline, and the week saved on this device is last week's. Open the app once with a connection and this week will be here too.",
          false)
      : owFailScreen('📡','No connection',
          "You're offline and we haven't saved a week to this device yet. Open the app once with a connection and it'll be here next time.",
          false);
  }
  if(kind==='signed_out'){
    return owFailScreen('👋','You\'ve been signed out',
      'Your session expired. Log back in — anything you did offline is still queued and will sync.',
      false, 'Log in', ()=>renderAuth('login', (function(){ try{ return localStorage.getItem('pp_last_email')||''; }catch(e){ return ''; } })()));
  }
  return owFailScreen('🛠','We can\'t reach Parent Playbook',
    "This one's on us, not your connection. It usually clears in a minute.", true);
}

// Shared layout. `retry` turns on the backoff countdown — the progress bar IS the
// countdown, not a fake loader that implies work is happening.
function owFailScreen(glyph, title, body, retry, btnLabel, btnFn){
  const signedIn = !!(typeof state!=='undefined' && state.user);
  root.innerHTML = H`<div class="app-pad ow-fail">
    <div class="ow-glyph">${glyph}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(body)}</p>
    <p id="owBadge" class="ow-queued" hidden></p>
    ${retry?'<div class="ow-count"><i></i></div><p class="ow-next" id="owNext"></p>':''}
    <div class="ow-acts">
      <button class="btn" id="owGo">${esc(btnLabel||'Try again')}</button>
      ${signedIn?'<button class="btn ghost" id="owOut">Log out</button>':''}
    </div>
    <p class="muted-note">Still stuck? <a href="mailto:support@playbookbp.com" style="color:var(--green-d)">support@playbookbp.com</a></p>
  </div>`;
  if(typeof owBadge==='function') owBadge();
  $("#owGo").onclick = btnFn || (()=>location.reload());
  { const o=$("#owOut"); if(o) o.onclick=async()=>{
      try{ await sb.auth.signOut(); }catch(e){}
      state.user=null; state.athletes=[]; state.active=null; renderAuth('login'); }; }
  if(retry) owBackoff();
}

// 2s, 5s, 15s, then stop and leave it to them. Retrying forever on a server error is
// how you turn one outage into a hot loop across every open tab.
const OW_STEPS=[2000,5000,15000];
let owStep=0;
function owBackoff(){
  const bar=document.querySelector('.ow-count i'), next=$("#owNext");
  if(!bar) return;
  if(owStep>=OW_STEPS.length){
    if(next) next.textContent='Still not back. Tap Try again when you\'re ready.';
    bar.style.width='100%'; bar.style.transition='none';
    return;
  }
  const ms=OW_STEPS[owStep++];
  if(next) next.textContent='Retrying in '+Math.round(ms/1000)+'s…';
  bar.style.transition='none'; bar.style.width='0%';
  requestAnimationFrame(()=>{ bar.style.transition='width '+ms+'ms linear'; bar.style.width='100%'; });
  setTimeout(()=>{ if(navigator.onLine) location.reload(); else owBackoff(); }, ms);
}

sb.auth.onAuthStateChange((event,session)=>{
  state.user = session?.user || null;
  if(event==='PASSWORD_RECOVERY') renderResetPassword(); // backup for the reset-link flow
});

// Back/forward between tabs. `fromPop` stops renderApp pushing the entry back on.
window.addEventListener('popstate',()=>{
  if(!state.user || !state.active) return;
  const tab=(location.hash||'').slice(1);
  if(APP_TABS.includes(tab)) renderApp(tab,true);
});

