async function afterLogin(){
  await loadAthletes();
  if(state.athletes.length===0) return renderOnboarding();
  state.active = state.active || state.athletes[0];
  renderApp('week');
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
function renderAuth(mode='login', prefill=''){
  document.body.classList.add('auth'); setAppBg();
  root.innerHTML = H`
  <div class="authwrap">
    <div class="authbrand">
      <div class="avatar" style="width:58px;height:58px;border-radius:16px;font-size:22px;margin:0 auto 14px;box-shadow:0 6px 18px rgba(0,0,0,.35)">PP</div>
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
      <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@email.com" value="${esc(prefill)}"/></div>
      <div class="field"><label>Password</label><input id="pw" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="At least 8 characters"/></div>
      <div class="err" id="autherr"></div>
      <button class="btn" id="go">${mode==='signup'?'Create account':'Log in'}</button>
      <p class="muted-note">
        ${mode==='signup'
          ? `Already have an account? <a href="#" id="swap">Log in</a>`
          : `New here? <a href="#" id="swap">Create an account</a>`}
      </p>
      ${mode==='login' ? `<p class="muted-note" style="margin-top:2px"><a href="#" id="forgot">Forgot password?</a></p>` : ''}
    </div>
    <p class="authlegal">By continuing you agree that you are the parent or legal guardian and consent to creating a profile for your child.</p>
  </div>`;

  $("#swap").onclick = e=>{e.preventDefault();renderAuth(mode==='signup'?'login':'signup');};
  { const f=$("#forgot"); if(f) f.onclick=e=>{ e.preventDefault(); renderForgot($("#email").value.trim()); }; }
  $("#go").onclick = async ()=>{
    const email=$("#email").value.trim(), pw=$("#pw").value;
    const errEl=$("#autherr"); errEl.textContent="";
    if(!email||!pw){ errEl.textContent="Enter your email and password."; return; }
    if(mode==='signup'&&pw.length<8){ errEl.textContent="Password must be at least 8 characters."; return; }
    const btn=$("#go"); const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    try{
      let res;
      if(mode==='signup'){
        res = await sb.auth.signUp({email,password:pw,options:{emailRedirectTo:location.origin+location.pathname}});
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
        res = await sb.auth.signInWithPassword({email,password:pw});
        if(res.error) throw res.error;
      }
      state.user = res.data.user;
      const token=inviteTokenFromUrl();
      if(token) return acceptAndEnter(token);
      await afterLogin();
    }catch(err){
      errEl.textContent = friendlyAuthErr(err.message);
      if(/confirm/i.test(err.message||'')) addResend(email, errEl);
      btn.innerHTML=label; btn.disabled=false;
    }
  };
}
function friendlyAuthErr(m){
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
      <div class="avatar" style="width:58px;height:58px;border-radius:16px;font-size:22px;margin:0 auto 14px;box-shadow:0 6px 18px rgba(0,0,0,.35)">PP</div>
      <h1 style="font-size:27px">Parent Playbook</h1>
    </div>
    <div class="glass">
      <h2 style="font-size:20px;margin-bottom:2px">Reset your password</h2>
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 16px">Enter your email and we'll send you a link to set a new password.</p>
      <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@email.com" value="${esc(prefill)}"/></div>
      <div class="err" id="autherr"></div>
      <button class="btn" id="send">Send reset link</button>
      <p class="muted-note"><a href="#" id="back">Back to log in</a></p>
    </div>
  </div>`;
  $("#back").onclick=e=>{ e.preventDefault(); renderAuth('login', $("#email").value.trim()); };
  $("#send").onclick=async()=>{
    const email=$("#email").value.trim(), errEl=$("#autherr"); errEl.textContent="";
    if(!email){ errEl.textContent="Enter your email."; return; }
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
      <div class="avatar" style="width:58px;height:58px;border-radius:16px;font-size:22px;margin:0 auto 14px;box-shadow:0 6px 18px rgba(0,0,0,.35)">PP</div>
      <h1 style="font-size:27px">Parent Playbook</h1>
    </div>
    <div class="glass">
      <h2 style="font-size:20px;margin-bottom:2px">Set a new password</h2>
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 16px">Choose a new password for your account.</p>
      <div class="field"><label>New password</label><input id="np" type="password" autocomplete="new-password" placeholder="At least 8 characters"/></div>
      <div class="field"><label>Confirm password</label><input id="np2" type="password" autocomplete="new-password" placeholder="Re-enter it"/></div>
      <div class="err" id="autherr"></div>
      <button class="btn" id="save">Update password</button>
    </div>
  </div>`;
  $("#save").onclick=async()=>{
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

