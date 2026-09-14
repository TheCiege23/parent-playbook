// `account` is a route, not a tab — it has no nav button and lives one level under
// Profile. It's in this list so the hash router and the Back button still handle it.
// `adult` is the signed-in parent's own training record, reached from Account and gated by adultTrainingOn().
const APP_TABS=['week','growth','scan','insights','journey','profile','account','activity','adult'];
// Whether this guardian can WRITE for the active athlete. RLS is the real gate —
// private.can_edit_athlete() only passes owner and co_parent — but the UI has to agree,
// or family view is a screen full of controls that silently fail.
async function loadRole(){
  state.canEdit = true; state.role = 'owner';
  const a=state.active; if(!a||!state.user) return;
  // A guardian can reach an athlete two ways, and the HIGHEST privilege wins — exactly
  // what private.can_edit_athlete() does with an OR. Reading only athlete_access meant
  // an owner who accepted an invite to their OWN child (easy to do while testing) was
  // demoted to family view forever: the DB still allowed their writes, but every
  // control was hidden, which looks identical to the app being broken.
  const [acc, ath] = await Promise.all([
    sb.from('athlete_access').select('role').eq('athlete_id',a.id)
      .eq('guardian_id',state.user.id).is('revoked_at',null).limit(1),
    sb.from('athletes').select('family_id').eq('id',a.id).maybeSingle(),
  ]);
  if(acc.error){ console.error(acc.error); return; }   // fail OPEN in the UI; RLS still refuses
  let fam=null;
  if(ath.data&&ath.data.family_id){
    const { data:m } = await sb.from('family_members').select('role')
      .eq('family_id',ath.data.family_id).eq('guardian_id',state.user.id).limit(1);
    fam = (m&&m[0]) ? m[0].role : null;
  }
  const viaAccess = (acc.data&&acc.data[0]) ? acc.data[0].role : null;
  const RANK={ owner:3, co_parent:2, family_view:1 };
  const best = [viaAccess, fam].filter(Boolean).sort((x,y)=>(RANK[y]||0)-(RANK[x]||0))[0];
  // No row on either side means they got here through the household with no explicit
  // grant — treat as owner, which is what loadAthletes already allowed them to see.
  if(best){ state.role=best; state.canEdit = (best==='owner'||best==='co_parent'); }

  if(!state.canEdit && !state.ownerName){
    try{
      const { data:n } = await sb.rpc('athlete_owner_first_name',{ p_athlete:a.id });
      if(n) state.ownerName=String(n);
    }catch(e){ console.error(e); }
  }
}
// First name of whoever owns this athlete, for read-only copy. Falls back to a neutral
// noun rather than an empty string.
function ownerFirstName(){ return (state && state.ownerName) || 'Their parent'; }

async function renderApp(tab, fromPop){
  // Adult Training is the parent's own record, not an athlete's: gated by its own flag and allowlist, and exempt from
  // the coach view, the family-view redirect and the family-view banner below, which are all about a child.
  if(tab==='adult' && adultTrainingOff()) return;
  document.body.classList.remove('auth'); setAppBg();
  await loadRole();
  // A coach sees a narrower slice of ONE athlete's data than even family_view — no
  // games, journey, photos, or weekly plan (enforced at the RLS layer, not just here).
  // Reusing the normal 7-tab shell for that role would render tabs that quietly come
  // back empty rather than explain why, so this bypasses renderApp()'s shell entirely
  // rather than trying to retrofit every screen to hide itself from a coach.
  if(state.role==='coach' && tab!=='adult') return renderCoachView();
  // Family view has no Growth or Scan tab: goals, measurements and starting a scan are
  // things a parent DOES, and an empty read-only version of them is just a locked door.
  if(!state.canEdit && (tab==='growth' || tab==='scan' || tab==='insights')) tab='week';
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
    ${state.canEdit||tab==='adult'?'':'<div class="roview" role="status"><i>👁</i> Family view · you can look, not change</div>'}
    <div id="screen"></div>
    <nav class="nav" id="nav">
      <div class="sb-brand" aria-hidden="true"><span class="mk">P</span><b>Parent Playbook</b></div>
      ${navBtn('week','Week','M4 5h16M4 12h16M4 19h10')}
      ${state.canEdit?navBtn('growth','Growth','M4 19V5m0 14l6-6 4 4 6-8'):''}
      ${state.canEdit?navBtn('scan','Scan','M4 8V4H8 M16 4H20V8 M4 16V20H8 M20 16V20H16'):''}
      ${navBtn('journey','Journey','M12 6.5C10 5 7 5 4 6v12c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5V6c-3-1-6-1-8 .5z M12 6.5V19')}
      ${navBtn('profile','Profile','M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0')}
      <div class="sb-foot" aria-hidden="true">
        <img src="/img/brownpig-logo-ondark.png" alt="" width="112" height="112"/>
        <span>A Brown Pig company</span>
      </div>
    </nav>`;
  bindNav(tab);
  try{
    if(tab==='week') await screenWeek();
    else if(tab==='growth') await screenGrowth();
    else if(tab==='scan') await screenScan();
    else if(tab==='insights') await screenBodyInsights();
    else if(tab==='journey') await screenJourney();
    else if(tab==='account') await screenAccount();
    else if(tab==='adult') await screenAdult();
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
  if(active==='insights') active='scan';
  // Account & settings sits under Profile, so Profile stays lit while you're in it.
  if(active==='account'||active==='adult') active='profile';
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
  $("#logout").onclick=async()=>{ await releasePushOnThisDevice(); await sb.auth.signOut(); state.user=null;state.athletes=[];state.active=null; renderAuth('login'); };
  const sw=$("#switch"); if(sw) sw.onclick=openSwitch;
}

// A small, consistent map of how the parent-facing product fits together. The bottom
// navigation names destinations; this names the job each destination does and includes
// Settings, which otherwise sits one level below Profile and was easy to miss.
function playbookPath(active){
  const steps=[
    { route:'week', label:'Plan', detail:'This week' },
    ...(state.canEdit===false ? [] : [{ route:'growth', label:'Growth', detail:'Measure' }]),
    { route:'journey', label:'Journey', detail:'Remember' },
    { route:'account', label:'Settings', detail:'Adjust' },
  ];
  const selected=(active==='scan'||active==='insights')?'growth':(active==='profile'?'account':active);
  return H`<nav class="playbook-path" aria-label="${esc(state.active?.first_name||'Athlete')}'s playbook">
    ${steps.map((s,i)=>H`<button type="button" data-flow="${s.route}" class="${s.route===selected?'on':''}"
      ${s.route===selected?'aria-current="page"':''}>
      <i>${i+1}</i><span>${s.label}<small>${s.detail}</small></span>
    </button>`).join('')}
  </nav>`;
}
function bindPlaybookPath(){
  document.querySelectorAll('[data-flow]').forEach(b=>{ b.onclick=()=>renderApp(b.dataset.flow); });
}

// ---- WEEK ----
