// ===================================================================
//  BOOT
// ===================================================================
// Capture a password-recovery link before Supabase clears the URL hash.
const PP_RECOVERY = (typeof location!=='undefined' && location.hash && location.hash.indexOf('type=recovery')!==-1);

(async function boot(){
  try{
    const { data:{ session } } = await sb.auth.getSession();
    state.user = session?.user || null;
    if(PP_RECOVERY){ return renderResetPassword(); }
    const token = inviteTokenFromUrl();
    if(token){ return renderRedeem(token); }
    if(!state.user) return renderAuth();
    await afterLogin();
  }catch(err){ console.error(err); bootError(); }
})();

function bootError(){
  root.innerHTML = H`<div class="center-screen">
    <div style="font-size:34px">😕</div>
    <div style="text-align:center;color:var(--muted);max-width:260px;line-height:1.5">Something went wrong loading Parent Playbook. Check your connection and try again.</div>
    <button class="btn" id="ppReload" style="max-width:200px">Reload</button></div>`;
  const r=document.getElementById('ppReload'); if(r) r.onclick=()=>location.reload();
}

sb.auth.onAuthStateChange((event,session)=>{
  state.user = session?.user || null;
  if(event==='PASSWORD_RECOVERY') renderResetPassword(); // backup for the reset-link flow
});

