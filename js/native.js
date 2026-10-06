// ===================================================================
//  NATIVE — the App Store and Play Store builds (Capacitor)
// ===================================================================
// The same files run on the website and inside the iOS and Android apps. On the website every
// function here is a no-op or falls through to the browser behaviour that was already there, so
// nothing about playbookbp.com changes. Inside the app, Capacitor's native bridge defines
// window.Capacitor before any script runs, and www/vendor/capacitor.js (copied in by
// tools/native/build-www.mjs) adds registerPlugin. See NATIVE-APPS.md.
//
// What the app needs that a browser tab does not:
//   - links: the page's own origin is capacitor://localhost (iOS) or https://localhost (Android),
//     so anything sent to someone else, or to an email, must carry https://playbookbp.com instead;
//     /privacy and friends are not bundled and open on the website; links to other sites open in
//     an in-app browser sheet instead of replacing the app.
//   - incoming links: invites, team codes and email sign-in links arrive as Universal Links / App
//     Links, and Stripe hands back through parentplaybook://return (app-return.html).
//   - push: APNs / FCM device tokens instead of Web Push, stored as an apns: / fcm: endpoint in the
//     same push_subscriptions table (supabase/functions/_shared/native-push.mjs explains why).
//   - files: a WebView cannot "download"; exports go through the share sheet instead.
//
// Definitions only, per ARCHITECTURE.md. init.js calls initNativeShell().

const PP_PUBLIC_ORIGIN = 'https://playbookbp.com';
const PP_APP_SCHEME = 'parentplaybook:';
// Pages that exist on the website but are not bundled into the app.
const PP_SITE_PAGES = ['/privacy', '/terms', '/datadeletion', '/coaches', '/organizations'];
// Holds this phone's push endpoint (apns:<token> or fcm:<token>) while reminders are on.
const PP_PUSH_TOKEN_KEY = 'pp_native_push_token';

