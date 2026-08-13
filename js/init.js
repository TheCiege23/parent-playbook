// ===================================================================
//  BOOT
// ===================================================================
// Capture a password-recovery link before Supabase clears the URL hash.
const PP_RECOVERY = (typeof location!=='undefined' && location.hash && location.hash.indexOf('type=recovery')!==-1);

// Everything that runs on load lives here — see ARCHITECTURE.md.
// The service worker registers on every visit, marketing page included: it is what
// makes the install prompt available in the first place.
registerServiceWorker();

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
  }catch(err){ console.error(err); bootError(); }
}

// Safety net: if the landing markup is ever absent (a stripped-down deploy, a future
// /app route), nothing would call enterApp and the page would sit on the spinner
// forever. Boot directly in that case.
if(!document.getElementById('landing')){
  handleStripeReturn(); initInstallBanner(); boot();
}

function bootError(){
  // Reload alone is a trap when the cause is the session itself — you reload into the
  // same error forever. Offer a sign-out to anyone who is logged in.
  const signedIn = !!(typeof state!=='undefined' && state.user);
  root.innerHTML = H`<div class="center-screen">
    <div style="font-size:34px">😕</div>
    <div style="text-align:center;color:var(--muted);max-width:260px;line-height:1.5">Something went wrong loading Parent Playbook. Check your connection and try again.</div>
    <button class="btn" id="ppReload" style="max-width:200px">Reload</button>
    ${signedIn?`<button class="btn ghost" id="ppSignOut" style="max-width:200px;margin-top:10px">Log out</button>`:''}
    <p style="font-size:12px;color:var(--muted);margin-top:14px">Still stuck? <a href="mailto:support@chimaura.com" style="color:var(--green-d)">support@chimaura.com</a></p>
  </div>`;
  const r=document.getElementById('ppReload'); if(r) r.onclick=()=>location.reload();
  const o=document.getElementById('ppSignOut');
  if(o) o.onclick=async()=>{
    try{ await sb.auth.signOut(); }catch(e){ console.error(e); }
    state.user=null; state.athletes=[]; state.active=null;
    renderAuth('login');
  };
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

