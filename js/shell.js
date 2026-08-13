// `account` is a route, not a tab — it has no nav button and lives one level under
// Profile. It's in this list so the hash router and the Back button still handle it.
const APP_TABS=['week','growth','journey','profile','account','activity'];
// Whether this guardian can WRITE for the active athlete. RLS is the real gate —
// private.can_edit_athlete() only passes owner and co_parent — but the UI has to agree,
// or family view is a screen full of controls that silently fail.
async function loadRole(){
  state.canEdit = true; state.role = 'owner';
  const a=state.active; if(!a||!state.user) return;
  const { data, error } = await sb.from('athlete_access')
    .select('role').eq('athlete_id',a.id).eq('guardian_id',state.user.id).is('revoked_at',null).limit(1);
  if(error){ console.error(error); return; }          // fail OPEN in the UI; RLS still refuses
  const r=(data&&data[0])?data[0].role:null;
  // No access row means they reach the athlete through family_members, i.e. they own it.
  if(r){ state.role=r; state.canEdit = (r==='owner'||r==='co_parent'); }
  // Read-only copy names who does the doing ("Chris marks these off") rather than
  // using the passive voice, which reads like the app is withholding something.
  // One extra query, and only for the guardians who actually need it.
  if(!state.canEdit && !state.ownerName){
    const { data:own } = await sb.from('athlete_access')
      .select('guardian_id').eq('athlete_id',a.id).eq('role','owner').is('revoked_at',null).limit(1);
    const oid=(own&&own[0])?own[0].guardian_id:null;
    if(oid){
      const { data:g } = await sb.from('guardians').select('display_name').eq('id',oid).limit(1);
      const n=(g&&g[0]&&g[0].display_name||'').trim();
      if(n) state.ownerName=n.split(/\s+/)[0];
    }
  }
}
// First name of whoever owns this athlete, for read-only copy. Falls back to a neutral
// noun rather than an empty string.
function ownerFirstName(){ return (state && state.ownerName) || 'Their parent'; }

async function renderApp(tab, fromPop){
  document.body.classList.remove('auth'); setAppBg();
  await loadRole();
  // Family view has no Growth tab: goals and measurements are things a parent DOES,
  // and an empty read-only version of them is just a locked door.
  if(!state.canEdit && tab==='growth') tab='week';
  // Keep the URL and the Back button in sync. Without this, Back exits the app
  // entirely — badly wrong in an installed PWA. Hash-based because this deploys as
  // static files with no rewrites, so /growth would 404 on refresh but #growth won't.
  if(!fromPop){
    const h='#'+tab;
    if(location.hash!==h){
      const url=location.pathname+location.search+h;
      // first render replaces so Back doesn't land on a blank pre-app entry
      try{ location.hash ? history.pushState({tab},'',url) : history.replaceState({tab},'',url); }catch(e){}
    }
  }
  root.innerHTML = H`
    ${state.canEdit?'':'<div class="roview" role="status"><i>👁</i> Family view · you can look, not change</div>'}
    <div id="screen"></div>
    <nav class="nav" id="nav">
      ${navBtn('week','Week','M4 5h16M4 12h16M4 19h10')}
      ${state.canEdit?navBtn('growth','Growth','M4 19V5m0 14l6-6 4 4 6-8'):''}
      ${navBtn('journey','Journey','M12 6.5C10 5 7 5 4 6v12c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5V6c-3-1-6-1-8 .5z M12 6.5V19')}
      ${navBtn('profile','Profile','M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0')}
    </nav>`;
  bindNav(tab);
  try{
    if(tab==='week') await screenWeek();
    else if(tab==='growth') await screenGrowth();
    else if(tab==='journey') await screenJourney();
    else if(tab==='account') await screenAccount();
    else if(tab==='activity') await screenActivity();
    else await screenProfile();
  }catch(err){ console.error(err); screenError(tab); }
}
function screenError(tab){
  const s=$("#screen"); if(!s) return;
  s.innerHTML = H`<div class="center-screen" style="min-height:60dvh">
    <div style="font-size:32px">😕</div>
    <div style="text-align:center;color:var(--muted);max-width:260px;line-height:1.5">Couldn't load this screen. Check your connection and retry.</div>
    <button class="btn" id="ppRetry" style="max-width:200px">Retry</button></div>`;
  const r=$("#ppRetry"); if(r) r.onclick=()=>renderApp(tab);
}
function navBtn(id,label,path){ return H`<button data-t="${id}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>${label}</button>`; }
function bindNav(active){
  // Account & settings sits under Profile, so Profile stays lit while you're in it.
  if(active==='account') active='profile';
  // The activity screen owns the whole viewport and has its own sticky action, so the
  // bottom nav comes off — two competing action bars is one too many.
  if(active==='activity'){ const n=$("#nav"); if(n) n.remove(); return; }
  // renderApp rebuilds the nav before every call, but the activity route removes it —
  // so this is no longer guaranteed to exist. Fail quietly rather than throwing and
  // taking the whole screen down with it.
  const nav=$("#nav"); if(!nav) return;
  nav.querySelectorAll('button').forEach(b=>{
    const on=b.dataset.t===active;
    b.classList.toggle('on',on);
    b.setAttribute('aria-current',on?'page':'false');
    b.onclick=()=>renderApp(b.dataset.t);
  });
}
// `extra` is pre-escaped HTML dropped in ahead of the switcher — the Week screen puts
// the weeks-in-a-row streak there. Callers own their own escaping.
function topBar(sub, extra){
  const a=state.active; const initials=(a.first_name||'?')[0].toUpperCase();
  const switcher = state.athletes.length>1
    ? `<button class="pill" id="switch">Switch ▾</button>` : '';
  return H`<div class="top">
    <div class="who"><div class="avatar" style="background:${sportGradient(state.activeSportKey||'general')}">${initials}</div>
      <div><h3>${esc(a.first_name)}</h3><span>${esc(sub)}</span></div></div>
    <div style="display:flex;gap:8px;align-items:center">${extra||''}${switcher}
      <button class="pill" id="logout">Log out</button></div>
  </div>`;
}
function bindTop(){
  $("#logout").onclick=async()=>{ await sb.auth.signOut(); state.user=null;state.athletes=[];state.active=null; renderAuth('login'); };
  const sw=$("#switch"); if(sw) sw.onclick=openSwitch;
}

// ---- WEEK ----