function isNativeApp(){
  try{ return !!(typeof window!=='undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform==='function' && window.Capacitor.isNativePlatform()); }
  catch(e){ return false; }
}
function nativePlatform(){
  if(!isNativeApp()) return 'web';
  try{ return window.Capacitor.getPlatform(); }catch(e){ return 'web'; }
}
// The origin to put in any link that leaves this device: share links, email redirect targets.
function publicOrigin(){ return isNativeApp() ? PP_PUBLIC_ORIGIN : location.origin; }

const ppNativePlugins = {};
function nativePlugin(name){
  if(!isNativeApp()) return null;
  if(!(name in ppNativePlugins)){
    try{
      const cap = window.Capacitor;
      ppNativePlugins[name] = typeof cap.registerPlugin==='function' ? cap.registerPlugin(name) : ((cap.Plugins||{})[name] || null);
    }catch(e){ ppNativePlugins[name] = null; }
  }
  return ppNativePlugins[name];
}

// Body fields an Edge Function needs to send Stripe back to the app rather than to the website.
function nativeReturnTo(){ return isNativeApp() ? { return_to:'app' } : {}; }

// ---- outbound links ----
function ppSitePage(pathname){
  return PP_SITE_PAGES.some(p => pathname===p || pathname===p+'.html');
}
// Opens a URL that is not part of the app in the system's in-app browser sheet. Returns false on
// the website, where the caller keeps its normal behaviour.
function openInAppBrowser(url){
  const browser = nativePlugin('Browser');
  if(!browser) return false;
  browser.open({ url, presentationStyle:'popover' }).catch(e=>{ console.error(e); });
  return true;
}

// Stripe Checkout and Connect. On the website the page navigates to Stripe and Stripe navigates
// back. In the app Stripe opens in a sheet; when the sheet closes, by the Done button or by
// app-return.html handing back through parentplaybook://return, the current screen is redrawn so a
// payment the webhook has recorded shows up.
function openCheckoutUrl(url){
  if(!isNativeApp()){ location.href = url; return; }
  const browser = nativePlugin('Browser');
  if(!browser){ location.href = url; return; }
  let handle = null;
  try{
    Promise.resolve(browser.addListener('browserFinished', ()=>{
      if(handle && handle.remove) handle.remove();
      nativeRefreshAfterBrowser();
    })).then(h=>{ handle = h; }).catch(()=>{});
  }catch(e){ console.error(e); }
  browser.open({ url, presentationStyle:'popover' }).catch(e=>{ console.error(e); location.href = url; });
}
async function nativeRefreshAfterBrowser(){
  try{
    if(typeof loadPremium==='function') await loadPremium();
    if(typeof state!=='undefined' && state.user && state.active && typeof renderApp==='function'){
      const tab=(location.hash||'').slice(1);
      renderApp(typeof APP_TABS!=='undefined' && APP_TABS.includes(tab) ? tab : 'week', true);
    }
  }catch(e){ console.error(e); }
}

// ---- files ----
// Exports, reports, calendar files and saved photos. A browser downloads them; a WebView would
// silently do nothing, so the app writes the file to its cache and opens the share sheet, where
// "Save to Files", AirDrop, Mail, Drive and "Save Image" all live.
function ppBlobToBase64(blob){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=>{ const s = String(r.result||''); resolve(s.slice(s.indexOf(',')+1)); };
    r.onerror = ()=>reject(r.error || new Error('could not read file'));
    r.readAsDataURL(blob);
  });
}
function ppSafeFileName(name){
  const clean = String(name||'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').slice(0, 120);
  return clean || 'file';
}
async function saveFile(blob, filename){
  if(!isNativeApp()){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 60000);
    return true;
  }
  const fs = nativePlugin('Filesystem'), share = nativePlugin('Share');
  if(!fs || !share) return false;
  try{
    const written = await fs.writeFile({ path: ppSafeFileName(filename), data: await ppBlobToBase64(blob), directory: 'CACHE' });
    await share.share({ title: filename, files: [written.uri] });
    return true;
  }catch(e){
    // Closing the share sheet without picking anything is not an error worth reporting.
    if(/cancel/i.test(String(e && (e.message || e)))) return false;
    console.error(e);
    if(typeof reportError==='function') reportError(e, 'native:saveFile');
    if(typeof toast==='function') toast('Could not save the file');
    return false;
  }
}
async function ppSaveFromHref(href, filename){
  const res = await fetch(href);
  if(!res.ok) throw new Error('could not fetch file: ' + res.status);
  return saveFile(await res.blob(), filename);
}

// One capture-phase listener covers every <a> in the app, so the dozens of templates that render
// links need no changes.
function ppInterceptLinks(ev){
  if(ev.defaultPrevented) return;
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
  if(!a) return;
  const raw = a.getAttribute('href') || '';
  if(!raw || raw.charAt(0)==='#' || /^(mailto|tel|sms|javascript):/i.test(raw)) return;
  let url;
  try{ url = new URL(raw, location.href); }catch(e){ return; }
  if(a.hasAttribute('download')){
    ev.preventDefault();
    ppSaveFromHref(url.href, a.getAttribute('download') || url.pathname.split('/').pop() || 'file')
      .catch(e=>{ console.error(e); if(typeof toast==='function') toast('Could not save the file'); });
    return;
  }
  if(url.origin===location.origin){
    if(ppSitePage(url.pathname)){ ev.preventDefault(); openInAppBrowser(PP_PUBLIC_ORIGIN + url.pathname + url.search + url.hash); }
    return;
  }
  if(/^https?:$/.test(url.protocol)){ ev.preventDefault(); openInAppBrowser(url.href); }
}

