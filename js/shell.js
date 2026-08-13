const APP_TABS=['week','growth','journey','profile'];
async function renderApp(tab, fromPop){
  document.body.classList.remove('auth'); setAppBg();
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
    <div id="screen"></div>
    <nav class="nav" id="nav">
      ${navBtn('week','Week','M4 5h16M4 12h16M4 19h10')}
      ${navBtn('growth','Growth','M4 19V5m0 14l6-6 4 4 6-8')}
      ${navBtn('journey','Journey','M12 6.5C10 5 7 5 4 6v12c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5V6c-3-1-6-1-8 .5z M12 6.5V19')}
      ${navBtn('profile','Profile','M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0')}
    </nav>`;
  bindNav(tab);
  try{
    if(tab==='week') await screenWeek();
    else if(tab==='growth') await screenGrowth();
    else if(tab==='journey') await screenJourney();
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
  $("#nav").querySelectorAll('button').forEach(b=>{
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
