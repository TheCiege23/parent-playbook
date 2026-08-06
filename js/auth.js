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
  if(error){ console.error(error); state.athletes=[]; return; }
  state.athletes = data||[];
}

// ===================================================================
//  AUTH
// ===================================================================
function renderAuth(mode='signup'){
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
      <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@email.com"/></div>
      <div class="field"><label>Password</label><input id="pw" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="At least 8 characters"/></div>
      <div class="err" id="autherr"></div>
      <button class="btn" id="go">${mode==='signup'?'Create account':'Log in'}</button>
      <p class="muted-note">
        ${mode==='signup'
          ? `Already have an account? <a href="#" id="swap">Log in</a>`
          : `New here? <a href="#" id="swap">Create an account</a>`}
      </p>
    </div>
    <p class="authlegal">By continuing you agree that you are the parent or legal guardian and consent to creating a profile for your child.</p>
  </div>`;

  $("#swap").onclick = e=>{e.preventDefault();renderAuth(mode==='signup'?'login':'signup');};
  $("#go").onclick = async ()=>{
    const email=$("#email").value.trim(), pw=$("#pw").value;
    const errEl=$("#autherr"); errEl.textContent="";
    if(!email||!pw){ errEl.textContent="Enter your email and password."; return; }
    if(mode==='signup'&&pw.length<8){ errEl.textContent="Password must be at least 8 characters."; return; }
    const btn=$("#go"); const label=btn.textContent; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    try{
      let res;
      if(mode==='signup') res = await sb.auth.signUp({email,password:pw,options:{emailRedirectTo:location.origin+location.pathname+location.search}});
      else res = await sb.auth.signInWithPassword({email,password:pw});
      if(res.error) throw res.error;
      if(!res.data.session){ // email confirmation on
        errEl.textContent=""; renderConfirmNotice(email); return;
      }
      state.user = res.data.user;
      const token=inviteTokenFromUrl();
      if(token) return acceptAndEnter(token);
      await afterLogin();
    }catch(err){
      errEl.textContent = friendlyAuthErr(err.message);
      btn.innerHTML=label; btn.disabled=false;
    }
  };
}
function friendlyAuthErr(m){
  if(/already registered/i.test(m)) return "That email already has an account. Try logging in.";
  if(/invalid login/i.test(m)) return "Email or password is incorrect.";
  if(/rate/i.test(m)) return "Too many tries — wait a moment and retry.";
  return m;
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