// ---- inbound links ----
// Universal Links / App Links (https://playbookbp.com/...) and parentplaybook://return?... from
// app-return.html. Both become a load of the bundled app with the same query, which is exactly how
// the website handles the same link: boot() reads ?invite=, ?team=, ?token_hash=, ?paid= and so on.
function nativeLocalUrlFor(incoming){
  let u;
  try{ u = new URL(incoming); }catch(e){ return null; }
  if(u.protocol===PP_APP_SCHEME) return '/' + (u.search || '') + (u.hash || '');
  if(u.origin===PP_PUBLIC_ORIGIN || u.origin==='https://www.playbookbp.com'){
    if(ppSitePage(u.pathname)) return null;
    return '/' + (u.search || '') + (u.hash || '');
  }
  return null;
}
function handleNativeUrl(incoming){
  const local = nativeLocalUrlFor(incoming);
  if(!local) return;
  const browser = nativePlugin('Browser');
  if(browser) browser.close().catch(()=>{});
  // Nothing to carry: the app is already open, so do not reload it.
  if(local==='/' ) return;
  if(local === location.pathname + location.search + location.hash) return;
  location.replace(local);
}
function nativeOpenPath(path){
  let u;
  try{ u = new URL(path, location.href); }catch(e){ return; }
  if(u.origin!==location.origin) return;
  if(u.pathname===location.pathname && u.search===location.search){ location.hash = u.hash; return; }
  location.replace(u.pathname + u.search + u.hash);
}

// ---- push (APNs / FCM) ----
function ppStoredPushToken(){ try{ return localStorage.getItem(PP_PUSH_TOKEN_KEY) || ''; }catch(e){ return ''; } }
function ppStorePushToken(t){ try{ if(t) localStorage.setItem(PP_PUSH_TOKEN_KEY, t); else localStorage.removeItem(PP_PUSH_TOKEN_KEY); }catch(e){} }

const ppPushWaiters = [];
function ppAwaitPushToken(push){
  return new Promise((resolve, reject)=>{
    const waiter = { resolve, reject };
    ppPushWaiters.push(waiter);
    setTimeout(()=>{
      const i = ppPushWaiters.indexOf(waiter);
      if(i!==-1){ ppPushWaiters.splice(i, 1); reject(new Error('timed out waiting for a device token')); }
    }, 20000);
    push.register().catch(e=>{
      const i = ppPushWaiters.indexOf(waiter);
      if(i!==-1){ ppPushWaiters.splice(i, 1); reject(e); }
    });
  });
}
// A device token becomes an endpoint with its push service as the scheme. Native rows have no
// Web Push keys; both key columns hold 'native', which claim_push_subscription compares like any
// other pair, so another parent's row on this phone is taken over by presenting the token itself.
function ppPushEndpoint(token){ return (nativePlatform()==='ios' ? 'apns:' : 'fcm:') + token; }
async function ppClaimPushToken(endpoint){
  const { data, error } = await sb.rpc('claim_push_subscription', { p_endpoint: endpoint, p_p256dh: 'native', p_auth: 'native' });
  if(error) throw error;
  return data === true;
}
// Apple and Google can rotate a token at any time. When a new one arrives for a device that has
// reminders on, move the row to it.
async function ppPushTokenArrived(token){
  const old = ppStoredPushToken();
  if(!token || !old) return;
  const endpoint = ppPushEndpoint(token);
  if(endpoint===old) return;
  if(typeof state==='undefined' || !state.user) return;
  try{
    if(await ppClaimPushToken(endpoint)){
      await sb.from('push_subscriptions').delete().eq('endpoint', old);
      ppStorePushToken(endpoint);
    }
  }catch(e){ console.error(e); if(typeof reportError==='function') reportError(e, 'push:native-refresh'); }
}

async function nativePushIsOn(){
  try{
    const push = nativePlugin('PushNotifications');
    const token = ppStoredPushToken();
    if(!push || !token || typeof state==='undefined' || !state.user) return false;
    const perm = await push.checkPermissions();
    if(perm.receive!=='granted') return false;
    const { data, error } = await sb.from('push_subscriptions').select('id').eq('user_id', state.user.id).eq('endpoint', token);
    return !error && !!(data && data.length);
  }catch(e){ return false; }
}

async function nativePushEnable(){
  const push = nativePlugin('PushNotifications');
  if(!push){ toast('Notifications aren’t available in this version of the app'); return false; }
  try{
    let perm = await push.checkPermissions();
    if(perm.receive==='prompt' || perm.receive==='prompt-with-rationale') perm = await push.requestPermissions();
    if(perm.receive!=='granted'){ toast('Turn on notifications for Parent Playbook in your phone’s Settings'); return false; }
    const endpoint = ppPushEndpoint(await ppAwaitPushToken(push));
    if(!(await ppClaimPushToken(endpoint))){
      toast('Could not turn on notifications');
      return false;
    }
    const old = ppStoredPushToken();
    if(old && old!==endpoint){ try{ await sb.from('push_subscriptions').delete().eq('endpoint', old); }catch(e){} }
    ppStorePushToken(endpoint);
    toast('Notifications on 🔔');
    return true;
  }catch(e){
    console.error(e);
    if(typeof reportError==='function') reportError(e, 'push:native-subscribe');
    toast('Could not turn on notifications');
    return false;
  }
}

