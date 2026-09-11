// Definitions only — init.js calls these. (ARCHITECTURE.md golden rule: no load-time
// code in feature modules, because browsers don't hoist across separate <script> tags.)
function registerServiceWorker(){
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

// ---- Web Push ----
// Must match VAPID_PUBLIC_KEY in the Supabase edge-function secrets. If these two ever
// disagree, subscriptions are created against one key and pushed with another — the send
// fails with a 403 that looks like nothing at all from the parent's side.
const VAPID_PUBLIC = 'BKNftzPUHSgXaRl_K0lBrF5jhJuamG59JlskkQOMMwwslHx-rt2pjNMVsuQ8xqDCktqa6p9LvKezhC0qFMykeB0';
function urlB64ToUint8Array(b){ const pad='='.repeat((4-b.length%4)%4); const s=(b+pad).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(s); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
function pushSupported(){ return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); }
// Apple only delivers web push to a page installed to the Home Screen. In a normal Safari
// tab PushManager is simply absent, so pushSupported() is false — and telling an iPhone
// owner "not supported on this device" is both untrue and a dead end. It IS supported;
// it needs installing first. Detect that case specifically so we can say so.
function isIOSDevice(){
  var ua=navigator.userAgent||'';
  return (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) && !window.MSStream;
}
function isInstalled(){
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone===true;
}
function pushNeedsInstall(){ return isIOSDevice() && !isInstalled(); }
// Does an existing subscription belong to the key we are currently signing with?
// A PushSubscription is bound to the applicationServerKey it was created with, forever.
// Rotate VAPID keys and every existing subscription becomes undeliverable — but it is
// still returned by getSubscription(), so naive code reuses it and every send fails with
// a 403 that is invisible to the user. Compare the bytes and re-subscribe if they differ.
function subMatchesKey(sub, keyBytes){
  try{
    const cur = sub && sub.options && sub.options.applicationServerKey;
    if(!cur) return false;
    const a = new Uint8Array(cur);
    if(a.length !== keyBytes.length) return false;
    for(let i=0;i<a.length;i++) if(a[i] !== keyBytes[i]) return false;
    return true;
  }catch(e){ return false; }
}

// True if this device currently has a live subscription on the current key.
async function pushIsOn(){
  try{
    if(!pushSupported() || Notification.permission!=='granted') return false;
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    return !!(sub && subMatchesKey(sub, urlB64ToUint8Array(VAPID_PUBLIC)));
  }catch(e){ return false; }
}

// The honest version of "you can't do that yet": what to do, in the order you do it.
function showIosPushHelp(){
  const bg=sheet(H`<h3>Add Parent Playbook to your Home Screen first</h3>
    <p style="color:var(--muted);font-size:13.5px;margin:8px 0 14px;line-height:1.55">
      iPhone and iPad only allow reminders from apps saved to the Home Screen — that's an Apple rule, not ours. It takes about ten seconds, and it's free.</p>
    <ol style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.85">
      <li>Tap the <b>Share</b> button at the bottom of Safari (the square with an arrow)</li>
      <li>Scroll and tap <b>Add to Home Screen</b></li>
      <li>Tap <b>Add</b></li>
      <li>Open Parent Playbook from the new icon, then turn reminders on here</li>
    </ol>
    <button class="btn" id="iosOk">Got it</button>`);
  bg.querySelector('#iosOk').onclick=()=>bg.remove();
}

// Signing out has to take this device's push subscription with it.
//
// endpoint is UNIQUE on push_subscriptions and enablePush() upserts ON CONFLICT DO
// NOTHING. A browser's endpoint belongs to the browser and the VAPID key, not to whoever
// is signed in — so on a shared iPad the second parent to turn reminders on collided with
// the first parent's row, changed nothing, got no error, and was told "Notifications on".
// They then never received one. Worse, the first parent's weekly reminder still arrived
// on that device, and it reads "<child>'s week is ready" on the lock screen.
//
// RLS lets a guardian delete only their own row, so the person leaving is the only one who
// can clear it. This must therefore run BEFORE signOut(), while there is still a token to
// authorize the delete.
//
// getRegistration() rather than .ready: ready never resolves when nothing is registered,
// which would hang a logout on a browser that had never installed the worker.
async function releasePushOnThisDevice(){
  try{
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if(!sub) return;
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    if(error) console.error(error);
    // Drop the browser-side subscription too. Leaving it live would have the push service
    // still holding a delivery channel for a device with no row behind it.
    try{ await sub.unsubscribe(); }catch(e){ console.error(e); }
  }catch(e){ console.error(e); }
}

async function enablePush(){
  if(pushNeedsInstall()){ showIosPushHelp(); return false; }
  if(!pushSupported()){ toast('Notifications aren’t supported on this device'); return false; }
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){ toast('Turn on notifications in your browser settings'); return false; }
    const reg=await navigator.serviceWorker.ready;
    const keyBytes=urlB64ToUint8Array(VAPID_PUBLIC);
    let sub=await reg.pushManager.getSubscription();
    if(sub && !subMatchesKey(sub, keyBytes)){
      // Stale key. Drop the dead row first so a failed unsubscribe can't leave a ghost
      // in the table that we would keep trying to push at every Sunday.
      try{ await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); }catch(e){ console.error(e); }
      try{ await sub.unsubscribe(); }catch(e){ console.error(e); }
      sub=null;
    }
    if(!sub) sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:keyBytes });
    const j=sub.toJSON();
    // claim_push_subscription rather than an upsert. The table is UNIQUE on endpoint and
    // an endpoint belongs to the BROWSER, so on a shared device the row may still be held
    // by whoever used this browser last. The old upsert wrote ON CONFLICT DO NOTHING,
    // which returns success whether it wrote a row or silently declined to, and there is
    // no update policy that would let it do anything else.
    //
    // The function takes the endpoint from another guardian only when we can also produce
    // the subscription's own keys, which only the browser holding it has. It returns false
    // rather than raising when it will not, so there is a truthful answer to show either
    // way and no read-back is needed to find out what actually happened.
    const { data:claimed, error }=await sb.rpc('claim_push_subscription',{
      p_endpoint:sub.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth });
    if(error){ console.error(error); reportError(error,'push:subscribe'); toast('Could not turn on notifications'); return false; }
    if(claimed!==true){
      reportError(new Error('push endpoint held by another account and the keys did not match'),'push:subscribe');
      toast('Another account on this device still has reminders on. Log out of it first.');
      return false;
    }
    toast('Notifications on 🔔');
    return true;
  }catch(e){ console.error(e); reportError(e,'push:subscribe'); toast('Could not turn on notifications'); return false; }
}

