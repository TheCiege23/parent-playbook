async function afterLogin(){
  // Reference data (sports, positions, METRICS) is needed by every screen, not just
  // onboarding — without it the app shows raw keys, loses `lower_is_better` so trend
  // arrows point the wrong way, and "Record a measurement" renders an empty picker
  // and throws on save. Load it on every entry into the app, not just first-run.
  await Promise.all([ loadAthletes(), loadRef() ]);
  if(state.athletes.length===0){
    // Account-last onboarding: the profile was built before the account existed and
    // stashed on this device. A session now exists, so finish the job silently — the
    // parent should land on the week they were already shown, not fill it in twice.
    const pending = (typeof obReadStash==='function') ? obReadStash() : null;
    if(pending){
      document.body.classList.remove('auth'); setAppBg();
      root.innerHTML = H`<div class="center-screen"><span class="spinner"></span><div>Building ${esc(pending.athlete.first)}'s playbook…</div></div>`;
      const familyId = await myFamilyId();
      obReset({ ...pending, mode: familyId?'addChild':'create', familyId: familyId||null });
      return finishOnboarding();
    }
    // No athletes doesn't mean no household. renderOnboarding() runs the `create` flow,
    // which mints a SECOND family and orphans the first along with its members and any
    // pending invites. If they already belong to one, add the child into it instead.
    const familyId = await myFamilyId();
    if(familyId){ document.body.classList.remove('auth'); setAppBg(); obReset({ mode:'addChild', familyId }); return obStep(); }
    // Someone who was invited to help and then had access revoked has no family and no
    // athletes — identical to a brand-new signup. Shoving them into "create your child's
    // profile" is wrong; tell them what happened and let them choose.
    if(await hadSharedAccess()) return renderNoAccess();
    return renderOnboarding();
  }
  state.active = state.active || state.athletes[0];
  // honour a deep link (#growth) on refresh; anything else — including leftover
  // Supabase token fragments — falls back to the week
  const tab=(location.hash||'').slice(1);
  renderApp(APP_TABS.includes(tab)?tab:'week');
  // If the last page life ended mid-scan, say so. Without this the parent is silently
  // dumped back on a settings screen with four photos taken and nothing to show for it,
  // which reads as the feature being broken rather than the OS reclaiming memory.
  if(typeof bodyScanWasInterrupted === 'function' && bodyScanWasInterrupted()){
    setTimeout(bsInterruptedNotice, 400);   // after the screen has painted
  }
  if(typeof jumpScanWasInterrupted === 'function' && jumpScanWasInterrupted()){
    setTimeout(jmpInterruptedNotice, 400);
  }
}

// The household this user already belongs to, if any. `fm_select` exposes every member
// of a family you're in, so scope to your OWN row. Both family roles (owner, co_parent)
// satisfy private.is_family_editor, so either can add a child — prefer owner.
async function myFamilyId(){
  const { data, error } = await sb.from('family_members')
    .select('family_id,role,created_at').eq('guardian_id', state.user.id).order('created_at');
  if(error){ console.error(error); return null; }
  if(!data || !data.length) return null;
  return (data.find(m=>m.role==='owner') || data[0]).family_id;
}

// Were they ever granted access to someone else's athlete? Distinguishes a revoked
// co-parent/grandparent from a genuinely new signup.
async function hadSharedAccess(){
  const { data, error } = await sb.from('athlete_access')
    .select('athlete_id').eq('guardian_id', state.user.id).limit(1);
  if(error){ console.error(error); return false; }
  return !!(data && data.length);
}