// Logging out takes this phone's reminders with it, for the same reason as the web version in
// pwa.js: the token belongs to the phone, not to whoever was signed in. Runs before signOut().
async function nativePushRelease(){
  const token = ppStoredPushToken();
  if(!token) return;
  try{
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', token);
    if(error) console.error(error);
  }catch(e){ console.error(e); }
  ppStorePushToken('');
}

function ppInitNativePush(){
  const push = nativePlugin('PushNotifications');
  if(!push) return;
  ppListen(push, 'registration', t=>{
    const token = t && t.value;
    ppPushWaiters.splice(0).forEach(w=>w.resolve(token));
    ppPushTokenArrived(token);
  });
  ppListen(push, 'registrationError', e=>{
    const err = new Error((e && e.error) || 'push registration failed');
    ppPushWaiters.splice(0).forEach(w=>w.reject(err));
  });
  // A tapped reminder opens the screen it is about (the sender puts the path in `url`).
  ppListen(push, 'pushNotificationActionPerformed', action=>{
    const data = action && action.notification && action.notification.data;
    if(data && typeof data.url==='string' && data.url.charAt(0)==='/') nativeOpenPath(data.url);
  });
  // Re-register on every launch while reminders are on, so a rotated token is picked up.
  if(ppStoredPushToken()){
    ppNativeStep('push-refresh', ()=>push.checkPermissions().then(p=>{ if(p.receive==='granted') return push.register(); }));
  }
}

// One plugin missing or failing (an older build, a permission the OS withheld) must not stop the
// others, so each piece starts on its own.
function ppNativeStep(label, fn){
  try{
    const r = fn();
    if(r && typeof r.catch==='function') r.catch(e=>console.error('native:' + label, e));
  }catch(e){ console.error('native:' + label, e); }
}
function ppListen(plugin, event, fn){
  ppNativeStep(event, ()=>plugin.addListener(event, fn));
}

function initNativeShell(){
  if(!isNativeApp()) return;
  document.documentElement.classList.add('native-app', 'native-' + nativePlatform());
  document.addEventListener('click', ppInterceptLinks, true);
  // window.open from app code (account.js opens /privacy this way) gets the same treatment as a link.
  const nativeOpen = window.open;
  window.open = function(url, target, features){
    try{
      const u = new URL(String(url||''), location.href);
      if(u.origin===location.origin && ppSitePage(u.pathname)){ openInAppBrowser(PP_PUBLIC_ORIGIN + u.pathname + u.search + u.hash); return null; }
      if(u.origin!==location.origin && /^https?:$/.test(u.protocol)){ openInAppBrowser(u.href); return null; }
    }catch(e){}
    return nativeOpen.call(window, url, target, features);
  };
  const app = nativePlugin('App');
  if(app){
    ppListen(app, 'appUrlOpen', e=>handleNativeUrl(e && e.url));
    // A cold start from a link: the listener above was not there yet when it arrived.
    ppNativeStep('launchUrl', ()=>app.getLaunchUrl().then(r=>{
      if(!r || !r.url) return;
      const local = nativeLocalUrlFor(r.url);
      let done = false; try{ done = sessionStorage.getItem('pp_launch_url')===r.url; }catch(e){}
      if(local && local!=='/' && !done){
        try{ sessionStorage.setItem('pp_launch_url', r.url); }catch(e){}
        if(local !== location.pathname + location.search + location.hash) location.replace(local);
      }
    }));
  }
  ppNativeStep('push', ppInitNativePush);
  const splash = nativePlugin('SplashScreen');
  if(splash) setTimeout(()=>ppNativeStep('splash', ()=>splash.hide()), 250);
}