// ---- return from Stripe (Checkout / Connect) ----
function handleStripeReturn(){
  var p; try{ p=new URLSearchParams(location.search); }catch(e){ return; }
  var paid=p.get('paid'), cancel=p.get('paycancel'), st=p.get('stripe');
  if(!paid && !cancel && !st) return;
  try{ history.replaceState({},'',location.pathname); }catch(e){}
  setTimeout(function(){
    if(paid){ try{ toast('Payment complete 🎉'); }catch(e){} if(typeof notifyBooking==='function') notifyBooking(paid,'paid'); }
    else if(cancel){ try{ toast('Payment canceled'); }catch(e){} }
    else if(st==='return'){ try{ toast('Stripe payout setup updated'); }catch(e){} }
  }, 900);
}

// ---- Add to Home Screen (install without an app store) ----
function initInstallBanner(){
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
  // beforeinstallprompt fires once, early — usually while the marketing page is still
  // up and long before this banner exists. landing.js stashes it; pick it up here so
  // the in-app Install button still works.
  var deferred=window.__ppInstallPrompt||null;
  function armed(){ go.hidden=false; steps.hidden=true;
    sub.textContent='One-tap access — no app store needed'; show(); }
  if(deferred) armed();
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault(); deferred=e; window.__ppInstallPrompt=e; armed();
  });
  window.addEventListener('appinstalled', function(){ hide(true); });
  go.onclick=async function(){
    if(!deferred) return;
    deferred.prompt();
    try{ await deferred.userChoice; }catch(e){}
    deferred=null; window.__ppInstallPrompt=null; hide(true);
  };
  // iOS Safari can't prompt — show the manual Share → Add to Home Screen steps
  var ua=navigator.userAgent||'';
  var isIOS=/iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isSafari=/^((?!chrome|crios|fxios|edgios|android).)*safari/i.test(ua);
  if(isIOS && isSafari){
    go.hidden=true;
    // iPhone is the one platform where installing is REQUIRED for reminders to work at
    // all, so this is where saying why actually changes the outcome.
    sub.textContent='Required on iPhone for your Sunday reminder';
    steps.hidden=false;
    steps.innerHTML='Tap the <b>Share</b> button <svg class="shr" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2F6FB0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"/></svg>, then <b>“Add to Home Screen.”</b>';
    setTimeout(show, 1400);
  }
}
