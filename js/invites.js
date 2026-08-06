// ===================================================================
//  REDEEM INVITE
// ===================================================================
async function renderRedeem(token){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Opening invite…</div></div>`;
  const { data, error } = await sb.rpc('invite_preview',{ p_token:token });
  const info = Array.isArray(data)?data[0]:data;
  if(error||!info||info.status==='not_found'){
    return root.innerHTML = redeemCard('This invite link is invalid', 'The link may be mistyped or was deleted.', false);
  }
  if(info.status!=='pending'){
    const map={revoked:'This invite was revoked.',accepted:'This invite has already been used.',expired:'This invite has expired.'};
    return root.innerHTML = redeemCard('Invite unavailable', map[info.status]||'This invite can no longer be used.', false);
  }
  const roleLabel = info.invite_role==='co_parent'?'co-parent (can edit)':'family view';
  root.innerHTML = H`<div class="app-pad" style="padding-top:52px">
    <div style="text-align:center;margin-bottom:22px">
      <div class="avatar" style="width:56px;height:56px;border-radius:16px;font-size:24px;margin:0 auto 14px">🤝</div>
      <h1 style="font-size:24px">You've been invited</h1>
      <p style="color:var(--muted);margin:8px auto 0;max-width:320px">
        <b>${esc(info.inviter)}</b> is sharing <b>${esc(info.athlete_first_name)}'s</b> Parent Playbook with you as <b>${esc(roleLabel)}</b>.</p>
    </div>
    <div class="card app-pad" id="rbox"></div>
  </div>`;
  const box=$("#rbox");
  if(state.user){
    box.innerHTML=H`<p style="font-size:14px;margin:0 0 14px">You're logged in as ${esc(state.user.email)}. Accept to get access.</p>
      <button class="btn" id="accept">Accept invite</button>
      <button class="btn ghost" id="skip" style="margin-top:10px">Not now</button>`;
    $("#accept").onclick=()=>acceptAndEnter(token);
    $("#skip").onclick=()=>{ history.replaceState({},'',location.pathname); afterLogin(); };
  }else{
    box.innerHTML=H`<p style="font-size:14px;margin:0 0 14px">Create a free account (or log in) to accept. You'll only ever see athletes shared with you.</p>
      <button class="btn" id="su">Create account & accept</button>
      <button class="btn ghost" id="li" style="margin-top:10px">I already have an account</button>`;
    $("#su").onclick=()=>renderAuth('signup');
    $("#li").onclick=()=>renderAuth('login');
  }
}
function redeemCard(title,sub,retry){
  return H`<div class="app-pad" style="padding-top:70px;text-align:center">
    <div class="avatar" style="width:56px;height:56px;border-radius:16px;font-size:24px;margin:0 auto 14px;background:var(--danger)">!</div>
    <h2 style="font-size:22px">${esc(title)}</h2>
    <p style="color:var(--muted);margin:10px auto 22px;max-width:300px">${esc(sub)}</p>
    <div style="max-width:280px;margin:0 auto"><a class="btn ghost" href="${location.pathname}">Go to Parent Playbook</a></div>
  </div>`;
}
async function acceptAndEnter(token){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Accepting invite…</div></div>`;
  const { error } = await sb.rpc('accept_invite',{ p_token:token });
  history.replaceState({},'',location.pathname);
  if(error){
    root.innerHTML = redeemCard('Could not accept', friendlyAcceptErr(error.message), false);
    return;
  }
  toast('Access granted 🎉');
  await afterLogin();
}
function friendlyAcceptErr(m){
  if(/expired/i.test(m)) return 'This invite has expired. Ask for a new link.';
  if(/revoked/i.test(m)) return 'This invite was revoked.';
  if(/already/i.test(m)) return 'This invite was already used.';
  if(/authenticated/i.test(m)) return 'Please log in first, then open the link again.';
  return m;
}