function renderNoAccess(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="app-pad" style="padding-top:64px;text-align:center">
    <div class="avatar" style="width:56px;height:56px;border-radius:16px;font-size:24px;margin:0 auto 16px;background:var(--amber)">🔒</div>
    <h2 style="font-size:22px">No athletes shared with you</h2>
    <p style="color:var(--muted);margin:10px auto 0;max-width:320px;line-height:1.5">
      The access you had has been removed, or the invite was revoked. Ask whoever invited you
      for a fresh link — or start your own household if you'd like to track your own athlete.</p>
    <div style="max-width:300px;margin:26px auto 0;display:grid;gap:10px">
      <button class="btn" id="naNew">Start my own household</button>
      <button class="btn ghost" id="naOut">Log out</button>
    </div>
  </div>`;
  $("#naNew").onclick=renderOnboarding;
  $("#naOut").onclick=async()=>{ await sb.auth.signOut(); state.user=null;state.athletes=[];state.active=null; renderAuth('login'); };
}

async function loadAthletes(){
  const { data, error } = await sb.from('athletes')
    .select('id,first_name,nickname,birthdate,dominant_hand,family_id,created_at')
    .order('created_at');
  if(error){ console.error(error); throw error; }   // surface load failures instead of faking an empty list (which would misroute to onboarding)
  state.athletes = data||[];
}

// ===================================================================
//  AUTH
// ===================================================================
// Where the confirmation email sends them back to. Must carry `?invite=` through:
// bare origin+pathname drops location.search, so a guardian who signs up from an
// invite link comes back tokenless and gets routed into creating a SECOND household
// instead of joining yours.
function authRedirectUrl(){
  const p=[];
  const t=inviteTokenFromUrl();  if(t)  p.push('invite='+encodeURIComponent(t));
  const tm=teamCodeFromUrl();    if(tm) p.push('team='+encodeURIComponent(tm));
  return location.origin+location.pathname+(p.length?('?'+p.join('&')):'');
}
function renderAuth(mode='login', prefill=''){
  document.body.classList.add('auth'); setAppBg();
  root.innerHTML = H`
  <div class="authwrap">
    <div class="authbrand">
      <div class="brandmark">P</div>
      <h1 style="font-size:27px">Parent Playbook</h1>
      <p style="margin:7px 0 0;font-size:14px">Coach your young athlete with confidence.</p>
    </div>
    <div class="glass">
      <div class="steps" style="margin-bottom:15px">
        <i class="${mode==='signup'?'on':''}"></i><i class="${mode==='login'?'on':''}"></i>
      </div>
      <h2 style="font-size:20px;margin-bottom:2px">${mode==='signup'?'Create your account':'Welcome back'}</h2>
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 16px">
        ${mode==='signup'?'You create the account. Your child gets a profile you own and control.':'Log in to your dashboard.'}
      </p>
      <form id="authform" novalidate>
        <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@email.com" value="${esc(prefill)}"/></div>
        <div class="field"><label>Password</label><input id="pw" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="At least 8 characters"/></div>
        ${mode==='signup' ? H`<label class="agree-row" for="agree" style="display:flex;align-items:flex-start;gap:9px;margin:14px 0 4px;font-size:13.5px;color:var(--muted);line-height:1.45;cursor:pointer">
          <input id="agree" type="checkbox" style="margin-top:3px;flex:none"/>
          <span>I am the parent or legal guardian, and I agree to the
            <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>,
            <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>, and
            <a href="/datadeletion" target="_blank" rel="noopener">Data Deletion</a> policy.</span>
        </label>` : ''}
        <div class="err" id="autherr"></div>
        <button class="btn" id="go" type="submit">${mode==='signup'?'Create account':'Log in'}</button>
      </form>
      <p class="muted-note">
        ${mode==='signup'
          ? `Already have an account? <a href="#" id="swap">Log in</a>`
          : `New here? <a href="#" id="swap">Start your athlete's playbook</a>`}
      </p>
      ${mode==='login' ? `<p class="muted-note" style="margin-top:2px"><a href="#" id="forgot">Forgot password?</a></p>` : ''}
    </div>
    ${mode==='login' ? `<p class="authlegal">By continuing you accept our
      <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and
      <a href="/terms" target="_blank" rel="noopener">Terms</a>.</p>` : ''}
  </div>`;

  // From login, "new here" goes to ONBOARDING, not a signup form — the account comes
  // last now, and a bare email box before they have seen anything converts far worse.
  $("#swap").onclick = e=>{ e.preventDefault();
    if(mode==='login') return renderOnboarding();
    renderAuth('login'); };
  { const f=$("#forgot"); if(f) f.onclick=e=>{ e.preventDefault(); renderForgot($("#email").value.trim()); }; }
  // A real <form> so Enter submits and password managers recognise the login.
  $("#authform").onsubmit = async (ev)=>{
    ev.preventDefault();
    const email=$("#email").value.trim(), pw=$("#pw").value;
    const errEl=$("#autherr"); errEl.textContent="";
    if(!email||!pw){ errEl.textContent="Enter your email and password."; return; }
    if(!validEmail(email)){ errEl.textContent="That email doesn't look right — check it for typos."; return; }
    if(mode==='signup'&&pw.length<8){ errEl.textContent="Password must be at least 8 characters."; return; }
    if(mode==='signup'){
      const agree=$("#agree");
      if(agree && !agree.checked){ errEl.textContent="Please confirm you're the parent or legal guardian and agree to the Privacy Policy and Terms."; return; }
    }
    const btn=$("#go"); const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    try{
      let res;
      if(mode==='signup'){
        res = await sb.auth.signUp({email,password:pw,options:{emailRedirectTo:authRedirectUrl()}});
        if(res.error) throw res.error;
        const u=res.data.user;
        // Supabase returns a user with an EMPTY identities array when the email is
        // already registered (enumeration protection). Send them to log in instead.
        if(u && Array.isArray(u.identities) && u.identities.length===0){
          toast('You already have an account — please log in');
          return renderAuth('login', email);
        }
        if(!res.data.session){ renderConfirmNotice(email); return; }
      } else {
        try{ localStorage.setItem('pp_last_email',email); }catch(e){}
        res = await sb.auth.signInWithPassword({email,password:pw});
        if(res.error) throw res.error;
      }
      state.user = res.data.user;
      const token=inviteTokenFromUrl();
      // Back to the redeem screen rather than straight into accept. Invites now carry a
      // confirmation code, and this path has no way to know it — accepting blind here
      // would fail the code check and dead-end someone in the second after they created
      // an account. renderRedeem asks for the code and then accepts.
      if(token) return renderRedeem(token);
      await afterLogin();
    }catch(err){
      const msg=err.message||'';
      errEl.textContent = friendlyAuthErr(msg);
      // Don't offer "resend" when the mail server is what failed — there is no account to
      // resend to, and /resend returns 200 for an unknown address, so the button would
      // look like it worked every time.
      const mailBroke=/sending.*email|smtp|mail server/i.test(msg);
      if(!mailBroke && /confirm/i.test(msg)) addResend(email, errEl);
      btn.innerHTML=label; btn.disabled=false;
    }
  };
}
// `type="email"` only validates on native form submission, and even then we submit via
// JS — so typos used to travel to Supabase and bounce back as a raw API string.
function validEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

function friendlyAuthErr(m){
  // MUST come before the "confirm" branch below. Supabase reports a mail-server failure
  // as "Error sending confirmation email", which contains the word "confirm" — so the
  // generic branch used to catch it and tell the parent to check an inbox for a message
  // that was never sent, for an account that was never created (GoTrue rolls the signup
  // back when the email fails). It looked like success. It was a 500.
  if(/sending.*email|smtp|mail server/i.test(m)){
    // A failed signup is rolled back; a failed reset simply didn't send. Say the right one.
    return /recovery|reset/i.test(m)
      ? "We couldn't send your reset email. That's a fault on our side, not yours — please try again in a few minutes, or email support@chimaura.com."
      : "We couldn't send your confirmation email, so your account wasn't created. That's a fault on our side, not yours — please try again in a few minutes, or email support@chimaura.com.";
  }
  if(/already registered/i.test(m)) return "That email already has an account. Try logging in.";
  if(/invalid login/i.test(m)) return "Email or password is incorrect.";
  if(/not confirmed|confirm/i.test(m)) return "Please confirm your email first — check your inbox and spam folder.";
  if(/provider.*disabled|logins are disabled/i.test(m)) return "Email sign-in is turned off in settings — enable the Email provider in Supabase.";
  if(/redirect/i.test(m)) return "This link target isn't allowed yet — add the Site URL in Supabase settings.";
  if(/rate/i.test(m)) return "Too many tries — wait a moment and retry.";
  return m;
}
function addResend(email, errEl){
  const b=document.createElement('button');
  b.className='btn ghost'; b.style.marginTop='8px'; b.textContent='Resend confirmation email';
  b.onclick=async()=>{ b.disabled=true; b.textContent='Sending…';
    const { error }=await sb.auth.resend({ type:'signup', email });
    toast(error?'Could not resend — try again shortly':'Sent — check your inbox and spam');
    b.textContent='Resend confirmation email'; b.disabled=false; };
  errEl.appendChild(b);
}
// ---- Forgot password: request a reset link ----
function renderForgot(prefill=''){
  document.body.classList.add('auth'); setAppBg();
  root.innerHTML = H`
  <div class="authwrap">
    <div class="authbrand">
      <div class="brandmark">P</div>
      <h1 style="font-size:27px">Parent Playbook</h1>
    </div>
    <div class="glass">
      <h2 style="font-size:20px;margin-bottom:2px">Reset your password</h2>
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 16px">Enter your email and we'll send you a link to set a new password.</p>
      <form id="forgotform" novalidate>
        <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@email.com" value="${esc(prefill)}"/></div>
        <div class="err" id="autherr"></div>
        <button class="btn" id="send" type="submit">Send reset link</button>
      </form>
      <p class="muted-note"><a href="#" id="back">Back to log in</a></p>
    </div>
  </div>`;
  $("#back").onclick=e=>{ e.preventDefault(); renderAuth('login', $("#email").value.trim()); };
  $("#forgotform").onsubmit=async(ev)=>{
    ev.preventDefault();
    const email=$("#email").value.trim(), errEl=$("#autherr"); errEl.textContent="";
    if(!email){ errEl.textContent="Enter your email."; return; }
    if(!validEmail(email)){ errEl.textContent="That email doesn't look right — check it for typos."; return; }
    const btn=$("#send"); const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    const { error }=await sb.auth.resetPasswordForEmail(email,{ redirectTo:location.origin+location.pathname });
    // resetPasswordForEmail returns success whether or not the account exists (no
    // enumeration), so any error here is a real config/rate problem — surface it.
    if(error){ console.error(error); errEl.textContent=friendlyAuthErr(error.message); btn.innerHTML=label; btn.disabled=false; return; }
    root.innerHTML = H`<div class="app-pad" style="padding-top:70px;text-align:center">
      <div class="avatar" style="width:56px;height:56px;border-radius:16px;font-size:24px;margin:0 auto 16px;background:var(--amber)">✉️</div>
      <h2 style="font-size:22px">Check your email</h2>
      <p style="color:var(--muted);margin:10px auto 0;max-width:320px">If an account exists for <b>${esc(email)}</b>, a password reset link is on its way. Open it, set a new password, and you'll be logged in.</p>
      <div style="max-width:300px;margin:26px auto 0"><button class="btn ghost" id="back2">Back to log in</button></div>
    </div>`;
    $("#back2").onclick=()=>renderAuth('login', email);
  };
}

// ---- Set a new password (landed here from the reset link) ----
function renderResetPassword(){
  document.body.classList.add('auth'); setAppBg();
  try{ history.replaceState({},'',location.pathname); }catch(e){}
  root.innerHTML = H`
  <div class="authwrap">
    <div class="authbrand">
      <div class="brandmark">P</div>
      <h1 style="font-size:27px">Parent Playbook</h1>
    </div>
    <div class="glass">
      <h2 style="font-size:20px;margin-bottom:2px">Set a new password</h2>
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 16px">Choose a new password for your account.</p>
      <form id="resetform" novalidate>
        <div class="field"><label>New password</label><input id="np" type="password" autocomplete="new-password" placeholder="At least 8 characters"/></div>
        <div class="field"><label>Confirm password</label><input id="np2" type="password" autocomplete="new-password" placeholder="Re-enter it"/></div>
        <div class="err" id="autherr"></div>
        <button class="btn" id="save" type="submit">Update password</button>
      </form>
    </div>
  </div>`;
  $("#resetform").onsubmit=async(ev)=>{
    ev.preventDefault();
    const p=$("#np").value, p2=$("#np2").value, errEl=$("#autherr"); errEl.textContent="";
    if(p.length<8){ errEl.textContent="Password must be at least 8 characters."; return; }
    if(p!==p2){ errEl.textContent="Passwords don't match."; return; }
    const btn=$("#save"); const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    const { data, error }=await sb.auth.updateUser({ password:p });
    if(error){ errEl.textContent=friendlyAuthErr(error.message); btn.innerHTML=label; btn.disabled=false; return; }
    state.user=data.user||state.user;
    toast('Password updated 🔒');
    document.body.classList.remove('auth');
    await afterLogin();
  };
}

function renderConfirmNotice(email){
  root.innerHTML = H`<div class="app-pad" style="padding-top:70px;text-align:center">
    <div class="avatar" style="width:56px;height:56px;border-radius:16px;font-size:24px;margin:0 auto 16px;background:var(--amber)">✓</div>
    <h2 style="font-size:22px">Check your email</h2>
    <p style="color:var(--muted);margin:10px auto 0;max-width:300px">We sent a confirmation link to <b>${esc(email)}</b>. Tap it, then come back and log in.</p>
    <div style="max-width:300px;margin:26px auto 0"><button class="btn ghost" id="back">Back to log in</button></div>
  </div>`;
  $("#back").onclick=()=>renderAuth('login');
}

