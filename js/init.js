// ===================================================================
//  BOOT
// ===================================================================
(async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  state.user = session?.user || null;

  const token = inviteTokenFromUrl();
  if(token){ return renderRedeem(token); }

  if(!state.user) return renderAuth();
  await afterLogin();
})();

sb.auth.onAuthStateChange((_e,session)=>{ state.user = session?.user || null; });

