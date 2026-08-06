async function renderApp(tab){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`
    <div id="screen"></div>
    <nav class="nav" id="nav">
      ${navBtn('week','Week','M4 5h16M4 12h16M4 19h10')}
      ${navBtn('growth','Growth','M4 19V5m0 14l6-6 4 4 6-8')}
      ${navBtn('journey','Journey','M12 6.5C10 5 7 5 4 6v12c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5V6c-3-1-6-1-8 .5z M12 6.5V19')}
      ${navBtn('profile','Profile','M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0')}
    </nav>`;
  bindNav(tab);
  if(tab==='week') await screenWeek();
  else if(tab==='growth') await screenGrowth();
  else if(tab==='journey') await screenJourney();
  else await screenProfile();
}
function navBtn(id,label,path){ return H`<button data-t="${id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>${label}</button>`; }
function bindNav(active){
  $("#nav").querySelectorAll('button').forEach(b=>{
    b.classList.toggle('on',b.dataset.t===active);
    b.onclick=()=>renderApp(b.dataset.t);
  });
}
function topBar(sub){
  const a=state.active; const initials=(a.first_name||'?')[0].toUpperCase();
  const switcher = state.athletes.length>1
    ? `<button class="pill" id="switch">Switch ▾</button>` : '';
  return H`<div class="top">
    <div class="who"><div class="avatar" style="background:${sportGradient(state.activeSportKey||'general')}">${initials}</div>
      <div><h3>${esc(a.first_name)}</h3><span>${esc(sub)}</span></div></div>
    <div style="display:flex;gap:8px;align-items:center">${switcher}
      <button class="pill" id="logout">Log out</button></div>
  </div>`;
}
function bindTop(){
  $("#logout").onclick=async()=>{ await sb.auth.signOut(); state.user=null;state.athletes=[];state.active=null; renderAuth('login'); };
  const sw=$("#switch"); if(sw) sw.onclick=openSwitch;
}

// ---- WEEK ----
