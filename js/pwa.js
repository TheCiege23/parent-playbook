if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{})); }

// ---- Web Push ----
const VAPID_PUBLIC = 'BN_7PR-B4kxktA8fKWiVo60DP-SXv_A888D3MxMHhPe4_Cr29UjAapot7sdbCdh1_HhjAt0-gVwUSb1tYRfcgps';
function urlB64ToUint8Array(b){ const pad='='.repeat((4-b.length%4)%4); const s=(b+pad).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(s); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
function pushSupported(){ return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); }
async function enablePush(){
  if(!pushSupported()){ toast('Notifications aren’t supported on this device'); return; }
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){ toast('Turn on notifications in your browser settings'); return; }
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8Array(VAPID_PUBLIC) });
    const j=sub.toJSON();
    const { error }=await sb.from('push_subscriptions').upsert(
      { user_id:state.user.id, endpoint:sub.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth },
      { onConflict:'endpoint', ignoreDuplicates:true });
    if(error){ console.error(error); toast('Could not turn on notifications'); return; }
    toast('Notifications on 🔔');
  }catch(e){ console.error(e); toast('Could not turn on notifications'); }
}

// ---- return from Stripe (Checkout / Connect) ----
(function(){
  var p; try{ p=new URLSearchParams(location.search); }catch(e){ return; }
  var paid=p.get('paid'), cancel=p.get('paycancel'), st=p.get('stripe');
  if(!paid && !cancel && !st) return;
  try{ history.replaceState({},'',location.pathname); }catch(e){}
  setTimeout(function(){
    if(paid){ try{ toast('Payment complete 🎉'); }catch(e){} if(typeof notifyBooking==='function') notifyBooking(paid,'paid'); }
    else if(cancel){ try{ toast('Payment canceled'); }catch(e){} }
    else if(st==='return'){ try{ toast('Stripe payout setup updated'); }catch(e){} }
  }, 900);
})();

// ---- Add to Home Screen (install without an app store) ----
(function(){
  var KEY='pp_a2hs_dismissed';
  var el=document.getElementById('a2hs'); if(!el) return;
  var go=document.getElementById('a2hsGo'), x=document.getElementById('a2hsX'),
      sub=document.getElementById('a2hsSub'), steps=document.getElementById('a2hsSteps');
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone===true;
  var dismissed=false; try{ dismissed=localStorage.getItem(KEY)==='1'; }catch(e){}
  if(standalone || dismissed) return;
  function show(){ el.classList.add('show'); }
  function hide(persist){ el.classList.remove('show'); if(persist){ try{localStorage.setItem(KEY,'1');}catch(e){} } }
  x.onclick=function(){ hide(true); };
  var deferred=null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault(); deferred=e; go.hidden=false; steps.hidden=true;
    sub.textContent='One-tap access — no app store needed'; show();
  });
  window.addEventListener('appinstalled', function(){ hide(true); });
  go.onclick=async function(){
    if(!deferred) return;
    deferred.prompt();
    try{ await deferred.userChoice; }catch(e){}
    deferred=null; hide(true);
  };
  // iOS Safari can't prompt — show the manual Share → Add to Home Screen steps
  var ua=navigator.userAgent||'';
  var isIOS=/iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isSafari=/^((?!chrome|crios|fxios|edgios|android).)*safari/i.test(ua);
  if(isIOS && isSafari){
    go.hidden=true;
    sub.textContent='Keep it one tap away on your phone';
    steps.hidden=false;
    steps.innerHTML='Tap the <b>Share</b> button <svg class="shr" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2F6FB0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"/></svg>, then <b>“Add to Home Screen.”</b>';
    setTimeout(show, 1400);
  }
})();
